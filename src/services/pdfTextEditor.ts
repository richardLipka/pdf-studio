import { PDFDict, PDFDocument, PDFFont, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { ContentOperation, TEXT_SHOW_OPERATORS, tokenizeContentStream } from './pdfContentTokenizer';
import { FontCodeMap, PageTextModel, TextBlock, measureLineLeading } from './pdfTextModel';
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

const formatNumber = (value: number): string => {
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

/** Font dictionary of the resources used by the stream part (page or one of its Form XObjects) */
function fontDictForPart(pdfDoc: PDFDocument, pageIndex: number, formName: string | undefined): PDFDict | null {
  const page = pdfDoc.getPage(pageIndex);
  if (!formName) return getPageLocalResourceDict(pdfDoc, page, 'Font');
  const xObjects = safeGetPageResources(page.node)?.lookup(PDFName.of('XObject'));
  if (!(xObjects instanceof PDFDict)) return null;
  const form = pdfDoc.context.lookup(xObjects.get(PDFName.of(formName)));
  if (!(form instanceof PDFRawStream)) return null;
  let resources = form.dict.lookup(PDFName.of('Resources'));
  if (!(resources instanceof PDFDict)) {
    resources = pdfDoc.context.obj({});
    form.dict.set(PDFName.of('Resources'), resources);
  }
  const resourceDict = resources as PDFDict;
  let fonts = resourceDict.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) {
    fonts = pdfDoc.context.obj({});
    resourceDict.set(PDFName.of('Font'), fonts);
  }
  return fonts as PDFDict;
}

const rawOf = (streamText: string, op: ContentOperation) => streamText.substring(op.start, op.end);

/** Builds the replacement text object */
function buildTextObject(
  streamText: string,
  block: TextBlock,
  fontOperator: string | null,
  lineOperations: string[],
  leading: number,
  restoreFontOperator: string | null
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
  const lines: string[] = [];
  lineOperations.forEach((operation, idx) => {
    if (idx > 0) lines.push(`0 ${formatNumber(-leading)} Td`);
    lines.push(operation);
  });

  return [
    'BT',
    ...before,
    ...(fontOperator ? [fontOperator] : []),
    `${first.textMatrix.map(formatNumber).join(' ')} Tm`,
    ...lines,
    ...after,
    ...(restoreFontOperator && !afterSetsFont ? [restoreFontOperator] : []),
    'ET',
  ].join('\n');
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
    const first = block.runs[0];
    const lines = newText.replace(/\r\n?/g, '\n').split('\n');
    const leading = measureLineLeading(block) ?? Math.abs(first.fontSize) * 1.2;
    const originalFontOperator = first.fontResource
      ? `/${first.fontResource} ${formatNumber(first.fontSize)} Tf`
      : null;

    const pdfDoc = await PDFDocument.load(pdfDocBytes, { ignoreEncryption: true, updateMetadata: false });

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
    const saved = await pdfDoc.save();

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
