import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRef,
  PDFRawStream,
  PDFDict,
  PDFNumber,
  decodePDFRawStream,
  arrayAsString,
} from 'pdf-lib';
import { logger } from './logger';

export interface StreamReplaceOptions {
  matchCase?: boolean;
}

export interface StreamReplaceResult {
  updatedPdfBytes: ArrayBuffer;
  occurrencesReplaced: number;
  pagesModified: number[];
  error?: string;
}

export interface StreamSegment {
  id: string;
  type: 'text' | 'graphics' | 'other';
  rawContent: string;
  previewText: string;
  fontInfo?: string;
  positionInfo?: string;
  x?: number;
  y?: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Unescape a PDF literal string (e.g. \( -> (, \\ -> \)
 */
export function unescapePdfLiteralString(str: string): string {
  return str
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Escape a text string for safe insertion into a PDF literal string (...)
 */
export function escapePdfLiteralString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Convert a hex string (e.g. 48656c6c6f or 00480065) to a text string
 */
export function hexToString(hex: string): string {
  const cleanHex = hex.replace(/\s+/g, '');
  if (cleanHex.length === 0) return '';

  // Check if UTF-16BE BOM (FEFF)
  if (cleanHex.startsWith('feff') || cleanHex.startsWith('FEFF')) {
    let str = '';
    for (let i = 4; i < cleanHex.length; i += 4) {
      const code = parseInt(cleanHex.substring(i, i + 4), 16);
      if (!isNaN(code)) {
        str += String.fromCharCode(code);
      }
    }
    return str;
  }

  // Check if every even byte is 00 (e.g. 0053 006D ...)
  if (cleanHex.length >= 4 && cleanHex.length % 4 === 0) {
    let isUtf16 = true;
    for (let i = 0; i < cleanHex.length; i += 4) {
      if (cleanHex.substring(i, i + 2) !== '00') {
        isUtf16 = false;
        break;
      }
    }
    if (isUtf16) {
      let str = '';
      for (let i = 0; i < cleanHex.length; i += 4) {
        const code = parseInt(cleanHex.substring(i, i + 4), 16);
        if (!isNaN(code)) {
          str += String.fromCharCode(code);
        }
      }
      return str;
    }
  }

  // Standard 1-byte ASCII / Latin-1
  let str = '';
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substring(i, i + 2), 16);
    if (!isNaN(byte) && byte !== 0) {
      str += String.fromCharCode(byte);
    }
  }
  return str;
}

/**
 * Convert text string to hex representation (e.g. Hello -> 48656c6c6f or 00480065006c006c006f)
 */
export function stringToHex(str: string, forceTwoBytes: boolean = false): string {
  let hex = '';
  const hasWideChars = forceTwoBytes || str.split('').some((c) => c.charCodeAt(0) > 255);

  if (hasWideChars) {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      hex += code.toString(16).padStart(4, '0');
    }
  } else {
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      hex += (charCode & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

/**
 * Extracts literal strings (...) from a PDF stream handling escapes and nested parens in O(N) time.
 */
export function extractLiteralStrings(text: string): { raw: string; inner: string; start: number; end: number }[] {
  const results: { raw: string; inner: string; start: number; end: number }[] = [];
  let inString = false;
  let depth = 0;
  let current = '';
  let start = -1;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      if (inString) current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) current += ch;
      escape = true;
      continue;
    }
    if (ch === '(') {
      if (!inString) {
        inString = true;
        depth = 1;
        start = i;
        current = '';
      } else {
        depth++;
        current += ch;
      }
      continue;
    }
    if (ch === ')' && inString) {
      depth--;
      if (depth === 0) {
        results.push({
          raw: text.substring(start, i + 1),
          inner: current,
          start,
          end: i + 1,
        });
        inString = false;
        start = -1;
        current = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (inString) {
      current += ch;
    }
  }
  return results;
}

/**
 * Replaces occurrences of searchText with replaceText in a single decoded content stream string.
 */
export function replaceTextInStreamString(
  streamContent: string,
  searchText: string,
  replaceText: string,
  options: StreamReplaceOptions = {}
): { modifiedContent: string; count: number } {
  if (!searchText) {
    return { modifiedContent: streamContent, count: 0 };
  }

  const { matchCase = true } = options;
  let count = 0;

  // Strategy 1: Replace inside literal PDF strings: ( ... ) using linear scanner
  const literalMatches = extractLiteralStrings(streamContent);
  let modifiedContent = '';
  let lastPos = 0;

  for (const item of literalMatches) {
    modifiedContent += streamContent.substring(lastPos, item.start);
    const unescaped = unescapePdfLiteralString(item.inner);

    const regex = matchCase
      ? new RegExp(escapeRegex(searchText), 'g')
      : new RegExp(escapeRegex(searchText), 'gi');

    let matchCount = 0;
    const replaced = unescaped.replace(regex, () => {
      matchCount++;
      return replaceText;
    });

    if (matchCount > 0) {
      count += matchCount;
      modifiedContent += `(${escapePdfLiteralString(replaced)})`;
    } else {
      modifiedContent += item.raw;
    }
    lastPos = item.end;
  }
  modifiedContent += streamContent.substring(lastPos);

  // Strategy 2: Replace inside hex PDF strings: < ... >
  const hexRegex = /<([0-9a-fA-F\s]+)>/g;
  modifiedContent = modifiedContent.replace(hexRegex, (match, hexBody) => {
    const cleanHex = hexBody.replace(/\s+/g, '');
    const isTwoByte = cleanHex.length >= 4 && (
      cleanHex.startsWith('feff') || 
      cleanHex.startsWith('FEFF') || 
      cleanHex.length % 4 === 0
    );
    const text = hexToString(hexBody);
    const regex = matchCase
      ? new RegExp(escapeRegex(searchText), 'g')
      : new RegExp(escapeRegex(searchText), 'gi');

    let matchCount = 0;
    const replaced = text.replace(regex, () => {
      matchCount++;
      return replaceText;
    });

    if (matchCount > 0) {
      count += matchCount;
      return `<${stringToHex(replaced, isTwoByte)}>`;
    }

    return match;
  });

  // Strategy 3: Fallback direct literal replacement if not inside standard parens
  if (count === 0) {
    const directRegex = matchCase
      ? new RegExp(escapeRegex(searchText), 'g')
      : new RegExp(escapeRegex(searchText), 'gi');

    const directReplaced = modifiedContent.replace(directRegex, () => {
      count++;
      return replaceText;
    });

    if (count > 0) {
      modifiedContent = directReplaced;
    }
  }

  return { modifiedContent, count };
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace text in the content stream of a specific page in a PDF ArrayBuffer.
 */
export async function replaceTextInPageContentStream(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  searchText: string,
  replaceText: string,
  options: StreamReplaceOptions = {}
): Promise<StreamReplaceResult> {
  const startTime = Date.now();
  logger.info('edit', `Zahájena náhrada textu v content streamu na straně ${pageIndex + 1}`, {
    searchText,
    replaceText,
    pageIndex: pageIndex + 1,
    options,
  });

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      const err = `Neplatný index stránky ${pageIndex + 1} (celkem stran: ${pageCount})`;
      logger.error('edit', err);
      return {
        updatedPdfBytes: pdfDocBytes,
        occurrencesReplaced: 0,
        pagesModified: [],
        error: err,
      };
    }

    const page = pdfDoc.getPage(pageIndex);
    const contentsRef = page.node.Contents();
    let occurrencesReplaced = 0;

    if (contentsRef instanceof PDFRef) {
      const stream = page.node.context.lookup(contentsRef) as PDFRawStream;
      if (stream && typeof (stream as any).getContents === 'function') {
        const decoded = decodePDFRawStream(stream).decode();
        const streamStr = arrayAsString(decoded);
        const { modifiedContent, count } = replaceTextInStreamString(
          streamStr,
          searchText,
          replaceText,
          options
        );

        if (count > 0) {
          occurrencesReplaced += count;
          const newStream = pdfDoc.context.flateStream(modifiedContent);
          const newRef = pdfDoc.context.register(newStream);
          page.node.set(PDFName.of('Contents'), newRef);
        }
      }
    } else if (contentsRef instanceof PDFArray) {
      for (let i = 0; i < contentsRef.size(); i++) {
        const itemRef = contentsRef.get(i);
        if (itemRef instanceof PDFRef) {
          const stream = page.node.context.lookup(itemRef) as PDFRawStream;
          if (stream && typeof (stream as any).getContents === 'function') {
            const decoded = decodePDFRawStream(stream).decode();
            const streamStr = arrayAsString(decoded);
            const { modifiedContent, count } = replaceTextInStreamString(
              streamStr,
              searchText,
              replaceText,
              options
            );

            if (count > 0) {
              occurrencesReplaced += count;
              const newStream = pdfDoc.context.flateStream(modifiedContent);
              const newRef = pdfDoc.context.register(newStream);
              contentsRef.set(i, newRef);
            }
          }
        }
      }
    }

    if (occurrencesReplaced === 0) {
      logger.warn(
        'edit',
        `Hledaný text "${searchText}" nebyl v content streamu strany ${pageIndex + 1} nalezen.`,
        { searchText, pageIndex: pageIndex + 1 }
      );
      return {
        updatedPdfBytes: pdfDocBytes,
        occurrencesReplaced: 0,
        pagesModified: [],
      };
    }

    const savedBytes = await pdfDoc.save({
      useObjectStreams: true,
      updateInfoDict: false,
    } as any);

    const elapsed = Date.now() - startTime;
    logger.success(
      'edit',
      `Úspěšně nahrazeno ${occurrencesReplaced} výskytů na straně ${pageIndex + 1} za ${elapsed} ms`,
      {
        pageIndex: pageIndex + 1,
        occurrencesReplaced,
        elapsedMs: elapsed,
      }
    );

    return {
      updatedPdfBytes: savedBytes.buffer as ArrayBuffer,
      occurrencesReplaced,
      pagesModified: [pageIndex],
    };
  } catch (error) {
    logger.error('edit', 'Chyba při náhradě textu v content streamu', error);
    return {
      updatedPdfBytes: pdfDocBytes,
      occurrencesReplaced: 0,
      pagesModified: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Replace text in content streams across all pages of a PDF document.
 */
export async function replaceTextInAllPagesContentStream(
  pdfDocBytes: ArrayBuffer,
  searchText: string,
  replaceText: string,
  options: StreamReplaceOptions = {}
): Promise<StreamReplaceResult> {
  const startTime = Date.now();
  logger.info('edit', `Zahájena celodokumentová náhrada textu v content streamech`, {
    searchText,
    replaceText,
    options,
  });

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    let totalOccurrences = 0;
    const pagesModified: number[] = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pdfDoc.getPage(pageIndex);
      const contentsRef = page.node.Contents();
      let pageModified = false;

      if (contentsRef instanceof PDFRef) {
        const stream = page.node.context.lookup(contentsRef) as PDFRawStream;
        if (stream && typeof (stream as any).getContents === 'function') {
          const decoded = decodePDFRawStream(stream).decode();
          const streamStr = arrayAsString(decoded);
          const { modifiedContent, count } = replaceTextInStreamString(
            streamStr,
            searchText,
            replaceText,
            options
          );

          if (count > 0) {
            totalOccurrences += count;
            pageModified = true;
            const newStream = pdfDoc.context.flateStream(modifiedContent);
            const newRef = pdfDoc.context.register(newStream);
            page.node.set(PDFName.of('Contents'), newRef);
          }
        }
      } else if (contentsRef instanceof PDFArray) {
        for (let i = 0; i < contentsRef.size(); i++) {
          const itemRef = contentsRef.get(i);
          if (itemRef instanceof PDFRef) {
            const stream = page.node.context.lookup(itemRef) as PDFRawStream;
            if (stream && typeof (stream as any).getContents === 'function') {
              const decoded = decodePDFRawStream(stream).decode();
              const streamStr = arrayAsString(decoded);
              const { modifiedContent, count } = replaceTextInStreamString(
                streamStr,
                searchText,
                replaceText,
                options
              );

              if (count > 0) {
                totalOccurrences += count;
                pageModified = true;
                const newStream = pdfDoc.context.flateStream(modifiedContent);
                const newRef = pdfDoc.context.register(newStream);
                contentsRef.set(i, newRef);
              }
            }
          }
        }
      }

      if (pageModified) {
        pagesModified.push(pageIndex);
      }
    }

    if (totalOccurrences === 0) {
      logger.warn(
        'edit',
        `Hledaný text "${searchText}" nebyl v žádné ze stránek dokumentu nalezen.`,
        { searchText }
      );
      return {
        updatedPdfBytes: pdfDocBytes,
        occurrencesReplaced: 0,
        pagesModified: [],
      };
    }

    const savedBytes = await pdfDoc.save({
      useObjectStreams: true,
      updateInfoDict: false,
    } as any);

    const elapsed = Date.now() - startTime;
    logger.success(
      'edit',
      `Celodokumentová náhrada dokončena: ${totalOccurrences} výskytů na ${pagesModified.length} stranách za ${elapsed} ms`,
      {
        totalOccurrences,
        pagesCount: pagesModified.length,
        pagesModified: pagesModified.map((p) => p + 1),
        elapsedMs: elapsed,
      }
    );

    return {
      updatedPdfBytes: savedBytes.buffer as ArrayBuffer,
      occurrencesReplaced: totalOccurrences,
      pagesModified,
    };
  } catch (error) {
    logger.error('edit', 'Chyba při celodokumentové náhradě textu', error);
    return {
      updatedPdfBytes: pdfDocBytes,
      occurrencesReplaced: 0,
      pagesModified: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Safely decode a PDF stream object (handles FlateDecode, raw uncompressed, and fallback).
 */
export function decodeStreamObject(stream: any): string {
  if (!stream) return '';
  try {
    if (typeof stream.getContents === 'function') {
      const decoded = decodePDFRawStream(stream).decode();
      return arrayAsString(decoded);
    }
  } catch (err) {
    try {
      if (typeof stream.getContents === 'function') {
        return arrayAsString(stream.getContents());
      }
    } catch (_) {}
  }
  return '';
}

/**
 * Get decompressed content stream of a specific page in a PDF ArrayBuffer.
 */
export async function getPageContentStream(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number
): Promise<{ streamText: string; streamCount: number; error?: string }> {
  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return {
        streamText: '',
        streamCount: 0,
        error: `Neplatný index stránky ${pageIndex + 1} (celkem stran: ${pageCount})`,
      };
    }

    const page = pdfDoc.getPage(pageIndex);
    const contentsRef = page.node.Contents();
    let streamText = '';
    let streamCount = 0;

    if (contentsRef instanceof PDFRef) {
      const stream = page.node.context.lookup(contentsRef);
      streamText = decodeStreamObject(stream);
      if (streamText) streamCount = 1;
    } else if (contentsRef instanceof PDFArray) {
      const parts: string[] = [];
      for (let i = 0; i < contentsRef.size(); i++) {
        const item = contentsRef.get(i);
        if (item instanceof PDFRef) {
          const stream = page.node.context.lookup(item);
          const decodedPart = decodeStreamObject(stream);
          if (decodedPart) {
            parts.push(decodedPart);
            streamCount++;
          }
        } else {
          const decodedPart = decodeStreamObject(item);
          if (decodedPart) {
            parts.push(decodedPart);
            streamCount++;
          }
        }
      }
      streamText = parts.join('\n');
    } else if (contentsRef) {
      streamText = decodeStreamObject(contentsRef);
      if (streamText) streamCount = 1;
    }

    return { streamText, streamCount };
  } catch (err: any) {
    logger.error('edit', `Chyba při čtení content streamu strany ${pageIndex + 1}: ${err?.message || err}`);
    return { streamText: '', streamCount: 0, error: err?.message || String(err) };
  }
}

/**
 * Parse a raw content stream string into individual structured segments (BT ... ET text blocks and graphics).
 */
export function parseStreamSegments(streamText: string): StreamSegment[] {
  const segments: StreamSegment[] = [];
  if (!streamText) return segments;

  const btEtRegex = /BT[\s\S]*?ET/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let blockIndex = 1;

  while ((match = btEtRegex.exec(streamText)) !== null) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    // Non-text chunk before this BT
    if (startIndex > lastIndex) {
      const nonText = streamText.substring(lastIndex, startIndex);
      const trimmed = nonText.trim();
      if (trimmed) {
        segments.push({
          id: `seg_graphics_${segments.length + 1}`,
          type: 'graphics',
          rawContent: nonText,
          previewText: trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed,
          startIndex: lastIndex,
          endIndex: startIndex,
        });
      }
    }

    const rawBlock = match[0];
    const extractedText = extractPreviewTextFromBlock(rawBlock);
    const fontInfo = extractFontInfoFromBlock(rawBlock);
    const coords = extractCoordinatesFromBlock(rawBlock);
    const positionInfo = coords.x !== undefined && coords.y !== undefined
      ? `X: ${coords.x.toFixed(1)}, Y: ${coords.y.toFixed(1)}`
      : undefined;

    segments.push({
      id: `block_${blockIndex}`,
      type: 'text',
      rawContent: rawBlock,
      previewText: extractedText || `[Textový blok #${blockIndex}]`,
      fontInfo,
      positionInfo,
      x: coords.x,
      y: coords.y,
      startIndex,
      endIndex,
    });

    blockIndex++;
    lastIndex = endIndex;

    if (match.index === btEtRegex.lastIndex) {
      btEtRegex.lastIndex++;
    }
  }

  // Trailing non-text chunk after last ET
  if (lastIndex < streamText.length) {
    const trailing = streamText.substring(lastIndex);
    const trimmed = trailing.trim();
    if (trimmed) {
      segments.push({
        id: `seg_graphics_${segments.length + 1}`,
        type: 'graphics',
        rawContent: trailing,
        previewText: trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed,
        startIndex: lastIndex,
        endIndex: streamText.length,
      });
    }
  }

  return segments;
}

/**
 * Extract human-readable preview text from a BT ... ET text block.
 */
export function extractPreviewTextFromBlock(rawBlock: string): string {
  const parts: string[] = [];

  // 1. Literal strings (...)
  const literalStrings = extractLiteralStrings(rawBlock);
  for (const item of literalStrings) {
    const text = unescapePdfLiteralString(item.inner).trim();
    if (text) {
      parts.push(text);
    }
  }

  // 2. Hex strings <...>
  const hexRegex = /<([0-9a-fA-F\s]+)>/g;
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexRegex.exec(rawBlock)) !== null) {
    const text = hexToString(hexMatch[1]).trim();
    if (text) {
      parts.push(text);
    }
    if (hexMatch.index === hexRegex.lastIndex) {
      hexRegex.lastIndex++;
    }
  }

  return parts.join(' ');
}

export function extractFontInfoFromBlock(rawBlock: string): string | undefined {
  const lines = rawBlock.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('Tf')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3 && parts[parts.length - 1] === 'Tf') {
        const fontName = parts[parts.length - 3];
        const fontSize = parts[parts.length - 2];
        return `${fontName.startsWith('/') ? fontName : '/' + fontName} ${fontSize}pt`;
      }
    }
  }
  return undefined;
}

export function extractCoordinatesFromBlock(rawBlock: string): { x?: number; y?: number } {
  const lines = rawBlock.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('Tm')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 7 && parts[parts.length - 1] === 'Tm') {
        const x = parseFloat(parts[parts.length - 3]);
        const y = parseFloat(parts[parts.length - 2]);
        if (!isNaN(x) && !isNaN(y)) {
          return { x, y };
        }
      }
    } else if (trimmed.endsWith('Td') || trimmed.endsWith('TD')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const x = parseFloat(parts[parts.length - 3]);
        const y = parseFloat(parts[parts.length - 2]);
        if (!isNaN(x) && !isNaN(y)) {
          return { x, y };
        }
      }
    }
  }
  return {};
}

export function extractPositionInfoFromBlock(rawBlock: string): string | undefined {
  const coords = extractCoordinatesFromBlock(rawBlock);
  if (coords.x !== undefined && coords.y !== undefined) {
    return `X: ${coords.x.toFixed(1)}, Y: ${coords.y.toFixed(1)}`;
  }
  return undefined;
}

/**
 * Normalizes text for matching by removing diacritics, lowercase, collapsing punctuation.
 */
export function normalizeTextForSearch(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\-_.,;:/\\()\[\]{}'"`<>]+/g, ' ')
    .trim();
}

/**
 * Finds the best matching text block given a target search text and/or clicked screen coordinates.
 */
export function findBestMatchingBlock(
  textBlocks: StreamSegment[],
  targetText?: string,
  targetPosition?: { x: number; y: number } | null,
  pageHeight?: number
): StreamSegment | undefined {
  if (!textBlocks || textBlocks.length === 0) return undefined;
  if (!targetText && !targetPosition) return textBlocks[0];

  const normTarget = normalizeTextForSearch(targetText || '');
  const targetWords = normTarget.split(' ').filter((w) => w.length >= 2);

  let bestBlock: StreamSegment | undefined;
  let highestScore = -1;

  for (const block of textBlocks) {
    let score = 0;
    const normPreview = normalizeTextForSearch(block.previewText);
    const normRaw = normalizeTextForSearch(block.rawContent);

    // 1. Text Matching Score
    if (normTarget) {
      if (normPreview === normTarget) {
        score += 500;
      } else if (normPreview.includes(normTarget)) {
        score += 300 + (normTarget.length / Math.max(1, normPreview.length)) * 100;
      } else if (normTarget.includes(normPreview) && normPreview.length > 2) {
        score += 250 + (normPreview.length / Math.max(1, normTarget.length)) * 100;
      } else if (normRaw.includes(normTarget)) {
        score += 200;
      }

      // Word-level overlap
      if (targetWords.length > 0) {
        const previewWords = new Set(normPreview.split(' ').filter((w) => w.length >= 2));
        const rawWords = new Set(normRaw.split(' ').filter((w) => w.length >= 2));
        let matchedCount = 0;
        for (const tw of targetWords) {
          if (previewWords.has(tw) || Array.from(previewWords).some((pw) => pw.includes(tw) || tw.includes(pw))) {
            matchedCount++;
          } else if (rawWords.has(tw) || Array.from(rawWords).some((rw) => rw.includes(tw) || tw.includes(rw))) {
            matchedCount += 0.8;
          }
        }
        score += (matchedCount / targetWords.length) * 200;
      }

      // Exact raw content match
      if (targetText && block.rawContent.includes(targetText)) {
        score += 150;
      }
    }

    // 2. Spatial Distance Score (if position was clicked)
    if (targetPosition && block.x !== undefined && block.y !== undefined) {
      const pHeight = pageHeight || 842;
      const blockTopY = pHeight - block.y;
      const dx = targetPosition.x - block.x;
      const dy = targetPosition.y - blockTopY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 25) {
        score += 250;
      } else if (dist < 60) {
        score += 180;
      } else if (dist < 120) {
        score += 100;
      } else if (dist < 250) {
        score += 40;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestBlock = block;
    }
  }

  if (highestScore > 0 && bestBlock) {
    return bestBlock;
  }

  return textBlocks[0];
}

/**
 * Direct full replacement of a page's content stream.
 */
export async function updatePageContentStream(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  newStreamContent: string
): Promise<{ updatedPdfBytes: ArrayBuffer; error?: string }> {
  const startTime = Date.now();
  logger.info('edit', `Zahájena přímá aktualizace content streamu na straně ${pageIndex + 1}`, {
    pageIndex: pageIndex + 1,
    newLengthBytes: newStreamContent.length,
  });

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      const err = `Neplatný index stránky ${pageIndex + 1} (celkem stran: ${pageCount})`;
      logger.error('edit', err);
      return { updatedPdfBytes: pdfDocBytes, error: err };
    }

    const page = pdfDoc.getPage(pageIndex);
    const newStream = pdfDoc.context.flateStream(newStreamContent);
    const newRef = pdfDoc.context.register(newStream);
    page.node.set(PDFName.of('Contents'), newRef);

    const savedBytes = await pdfDoc.save();
    const durationMs = Date.now() - startTime;

    logger.success('edit', `Content stream strany ${pageIndex + 1} úspěšně zapsán do PDF za ${durationMs} ms (${savedBytes.byteLength} B)`, {
      pageIndex: pageIndex + 1,
      durationMs,
      savedBytes: savedBytes.byteLength,
    });

    return { updatedPdfBytes: savedBytes.buffer as ArrayBuffer };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logger.error('edit', `Chyba při zápisu content streamu strany ${pageIndex + 1}: ${errorMsg}`, {
      stack: err?.stack,
    });
    return { updatedPdfBytes: pdfDocBytes, error: errorMsg };
  }
}

/**
 * Direct replacement of a specific segment inside a page's content stream.
 */
export async function updateStreamSegmentInPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  originalSegment: string,
  newSegment: string
): Promise<{ updatedPdfBytes: ArrayBuffer; error?: string }> {
  const { streamText, error } = await getPageContentStream(pdfDocBytes, pageIndex);
  if (error || !streamText) {
    return { updatedPdfBytes: pdfDocBytes, error: error || 'Nelze načíst stream stránky' };
  }

  let updatedStream: string;
  if (streamText.includes(originalSegment)) {
    updatedStream = streamText.replace(originalSegment, newSegment);
  } else {
    const normalizedOrig = originalSegment.replace(/\r\n/g, '\n');
    const normalizedStream = streamText.replace(/\r\n/g, '\n');
    if (normalizedStream.includes(normalizedOrig)) {
      updatedStream = normalizedStream.replace(normalizedOrig, newSegment);
    } else {
      return {
        updatedPdfBytes: pdfDocBytes,
        error: 'Původní segment nebyl v content streamu nalezen pro přesnou náhradu.',
      };
    }
  }

  return updatePageContentStream(pdfDocBytes, pageIndex, updatedStream);
}

export interface PageImageInfo {
  id: string;
  name: string;
  cleanName: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  colorSpace?: string;
  filter?: string;
  rawInvocation?: string;
}

/**
 * Discovers and inspects all embedded image XObjects and inline image placements on a PDF page.
 */
export async function getPageImages(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number
): Promise<{ images: PageImageInfo[]; error?: string }> {
  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return { images: [], error: `Neplatný index stránky ${pageIndex + 1}` };
    }

    const page = pdfDoc.getPage(pageIndex);
    const { streamText } = await getPageContentStream(pdfDocBytes, pageIndex);

    const images: PageImageInfo[] = [];
    const discoveredNames = new Set<string>();

    // 1. Inspect /Resources /XObject dictionary
    const resources = page.node.Resources();
    if (resources) {
      const xObjectDict = resources.get(PDFName.of('XObject'));
      if (xObjectDict instanceof PDFDict) {
        const entries = xObjectDict.entries();
        for (const [nameKey, refVal] of entries) {
          const cleanName = nameKey.asString().replace(/^\//, '');
          const xObj = page.node.context.lookup(refVal);
          const dict =
            xObj instanceof PDFDict
              ? xObj
              : (xObj as any)?.dict instanceof PDFDict
              ? (xObj as any).dict
              : undefined;

          if (dict) {
            const subtype = dict.get(PDFName.of('Subtype'));
            if (subtype?.toString() === '/Image') {
              discoveredNames.add(cleanName);

              const widthVal = dict.get(PDFName.of('Width'));
              const heightVal = dict.get(PDFName.of('Height'));
              const colorSpaceVal = dict.get(PDFName.of('ColorSpace'));
              const filterVal = dict.get(PDFName.of('Filter'));

              const pixelWidth =
                widthVal instanceof PDFNumber
                  ? widthVal.asNumber()
                  : parseInt(String(widthVal || '').replace(/[^0-9]/g, ''), 10) || undefined;
              const pixelHeight =
                heightVal instanceof PDFNumber
                  ? heightVal.asNumber()
                  : parseInt(String(heightVal || '').replace(/[^0-9]/g, ''), 10) || undefined;

              images.push({
                id: `img_${images.length + 1}`,
                name: `/${cleanName}`,
                cleanName,
                pixelWidth,
                pixelHeight,
                colorSpace: colorSpaceVal ? String(colorSpaceVal).replace(/^\//, '') : undefined,
                filter: filterVal ? String(filterVal).replace(/^\//, '') : undefined,
              });
            }
          }
        }
      }
    }

    // 2. Correlate with streamText to find layout coordinates (cm /Do)
    if (streamText) {
      const doRegex = /\/([A-Za-z0-9_\-+]+)\s+Do/g;
      let doMatch: RegExpExecArray | null;
      while ((doMatch = doRegex.exec(streamText)) !== null) {
        const cleanName = doMatch[1];
        const matchIndex = doMatch.index;
        
        // Inspect the preceding ~200 chars for matrix transformation "a b c d e f cm"
        const precedingChunk = streamText.substring(Math.max(0, matchIndex - 200), matchIndex);
        const cmMatch = precedingChunk.match(/([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+cm\s*$/);

        const invMatrix = {
          a: cmMatch ? parseFloat(cmMatch[1]) : undefined,
          b: cmMatch ? parseFloat(cmMatch[2]) : undefined,
          c: cmMatch ? parseFloat(cmMatch[3]) : undefined,
          d: cmMatch ? parseFloat(cmMatch[4]) : undefined,
          e: cmMatch ? parseFloat(cmMatch[5]) : undefined,
          f: cmMatch ? parseFloat(cmMatch[6]) : undefined,
        };

        const calcWidth =
          invMatrix.a !== undefined && invMatrix.b !== undefined
            ? Math.round(Math.hypot(invMatrix.a, invMatrix.b) * 10) / 10
            : undefined;
        const calcHeight =
          invMatrix.c !== undefined && invMatrix.d !== undefined
            ? Math.round(Math.hypot(invMatrix.c, invMatrix.d) * 10) / 10
            : undefined;

        const existing = images.find((im) => im.cleanName === cleanName);
        if (existing) {
          existing.width = calcWidth || existing.width;
          existing.height = calcHeight || existing.height;
          existing.x = invMatrix.e !== undefined ? Math.round(invMatrix.e * 10) / 10 : existing.x;
          existing.y = invMatrix.f !== undefined ? Math.round(invMatrix.f * 10) / 10 : existing.y;
          existing.rawInvocation = cmMatch ? `${cmMatch[0]}${doMatch[0]}` : doMatch[0];
        } else if (!discoveredNames.has(cleanName)) {
          discoveredNames.add(cleanName);
          images.push({
            id: `img_${images.length + 1}`,
            name: `/${cleanName}`,
            cleanName,
            width: calcWidth,
            height: calcHeight,
            x: invMatrix.e !== undefined ? Math.round(invMatrix.e * 10) / 10 : undefined,
            y: invMatrix.f !== undefined ? Math.round(invMatrix.f * 10) / 10 : undefined,
            rawInvocation: cmMatch ? `${cmMatch[0]}${doMatch[0]}` : doMatch[0],
          });
        }
      }
    }

    return { images };
  } catch (err: any) {
    logger.error('edit', `Chyba při čtení obrázků ze strany ${pageIndex + 1}: ${err?.message || err}`);
    return { images: [], error: err?.message || String(err) };
  }
}

/**
 * Removes an image from a page by its XObject name.
 */
export async function removeImageFromPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  imageName: string
): Promise<{ updatedPdfBytes: ArrayBuffer; error?: string }> {
  const res = await removeMultipleElementsFromPage(pdfDocBytes, pageIndex, [], [imageName]);
  return { updatedPdfBytes: res.updatedPdfBytes, error: res.error };
}

/**
 * Removes a text or graphics segment from a page content stream.
 */
export async function removeStreamSegmentFromPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  segment: StreamSegment
): Promise<{ updatedPdfBytes: ArrayBuffer; error?: string }> {
  const res = await removeMultipleElementsFromPage(pdfDocBytes, pageIndex, [segment.id], []);
  return { updatedPdfBytes: res.updatedPdfBytes, error: res.error };
}

/**
 * Atomically removes multiple text blocks and/or images from a page's content stream and resources.
 */
export async function removeMultipleElementsFromPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  segmentIds: string[],
  imageNames: string[]
): Promise<{ updatedPdfBytes: ArrayBuffer; removedCount: number; error?: string }> {
  const startTime = Date.now();
  logger.info('edit', `Zahájeno odstraňování prvků ze strany ${pageIndex + 1}`, {
    pageIndex: pageIndex + 1,
    segmentIds,
    imageNames,
  });

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      const err = `Neplatný index stránky ${pageIndex + 1}`;
      return { updatedPdfBytes: pdfDocBytes, removedCount: 0, error: err };
    }

    const page = pdfDoc.getPage(pageIndex);
    let { streamText, error: streamErr } = await getPageContentStream(pdfDocBytes, pageIndex);
    if (streamErr || !streamText) {
      return {
        updatedPdfBytes: pdfDocBytes,
        removedCount: 0,
        error: streamErr || 'Nelze načíst stream stránky',
      };
    }

    let removedCount = 0;
    let modifiedStream = streamText;

    // 1. Remove text/graphics segments
    if (segmentIds.length > 0) {
      const parsed = parseStreamSegments(modifiedStream);
      for (const segId of segmentIds) {
        const seg = parsed.find((s) => s.id === segId);
        if (seg) {
          if (modifiedStream.includes(seg.rawContent)) {
            modifiedStream = modifiedStream.replace(seg.rawContent, '');
            removedCount++;
          } else {
            const normOrig = seg.rawContent.replace(/\r\n/g, '\n');
            const normStream = modifiedStream.replace(/\r\n/g, '\n');
            if (normStream.includes(normOrig)) {
              modifiedStream = normStream.replace(normOrig, '');
              removedCount++;
            }
          }
        }
      }
    }

    // 2. Remove images
    if (imageNames.length > 0) {
      const resources = page.node.Resources();
      const xObjectDict = resources?.get(PDFName.of('XObject'));

      for (const rawName of imageNames) {
        const cleanName = rawName.replace(/^\//, '');

        // Delete from /Resources /XObject dictionary
        if (xObjectDict instanceof PDFDict) {
          xObjectDict.delete(PDFName.of(cleanName));
          xObjectDict.delete(PDFName.of('/' + cleanName));
        }

        // Delete from content stream (/Im1 Do and optional transformation wrapper q ... cm ... /Im1 Do Q)
        const escapedName = escapeRegex(cleanName);
        const wrappedRegex = new RegExp(
          `(?:q[\\s\\r\\n]+)?(?:[0-9.-]+[\\s\\r\\n]+){6}cm[\\s\\r\\n]*\\/${escapedName}[\\s\\r\\n]+Do(?:[\\s\\r\\n]+Q)?|\\/${escapedName}[\\s\\r\\n]+Do`,
          'g'
        );

        const beforeLen = modifiedStream.length;
        modifiedStream = modifiedStream.replace(wrappedRegex, '');
        if (modifiedStream.length !== beforeLen) {
          removedCount++;
        } else {
          removedCount++;
        }
      }
    }

    // 3. Write back modified stream
    const newStream = pdfDoc.context.flateStream(modifiedStream);
    const newRef = pdfDoc.context.register(newStream);
    page.node.set(PDFName.of('Contents'), newRef);

    const savedBytes = await pdfDoc.save();
    const durationMs = Date.now() - startTime;

    logger.success(
      'edit',
      `Úspěšně odstraněno ${removedCount} prvků ze strany ${pageIndex + 1} za ${durationMs} ms`,
      {
        pageIndex: pageIndex + 1,
        removedCount,
        durationMs,
        savedBytes: savedBytes.byteLength,
      }
    );

    return {
      updatedPdfBytes: savedBytes.buffer as ArrayBuffer,
      removedCount,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logger.error('edit', `Chyba při odstraňování prvků ze strany ${pageIndex + 1}: ${errorMsg}`, {
      stack: err?.stack,
    });
    return { updatedPdfBytes: pdfDocBytes, removedCount: 0, error: errorMsg };
  }
}

