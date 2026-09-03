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

/**
 * WeakMap cache for parsed PDFDocument instances to avoid redundant multi-second parsing
 * of large files (e.g. 756-page documents like spec.pdf) across page switches.
 */
const pdfDocCache = new WeakMap<ArrayBuffer, Promise<PDFDocument>>();

/**
 * Returns a cached PDFDocument promise or parses it if not yet loaded.
 */
export async function getCachedPdfLibDocument(
  pdfDocBytes: ArrayBuffer,
  options: { ignoreEncryption?: boolean; updateMetadata?: boolean } = {
    ignoreEncryption: true,
    updateMetadata: false,
  }
): Promise<PDFDocument> {
  let existing = pdfDocCache.get(pdfDocBytes);
  if (!existing) {
    existing = PDFDocument.load(pdfDocBytes, options);
    pdfDocCache.set(pdfDocBytes, existing);
  }
  return existing;
}

export interface EncryptionInfo {
  isEncrypted: boolean;
  filter?: string;
  subFilter?: string;
  version?: number;
  revision?: number;
  permissions?: number;
}

/**
 * Detects whether a PDF ArrayBuffer uses Standard Permissions Encryption.
 */
export async function checkDocumentEncryption(
  pdfDocBytes: ArrayBuffer
): Promise<EncryptionInfo> {
  try {
    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);
    const trailer = pdfDoc.context.trailerInfo;
    const encryptRef = trailer.Encrypt;
    if (!encryptRef) {
      return { isEncrypted: false };
    }
    const encryptDict = pdfDoc.context.lookup(encryptRef);
    if (encryptDict instanceof PDFDict) {
      const filter = encryptDict.get(PDFName.of('Filter'))?.toString().replace(/^\//, '');
      const subFilter = encryptDict.get(PDFName.of('SubFilter'))?.toString().replace(/^\//, '');
      const vVal = encryptDict.get(PDFName.of('V'));
      const rVal = encryptDict.get(PDFName.of('R'));
      const pVal = encryptDict.get(PDFName.of('P'));

      return {
        isEncrypted: true,
        filter,
        subFilter,
        version: vVal instanceof PDFNumber ? vVal.asNumber() : undefined,
        revision: rVal instanceof PDFNumber ? rVal.asNumber() : undefined,
        permissions: pVal instanceof PDFNumber ? pVal.asNumber() : undefined,
      };
    }
    return { isEncrypted: true };
  } catch (e) {
    return { isEncrypted: false };
  }
}

/**
 * Heuristically tests if a decoded stream is actually encrypted ciphertext.
 */
export function isLikelyCiphertext(str: string): boolean {
  if (!str || str.length < 20) return false;
  let nonAsciiCount = 0;
  const sampleLen = Math.min(str.length, 500);
  for (let i = 0; i < sampleLen; i++) {
    const code = str.charCodeAt(i);
    // Standard PDF operators and formatting: 9 (\t), 10 (\n), 13 (\r), 32-126
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126)) {
      nonAsciiCount++;
    }
  }
  return nonAsciiCount / sampleLen > 0.15;
}

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
  fontSize?: number;
  fontName?: string;
  headingRole?: 'h1' | 'h2' | 'body' | 'small';
  positionInfo?: string;
  x?: number;
  y?: number;
  indentLevel?: number;
  treeDepth?: number;
  parentScope?: string;
  parentContainerId?: string;
  markedContentTag?: string;
  lineCount?: number;
  startIndex: number;
  endIndex: number;
}

export interface StreamTreeNode {
  id: string;
  type: 'root' | 'q_scope' | 'marked_content' | 'text_block' | 'graphics';
  name: string;
  depth: number;
  segmentId?: string;
  children: StreamTreeNode[];
  startIndex: number;
  endIndex: number;
  tag?: string;
  matrixInfo?: string;
  previewText?: string;
}

const WIN1250_OCTAL_MAP: { [code: number]: string } = {
  138: 'Š', 141: 'Ť', 142: 'Ž', 154: 'š', 157: 'ť', 158: 'ž',
  193: 'Á', 196: 'Ä', 200: 'Č', 201: 'É', 204: 'Ě', 205: 'Í',
  207: 'Ď', 210: 'Ň', 211: 'Ó', 212: 'Ô', 216: 'Ř', 217: 'Ů',
  218: 'Ú', 220: 'Ü', 221: 'Ý', 225: 'á', 228: 'ä', 232: 'č',
  233: 'é', 236: 'ě', 237: 'í', 239: 'ď', 242: 'ň', 243: 'ó',
  244: 'ô', 248: 'ř', 249: 'ů', 250: 'ú', 252: 'ü', 253: 'ý', 254: 'ž',
};

const REVERSE_WIN1250_MAP: { [char: string]: string } = {};
for (const [codeStr, char] of Object.entries(WIN1250_OCTAL_MAP)) {
  const code = parseInt(codeStr, 10);
  REVERSE_WIN1250_MAP[char] = '\\' + code.toString(8).padStart(3, '0');
}

/**
 * Unescape a PDF literal string (e.g. \( -> (, \\ -> \), handling Win-1250/Latin-2 octal characters
 */
export function unescapePdfLiteralString(str: string): string {
  return str
    .replace(/\\([0-7]{1,3})/g, (_, oct) => {
      const code = parseInt(oct, 8);
      if (WIN1250_OCTAL_MAP[code]) {
        return WIN1250_OCTAL_MAP[code];
      }
      return String.fromCharCode(code);
    })
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
export function escapePdfLiteralString(str: string, encodeCzech: boolean = false): string {
  let escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

  if (encodeCzech) {
    for (const [char, octal] of Object.entries(REVERSE_WIN1250_MAP)) {
      escaped = escaped.split(char).join(octal);
    }
  }

  return escaped;
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

  // Strategy 2.5: Replace inside TJ arrays with kerning: [ (...) 20 (...) ] TJ
  const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
  modifiedContent = modifiedContent.replace(tjRegex, (match, arrayBody) => {
    const tokenRegex = /\((?:[^\\()]+|\\.)*\)|<[0-9a-fA-F\s]+>|[-+]?\d+(?:\.\d+)?/g;
    let tok: RegExpExecArray | null;
    let fullText = '';

    while ((tok = tokenRegex.exec(arrayBody)) !== null) {
      const item = tok[0];
      if (item.startsWith('(') && item.endsWith(')')) {
        const text = unescapePdfLiteralString(item.substring(1, item.length - 1));
        fullText += text;
      } else if (item.startsWith('<') && item.endsWith('>')) {
        const text = hexToString(item.substring(1, item.length - 1));
        fullText += text;
      } else {
        const num = parseFloat(item);
        if (!isNaN(num) && num < -120 && fullText.length > 0 && !fullText.endsWith(' ')) {
          fullText += ' ';
        }
      }
    }

    const regex = matchCase
      ? new RegExp(escapeRegex(searchText), 'g')
      : new RegExp(escapeRegex(searchText), 'gi');

    if (regex.test(fullText)) {
      let localCount = 0;
      const replacedFull = fullText.replace(regex, () => {
        localCount++;
        return replaceText;
      });

      if (localCount > 0) {
        count += localCount;
        return `[ (${escapePdfLiteralString(replacedFull, true)}) ] TJ`;
      }
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

/**
 * Direct replacement of text emission operators inside a BT ... ET text block.
 * Preserves font settings (Tf), color (rg/g/k), transformation matrix (Tm),
 * and marked content wrappers (BDC ... EMC) while substituting the text cleanly.
 */
export function replaceTextBlockText(rawBlock: string, newText: string): string {
  if (!rawBlock) return rawBlock;

  const escaped = escapePdfLiteralString(newText, true);

  // Check if it's a standard BT ... ET block
  const btMatch = rawBlock.match(/\bBT\b/);
  const etMatch = rawBlock.match(/\bET\b/);

  if (!btMatch || !etMatch) {
    if (/\[[\s\S]*?\]\s*TJ/.test(rawBlock)) {
      return rawBlock.replace(/\[[\s\S]*?\]\s*TJ/, `(${escaped}) Tj`);
    }
    if (/\((?:[^\\()]+|\\.)*\)\s*Tj/.test(rawBlock)) {
      return rawBlock.replace(/\((?:[^\\()]+|\\.)*\)\s*Tj/, `(${escaped}) Tj`);
    }
    return rawBlock;
  }

  const lines = rawBlock.split(/\r?\n/);
  let firstTextIdx = -1;
  let lastTextIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.endsWith('Tj') ||
      trimmed.endsWith('TJ') ||
      trimmed.endsWith("'") ||
      trimmed.endsWith('"') ||
      /\[[\s\S]*\]\s*TJ/.test(trimmed) ||
      /\([\s\S]*\)\s*Tj/.test(trimmed) ||
      /<[0-9a-fA-F\s]*>\s*Tj/.test(trimmed)
    ) {
      if (firstTextIdx === -1) firstTextIdx = i;
      lastTextIdx = i;
    }
  }

  if (firstTextIdx === -1 || lastTextIdx === -1) {
    if (/\[[\s\S]*?\]\s*TJ/.test(rawBlock)) {
      return rawBlock.replace(/\[[\s\S]*?\]\s*TJ/, `(${escaped}) Tj`);
    }
    if (/\([\s\S]*?\)\s*Tj/.test(rawBlock)) {
      return rawBlock.replace(/\([\s\S]*?\)\s*Tj/, `(${escaped}) Tj`);
    }
    const etIdx = lines.findIndex((l) => l.trim() === 'ET');
    if (etIdx !== -1) {
      const p = lines.slice(0, etIdx).join('\n');
      const s = lines.slice(etIdx).join('\n');
      return `${p}\n(${escaped}) Tj\n${s}`;
    }
    return rawBlock;
  }

  const prefix = lines.slice(0, firstTextIdx).join('\n');
  const suffix = lines.slice(lastTextIdx + 1).join('\n');

  const textLines = newText.split(/\r?\n/);
  const replacementLines = textLines
    .map((line, idx) => {
      const lineEscaped = escapePdfLiteralString(line, true);
      return idx === 0 ? `(${lineEscaped}) Tj` : `T* (${lineEscaped}) Tj`;
    })
    .join('\n');

  return [prefix, replacementLines, suffix].filter((s) => s !== '').join('\n');
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
): Promise<{ streamText: string; streamCount: number; isEncrypted?: boolean; error?: string }> {
  try {
    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);
    const encInfo = await checkDocumentEncryption(pdfDocBytes);

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return {
        streamText: '',
        streamCount: 0,
        isEncrypted: encInfo.isEncrypted,
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

    // Inspect Form XObjects in page resources (/XObject dictionary)
    const resources = page.node.Resources();
    if (resources instanceof PDFDict) {
      const xObject = resources.lookup(PDFName.of('XObject'));
      if (xObject instanceof PDFDict) {
        for (const [, ref] of xObject.entries()) {
          const obj = pdfDoc.context.lookup(ref);
          if (obj instanceof PDFRawStream || (obj && typeof (obj as any).getContents === 'function')) {
            const dict = (obj as any).dict || obj;
            const sub = dict instanceof PDFDict ? dict.lookup(PDFName.of('Subtype')) : undefined;
            if (sub instanceof PDFName && sub.asString() === '/Form') {
              const formStream = decodeStreamObject(obj);
              if (formStream) {
                if (streamText) {
                  streamText += `\n${formStream}`;
                } else {
                  streamText = formStream;
                }
                streamCount++;
              }
            }
          }
        }
      }
    }

    // Check if the stream content is encrypted ciphertext
    const ciphertext = isLikelyCiphertext(streamText);
    if (encInfo.isEncrypted || ciphertext) {
      return {
        streamText: '',
        streamCount,
        isEncrypted: true,
        error: 'Dokument používá standardní šifrování oprávnění (Standard Security). Přímá editace content streamu je uzamčena.',
      };
    }

    return { streamText, streamCount, isEncrypted: false };
  } catch (err: any) {
    logger.error('edit', `Chyba při čtení content streamu strany ${pageIndex + 1}: ${err?.message || err}`);
    return { streamText: '', streamCount: 0, error: err?.message || String(err) };
  }
}

interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY_MATRIX: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiplyMatrix(m1: TransformMatrix, m2: TransformMatrix): TransformMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function transformPoint(x: number, y: number, m: TransformMatrix): { x: number; y: number } {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
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

  let currentMatrix: TransformMatrix = { ...IDENTITY_MATRIX };
  const matrixStack: TransformMatrix[] = [];

  while ((match = btEtRegex.exec(streamText)) !== null) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    // Process preceding non-text chunk for q, Q, and cm transformations
    if (startIndex > lastIndex) {
      const nonText = streamText.substring(lastIndex, startIndex);
      const trimmed = nonText.trim();

      // Scan tokens in nonText
      const tokens = nonText.split(/\s+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === 'q') {
          matrixStack.push({ ...currentMatrix });
        } else if (token === 'Q') {
          if (matrixStack.length > 0) {
            currentMatrix = matrixStack.pop()!;
          } else {
            currentMatrix = { ...IDENTITY_MATRIX };
          }
        } else if (token === 'cm' && i >= 6) {
          const a = parseFloat(tokens[i - 6]);
          const b = parseFloat(tokens[i - 5]);
          const c = parseFloat(tokens[i - 4]);
          const d = parseFloat(tokens[i - 3]);
          const e = parseFloat(tokens[i - 2]);
          const f = parseFloat(tokens[i - 1]);
          if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d) && !isNaN(e) && !isNaN(f)) {
            const cmMat: TransformMatrix = { a, b, c, d, e, f };
            currentMatrix = multiplyMatrix(currentMatrix, cmMat);
          }
        }
      }

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
    const fontDetails = extractFontDetailsFromBlock(rawBlock);
    const rawCoords = extractCoordinatesFromBlock(rawBlock);
    const lineCount = extractLineCountFromBlock(rawBlock);
    const markedTag = extractMarkedContentTag(streamText, startIndex);

    let coords: { x?: number; y?: number } = rawCoords;
    if (rawCoords.x !== undefined && rawCoords.y !== undefined) {
      coords = transformPoint(rawCoords.x, rawCoords.y, currentMatrix);
    }

    const positionInfo =
      coords.x !== undefined && coords.y !== undefined
        ? `X: ${coords.x.toFixed(1)}, Y: ${coords.y.toFixed(1)}`
        : undefined;

    segments.push({
      id: `block_${blockIndex}`,
      type: 'text',
      rawContent: rawBlock,
      previewText: extractedText || `[Textový blok #${blockIndex}]`,
      fontInfo: fontDetails.fontInfo,
      fontSize: fontDetails.fontSize,
      fontName: fontDetails.fontName,
      headingRole: fontDetails.headingRole,
      positionInfo,
      x: coords.x,
      y: coords.y,
      indentLevel: matrixStack.length + (markedTag ? 1 : 0),
      treeDepth: matrixStack.length + (markedTag ? 1 : 0),
      parentScope: markedTag ? `tag:${markedTag}` : matrixStack.length > 0 ? `q[${matrixStack.length}]` : undefined,
      lineCount,
      markedContentTag: markedTag,
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

  // Calculate relative indentation levels across all text blocks on the page
  const textSegments = segments.filter((s) => s.type === 'text' && s.x !== undefined);
  if (textSegments.length > 0) {
    const allX = textSegments.map((s) => s.x!).filter((x) => x >= 0);
    const minX = allX.length > 0 ? Math.min(...allX) : 0;

    for (const seg of segments) {
      if (seg.type === 'text' && seg.x !== undefined) {
        const deltaX = seg.x - minX;
        const structuralIndent = seg.treeDepth || 0;
        if (deltaX < 12) {
          seg.indentLevel = structuralIndent; // Main left margin level
        } else if (deltaX < 36) {
          seg.indentLevel = structuralIndent + 1; // Indented level 1 (sub-item / bullet)
        } else {
          seg.indentLevel = structuralIndent + 2; // Deep indentation level 2 / right column
        }
      } else {
        seg.indentLevel = 0;
      }
    }
  }

  return segments;
}

/**
 * Builds a hierarchical tree of content stream objects grouped by
 * Graphics State (q ... Q) and Marked Content (BDC ... EMC) scopes.
 */
export function parseStreamTree(streamText: string): StreamTreeNode {
  const root: StreamTreeNode = {
    id: 'tree_root',
    type: 'root',
    name: 'Page Content Stream',
    depth: 0,
    children: [],
    startIndex: 0,
    endIndex: streamText ? streamText.length : 0,
  };

  if (!streamText) return root;

  const stack: StreamTreeNode[] = [root];
  const segments = parseStreamSegments(streamText);

  let qCount = 0;
  let bdcCount = 0;

  for (const seg of segments) {
    const currentContainer = stack[stack.length - 1];

    if (seg.type === 'text') {
      currentContainer.children.push({
        id: `node_${seg.id}`,
        type: 'text_block',
        name: seg.previewText.length > 40 ? seg.previewText.substring(0, 40) + '...' : seg.previewText,
        depth: stack.length,
        segmentId: seg.id,
        children: [],
        startIndex: seg.startIndex,
        endIndex: seg.endIndex,
        tag: seg.markedContentTag,
        previewText: seg.previewText,
      });
    } else {
      const content = seg.rawContent;
      const tokens = content.split(/\s+/).filter(Boolean);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === 'q') {
          qCount++;
          const qNode: StreamTreeNode = {
            id: `node_q_${qCount}`,
            type: 'q_scope',
            name: `Graphics Scope (q #${qCount})`,
            depth: stack.length,
            children: [],
            startIndex: seg.startIndex,
            endIndex: seg.endIndex,
          };
          stack[stack.length - 1].children.push(qNode);
          stack.push(qNode);
        } else if (token === 'Q') {
          if (stack.length > 1 && stack[stack.length - 1].type === 'q_scope') {
            stack.pop();
          }
        } else if (token === 'BDC' || token === 'BMC') {
          bdcCount++;
          const tag = i > 0 ? tokens[i - 1] : '/Span';
          const bdcNode: StreamTreeNode = {
            id: `node_mc_${bdcCount}`,
            type: 'marked_content',
            name: `Marked Content (${tag})`,
            depth: stack.length,
            tag,
            children: [],
            startIndex: seg.startIndex,
            endIndex: seg.endIndex,
          };
          stack[stack.length - 1].children.push(bdcNode);
          stack.push(bdcNode);
        } else if (token === 'EMC') {
          if (stack.length > 1 && stack[stack.length - 1].type === 'marked_content') {
            stack.pop();
          }
        }
      }

      if (seg.previewText && !seg.previewText.startsWith('q') && !seg.previewText.startsWith('Q')) {
        stack[stack.length - 1].children.push({
          id: `node_${seg.id}`,
          type: 'graphics',
          name: `Graphics (${seg.previewText})`,
          depth: stack.length,
          segmentId: seg.id,
          children: [],
          startIndex: seg.startIndex,
          endIndex: seg.endIndex,
          previewText: seg.previewText,
        });
      }
    }
  }

  return root;
}

/**
 * Extract human-readable preview text from a BT ... ET text block.
 */
export function extractPreviewTextFromBlock(rawBlock: string): string {
  const words: string[] = [];

  // Check for TJ arrays first e.g. [(Sml) 20 (ouva) -250 (o) -250 (d) (\xedlo)] TJ
  const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
  let tjMatch: RegExpExecArray | null;
  let foundTj = false;

  while ((tjMatch = tjRegex.exec(rawBlock)) !== null) {
    foundTj = true;
    const arrayContent = tjMatch[1];
    let currentWord = '';

    // Tokenize arrayContent into strings (...) or <...> and kerning numbers
    const tokenRegex = /\((?:[^\\()]+|\\.)*\)|<[0-9a-fA-F\s]+>|[-+]?\d+(?:\.\d+)?/g;
    let tok: RegExpExecArray | null;

    while ((tok = tokenRegex.exec(arrayContent)) !== null) {
      const item = tok[0];
      if (item.startsWith('(') && item.endsWith(')')) {
        const text = unescapePdfLiteralString(item.substring(1, item.length - 1));
        currentWord += text;
      } else if (item.startsWith('<') && item.endsWith('>')) {
        const text = hexToString(item.substring(1, item.length - 1));
        currentWord += text;
      } else {
        const num = parseFloat(item);
        // In PDF fonts, a negative kerning < -140 typically indicates a space between words
        if (!isNaN(num) && num < -140 && currentWord.length > 0) {
          if (!currentWord.endsWith(' ')) {
            currentWord += ' ';
          }
        }
      }
    }

    const trimmed = currentWord.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      words.push(trimmed);
    }
  }

  if (foundTj && words.length > 0) {
    return words.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Fallback for standard Tj, ', " operators or raw literal strings
  const literalStrings = extractLiteralStrings(rawBlock);
  const parts: string[] = [];
  for (const item of literalStrings) {
    const text = unescapePdfLiteralString(item.inner).trim();
    if (text) {
      parts.push(text);
    }
  }

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

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractFontDetailsFromBlock(rawBlock: string): {
  fontInfo?: string;
  fontSize?: number;
  fontName?: string;
  headingRole?: 'h1' | 'h2' | 'body' | 'small';
} {
  const tfMatch = rawBlock.match(/\/([A-Za-z0-9_\-+]+)\s+([0-9.-]+)\s+Tf/);
  if (tfMatch) {
    const cleanFontName = '/' + tfMatch[1].replace(/^\//, '');
    const rawFontSize = parseFloat(tfMatch[2]);
    const fontSize = !isNaN(rawFontSize) ? rawFontSize : undefined;
    const fontInfo =
      fontSize !== undefined
        ? `${cleanFontName} ${Number.isInteger(fontSize) ? fontSize : fontSize.toFixed(1)}pt`
        : cleanFontName;

    let headingRole: 'h1' | 'h2' | 'body' | 'small' = 'body';
    const isBold = /bold|black|heavy/i.test(cleanFontName);
    if (fontSize !== undefined) {
      if (fontSize >= 15.5 || (fontSize >= 13.5 && isBold)) {
        headingRole = 'h1';
      } else if (fontSize >= 12.5 || (fontSize >= 11.0 && isBold)) {
        headingRole = 'h2';
      } else if (fontSize < 8.5) {
        headingRole = 'small';
      }
    }

    return { fontInfo, fontSize, fontName: cleanFontName, headingRole };
  }
  return {};
}

export function extractFontInfoFromBlock(rawBlock: string): string | undefined {
  return extractFontDetailsFromBlock(rawBlock).fontInfo;
}

export function extractLineCountFromBlock(rawBlock: string): number {
  if (!rawBlock) return 1;
  let verticalAdvances = 0;
  const hasTm = /([0-9.-]+\s+){5}[0-9.-]+\s+Tm/.test(rawBlock);
  let isFirstTd = !hasTm;

  const lines = rawBlock.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'T*' || trimmed.endsWith('T*')) {
      verticalAdvances++;
    } else if (trimmed === "'" || trimmed.endsWith("'") || trimmed === '"' || trimmed.endsWith('"')) {
      verticalAdvances++;
    } else {
      const tdMatches = trimmed.matchAll(/([0-9.-]+)\s+([0-9.-]+)\s+(?:Td|TD)/g);
      for (const m of tdMatches) {
        if (isFirstTd) {
          isFirstTd = false;
          continue;
        }
        const ty = parseFloat(m[2]);
        if (!isNaN(ty) && Math.abs(ty) > 0.001) {
          verticalAdvances++;
        }
      }
    }
  }
  return Math.max(1, 1 + verticalAdvances);
}

export function extractMarkedContentTag(streamText: string, startIndex: number): string | undefined {
  const precedingChunk = streamText.substring(Math.max(0, startIndex - 250), startIndex);
  const tagMatch = precedingChunk.match(/\/([A-Za-z0-9_]+)\s*(?:<<[^>]*>>)?\s*B[DM]C/);
  if (tagMatch) {
    const lastEmc = precedingChunk.lastIndexOf('EMC');
    if (lastEmc === -1 || lastEmc < tagMatch.index!) {
      return `/${tagMatch[1]}`;
    }
  }
  return undefined;
}

export function extractCoordinatesFromBlock(rawBlock: string): { x?: number; y?: number } {
  // 1. Check for Tm (Text Matrix: a b c d e f Tm)
  const tmMatch = rawBlock.match(/([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm/);
  if (tmMatch) {
    const x = parseFloat(tmMatch[5]);
    const y = parseFloat(tmMatch[6]);
    if (!isNaN(x) && !isNaN(y)) {
      return { x, y };
    }
  }

  // 2. Check for Td or TD (Text Move: tx ty Td / TD)
  const tdMatch = rawBlock.match(/([0-9.-]+)\s+([0-9.-]+)\s+(?:Td|TD)/);
  if (tdMatch) {
    const x = parseFloat(tdMatch[1]);
    const y = parseFloat(tdMatch[2]);
    if (!isNaN(x) && !isNaN(y)) {
      return { x, y };
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
): Promise<{ updatedPdfBytes: ArrayBuffer; updatedStream: string; error?: string }> {
  const startTime = Date.now();
  logger.info('edit', `Zahájen přímý zápis content streamu na straně ${pageIndex + 1}`, {
    pageIndex: pageIndex + 1,
    streamLength: newStreamContent.length,
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
      return { updatedPdfBytes: pdfDocBytes, updatedStream: '', error: err };
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

    return {
      updatedPdfBytes: savedBytes.buffer as ArrayBuffer,
      updatedStream: newStreamContent,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logger.error('edit', `Chyba při zápisu content streamu strany ${pageIndex + 1}: ${errorMsg}`, {
      stack: err?.stack,
    });
    return { updatedPdfBytes: pdfDocBytes, updatedStream: '', error: errorMsg };
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
): Promise<{ updatedPdfBytes: ArrayBuffer; updatedStream: string; error?: string }> {
  const { streamText, error } = await getPageContentStream(pdfDocBytes, pageIndex);
  if (error || !streamText) {
    return { updatedPdfBytes: pdfDocBytes, updatedStream: '', error: error || 'Nelze načíst stream stránky' };
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
      const trimmedOrig = originalSegment.trim();
      const parsed = parseStreamSegments(streamText);
      const matched = parsed.find(
        (s) => s.rawContent === originalSegment || s.rawContent.trim() === trimmedOrig
      );
      if (matched && streamText.includes(matched.rawContent)) {
        updatedStream = streamText.replace(matched.rawContent, newSegment);
      } else {
        return {
          updatedPdfBytes: pdfDocBytes,
          updatedStream: streamText,
          error: 'Původní segment nebyl v content streamu nalezen pro přesnou náhradu.',
        };
      }
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
    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return { images: [], error: `Neplatný index stránky ${pageIndex + 1}` };
    }

    const page = pdfDoc.getPage(pageIndex);
    const { streamText } = await getPageContentStream(pdfDocBytes, pageIndex);

    const images: PageImageInfo[] = [];
    const discoveredNames = new Set<string>();

    // 1. Inspect /Resources /XObject dictionary (supporting indirect references and inherited resources)
    let resources = page.node.Resources();
    if (!resources) {
      const rawRes = page.node.get(PDFName.of('Resources'));
      if (rawRes instanceof PDFRef) {
        resources = page.node.context.lookup(rawRes) as any;
      } else if (rawRes instanceof PDFDict) {
        resources = rawRes;
      }
    }
    if (!resources) {
      let parent: any = (page.node as any).Parent?.() || (page.node as any).parent?.();
      while (parent && !resources) {
        const pRes = parent.Resources?.() || parent.get?.(PDFName.of('Resources'));
        if (pRes instanceof PDFRef) {
          const lookedUp = page.node.context.lookup(pRes);
          if (lookedUp instanceof PDFDict) resources = lookedUp;
        } else if (pRes instanceof PDFDict) {
          resources = pRes;
        }
        parent =
          typeof parent.Parent === 'function'
            ? parent.Parent()
            : typeof parent.parent === 'function'
            ? parent.parent()
            : undefined;
      }
    }

    if (resources) {
      let xObjectDict = resources.get(PDFName.of('XObject'));
      if (xObjectDict instanceof PDFRef) {
        xObjectDict = page.node.context.lookup(xObjectDict);
      }
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
        
        // Inspect preceding chunk for matrix transformation "a b c d e f cm", allowing intervening gs, q, or whitespace
        const precedingChunk = streamText.substring(Math.max(0, matchIndex - 300), matchIndex);
        const cmMatch = precedingChunk.match(/([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+cm(?:\s+(?:[A-Za-z0-9_/]+(?:\s+[A-Za-z0-9_/]+)*\s+gs|q))*[\s\r\n]*$/);

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
): Promise<{ updatedPdfBytes: ArrayBuffer; removedCount: number; updatedStream: string; error?: string }> {
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
      return { updatedPdfBytes: pdfDocBytes, removedCount: 0, updatedStream: '', error: err };
    }

    const page = pdfDoc.getPage(pageIndex);
    let { streamText, error: streamErr } = await getPageContentStream(pdfDocBytes, pageIndex);
    if (streamErr || !streamText) {
      return {
        updatedPdfBytes: pdfDocBytes,
        removedCount: 0,
        updatedStream: '',
        error: streamErr || 'Nelze načíst stream stránky',
      };
    }

    let removedCount = 0;
    let modifiedStream = streamText;

    // 1. Remove text/graphics segments in reverse order of index
    if (segmentIds.length > 0) {
      const idSet = new Set(segmentIds);
      const parsed = parseStreamSegments(modifiedStream);
      const toRemove = parsed
        .filter((s) => idSet.has(s.id))
        .sort((a, b) => b.startIndex - a.startIndex);

      for (const seg of toRemove) {
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

      // Clean up empty marked content tags left after segment deletion (e.g. /Artifact BDC EMC)
      modifiedStream = modifiedStream
        .replace(/\/[A-Za-z0-9_\-+]+(?:\s+<<[^>]*>>)?\s*BDC\s*EMC/g, '')
        .replace(/\/[A-Za-z0-9_\-+Client]+\s*BMC\s*EMC/g, '');
    }

    // 2. Remove images
    if (imageNames.length > 0) {
      let resources = page.node.Resources();
      if (!resources) {
        const rawRes = page.node.get(PDFName.of('Resources'));
        if (rawRes instanceof PDFRef) {
          resources = page.node.context.lookup(rawRes) as any;
        } else if (rawRes instanceof PDFDict) {
          resources = rawRes;
        }
      }
      let xObjectDict = resources?.get(PDFName.of('XObject'));
      if (xObjectDict instanceof PDFRef) {
        xObjectDict = page.node.context.lookup(xObjectDict);
      }

      for (const rawName of imageNames) {
        const cleanName = rawName.replace(/^\//, '');

        // Delete from /Resources /XObject dictionary
        if (xObjectDict instanceof PDFDict) {
          xObjectDict.delete(PDFName.of(cleanName));
          xObjectDict.delete(PDFName.of('/' + cleanName));
        }

        // Delete from content stream (cleanly removes q ... cm ... /Name Do ... Q wrapper or bare /Name Do)
        const escapedName = escapeRegex(cleanName);
        const wrappedRegex = new RegExp(
          `q\\s*(?:[0-9.-]+\\s+){6}cm\\s*(?:[^Q]*?\\s+)?\\/${escapedName}\\s+Do\\s*Q|` +
          `q\\s*(?:[^Q]*?\\s+)?\\/${escapedName}\\s+Do\\s*Q|` +
          `(?:[0-9.-]+\\s+){6}cm\\s*(?:[^\\r\\n]*?\\s+)?\\/${escapedName}\\s+Do|` +
          `\\/${escapedName}\\s+Do`,
          'g'
        );

        const beforeLen = modifiedStream.length;
        modifiedStream = modifiedStream.replace(wrappedRegex, '');
        if (modifiedStream.length !== beforeLen) {
          removedCount++;
        }
      }
    }

    // 3. Write back modified stream
    const newStream = pdfDoc.context.flateStream(modifiedStream);
    const newRef = pdfDoc.context.register(newStream);
    page.node.set(PDFName.of('Contents'), newRef);

    const savedBytes = await pdfDoc.save();
    const updatedBuffer = savedBytes.buffer as ArrayBuffer;
    pdfDocCache.set(updatedBuffer, Promise.resolve(pdfDoc));
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
      updatedStream: modifiedStream,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logger.error('edit', `Chyba při odstraňování prvků ze strany ${pageIndex + 1}: ${errorMsg}`, {
      stack: err?.stack,
    });
    return { updatedPdfBytes: pdfDocBytes, removedCount: 0, updatedStream: '', error: errorMsg };
  }
}

