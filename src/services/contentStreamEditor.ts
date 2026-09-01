import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRef,
  PDFRawStream,
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
 * Convert a hex string (e.g. 48656c6c6f) to a text string
 */
export function hexToString(hex: string): string {
  let str = '';
  const cleanHex = hex.replace(/\s+/g, '');
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substring(i, i + 2), 16);
    if (!isNaN(byte)) {
      str += String.fromCharCode(byte);
    }
  }
  return str;
}

/**
 * Convert text string to hex representation (e.g. Hello -> 48656c6c6f)
 */
export function stringToHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    const hexByte = (charCode & 0xff).toString(16).padStart(2, '0');
    hex += hexByte;
  }
  return hex;
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

  // Strategy 1: Replace inside literal PDF strings: ( ... )
  // Matches ( ... ) while handling escaped parens \( and \)
  const literalRegex = /\((?:[^\\()]+|\\.)*\)/g;
  let modifiedContent = streamContent.replace(literalRegex, (match) => {
    // Strip surrounding parens
    const inner = match.slice(1, -1);
    const unescaped = unescapePdfLiteralString(inner);

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
      return `(${escapePdfLiteralString(replaced)})`;
    }

    return match;
  });

  // Strategy 2: Replace inside hex PDF strings: < ... >
  const hexRegex = /<([0-9a-fA-F\s]+)>/g;
  modifiedContent = modifiedContent.replace(hexRegex, (match, hexBody) => {
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
      return `<${stringToHex(replaced)}>`;
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
