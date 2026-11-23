import { PdfPageModel, SourceDocument } from '../types/document';
import { getCachedPdfDocument } from './pdfLoader';

export interface SearchMatchRect {
  x: number; // in unscaled page coordinates (points) from top-left
  y: number;
  width: number;
  height: number;
}

export interface SearchMatch {
  id: string;
  globalIndex: number;
  pageIndex: number;
  pageId: string;
  matchedText: string;
  rects: SearchMatchRect[];
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  signal?: AbortSignal;
  /** Optional progressive callback invoked with matches found so far as chunks of pages complete */
  onProgress?: (matchesSoFar: SearchMatch[], scannedPages: number, totalPages: number) => void;
  /** Number of pages scanned before yielding to the event loop & emitting progress (default: 6) */
  chunkSize?: number;
}

interface CompactTextItem {
  start: number;
  end: number;
  strLen: number;
  width: number;
  height: number;
  transform: number[];
}

interface CachedPageText {
  fullText: string;
  items: CompactTextItem[];
  viewport: any;
}

// Per-buffer compact text index cache (GC'd automatically when ArrayBuffer is replaced/closed)
const searchTextCache = new WeakMap<ArrayBuffer, Map<string, CachedPageText>>();

/**
 * Normalizes text for regex matching with special character escaping
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/** Binary search for the first item whose `end > targetOffset` */
const findFirstOverlappingItem = (items: CompactTextItem[], offset: number): number => {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].end <= offset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

/**
 * Projects a substring [subStart, subEnd) of a pdf.js text item to viewport coordinates,
 * accurately handling horizontal, vertical, and arbitrarily rotated text transforms.
 */
const computeSubstringRect = (
  item: CompactTextItem,
  subStart: number,
  subEnd: number,
  viewport: any
): SearchMatchRect | null => {
  const tr = item.transform;
  if (!tr || tr.length < 6) return null;

  const strLen = Math.max(1, item.strLen);
  const clampedStart = Math.min(subStart, strLen);
  const clampedEnd = Math.min(subEnd, strLen);
  if (clampedEnd <= clampedStart) return null;

  const itemWidth = item.width || 10;
  const charWidth = itemWidth / strLen;
  const subOffset = clampedStart * charWidth;
  const subWidth = (clampedEnd - clampedStart) * charWidth;

  // PDF text item transform [a, b, c, d, tx, ty]:
  // baseline direction = (a, b), ascent vector = (c, d)
  const [a, b, c, d, tx, ty] = tr;
  const baselineLen = Math.hypot(a, b);
  const ux = baselineLen > 1e-6 ? a / baselineLen : 1;
  const uy = baselineLen > 1e-6 ? b / baselineLen : 0;

  const ascentLen = Math.hypot(c, d);
  let ax: number;
  let ay: number;
  if (ascentLen > 1e-6) {
    ax = c;
    ay = d;
  } else {
    const fallbackH = item.height || 12;
    ax = -uy * fallbackH;
    ay = ux * fallbackH;
  }

  const x0 = tx + ux * subOffset;
  const y0 = ty + uy * subOffset;
  const x1 = x0 + ux * subWidth;
  const y1 = y0 + uy * subWidth;

  const p00 = viewport.convertToViewportPoint(x0, y0);
  const p10 = viewport.convertToViewportPoint(x1, y1);
  const p01 = viewport.convertToViewportPoint(x0 + ax, y0 + ay);
  const p11 = viewport.convertToViewportPoint(x1 + ax, y1 + ay);

  const minX = Math.min(p00[0], p10[0], p01[0], p11[0]);
  const maxX = Math.max(p00[0], p10[0], p01[0], p11[0]);
  const minY = Math.min(p00[1], p10[1], p01[1], p11[1]);
  const maxY = Math.max(p00[1], p10[1], p01[1], p11[1]);

  return {
    x: Math.round(minX * 10) / 10,
    y: Math.round(minY * 10) / 10,
    width: Math.round(Math.max(2, maxX - minX) * 10) / 10,
    height: Math.round(Math.max(2, maxY - minY) * 10) / 10,
  };
};

/**
 * Searches for occurrences of query text across all document pages using pdf.js textContent
 */
export const searchPdfDocument = async (
  pages: PdfPageModel[],
  sources: SourceDocument[],
  query: string,
  options: SearchOptions = {}
): Promise<SearchMatch[]> => {
  const trimmed = query.trim();
  if (!trimmed || pages.length === 0 || options.signal?.aborted) {
    return [];
  }

  const { caseSensitive = false, wholeWord = false, signal, onProgress, chunkSize = 6 } = options;
  const flags = caseSensitive ? 'g' : 'gi';
  const escaped = escapeRegex(trimmed);
  const regexPattern = wholeWord ? `(?<=^|[\\s.,;:!?'"()\\[\\]{}/<>-])${escaped}(?=$|[\\s.,;:!?'"()\\[\\]{}/<>-])` : escaped;

  let regex: RegExp;
  try {
    regex = new RegExp(regexPattern, flags);
  } catch {
    regex = new RegExp(escaped, flags);
  }

  const sourcesById = new Map<string, SourceDocument>();
  for (const src of sources) {
    sourcesById.set(src.id, src);
  }

  const matches: SearchMatch[] = [];
  let globalIndexCounter = 0;
  let scannedSinceCleanup = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    if (signal?.aborted) return [];

    const pageModel = pages[pageIdx];
    if (pageModel.sourceType && pageModel.sourceType !== 'pdf') continue;

    const sourceDoc = (pageModel.sourceDocId ? sourcesById.get(pageModel.sourceDocId) : undefined) || sources[0];
    if (!sourceDoc?.arrayBuffer) continue;

    const originalIdx = typeof pageModel.originalPageIndex === 'number'
      ? pageModel.originalPageIndex
      : typeof (pageModel as any).sourcePageIndex === 'number'
      ? (pageModel as any).sourcePageIndex
      : pageIdx;
    const rotation = pageModel.rotation || 0;
    const cacheKey = `${originalIdx}_${rotation}`;

    let docCacheMap = searchTextCache.get(sourceDoc.arrayBuffer);
    let pageData = docCacheMap?.get(cacheKey);

    if (!pageData) {
      let pdfPage: any = null;
      let pdfDoc: any = null;
      try {
        pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
        if (signal?.aborted) return [];
        pdfPage = await pdfDoc.getPage(originalIdx + 1);
        const textContent = await pdfPage.getTextContent();
        const viewport = pdfPage.getViewport({ scale: 1, rotation });

        const chunks: string[] = [];
        const items: CompactTextItem[] = [];
        let cursor = 0;

        for (let i = 0; i < textContent.items.length; i++) {
          const item = textContent.items[i] as any;
          if (!item || typeof item.str !== 'string') continue;

          const str = item.str;
          const start = cursor;
          if (str.length > 0) {
            chunks.push(str);
            cursor += str.length;
            items.push({
              start,
              end: cursor,
              strLen: str.length,
              width: item.width || 10,
              height: item.height || 12,
              transform: Array.isArray(item.transform) ? item.transform : Array.from(item.transform || []),
            });
          }

          // Add a space between items if item hasEOL or to prevent runaway word concatenation
          if (item.hasEOL || (str.length > 0 && !str.endsWith(' '))) {
            chunks.push(' ');
            cursor += 1;
          }
        }

        pageData = { fullText: chunks.join(''), items, viewport };
        if (!docCacheMap) {
          docCacheMap = new Map();
          searchTextCache.set(sourceDoc.arrayBuffer, docCacheMap);
        }
        docCacheMap.set(cacheKey, pageData);
      } catch (err) {
        console.warn(`Search error on page ${pageModel.id}:`, err);
        continue;
      } finally {
        if (pdfPage) {
          try {
            pdfPage.cleanup();
          } catch {
            // ignore
          }
        }
        scannedSinceCleanup++;
        if (scannedSinceCleanup >= 50 && pdfDoc && typeof pdfDoc.cleanup === 'function') {
          scannedSinceCleanup = 0;
          try {
            pdfDoc.cleanup(true);
          } catch {
            // ignore
          }
        }
      }
    }

    const { fullText, items, viewport } = pageData;
    if (!fullText || items.length === 0) continue;

    // Find all matches in fullText (zero per-character allocations; maps items only on actual matches)
    regex.lastIndex = 0;
    let matchExec: RegExpExecArray | null;

    while ((matchExec = regex.exec(fullText)) !== null) {
      const matchStart = matchExec.index;
      const matchEnd = matchStart + matchExec[0].length;
      const matchedStr = matchExec[0];

      const rects: SearchMatchRect[] = [];
      let itemIdx = findFirstOverlappingItem(items, matchStart);
      while (itemIdx < items.length && items[itemIdx].start < matchEnd) {
        const item = items[itemIdx];
        const subStart = Math.max(0, matchStart - item.start);
        const subEnd = Math.min(item.strLen, matchEnd - item.start);
        if (subEnd > subStart) {
          const rect = computeSubstringRect(item, subStart, subEnd, viewport);
          if (rect) rects.push(rect);
        }
        itemIdx++;
      }

      if (rects.length > 0) {
        matches.push({
          id: `match_${pageModel.id}_${globalIndexCounter}`,
          globalIndex: globalIndexCounter++,
          pageIndex: pageIdx,
          pageId: pageModel.id,
          matchedText: matchedStr,
          rects,
        });
      }

      // Avoid infinite loop on zero-width match
      if (matchExec.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    // Progressive chunk yield: lets the UI stay responsive and stream hits immediately on long PDFs
    const scannedCount = pageIdx + 1;
    if (onProgress && (scannedCount % chunkSize === 0 || scannedCount === pages.length)) {
      onProgress(matches.slice(), scannedCount, pages.length);
      if (scannedCount < pages.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  return matches;
};
