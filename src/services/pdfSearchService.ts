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
}

interface CharMapping {
  itemIndex: number;
  charIndex: number;
}

/**
 * Normalizes text for regex matching with special character escaping
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (!trimmed || pages.length === 0) {
    return [];
  }

  const { caseSensitive = false, wholeWord = false } = options;
  const flags = caseSensitive ? 'g' : 'gi';
  const escaped = escapeRegex(trimmed);
  const regexPattern = wholeWord ? `(?<=^|[\\s.,;:!?'"()\\[\\]{}/<>-])${escaped}(?=$|[\\s.,;:!?'"()\\[\\]{}/<>-])` : escaped;

  let regex: RegExp;
  try {
    regex = new RegExp(regexPattern, flags);
  } catch {
    regex = new RegExp(escaped, flags);
  }

  const matches: SearchMatch[] = [];
  let globalIndexCounter = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageModel = pages[pageIdx];
    if (pageModel.sourceType && pageModel.sourceType !== 'pdf') continue;

    const sourceDoc = (pageModel.sourceDocId ? sources.find((s) => s.id === pageModel.sourceDocId) : null) || sources[0];
    if (!sourceDoc?.arrayBuffer) continue;

    try {
      const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
      const originalIdx = typeof pageModel.originalPageIndex === 'number' 
        ? pageModel.originalPageIndex 
        : typeof (pageModel as any).sourcePageIndex === 'number' 
        ? (pageModel as any).sourcePageIndex 
        : pageIdx;
      const pdfPage = await pdfDoc.getPage(originalIdx + 1);
      const textContent = await pdfPage.getTextContent();
      const viewport = pdfPage.getViewport({ scale: 1, rotation: pageModel.rotation || 0 });

      // Build unified text string and character-to-item mapping
      let fullText = '';
      const charMappings: CharMapping[] = [];
      const textItems: any[] = [];

      for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i] as any;
        if (!item || typeof item.str !== 'string') continue;

        textItems.push(item);
        const itemIdx = textItems.length - 1;

        for (let c = 0; c < item.str.length; c++) {
          fullText += item.str[c];
          charMappings.push({ itemIndex: itemIdx, charIndex: c });
        }

        // Add a space between items if item hasEOL or to prevent runaway word concatenation
        if (item.hasEOL || (item.str.length > 0 && !item.str.endsWith(' '))) {
          fullText += ' ';
          charMappings.push({ itemIndex: itemIdx, charIndex: item.str.length });
        }
      }

      // Find all matches in fullText
      regex.lastIndex = 0;
      let matchExec: RegExpExecArray | null;

      while ((matchExec = regex.exec(fullText)) !== null) {
        const matchStart = matchExec.index;
        const matchLen = matchExec[0].length;
        const matchEnd = matchStart + matchLen;
        const matchedStr = matchExec[0];

        // Gather bounding rects across involved text items
        const rects: SearchMatchRect[] = [];
        const affectedItemRanges = new Map<number, { minChar: number; maxChar: number }>();

        for (let idx = matchStart; idx < matchEnd && idx < charMappings.length; idx++) {
          const map = charMappings[idx];
          if (!affectedItemRanges.has(map.itemIndex)) {
            affectedItemRanges.set(map.itemIndex, { minChar: map.charIndex, maxChar: map.charIndex + 1 });
          } else {
            const current = affectedItemRanges.get(map.itemIndex)!;
            current.minChar = Math.min(current.minChar, map.charIndex);
            current.maxChar = Math.max(current.maxChar, map.charIndex + 1);
          }
        }

        // Convert affected item character ranges to viewport bounding boxes
        for (const [itemIdx, range] of affectedItemRanges.entries()) {
          const item = textItems[itemIdx];
          if (!item || !item.transform) continue;

          const strLen = Math.max(1, item.str.length);
          const itemWidth = item.width || 10;
          const charWidth = itemWidth / strLen;
          const subStart = Math.min(range.minChar, strLen);
          const subEnd = Math.min(range.maxChar, strLen);
          if (subEnd <= subStart) continue;

          const subWidth = (subEnd - subStart) * charWidth;
          const subOffset = subStart * charWidth;

          // In PDF space: item.transform = [a, b, c, d, tx, ty]
          const tx = item.transform[4] + subOffset;
          const ty = item.transform[5];
          const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;

          // Project opposing corners to viewport coordinates
          const p1 = viewport.convertToViewportPoint(tx, ty);
          const p2 = viewport.convertToViewportPoint(tx + subWidth, ty + fontSize);

          const left = Math.min(p1[0], p2[0]);
          const top = Math.min(p1[1], p2[1]);
          const width = Math.max(2, Math.abs(p2[0] - p1[0]));
          const height = Math.max(2, Math.abs(p2[1] - p1[1]));

          rects.push({
            x: Math.round(left * 10) / 10,
            y: Math.round(top * 10) / 10,
            width: Math.round(width * 10) / 10,
            height: Math.round(height * 10) / 10,
          });
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

      pdfPage.cleanup();
    } catch (err) {
      console.warn(`Search error on page ${pageModel.id}:`, err);
    }
  }

  return matches;
};
