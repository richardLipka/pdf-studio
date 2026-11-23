import { ParseSpeeds, PDFDict, PDFDocument, PDFFont, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { ContentOperation, TEXT_SHOW_OPERATORS, tokenizeContentStream } from './pdfContentTokenizer';
import { FontCodeMap, PageTextModel, TextBlock, TextLine, TextRun, measureLineLeading } from './pdfTextModel';
import {
  getPageContentStream,
  getPageLocalResourceDict,
  safeGetPageResources,
  writePageStreamText,
} from './contentStreamEditor';
import { PdfFontProvider, prepareTextForFont } from './pdfFonts';
import { logger } from './logger';

/**
 * Replaces the text of one text object (BT ... ET) in a page content stream.
 *
 * The new text is written at the position, size and colour of the original. It is encoded with the
 * original font's own character codes when that font contains every character needed (typical for
 * corrections within the same alphabet); otherwise a substitute font is embedded and used for this
 * text object only (e.g. a subset font lacking a newly typed letter).
 */

export interface TextBlockEditResult {
  updatedPdfBytes: ArrayBuffer;
  updatedStream: string;
  /** True when the original font could not encode the new text and a substitute font was embedded */
  fontSubstituted: boolean;
  substituteFontName?: string;
  error?: string;
}

const POSITIONING_OPERATORS = new Set(['Td', 'TD', 'Tm', 'T*']);

export const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(4).replace(/0+$/, '');
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed;
};

const toHex = (codes: number[], codeBytes: 1 | 2): string =>
  `<${codes.map((c) => c.toString(16).padStart(codeBytes * 2, '0')).join('').toUpperCase()}>`;

/** Text-showing operation for one line in the original font, or null if a character has no code */
function encodeLineWithOriginalFont(line: string, map: FontCodeMap): string | null {
  const parts: Array<string | number> = [];
  let pending: number[] = [];
  for (const ch of Array.from(line)) {
    const code = map.codes.get(ch);
    if (code !== undefined) {
      pending.push(code);
      continue;
    }
    if (ch === ' ') {
      // Subset fonts often drop the space glyph; a word gap can be written as a TJ offset instead
      if (pending.length > 0) parts.push(toHex(pending, map.codeBytes));
      pending = [];
      parts.push(-250);
      continue;
    }
    return null;
  }
  if (pending.length > 0 || parts.length === 0) parts.push(toHex(pending, map.codeBytes));
  if (parts.length === 1 && typeof parts[0] === 'string') return `${parts[0]} Tj`;
  return `[${parts.map((p) => (typeof p === 'number' ? String(p) : p)).join(' ')}] TJ`;
}

/** Substitute font family / style guessed from the original PostScript font name */
function describeOriginalFont(fontName: string): { family: string; bold: boolean; italic: boolean } {
  const name = fontName.replace(/^[A-Z]{6}\+/, '');
  const isSerif = /times|serif|georgia|garamond|cambria|minion|book/i.test(name) && !/sans/i.test(name);
  const isMono = /courier|mono|consol/i.test(name);
  return {
    family: isMono ? 'Courier' : isSerif ? 'Times' : 'Helvetica',
    bold: /bold|black|heavy|semibold|demi/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

const uniqueResourceName = (fontDict: PDFDict, prefix: string): string => {
  const existing = new Set(fontDict.keys().map((k) => k.asString().replace(/^\//, '')));
  let n = 1;
  while (existing.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

/**
 * Font dictionary of the resources used by the stream part (page or one of its Form XObjects).
 * Always creates page-local shallow copies of shared Form XObjects and their /Resources / /Font
 * dictionaries so adding a substitute font never mutates unedited pages sharing the same XObject.
 */
function fontDictForPart(pdfDoc: PDFDocument, pageIndex: number, formName: string | undefined): PDFDict | null {
  const page = pdfDoc.getPage(pageIndex);
  if (!formName) return getPageLocalResourceDict(pdfDoc, page, 'Font');
  const context = pdfDoc.context;
  const pageXObjects = safeGetPageResources(page.node)?.lookup(PDFName.of('XObject'));
  if (!(pageXObjects instanceof PDFDict)) return null;
  const formObj = context.lookup(pageXObjects.get(PDFName.of(formName)));
  if (!(formObj instanceof PDFRawStream)) return null;

  // Clone the Form XObject and its /Resources & /Font dicts onto a page-local /XObject map
  const localXObjects = getPageLocalResourceDict(pdfDoc, page, 'XObject');
  const clonedForm = formObj.clone(context);
  const existingResources = clonedForm.dict.lookup(PDFName.of('Resources'));
  const localResources =
    existingResources instanceof PDFDict ? existingResources.clone(context) : context.obj({});
  clonedForm.dict.set(PDFName.of('Resources'), localResources);

  const existingFonts = localResources.lookup(PDFName.of('Font'));
  const localFonts = existingFonts instanceof PDFDict ? existingFonts.clone(context) : context.obj({});
  localResources.set(PDFName.of('Font'), localFonts);

  localXObjects.set(PDFName.of(formName), context.register(clonedForm));
  return localFonts;
}

const rawOf = (streamText: string, op: ContentOperation) => streamText.substring(op.start, op.end);

/** Builds the replacement text object */
export function buildTextObject(
  streamText: string,
  block: TextBlock,
  fontOperator: string | null,
  lineOperations: string[],
  leading: number,
  restoreFontOperator: string | null,
  textMatrixOverride?: [number, number, number, number, number, number]
): string {
  const operations = tokenizeContentStream(streamText, block.startIndex, block.endIndex);
  const firstShow = operations.findIndex((op) => TEXT_SHOW_OPERATORS.has(op.operator));
  const isStateOperation = (op: ContentOperation) =>
    op.operator !== 'BT' &&
    op.operator !== 'ET' &&
    !POSITIONING_OPERATORS.has(op.operator) &&
    !TEXT_SHOW_OPERATORS.has(op.operator);

  // State set before the first text: colour, spacing, rendering mode, marked content... (the font is
  // written explicitly below)
  const before = operations
    .slice(0, Math.max(0, firstShow))
    .filter((op) => isStateOperation(op) && op.operator !== 'Tf')
    .map((op) => rawOf(streamText, op));
  // State changes after the first text are replayed at the end, so the text objects that follow
  // (which may inherit font, colour or spacing from this one) render exactly as before
  const after = operations
    .slice(firstShow + 1)
    .filter(isStateOperation)
    .map((op) => rawOf(streamText, op));
  const afterSetsFont = operations.slice(firstShow + 1).some((op) => op.operator === 'Tf');

  const first = block.runs[0];
  const tm = textMatrixOverride ?? first.textMatrix;
  const lines: string[] = [];
  lineOperations.forEach((operation, idx) => {
    if (idx > 0) lines.push(`0 ${formatNumber(-leading)} Td`);
    lines.push(operation);
  });

  return [
    'BT',
    ...before,
    ...(fontOperator ? [fontOperator] : []),
    `${tm.map(formatNumber).join(' ')} Tm`,
    ...lines,
    ...after,
    ...(restoreFontOperator && !afterSetsFont ? [restoreFontOperator] : []),
    'ET',
  ].join('\n');
}

/**
 * Rebuilds the stream slice of a single TextLine in-place: replaces its text-showing operators
 * (or removes them when `replacementOp === null`) while keeping every positioning (`Td`, `TD`,
 * `Tm`, `T*`), font (`Tf`), colour, and graphics-state operator intact so following lines inside
 * the same `BT ... ET` never shift or lose their styling.
 */
function rebuildLineSlice(
  streamText: string,
  line: TextLine,
  replacementOp: string | null,
  fontPrefix: string,
  fontRestore: string
): { start: number; end: number; replacement: string } {
  const first = line.runs[0];
  const lineStart = first.start;
  const lineEnd = line.runs[line.runs.length - 1].end;
  const runStarts = new Set(line.runs.map((r) => r.start));
  const firstShowStart = first.start;

  let rebuilt = '';
  let cursor = lineStart;
  for (const op of tokenizeContentStream(streamText, lineStart, lineEnd)) {
    if (!TEXT_SHOW_OPERATORS.has(op.operator) || !runStarts.has(op.start)) continue;
    rebuilt += streamText.substring(cursor, op.start);
    cursor = op.end;
    // ' and " also move to the next line (and " sets spacing); keep that effect
    const lineMove =
      op.operator === "'"
        ? 'T* '
        : op.operator === '"'
        ? `${op.operands[0]?.raw ?? '0'} Tw ${op.operands[1]?.raw ?? '0'} Tc T* `
        : '';
    if (replacementOp !== null && op.start === firstShowStart) {
      rebuilt += lineMove + fontPrefix + replacementOp + fontRestore;
    } else {
      rebuilt += lineMove.trim();
    }
  }
  rebuilt += streamText.substring(cursor, lineEnd);
  return { start: lineStart, end: lineEnd, replacement: rebuilt };
}

/**
 * Text-showing operations for the given lines: the original font's codes when it has every
 * character, otherwise a substitute font registered in the resources of the run's stream part.
 * Optional `substituteCache` avoids embedding duplicate substitute fonts across multiple lines.
 */
export async function encodeForRun(
  pdfDoc: PDFDocument,
  pageIndex: number,
  model: PageTextModel,
  layout: { kind: string; name?: string }[] | undefined,
  run: TextRun,
  partIndex: number,
  lines: string[],
  substituteCache?: Map<string, { font: PDFFont; resourceName: string }>,
  fontProvider?: PdfFontProvider
): Promise<{ fontOperator: string | null; originalFontOperator: string | null; lineOperations: string[]; substituteFont: PDFFont | null } | { error: string }> {
  const originalFontOperator = run.fontResource ? `/${run.fontResource} ${formatNumber(run.fontSize)} Tf` : null;
  const codeMap = model.fontCodeMaps.get(run.fontKey);
  const originalEncoded = codeMap ? lines.map((line) => encodeLineWithOriginalFont(line, codeMap)) : null;
  if (originalEncoded && originalEncoded.every((op): op is string => op !== null)) {
    return { fontOperator: originalFontOperator, originalFontOperator, lineOperations: originalEncoded, substituteFont: null };
  }
  const { family, bold, italic } = describeOriginalFont(run.fontName);
  const provider = fontProvider ?? new PdfFontProvider(pdfDoc);
  const substituteFont = await provider.fontFor(family, bold, italic, lines.join(''));
  const cacheKey = `${partIndex}|${substituteFont.ref.toString()}`;
  let cached = substituteCache?.get(cacheKey);
  if (!cached) {
    const partLayout = layout?.[partIndex];
    const fontDict = fontDictForPart(pdfDoc, pageIndex, partLayout?.kind === 'form' ? partLayout.name : undefined);
    if (!fontDict) return { error: 'Nelze přidat náhradní písmo do zdrojů stránky.' };
    const resourceName = uniqueResourceName(fontDict, 'PSF');
    fontDict.set(PDFName.of(resourceName), substituteFont.ref as PDFRef);
    cached = { font: substituteFont, resourceName };
    substituteCache?.set(cacheKey, cached);
  }
  return {
    fontOperator: `/${cached.resourceName} ${formatNumber(run.fontSize)} Tf`,
    originalFontOperator,
    lineOperations: lines.map((line) => `${cached!.font.encodeText(prepareTextForFont(cached!.font, line)).toString()} Tj`),
    substituteFont: cached.font,
  };
}

/**
 * Removes a single line from a text object (`BT ... ET`) without affecting any other lines in
 * that same text object. When the line is the only remaining line in the block, the entire
 * `BT ... ET` segment is cleanly removed.
 */
export async function removeTextLineContent(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  model: PageTextModel,
  lineId: string
): Promise<TextBlockEditResult> {
  const fail = (error: string): TextBlockEditResult => ({
    updatedPdfBytes: pdfDocBytes,
    updatedStream: model.streamText,
    fontSubstituted: false,
    error,
  });
  const line = model.linesById.get(lineId);
  const block = line ? model.blocksById.get(line.segmentId) : undefined;
  if (!model.aligned || !line || !block || line.runs.length === 0) {
    return fail('Řádek textu nelze na stránce spolehlivě určit.');
  }
  const current = await getPageContentStream(pdfDocBytes, pageIndex);
  if (current.error || current.streamText !== model.streamText) {
    return fail('Obsah stránky se mezitím změnil. Vyberte řádek znovu.');
  }

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });

    let newStreamText: string;
    if (block.lines.length <= 1) {
      newStreamText =
        model.streamText.substring(0, block.startIndex) + model.streamText.substring(block.endIndex);
    } else {
      const slice = rebuildLineSlice(model.streamText, line, null, '', '');
      newStreamText =
        model.streamText.substring(0, slice.start) + slice.replacement + model.streamText.substring(slice.end);
    }

    const page = pdfDoc.getPage(pageIndex);
    const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);
    const saved = await pdfDoc.save({ objectsPerTick: 500 });
    logger.success('edit', `Řádek ${lineId} na straně ${pageIndex + 1} byl odstraněn`, { lineId });
    return {
      updatedPdfBytes: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
      updatedStream,
      fontSubstituted: false,
    };
  } catch (err: any) {
    logger.error('edit', `Odstranění řádku ${lineId} selhalo: ${err?.message || err}`);
    return fail(err?.message || String(err));
  }
}

/**
 * Replaces the text of one line of a text object and nothing else. The first text-showing
 * operation of the line gets the new text (the text position there is exactly where the line
 * starts); the line's other text-showing operations are removed, while every positioning and
 * state operation stays, so the lines that follow keep their positions.
 */
export async function replaceTextLineContent(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  model: PageTextModel,
  lineId: string,
  newText: string
): Promise<TextBlockEditResult> {
  const fail = (error: string): TextBlockEditResult => ({
    updatedPdfBytes: pdfDocBytes,
    updatedStream: model.streamText,
    fontSubstituted: false,
    error,
  });
  const line = model.linesById.get(lineId);
  if (!model.aligned || !line || line.runs.length === 0) return fail('Řádek textu nelze na stránce spolehlivě určit.');
  const text = newText.replace(/[\r\n]+/g, ' ');
  if (text === line.text) return fail('Text řádku se nezměnil.');
  if (text.trim() === '') {
    return removeTextLineContent(pdfDocBytes, pageIndex, model, lineId);
  }

  const current = await getPageContentStream(pdfDocBytes, pageIndex);
  if (current.error || current.streamText !== model.streamText) {
    return fail('Obsah stránky se mezitím změnil. Vyberte řádek znovu.');
  }

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });
    const first = line.runs[0];
    const encoded = await encodeForRun(pdfDoc, pageIndex, model, current.layout, first, first.partIndex, [text]);
    if ('error' in encoded) return fail(encoded.error);

    const useSubstitute = Boolean(encoded.substituteFont);
    const fontPrefix = useSubstitute && encoded.fontOperator ? `${encoded.fontOperator} ` : '';
    const fontRestore = useSubstitute && encoded.originalFontOperator ? ` ${encoded.originalFontOperator}` : '';
    const slice = rebuildLineSlice(model.streamText, line, encoded.lineOperations[0], fontPrefix, fontRestore);
    const newStreamText =
      model.streamText.substring(0, slice.start) + slice.replacement + model.streamText.substring(slice.end);

    const page = pdfDoc.getPage(pageIndex);
    const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);
    const saved = await pdfDoc.save({ objectsPerTick: 500 });
    logger.success('edit', `Řádek ${lineId} na straně ${pageIndex + 1} byl přepsán`, {
      lineId,
      fontSubstituted: Boolean(encoded.substituteFont),
    });
    return {
      updatedPdfBytes: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
      updatedStream,
      fontSubstituted: Boolean(encoded.substituteFont),
      substituteFontName: encoded.substituteFont?.name,
    };
  } catch (err: any) {
    logger.error('edit', `Přepis řádku ${lineId} selhal: ${err?.message || err}`);
    return fail(err?.message || String(err));
  }
}

export async function replaceTextBlockContent(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  model: PageTextModel,
  segmentId: string,
  newText: string
): Promise<TextBlockEditResult> {
  const fail = (error: string): TextBlockEditResult => ({
    updatedPdfBytes: pdfDocBytes,
    updatedStream: model.streamText,
    fontSubstituted: false,
    error,
  });

  const block = model.blocksById.get(segmentId);
  if (!model.aligned || !block || block.runs.length === 0) {
    return fail('Textový blok nelze na stránce spolehlivě určit.');
  }

  const current = await getPageContentStream(pdfDocBytes, pageIndex);
  if (current.error || current.streamText !== model.streamText) {
    return fail('Obsah stránky se mezitím změnil. Vyberte blok znovu.');
  }

  try {
    const newLines = newText.replace(/\r\n?/g, '\n').split('\n');

    // Multi-line PDF element (BT ... ET containing 2+ positioned lines):
    // Apply surgical per-line replacements so unchanged lines keep their exact original bytes,
    // coordinates, vertical gaps, columns, fonts, bold/italic styles, and colors!
    if (block.lines.length > 1) {
      const pdfDoc = await PDFDocument.load(pdfDocBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
        parseSpeed: ParseSpeeds.Fast,
      });

      if (newLines.every((l) => l.trim() === '')) {
        const newStreamText =
          model.streamText.substring(0, block.startIndex) + model.streamText.substring(block.endIndex);
        const page = pdfDoc.getPage(pageIndex);
        const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);
        const saved = await pdfDoc.save({ objectsPerTick: 500 });
        return {
          updatedPdfBytes: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
          updatedStream,
          fontSubstituted: false,
        };
      }

      const substituteCache = new Map<string, { font: PDFFont; resourceName: string }>();
      const fontProvider = new PdfFontProvider(pdfDoc);
      const splices: Array<{ start: number; end: number; replacement: string }> = [];
      let anyFontSubstituted = false;
      let lastSubstituteName: string | undefined;

      for (let idx = 0; idx < block.lines.length; idx++) {
        const origLine = block.lines[idx];
        const targetText = idx < newLines.length ? newLines[idx] : '';
        if (targetText === origLine.text) continue; // Untouched line stays 100% intact

        if (targetText.trim() === '') {
          splices.push(rebuildLineSlice(model.streamText, origLine, null, '', ''));
          continue;
        }

        const firstRun = origLine.runs[0];
        const encoded = await encodeForRun(
          pdfDoc,
          pageIndex,
          model,
          current.layout,
          firstRun,
          firstRun.partIndex,
          [targetText],
          substituteCache,
          fontProvider
        );
        if ('error' in encoded) return fail(encoded.error);
        const useSub = Boolean(encoded.substituteFont);
        if (useSub) {
          anyFontSubstituted = true;
          lastSubstituteName = encoded.substituteFont?.name;
        }
        const fontPrefix = useSub && encoded.fontOperator ? `${encoded.fontOperator} ` : '';
        const fontRestore = useSub && encoded.originalFontOperator ? ` ${encoded.originalFontOperator}` : '';
        splices.push(rebuildLineSlice(model.streamText, origLine, encoded.lineOperations[0], fontPrefix, fontRestore));
      }

      // Append any newly added lines below the last original line using measured leading
      if (newLines.length > block.lines.length) {
        const extraLines = newLines.slice(block.lines.length);
        const lastOrigLine = block.lines[block.lines.length - 1];
        const lastRun = lastOrigLine.runs[0];
        const insertAt = lastOrigLine.runs[lastOrigLine.runs.length - 1].end;
        const leading = measureLineLeading(block) ?? Math.abs(lastRun.fontSize) * 1.2;

        const encodedExtra = await encodeForRun(
          pdfDoc,
          pageIndex,
          model,
          current.layout,
          lastRun,
          lastRun.partIndex,
          extraLines,
          substituteCache,
          fontProvider
        );
        if ('error' in encodedExtra) return fail(encodedExtra.error);
        const useSub = Boolean(encodedExtra.substituteFont);
        if (useSub) {
          anyFontSubstituted = true;
          lastSubstituteName = encodedExtra.substituteFont?.name;
        }
        const extraChunks: string[] = [];
        if (useSub && encodedExtra.fontOperator) extraChunks.push(encodedExtra.fontOperator);
        for (const op of encodedExtra.lineOperations) {
          extraChunks.push(`0 ${formatNumber(-leading)} Td`);
          extraChunks.push(op);
        }
        if (useSub && encodedExtra.originalFontOperator) extraChunks.push(encodedExtra.originalFontOperator);
        splices.push({ start: insertAt, end: insertAt, replacement: `\n${extraChunks.join('\n')}` });
      }

      if (splices.length === 0) {
        return {
          updatedPdfBytes: pdfDocBytes,
          updatedStream: model.streamText,
          fontSubstituted: false,
        };
      }

      // Apply splices from end to start so earlier offsets remain valid
      splices.sort((a, b) => b.start - a.start || b.end - a.end);
      let newStreamText = model.streamText;
      for (const sp of splices) {
        newStreamText = newStreamText.substring(0, sp.start) + sp.replacement + newStreamText.substring(sp.end);
      }

      const page = pdfDoc.getPage(pageIndex);
      const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);
      const saved = await pdfDoc.save({ objectsPerTick: 500 });

      logger.success('edit', `Víceřádkový blok ${segmentId} na straně ${pageIndex + 1} byl přepsán po řádcích`, {
        segmentId,
        linesCount: block.lines.length,
        changedSlices: splices.length,
        fontSubstituted: anyFontSubstituted,
      });

      return {
        updatedPdfBytes: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
        updatedStream,
        fontSubstituted: anyFontSubstituted,
        substituteFontName: lastSubstituteName,
      };
    }

    // Single-line PDF element (may remain 1 line or expand into multiple lines)
    const first = block.runs[0];
    const lines = newLines;
    const leading = measureLineLeading(block) ?? Math.abs(first.fontSize) * 1.2;
    const originalFontOperator = first.fontResource
      ? `/${first.fontResource} ${formatNumber(first.fontSize)} Tf`
      : null;

    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });

    // 1. Original font, when every character of the new text has a code in it
    const codeMap = model.fontCodeMaps.get(first.fontKey);
    const originalEncoded = codeMap ? lines.map((line) => encodeLineWithOriginalFont(line, codeMap)) : null;

    let fontOperator = originalFontOperator;
    let lineOperations: string[];
    let substituteFont: PDFFont | null = null;
    if (originalEncoded && originalEncoded.every((op): op is string => op !== null)) {
      lineOperations = originalEncoded;
    } else {
      // 2. Substitute font embedded for this text object
      const { family, bold, italic } = describeOriginalFont(first.fontName);
      substituteFont = await new PdfFontProvider(pdfDoc).fontFor(family, bold, italic, lines.join(''));
      const part = new Set(block.runs.map((r) => r.partIndex)).size === 1 ? first.partIndex : 0;
      const partLayout = current.layout?.[part];
      const fontDict = fontDictForPart(pdfDoc, pageIndex, partLayout?.kind === 'form' ? partLayout.name : undefined);
      if (!fontDict) return fail('Nelze přidat náhradní písmo do zdrojů stránky.');
      const resourceName = uniqueResourceName(fontDict, 'PSF');
      fontDict.set(PDFName.of(resourceName), substituteFont.ref as PDFRef);
      fontOperator = `/${resourceName} ${formatNumber(first.fontSize)} Tf`;
      const font = substituteFont;
      lineOperations = lines.map((line) => `${font.encodeText(prepareTextForFont(font, line)).toString()} Tj`);
    }

    const textObject = buildTextObject(
      model.streamText,
      block,
      fontOperator,
      lineOperations,
      leading,
      substituteFont ? originalFontOperator : null
    );
    const newStreamText =
      model.streamText.substring(0, block.startIndex) + textObject + model.streamText.substring(block.endIndex);

    const page = pdfDoc.getPage(pageIndex);
    const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);
    const saved = await pdfDoc.save({ objectsPerTick: 500 });

    logger.success('edit', `Text bloku ${segmentId} na straně ${pageIndex + 1} byl přepsán`, {
      segmentId,
      fontSubstituted: Boolean(substituteFont),
      originalFont: first.fontName,
    });

    return {
      updatedPdfBytes: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
      updatedStream,
      fontSubstituted: Boolean(substituteFont),
      substituteFontName: substituteFont?.name,
    };
  } catch (err: any) {
    logger.error('edit', `Přepis textu bloku ${segmentId} selhal: ${err?.message || err}`);
    return fail(err?.message || String(err));
  }
}
