import {
  PDFDocument,
  PDFPage,
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
import { tokenizeContentStream } from './pdfContentTokenizer';

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
 * ISO 32000-1 Section 7.7.3.4: Safely resolves /Resources dictionary for a page node.
 * Avoids throwing "Expected instance of PDFDict, but got instance of undefined" when /Resources
 * is inherited from parent /Pages nodes or not directly declared on the leaf node.
 */
export function safeGetPageResources(page: any): PDFDict | undefined {
  if (!page) return undefined;
  const node = page.node || page;
  const ctx = node.context;

  // 1. Direct get on node without strict type assertion
  try {
    const rawRes = node.get ? node.get(PDFName.of('Resources')) : undefined;
    if (rawRes instanceof PDFRef && ctx) {
      const lookedUp = ctx.lookup(rawRes);
      if (lookedUp instanceof PDFDict) return lookedUp;
    } else if (rawRes instanceof PDFDict) {
      return rawRes;
    }
  } catch (_) {}

  // 2. Safe call to node.Resources()
  try {
    const res = node.Resources?.();
    if (res instanceof PDFDict) return res;
  } catch (_) {}

  // 3. Inheritance traversal: check parent /Pages nodes
  try {
    let parent: any = node.Parent?.() || node.parent?.();
    while (parent) {
      const pRaw = parent.get ? parent.get(PDFName.of('Resources')) : undefined;
      if (pRaw instanceof PDFRef && ctx) {
        const lookedUp = ctx.lookup(pRaw);
        if (lookedUp instanceof PDFDict) return lookedUp;
      } else if (pRaw instanceof PDFDict) {
        return pRaw;
      }
      try {
        const pRes = parent.Resources?.();
        if (pRes instanceof PDFDict) return pRes;
      } catch (_) {}

      parent =
        typeof parent.Parent === 'function'
          ? parent.Parent()
          : typeof parent.parent === 'function'
          ? parent.parent()
          : undefined;
    }
  } catch (_) {}

  return undefined;
}

/**
 * ISO 32000-1: Safely retrieves /Contents from a page node without throwing.
 */
export function safeGetPageContents(page: any): any {
  if (!page) return undefined;
  const node = page.node || page;
  try {
    const raw = node.get ? node.get(PDFName.of('Contents')) : undefined;
    if (raw) return raw;
  } catch (_) {}

  try {
    return node.Contents?.();
  } catch (_) {}

  return undefined;
}

/**
 * Heuristically tests if a decoded stream is actually encrypted ciphertext.
 */
export function isLikelyCiphertext(str: string): boolean {
  if (!str || str.length < 20) return false;
  // Inline image data (BI ... ID <binary> EI) is binary in any valid stream; judge the operators only
  if (/\bID\s/.test(str.substring(0, 4000))) {
    const operators = tokenizeContentStream(str.substring(0, 20000))
      .filter((op) => op.operator !== 'ID')
      .map((op) => str.substring(op.start, op.end))
      .join(' ');
    if (operators.length >= 20) str = operators;
  }
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
  244: 'ô', 248: 'ř', 249: 'ů', 250: 'ú', 252: 'ü', 253: 'ý', 254: 'ţ',
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
 * Whether hexToString decodes the hex string as UTF-16BE (BOM or every high byte 00)
 */
export function isTwoByteHexString(hex: string): boolean {
  const cleanHex = hex.replace(/\s+/g, '');
  if (cleanHex.startsWith('feff') || cleanHex.startsWith('FEFF')) return true;
  if (cleanHex.length < 4 || cleanHex.length % 4 !== 0) return false;
  for (let i = 0; i < cleanHex.length; i += 4) {
    if (cleanHex.substring(i, i + 2) !== '00') return false;
  }
  return true;
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
  const regex = matchCase
    ? new RegExp(escapeRegex(searchText), 'g')
    : new RegExp(escapeRegex(searchText), 'gi');

  // Step 1: Process TJ arrays with kerning: [ (...) 20 (...) ] TJ
  // We mask replaced TJ arrays with a unique placeholder so Strategy 2 (literal strings) won't re-process them.
  const tjReplacements: Map<string, string> = new Map();
  let tjPlaceholderIndex = 0;

  const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
  const intermediate = streamContent.replace(tjRegex, (match, arrayBody) => {
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

    if (regex.test(fullText)) {
      let localCount = 0;
      const replacedFull = fullText.replace(regex, () => {
        localCount++;
        return replaceText;
      });

      if (localCount > 0) {
        count += localCount;
        const placeholder = `__PDF_STUDIO_TJ_MASK_${tjPlaceholderIndex++}__`;
        const newTj = `[ (${escapePdfLiteralString(replacedFull, true)}) ] TJ`;
        tjReplacements.set(placeholder, newTj);
        return placeholder;
      }
    }

    return match;
  });

  // Step 2: Replace inside remaining literal PDF strings: ( ... ) using linear scanner
  const literalMatches = extractLiteralStrings(intermediate);
  let literalPassContent = '';
  let lastPos = 0;

  for (const item of literalMatches) {
    literalPassContent += intermediate.substring(lastPos, item.start);
    const unescaped = unescapePdfLiteralString(item.inner);

    let matchCount = 0;
    const replaced = unescaped.replace(regex, () => {
      matchCount++;
      return replaceText;
    });

    if (matchCount > 0) {
      count += matchCount;
      // Re-encode Czech characters that unescapePdfLiteralString decoded from octal escapes;
      // writing them raw would truncate them to their low byte (e.g. "ř" -> "Y")
      literalPassContent += `(${escapePdfLiteralString(replaced, true)})`;
    } else {
      literalPassContent += item.raw;
    }
    lastPos = item.end;
  }
  literalPassContent += intermediate.substring(lastPos);

  // Step 3: Replace inside remaining hex PDF strings: < ... >
  const hexRegex = /<([0-9a-fA-F\s]+)>/g;
  let hexPassContent = literalPassContent.replace(hexRegex, (match, hexBody) => {
    const isTwoByte = isTwoByteHexString(hexBody);
    const text = hexToString(hexBody);

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

  // Step 4: Restore masked TJ arrays
  for (const [placeholder, replacedTj] of tjReplacements.entries()) {
    hexPassContent = hexPassContent.replace(placeholder, replacedTj);
  }

  // Text outside PDF strings is never touched: a raw search over the whole stream would rewrite
  // operators, resource names and coordinates (e.g. replacing "1" or "re") and corrupt the page.
  return { modifiedContent: hexPassContent, count };
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
    const contentsRef = safeGetPageContents(page.node);
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
      const contentsRef = safeGetPageContents(page.node);
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
 * The editable stream text of a page is its /Contents followed by the content of the Form
 * XObjects it uses, each introduced by a marker comment line. The markers let edits be written
 * back to the stream they came from: without them, saving would inline the form content into
 * /Contents, drawing it a second time (in the wrong coordinate space, with missing resources).
 * Marker lines are PDF comments, so they are harmless even if they end up inside a stream; they
 * deliberately contain no "BT"/"ET"/"q" sequences that the heuristic stream parsers look for.
 */
const FORM_MARKER_PREFIX = '% pdfstudio:form-xobject:';
const FORM_MARKER_REGEX = /(^|\n)% pdfstudio:form-xobject:(\d+)[^\r\n]*(\r?\n|$)/g;

interface FormStreamPart {
  index: number;
  name: string;
  ref: PDFRef;
  text: string;
}

interface PageStreamParts {
  pageText: string;
  pageStreamCount: number;
  forms: FormStreamPart[];
}

const formMarkerLine = (form: FormStreamPart): string =>
  `${FORM_MARKER_PREFIX}${form.index} /${form.name.toLowerCase()} - edits here are saved into this form xobject`;

/** Where the page /Contents and each Form XObject lie inside the composed stream text */
export interface StreamPartLayout {
  kind: 'page' | 'form';
  /** Form XObject resource name (without the slash) */
  name?: string;
  start: number;
  end: number;
}

export function composePageStreamLayout(parts: PageStreamParts): { text: string; layout: StreamPartLayout[] } {
  let text = parts.pageText;
  const layout: StreamPartLayout[] = [{ kind: 'page', start: 0, end: text.length }];
  for (const form of parts.forms) {
    text += `${text ? '\n' : ''}${formMarkerLine(form)}\n`;
    const start = text.length;
    text += form.text;
    layout.push({ kind: 'form', name: form.name, start, end: text.length });
  }
  return { text, layout };
}

export function composePageStreamText(parts: PageStreamParts): string {
  return composePageStreamLayout(parts).text;
}

/**
 * Splits text produced by composePageStreamText back into the page /Contents text and the
 * texts of the individual Form XObjects (keyed by their marker index).
 */
export function splitPageStreamText(fullText: string): { pageText: string; forms: Map<number, string> } {
  const markers: { index: number; start: number; contentStart: number }[] = [];
  FORM_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORM_MARKER_REGEX.exec(fullText)) !== null) {
    markers.push({
      index: parseInt(match[2], 10),
      start: match.index,
      contentStart: match.index + match[0].length,
    });
    if (match[0].length === 0) FORM_MARKER_REGEX.lastIndex++;
  }

  if (markers.length === 0) {
    return { pageText: fullText, forms: new Map() };
  }

  const forms = new Map<number, string>();
  markers.forEach((marker, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].start : fullText.length;
    forms.set(marker.index, fullText.substring(marker.contentStart, end));
  });
  return { pageText: fullText.substring(0, markers[0].start), forms };
}

function collectPageStreamParts(pdfDoc: PDFDocument, page: PDFPage): PageStreamParts {
  const contentsRef = safeGetPageContents(page.node);
  const pageParts: string[] = [];

  const readPart = (item: any) => {
    const stream = item instanceof PDFRef ? page.node.context.lookup(item) : item;
    const decodedPart = decodeStreamObject(stream);
    if (decodedPart) pageParts.push(decodedPart);
  };

  if (contentsRef instanceof PDFArray) {
    for (let i = 0; i < contentsRef.size(); i++) {
      readPart(contentsRef.get(i));
    }
  } else if (contentsRef) {
    readPart(contentsRef);
  }

  // Form XObjects in page resources (/XObject dictionary)
  const forms: FormStreamPart[] = [];
  const resources = safeGetPageResources(page.node);
  if (resources instanceof PDFDict) {
    const xObject = resources.lookup(PDFName.of('XObject'));
    if (xObject instanceof PDFDict) {
      for (const [key, ref] of xObject.entries()) {
        if (!(ref instanceof PDFRef)) continue;
        const obj = pdfDoc.context.lookup(ref);
        if (obj instanceof PDFRawStream || (obj && typeof (obj as any).getContents === 'function')) {
          const dict = (obj as any).dict || obj;
          const sub = dict instanceof PDFDict ? dict.lookup(PDFName.of('Subtype')) : undefined;
          if (sub instanceof PDFName && sub.asString() === '/Form') {
            const formStream = decodeStreamObject(obj);
            if (formStream) {
              forms.push({
                index: forms.length + 1,
                name: key.asString().replace(/^\//, ''),
                ref,
                text: formStream,
              });
            }
          }
        }
      }
    }
  }

  return { pageText: pageParts.join('\n'), pageStreamCount: pageParts.length, forms };
}

/**
 * Gives the page its own /Resources dictionary and its own copy of one resource category (both
 * shallow copies), so changing an entry affects only this page and not every page sharing the
 * inherited resources.
 */
export function getPageLocalResourceDict(pdfDoc: PDFDocument, page: PDFPage, category: 'XObject' | 'Font'): PDFDict {
  const context = pdfDoc.context;
  const resources = safeGetPageResources(page.node);
  const localResources = resources ? resources.clone(context) : context.obj({});
  page.node.set(PDFName.of('Resources'), localResources);

  const existing = localResources.lookup(PDFName.of(category));
  const localCategory = existing instanceof PDFDict ? existing.clone(context) : context.obj({});
  localResources.set(PDFName.of(category), localCategory);
  return localCategory;
}

const getPageLocalXObjectDict = (pdfDoc: PDFDocument, page: PDFPage): PDFDict =>
  getPageLocalResourceDict(pdfDoc, page, 'XObject');

/**
 * Writes stream text (as produced by composePageStreamText and possibly edited) back into the page:
 * the page part replaces /Contents, edited Form XObject parts replace page-local copies of the forms.
 * Returns the resulting composed stream text.
 */
export function writePageStreamText(pdfDoc: PDFDocument, page: PDFPage, fullText: string): string {
  const original = collectPageStreamParts(pdfDoc, page);
  const { pageText, forms } = splitPageStreamText(fullText);

  if (pageText !== original.pageText) {
    const newRef = pdfDoc.context.register(pdfDoc.context.flateStream(pageText));
    page.node.set(PDFName.of('Contents'), newRef);
  }

  const changedForms = original.forms.filter((form) => forms.has(form.index) && forms.get(form.index) !== form.text);
  if (changedForms.length > 0) {
    const localXObject = getPageLocalXObjectDict(pdfDoc, page);
    for (const form of changedForms) {
      const originalStream = pdfDoc.context.lookup(form.ref) as PDFRawStream;
      const newStream = pdfDoc.context.flateStream(forms.get(form.index)!);
      for (const [key, value] of originalStream.dict.entries()) {
        const keyName = key.asString();
        if (keyName !== '/Length' && keyName !== '/Filter' && keyName !== '/DecodeParms' && keyName !== '/DL') {
          newStream.dict.set(key, value);
        }
      }
      localXObject.set(PDFName.of(form.name), pdfDoc.context.register(newStream));
    }
  }

  return composePageStreamText(collectPageStreamParts(pdfDoc, page));
}

/**
 * Get decompressed content stream of a specific page in a PDF ArrayBuffer.
 */
export async function getPageContentStream(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number
): Promise<{ streamText: string; streamCount: number; isEncrypted?: boolean; error?: string; layout?: StreamPartLayout[] }> {
  try {
    const encInfo = await checkDocumentEncryption(pdfDocBytes);
    if (encInfo.isEncrypted) {
      return {
        streamText: '',
        streamCount: 0,
        isEncrypted: true,
        error: 'Dokument používá standardní šifrování oprávnění (Standard Security). Přímá editace content streamu je uzamčena.',
      };
    }

    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);
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
    const parts = collectPageStreamParts(pdfDoc, page);
    const { text: streamText, layout } = composePageStreamLayout(parts);
    const streamCount = parts.pageStreamCount + parts.forms.length;

    // Without /Encrypt, binary-looking operators mean the stream could not be decoded (e.g. an
    // unsupported filter); editing it would corrupt the page
    if (isLikelyCiphertext(streamText)) {
      return {
        streamText: '',
        streamCount,
        isEncrypted: false,
        error: 'Obsah stránky se nepodařilo dekódovat (nepodporovaný filtr nebo poškozený stream). Přímá editace je vypnuta.',
      };
    }

    return { streamText, streamCount, isEncrypted: false, layout };
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

  // Text objects are found with a real tokenizer: a regular expression would also match "BT"/"ET"
  // inside strings and names (e.g. "(BUDGET) Tj") and cut a text object in half
  const operations = tokenizeContentStream(streamText);
  let lastIndex = 0;
  let blockIndex = 1;

  let currentMatrix: TransformMatrix = { ...IDENTITY_MATRIX };
  const matrixStack: TransformMatrix[] = [];

  for (let opIdx = 0; opIdx < operations.length; opIdx++) {
    const op = operations[opIdx];
    if (op.operator === 'q') {
      matrixStack.push({ ...currentMatrix });
      continue;
    }
    if (op.operator === 'Q') {
      currentMatrix = matrixStack.pop() ?? { ...IDENTITY_MATRIX };
      continue;
    }
    if (op.operator === 'cm') {
      const values = op.operands.slice(-6).map((o) => parseFloat(o.raw));
      if (values.length === 6 && values.every((v) => !isNaN(v))) {
        const [a, b, c, d, e, f] = values;
        currentMatrix = multiplyMatrix(currentMatrix, { a, b, c, d, e, f });
      }
      continue;
    }
    if (op.operator !== 'BT') continue;

    let etIdx = opIdx + 1;
    while (etIdx < operations.length && operations[etIdx].operator !== 'ET') etIdx++;
    const startIndex = op.operatorStart;
    const endIndex = etIdx < operations.length ? operations[etIdx].end : streamText.length;
    opIdx = etIdx;

    // Preceding non-text chunk
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

    const rawBlock = streamText.substring(startIndex, endIndex);
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
  pageHeight?: number,
  requireMatch: boolean = false
): StreamSegment | undefined {
  if (!textBlocks || textBlocks.length === 0) return undefined;
  if (!targetText && !targetPosition) return requireMatch ? undefined : textBlocks[0];

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

  // Callers that act destructively must not fall back to an arbitrary block
  return requireMatch ? undefined : textBlocks[0];
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
    const updatedStream = writePageStreamText(pdfDoc, page, newStreamContent);

    const savedBytes = await pdfDoc.save();
    const durationMs = Date.now() - startTime;

    logger.success('edit', `Content stream strany ${pageIndex + 1} úspěšně zapsán do PDF za ${durationMs} ms (${savedBytes.byteLength} B)`, {
      pageIndex: pageIndex + 1,
      durationMs,
      savedBytes: savedBytes.byteLength,
    });

    return {
      updatedPdfBytes: savedBytes.buffer as ArrayBuffer,
      updatedStream,
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
  format?: 'jpeg' | 'png' | 'jbig2' | 'ccitt' | 'flate' | 'unknown';
  dpi?: number;
  isFullPageScan?: boolean;
  thumbnailDataUrl?: string;
  rawInvocation?: string;
  /** How the image is stored: an image XObject or inline image data in the content stream */
  kind?: 'xobject' | 'inline';
  /** Index among invocations of the same image (or among inline images) on the page */
  occurrence?: number;
  /** How many times the same image XObject is painted on this page */
  placementCount?: number;
  /** Painted inside one of the page's Form XObjects */
  inForm?: boolean;
}

/**
 * Discovers and inspects all embedded image XObjects and inline image placements on a PDF page.
 */
export async function getPageImages(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number
): Promise<{ images: PageImageInfo[]; error?: string }> {
  try {
    const encInfo = await checkDocumentEncryption(pdfDocBytes);
    if (encInfo.isEncrypted) {
      return { images: [], error: 'Dokument používá standardní šifrování oprávnění (Standard Security).' };
    }

    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return { images: [], error: `Neplatný index stránky ${pageIndex + 1}` };
    }

    const page = pdfDoc.getPage(pageIndex);
    const { streamText } = await getPageContentStream(pdfDocBytes, pageIndex);

    const images: PageImageInfo[] = [];
    const { layout } = await getPageContentStream(pdfDocBytes, pageIndex);
    if (!streamText || !layout) return { images };

    const context = page.node.context;
    const pageResources = safeGetPageResources(page.node);
    const xObjectsOf = (resources: unknown): PDFDict | undefined => {
      const dict = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : undefined;
      return dict instanceof PDFDict ? dict : undefined;
    };
    const streamDict = (obj: unknown): PDFDict | undefined =>
      obj instanceof PDFDict ? obj : (obj as any)?.dict instanceof PDFDict ? (obj as any).dict : undefined;
    const pageXObjects = xObjectsOf(pageResources);
    // Resources of each stream part: the page's, or the form's own (falling back to the page's)
    const partXObjects = layout.map((part) => {
      if (part.kind !== 'form' || !part.name || !pageXObjects) return pageXObjects;
      const formDict = streamDict(context.lookup(pageXObjects.get(PDFName.of(part.name))));
      return xObjectsOf(formDict?.lookup(PDFName.of('Resources'))) || pageXObjects;
    });
    const imageDicts = new Map<string, PDFDict>();

    const placements = findImagePlacements(streamText, layout, (partIndex, name) => {
      const dict = streamDict(context.lookup(partXObjects[partIndex]?.get(PDFName.of(name))));
      if (!dict) return null;
      const subtype = dict.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Image') {
        imageDicts.set(`${partIndex}:${name}`, dict);
        return { kind: 'image' };
      }
      if (subtype === '/Form') {
        const matrixArr = dict.lookup(PDFName.of('Matrix'));
        const nums =
          matrixArr instanceof PDFArray ? matrixArr.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN)) : [];
        const matrix = (nums.length === 6 && nums.every((n) => Number.isFinite(n)) ? nums : [1, 0, 0, 1, 0, 0]) as [
          number, number, number, number, number, number
        ];
        const formPart = layout[partIndex]?.kind === 'page' ? layout.findIndex((p) => p.kind === 'form' && p.name === name) : -1;
        return { kind: 'form', partIndex: formPart >= 0 ? formPart : undefined, matrix };
      }
      return null;
    });

    const numberOf = (value: unknown): number | undefined => {
      if (value instanceof PDFNumber) return value.asNumber();
      const n = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const nameOf = (value: unknown): string | undefined => (value ? String(value).replace(/^\//, '') : undefined);
    const placementCounts = new Map<string, number>();
    placements.forEach((p) => {
      if (p.kind === 'xobject') placementCounts.set(p.name, (placementCounts.get(p.name) ?? 0) + 1);
    });

    for (const p of placements) {
      const [minX, minY, maxX, maxY] = p.bbox;
      const info: PageImageInfo = {
        id: p.id,
        name: p.kind === 'xobject' ? `/${p.name}` : '',
        cleanName: p.kind === 'xobject' ? p.name : `inline-${p.occurrence + 1}`,
        kind: p.kind,
        occurrence: p.occurrence,
        placementCount: p.kind === 'xobject' ? placementCounts.get(p.name) : 1,
        inForm: layout[p.partIndex]?.kind === 'form',
        x: Math.round(minX * 10) / 10,
        y: Math.round(minY * 10) / 10,
        width: Math.round((maxX - minX) * 10) / 10,
        height: Math.round((maxY - minY) * 10) / 10,
        rawInvocation: streamText.substring(p.start, p.end).slice(0, 300),
      };
      if (p.kind === 'xobject') {
        const dict = imageDicts.get(`${p.partIndex}:${p.name}`);
        info.pixelWidth = numberOf(dict?.get(PDFName.of('Width')));
        info.pixelHeight = numberOf(dict?.get(PDFName.of('Height')));
        info.colorSpace = nameOf(dict?.get(PDFName.of('ColorSpace')));
        info.filter = nameOf(dict?.get(PDFName.of('Filter')));
      } else {
        const params = p.inlineParams || {};
        info.pixelWidth = numberOf(params.W ?? params.Width);
        info.pixelHeight = numberOf(params.H ?? params.Height);
        info.colorSpace = params.CS ?? params.ColorSpace;
        info.filter = params.F ?? params.Filter;
      }
      // Resolution along the image's own axes (rotated or skewed placements included)
      const drawnWidth = Math.hypot(p.matrix[0], p.matrix[1]);
      if (info.pixelWidth && drawnWidth > 0) info.dpi = Math.round((info.pixelWidth / drawnWidth) * 72);
      images.push(info);
    }

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    for (const img of images) {
      if (!img.format && img.filter) {
        if (img.filter.includes('DCT') || img.filter.includes('JPX')) {
          img.format = 'jpeg';
        } else if (img.filter.includes('JBIG2')) {
          img.format = 'jbig2';
        } else if (img.filter.includes('CCITT') || img.filter === 'CCF') {
          img.format = 'ccitt';
        } else if (img.filter.includes('Flate') || img.filter === 'Fl') {
          img.format = 'png';
        } else {
          img.format = 'unknown';
        }
      }
      if (img.width && img.height && pageWidth > 0 && pageHeight > 0) {
        const areaRatio = (img.width * img.height) / (pageWidth * pageHeight);
        img.isFullPageScan = areaRatio >= 0.82;
      }
    }

    return { images };
  } catch (err: any) {
    logger.error('edit', `Chyba při čtení obrázků ze strany ${pageIndex + 1}: ${err?.message || err}`);
    return { images: [], error: err?.message || String(err) };
  }
}

/**
 * In-place replaces an image on a page with a new image (PNG or JPEG) conforming to ISO 32000-1.
 * Maintains the existing content stream placement, matrix transform, and aspect ratio.
 */
export async function replaceImageOnPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  imageName: string,
  newImageBytes: ArrayBuffer | Uint8Array,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'
): Promise<{ updatedPdfBytes: ArrayBuffer; error?: string }> {
  const startTime = Date.now();
  const cleanName = imageName.replace(/^\//, '');
  logger.info('edit', `Zahájena výměna obrázku /${cleanName} na straně ${pageIndex + 1}`, {
    pageIndex: pageIndex + 1,
    imageName: cleanName,
    mimeType,
  });

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      const err = `Neplatný index stránky ${pageIndex + 1}`;
      return { updatedPdfBytes: pdfDocBytes, error: err };
    }

    const page = pdfDoc.getPage(pageIndex);

    // Embed the new image into the PDFDocument context
    const isJpg = mimeType === 'image/jpeg';
    const embeddedImage = isJpg
      ? await pdfDoc.embedJpg(newImageBytes)
      : await pdfDoc.embedPng(newImageBytes);

    // Locate or create the page's /Resources /XObject dictionary
    let resources = safeGetPageResources(page.node);
    if (!page.node.get(PDFName.of('Resources'))) {
      // Create page-local Resources dictionary to avoid mutating parent trees
      const localResources = page.node.context.obj({});
      if (resources instanceof PDFDict) {
        for (const [key, val] of resources.entries()) {
          localResources.set(key, val);
        }
      }
      page.node.set(PDFName.of('Resources'), localResources);
      resources = localResources;
    } else if (resources instanceof PDFRef) {
      resources = page.node.context.lookup(resources) as any;
    }

    if (!resources) {
      resources = page.node.context.obj({});
      page.node.set(PDFName.of('Resources'), resources);
    }

    let xObjectDict = resources.get(PDFName.of('XObject'));
    if (xObjectDict instanceof PDFRef) {
      xObjectDict = page.node.context.lookup(xObjectDict);
    }
    if (!xObjectDict || !(xObjectDict instanceof PDFDict)) {
      xObjectDict = page.node.context.obj({});
      resources.set(PDFName.of('XObject'), xObjectDict);
    }

    // Set the new image reference for the specified key
    (xObjectDict as PDFDict).set(PDFName.of(cleanName), embeddedImage.ref);

    const savedBytes = await pdfDoc.save({ useObjectStreams: false });
    const durationMs = Date.now() - startTime;
    logger.info('edit', `Obrázek /${cleanName} byl úspěšně nahrazen (${durationMs} ms)`, {
      pageIndex: pageIndex + 1,
      imageName: cleanName,
      durationMs,
    });

    return { updatedPdfBytes: savedBytes.buffer as ArrayBuffer };
  } catch (err: any) {
    logger.error('edit', `Chyba při výměně obrázku /${cleanName}: ${err?.message || err}`);
    return { updatedPdfBytes: pdfDocBytes, error: err?.message || String(err) };
  }
}

/**
 * Extracts raw or decoded bytes of an image XObject from a PDF page for export/download.
 */
export async function extractImageBytesFromPdf(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  imageName: string
): Promise<{ imageBytes?: Uint8Array; mimeType?: string; extension?: string; error?: string }> {
  try {
    const pdfDoc = await getCachedPdfLibDocument(pdfDocBytes);
    const pageCount = pdfDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return { error: `Neplatný index stránky ${pageIndex + 1}` };
    }

    const page = pdfDoc.getPage(pageIndex);
    const cleanName = imageName.replace(/^\//, '');

    let resources = safeGetPageResources(page.node);
    if (!resources) return { error: 'Stránka neobsahuje žádné /Resources' };
    let xObjectDict = resources.get(PDFName.of('XObject'));
    if (xObjectDict instanceof PDFRef) xObjectDict = page.node.context.lookup(xObjectDict);
    if (!(xObjectDict instanceof PDFDict)) return { error: 'Slovník /XObject nebyl nalezen' };

    const imgRef = xObjectDict.get(PDFName.of(cleanName));
    if (!imgRef) return { error: `Obrázek /${cleanName} nebyl v /XObject nalezen` };

    const xObj = page.node.context.lookup(imgRef);
    if (!xObj) return { error: `Objekt pro /${cleanName} nelze dereferencovat` };

    const dict =
      xObj instanceof PDFDict ? xObj : (xObj as any).dict instanceof PDFDict ? (xObj as any).dict : undefined;
    const filter = dict ? String(dict.get(PDFName.of('Filter')) || '') : '';

    if (xObj instanceof PDFRawStream) {
      const rawContents = xObj.getContents();
      if (filter.includes('DCTDecode') || filter.includes('JPXDecode')) {
        return { imageBytes: rawContents, mimeType: 'image/jpeg', extension: 'jpg' };
      }
      try {
        const decoded = decodePDFRawStream(xObj);
        return { imageBytes: decoded.decode(), mimeType: 'application/octet-stream', extension: 'bin' };
      } catch {
        return { imageBytes: rawContents, mimeType: 'application/octet-stream', extension: 'bin' };
      }
    }

    return { error: 'Objekt obrázku není stream' };
  } catch (err: any) {
    return { error: err?.message || String(err) };
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

// Operators that put something on the page; a q ... Q group containing any of them besides the
// image being removed must stay (only the image invocation goes)
const PAINTING_OPERATORS = new Set([
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'BT', 'INLINE', 'Do', 'd0', 'd1',
]);

type WalkMatrix = [number, number, number, number, number, number];

interface WalkOperation {
  operator: string;
  operands: { type: string; raw: string }[];
  start: number;
  end: number;
  operatorStart: number;
}

/** Content stream operations with each inline image (BI ... ID data EI) merged into one INLINE op */
function walkOperations(stream: string, from = 0, to = stream.length): WalkOperation[] {
  const ops = tokenizeContentStream(stream, from, to) as WalkOperation[];
  const merged: WalkOperation[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.operator === 'BI' && ops[i + 1]?.operator === 'ID') {
      const data = ops[i + 1];
      merged.push({ operator: 'INLINE', operands: data.operands, start: op.start, end: data.end, operatorStart: op.operatorStart });
      i++;
    } else {
      merged.push(op);
    }
  }
  return merged;
}

/** Resource name of a /Name operand, with #xx escapes decoded */
const decodeNameOperand = (raw: string | undefined): string | null => {
  if (!raw || !raw.startsWith('/')) return null;
  return raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
};

const multiplyWalkMatrix = (m1: WalkMatrix, m2: WalkMatrix): WalkMatrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/**
 * Removes the operations selected by `isTarget` from a content stream. When a target sits in a
 * q ... Q group that only sets it up (cm, gs, clipping...), the whole group goes; otherwise just
 * the operation, so nothing else drawn on the page is lost. `occurrence` counts invocations of the
 * same XObject name (Do) or inline images (INLINE) in stream order.
 */
function removeTargetOperations(
  stream: string,
  isTarget: (op: WalkOperation, name: string | null, occurrence: number) => boolean
): { stream: string; removed: number } {
  interface Frame {
    start: number;
    hasOther: boolean;
    targets: { start: number; end: number }[];
  }
  const root: Frame = { start: -1, hasOther: true, targets: [] };
  const stack: Frame[] = [root];
  const ranges: { start: number; end: number }[] = [];
  const doCounts = new Map<string, number>();
  let inlineCount = 0;
  let removed = 0;

  for (const op of walkOperations(stream)) {
    const top = stack[stack.length - 1];
    if (op.operator === 'q') {
      stack.push({ start: op.operatorStart, hasOther: false, targets: [] });
      continue;
    }
    if (op.operator === 'Q') {
      if (stack.length === 1) continue; // unbalanced Q
      const frame = stack.pop()!;
      const parent = stack[stack.length - 1];
      if (frame.targets.length > 0 && !frame.hasOther) {
        ranges.push({ start: frame.start, end: op.end });
      } else {
        ranges.push(...frame.targets);
        if (frame.hasOther) parent.hasOther = true;
      }
      removed += frame.targets.length;
      continue;
    }
    let name: string | null = null;
    let occurrence = -1;
    if (op.operator === 'Do') {
      name = decodeNameOperand(op.operands[0]?.raw);
      if (name !== null) {
        occurrence = doCounts.get(name) ?? 0;
        doCounts.set(name, occurrence + 1);
      }
    } else if (op.operator === 'INLINE') {
      occurrence = inlineCount++;
    }
    if ((op.operator === 'Do' || op.operator === 'INLINE') && isTarget(op, name, occurrence)) {
      top.targets.push({ start: op.start, end: op.end });
    } else if (PAINTING_OPERATORS.has(op.operator)) {
      top.hasOther = true;
    }
  }
  // Groups left open at the end of the stream, and the top level: remove the invocations only
  for (const frame of stack) {
    ranges.push(...frame.targets);
    removed += frame.targets.length;
  }

  ranges.sort((a, b) => b.start - a.start);
  let out = stream;
  for (const range of ranges) {
    out = out.substring(0, range.start) + out.substring(range.end);
  }
  return { stream: out, removed };
}

/**
 * Removes invocations of the named XObject (`/Name Do`): all of them, or only the given
 * occurrence (0-based, in stream order) when one placement of a repeated image is deleted.
 */
export function removeXObjectInvocations(
  stream: string,
  name: string,
  occurrence?: number
): { stream: string; removed: number } {
  const cleanName = name.replace(/^\//, '');
  return removeTargetOperations(
    stream,
    (op, opName, opOccurrence) =>
      op.operator === 'Do' && opName === cleanName && (occurrence === undefined || opOccurrence === occurrence)
  );
}

/** Removes one inline image (BI ... ID ... EI), counted in stream order */
export function removeInlineImage(stream: string, occurrence: number): { stream: string; removed: number } {
  return removeTargetOperations(stream, (op, _name, opOccurrence) => op.operator === 'INLINE' && opOccurrence === occurrence);
}

/** Number of `/Name Do` invocations in a content stream */
export function countXObjectInvocations(stream: string, name: string): number {
  const cleanName = name.replace(/^\//, '');
  return walkOperations(stream).filter((op) => op.operator === 'Do' && decodeNameOperand(op.operands[0]?.raw) === cleanName)
    .length;
}

/** One place where an image is painted on the page */
export interface ImagePlacement {
  /** `img:<name>:<occurrence>` for image XObjects, `inline:<occurrence>` for inline images */
  id: string;
  kind: 'xobject' | 'inline';
  /** Resource name (image XObjects) */
  name: string;
  /** Index among invocations of the same name / among inline images, in stream order */
  occurrence: number;
  partIndex: number;
  /** Range of the painting operation in the composed stream */
  start: number;
  end: number;
  /** Image space (unit square) -> page user space */
  matrix: WalkMatrix;
  /** [minX, minY, maxX, maxY] in page user space */
  bbox: [number, number, number, number];
  /** Inline image dictionary entries (W, H, BPC, CS, F...) */
  inlineParams?: Record<string, string>;
}

export type XObjectResolution =
  | { kind: 'image' }
  | { kind: 'form'; partIndex?: number; matrix: WalkMatrix }
  | null;

/**
 * Finds every painted image of a page in the composed stream (page contents followed by its Form
 * XObjects): image XObjects and inline images, with the transformation in effect, descending into
 * the page's forms where they are invoked. Each invocation gets its own id, so repeated images can
 * be listed, selected and deleted one by one.
 */
export function findImagePlacements(
  streamText: string,
  layout: StreamPartLayout[],
  resolveXObject: (partIndex: number, name: string) => XObjectResolution
): ImagePlacement[] {
  const opsByPart: WalkOperation[][] = layout.map((part) => walkOperations(streamText, part.start, part.end));

  // Occurrence numbers in stream text order, as the removal functions count them
  const occurrenceAt = new Map<number, number>();
  const doCounts = new Map<string, number>();
  let inlineCount = 0;
  opsByPart.flat().sort((a, b) => a.start - b.start).forEach((op) => {
    if (op.operator === 'Do') {
      const name = decodeNameOperand(op.operands[0]?.raw);
      if (name === null) return;
      const n = doCounts.get(name) ?? 0;
      doCounts.set(name, n + 1);
      occurrenceAt.set(op.start, n);
    } else if (op.operator === 'INLINE') {
      occurrenceAt.set(op.start, inlineCount++);
    }
  });

  const placements: ImagePlacement[] = [];
  const usedIds = new Map<string, number>();
  const pushPlacement = (placement: Omit<ImagePlacement, 'bbox'>) => {
    const m = placement.matrix;
    const xs = [m[4], m[0] + m[4], m[0] + m[2] + m[4], m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[1] + m[3] + m[5], m[3] + m[5]];
    // A form painted twice paints its images twice from the same operation
    const seen = usedIds.get(placement.id) ?? 0;
    usedIds.set(placement.id, seen + 1);
    placements.push({
      ...placement,
      id: seen === 0 ? placement.id : `${placement.id}@${seen}`,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  };

  const walk = (ops: WalkOperation[], partIndex: number, initial: WalkMatrix, depth: number) => {
    let ctm = initial;
    const stack: WalkMatrix[] = [];
    for (const op of ops) {
      if (op.operator === 'q') {
        stack.push(ctm);
      } else if (op.operator === 'Q') {
        if (stack.length > 0) ctm = stack.pop()!;
      } else if (op.operator === 'cm') {
        const nums = op.operands.map((o) => Number(o.raw));
        if (nums.length === 6 && nums.every((n) => Number.isFinite(n))) ctm = multiplyWalkMatrix(ctm, nums as WalkMatrix);
      } else if (op.operator === 'Do') {
        const name = decodeNameOperand(op.operands[0]?.raw);
        if (name === null) continue;
        const resolved = resolveXObject(partIndex, name);
        if (resolved?.kind === 'image') {
          const occurrence = occurrenceAt.get(op.start) ?? 0;
          pushPlacement({ id: `img:${name}:${occurrence}`, kind: 'xobject', name, occurrence, partIndex, start: op.start, end: op.end, matrix: ctm });
        } else if (resolved?.kind === 'form' && resolved.partIndex !== undefined && depth < 4) {
          walk(opsByPart[resolved.partIndex] || [], resolved.partIndex, multiplyWalkMatrix(ctm, resolved.matrix), depth + 1);
        }
      } else if (op.operator === 'INLINE') {
        const occurrence = occurrenceAt.get(op.start) ?? 0;
        const params: Record<string, string> = {};
        for (let i = 0; i + 1 < op.operands.length; i += 2) {
          const key = decodeNameOperand(op.operands[i].raw);
          if (key) params[key] = op.operands[i + 1].raw.replace(/^\//, '');
        }
        pushPlacement({ id: `inline:${occurrence}`, kind: 'inline', name: '', occurrence, partIndex, start: op.start, end: op.end, matrix: ctm, inlineParams: params });
      }
    }
  };

  // Page content streams run in sequence; forms are walked where the page invokes them
  const pageOps = layout.flatMap((part, idx) => (part.kind === 'page' ? opsByPart[idx] : []));
  const firstPagePart = Math.max(0, layout.findIndex((part) => part.kind === 'page'));
  walk(pageOps, firstPagePart, [1, 0, 0, 1, 0, 0], 0);
  return placements;
}

/**
 * Atomically removes multiple text blocks and/or images from a page's content stream and resources.
 */
export async function removeMultipleElementsFromPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  segmentIds: string[],
  imageNames: string[],
  /** Stream text each segment id had when the caller looked; guards against stale (renumbered) ids */
  expectedContents?: Record<string, string>
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

    // 1. Remove text/graphics segments by position, last first so earlier offsets stay valid
    // (removing by content would hit the first identical block instead of the selected one)
    if (segmentIds.length > 0) {
      const parsed = parseStreamSegments(modifiedStream);
      const byId = new Map(parsed.map((s) => [s.id, s]));
      const targets = new Set<StreamSegment>();
      for (const id of segmentIds) {
        let seg = byId.get(id);
        const expected = expectedContents?.[id];
        if (expected !== undefined && seg?.rawContent !== expected) {
          // Segment ids are positional and shift after every removal; find the block by its content
          const matches = parsed.filter((s) => s.type === 'text' && s.rawContent === expected);
          seg = matches.length === 1 ? matches[0] : undefined;
          if (!seg) {
            return {
              updatedPdfBytes: pdfDocBytes,
              removedCount: 0,
              updatedStream: streamText,
              error: 'Obsah stránky se mezitím změnil. Vyberte prvek znovu.',
            };
          }
        }
        if (seg) targets.add(seg);
      }
      const toRemove = [...targets].sort((a, b) => b.startIndex - a.startIndex);

      for (const seg of toRemove) {
        if (modifiedStream.substring(seg.startIndex, seg.endIndex) === seg.rawContent) {
          modifiedStream = modifiedStream.substring(0, seg.startIndex) + modifiedStream.substring(seg.endIndex);
          removedCount++;
        }
      }

      // Clean up empty marked content tags left after segment deletion (e.g. /Artifact BDC EMC)
      modifiedStream = modifiedStream
        .replace(/\/[A-Za-z0-9_\-+]+(?:\s+<<[^>]*>>)?\s*BDC\s*EMC/g, '')
        .replace(/\/[A-Za-z0-9_\-+Client]+\s*BMC\s*EMC/g, '');
    }

    // 2. Remove images: placement ids ("img:<name>:<occurrence>", "inline:<occurrence>") remove one
    // painted image, a plain name removes every invocation of that image XObject
    if (imageNames.length > 0) {
      const resources = safeGetPageResources(page.node);
      const sharedXObjectDict = resources?.lookup(PDFName.of('XObject'));
      const hasImageEntry = (name: string) =>
        sharedXObjectDict instanceof PDFDict && sharedXObjectDict.has(PDFName.of(name));

      type ImageTarget = { kind: 'all' | 'placement' | 'inline'; name: string; occurrence: number; label: string };
      const targets: ImageTarget[] = imageNames.map((raw) => {
        const inline = /^inline:(\d+)(?:@\d+)?$/.exec(raw);
        if (inline) return { kind: 'inline', name: '', occurrence: Number(inline[1]), label: raw };
        const placed = /^img:(.+):(\d+)(?:@\d+)?$/.exec(raw);
        if (placed) return { kind: 'placement', name: placed[1], occurrence: Number(placed[2]), label: placed[1] };
        const name = raw.replace(/^\//, '');
        return { kind: 'all', name, occurrence: -1, label: name };
      });
      // Later occurrences first, so removing one does not renumber the others still to remove
      targets.sort((a, b) => b.occurrence - a.occurrence);

      const touchedNames = new Set<string>();
      for (const target of targets) {
        const result =
          target.kind === 'inline'
            ? removeInlineImage(modifiedStream, target.occurrence)
            : removeXObjectInvocations(modifiedStream, target.name, target.kind === 'placement' ? target.occurrence : undefined);
        modifiedStream = result.stream;
        if (result.removed > 0) {
          removedCount++;
          if (target.name) touchedNames.add(target.name);
        } else if (segmentIds.length === 0) {
          return {
            updatedPdfBytes: pdfDocBytes,
            removedCount: 0,
            updatedStream: streamText,
            error: `Obrázek ${target.label} se v obsahu stránky nepodařilo najít. Obnovte seznam prvků a vyberte ho znovu.`,
          };
        }
      }

      // An image XObject no longer painted anywhere on the page leaves this page's resources
      // (a page-local copy: resources are often shared by many pages)
      const unused = [...touchedNames].filter((name) => hasImageEntry(name) && countXObjectInvocations(modifiedStream, name) === 0);
      if (unused.length > 0) {
        const xObjectDict = getPageLocalXObjectDict(pdfDoc, page);
        unused.forEach((name) => xObjectDict.delete(PDFName.of(name)));
      }
    }

    // 3. Write back modified stream (page contents and any edited Form XObjects)
    const updatedStream = writePageStreamText(pdfDoc, page, modifiedStream);

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
      updatedStream,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logger.error('edit', `Chyba při odstraňování prvků ze strany ${pageIndex + 1}: ${errorMsg}`, {
      stack: err?.stack,
    });
    return { updatedPdfBytes: pdfDocBytes, removedCount: 0, updatedStream: '', error: errorMsg };
  }
}

