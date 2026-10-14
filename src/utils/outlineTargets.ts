import { PdfPageModel } from '../types/document';

/**
 * Position of an outline (bookmark) target in the edited document. Outline destinations point to
 * pages of the opened file (`sourcePageIndex`); after pages were moved, deleted or inserted the page
 * has a different position, or none at all (-1).
 */
export const resolveOutlineTarget = (
  pages: PdfPageModel[],
  primarySourceId: string | undefined,
  sourcePageIndex: number | null
): number => {
  if (sourcePageIndex === null || !primarySourceId) return -1;
  return pages.findIndex(
    (p) => p.sourceType === 'pdf' && p.sourceDocId === primarySourceId && p.originalPageIndex === sourcePageIndex
  );
};
