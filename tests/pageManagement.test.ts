import { describe, it, expect } from 'vitest';
import {
  rotatePage,
  reorderPages,
  deletePage,
  duplicatePage,
  createBlankPage,
  insertPagesAtPosition,
} from '../src/services/pageManager';
import { PdfPageModel } from '../src/types/document';

describe('Page Management & Reordering Suite', () => {
  const createMockPage = (id: string, rotation = 0): PdfPageModel => ({
    id,
    sourceDocId: 'src-1',
    originalPageIndex: 0,
    pageNumber: 1,
    width: 595.28,
    height: 841.89,
    rotation,
    sourceType: 'blank',
  });

  it('should rotate page in 90 degree increments clockwise and counter-clockwise', () => {
    const page = createMockPage('p1', 0);
    const rot90 = rotatePage(page, 90);
    expect(rot90.rotation).toBe(90);

    const rot180 = rotatePage(rot90, 90);
    expect(rot180.rotation).toBe(180);

    const rot360 = rotatePage(rot180, 180);
    expect(rot360.rotation).toBe(0);

    const rotNeg90 = rotatePage(page, -90);
    expect(rotNeg90.rotation).toBe(270);
  });

  it('should reorder pages via drag and drop indices correctly', () => {
    const pages = [createMockPage('p1'), createMockPage('p2'), createMockPage('p3')];
    // Move p1 to position 2
    const reordered = reorderPages(pages, 0, 2);
    expect(reordered.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);

    // Move p3 to position 0
    const reordered2 = reorderPages(reordered, 1, 0);
    expect(reordered2.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
  });

  it('should delete a page and compute the next active page index safely', () => {
    const pages = [createMockPage('p1'), createMockPage('p2'), createMockPage('p3')];
    // Delete middle page p2
    const res1 = deletePage(pages, 'p2');
    expect(res1.updatedPages.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(res1.nextActiveIndex).toBe(1);

    // Delete last page p3
    const res2 = deletePage(res1.updatedPages, 'p3');
    expect(res2.updatedPages.map((p) => p.id)).toEqual(['p1']);
    expect(res2.nextActiveIndex).toBe(0);
  });

  it('should duplicate a page and insert directly after target page', () => {
    const pages = [createMockPage('p1'), createMockPage('p2')];
    const duplicated = duplicatePage(pages, 'p1');
    expect(duplicated.length).toBe(3);
    expect(duplicated[0].id).toBe('p1');
    expect(duplicated[1].sourceDocId).toBe('src-1');
    expect(duplicated[2].id).toBe('p2');
  });

  it('should insert blank pages in portrait and landscape orientations with correct A4 dimensions', () => {
    const portrait = createBlankPage('portrait');
    expect(portrait.width).toBeCloseTo(595.28, 1);
    expect(portrait.height).toBeCloseTo(841.89, 1);

    const landscape = createBlankPage('landscape');
    expect(landscape.width).toBeCloseTo(841.89, 1);
    expect(landscape.height).toBeCloseTo(595.28, 1);
  });

  it('should correctly insert new pages at beginning, after current active page, and at end', () => {
    const pages = [createMockPage('p1'), createMockPage('p2'), createMockPage('p3')];
    const newPage = [createMockPage('new-1')];

    // Insert beginning
    const resBeginning = insertPagesAtPosition(pages, newPage, 'beginning', 1);
    expect(resBeginning.pages.map((p) => p.id)).toEqual(['new-1', 'p1', 'p2', 'p3']);
    expect(resBeginning.newActiveIndex).toBe(0);

    // Insert after current (active index = 1 -> page p2)
    const resAfter = insertPagesAtPosition(pages, newPage, 'after_current', 1);
    expect(resAfter.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'new-1', 'p3']);
    expect(resAfter.newActiveIndex).toBe(2);

    // Insert end
    const resEnd = insertPagesAtPosition(pages, newPage, 'end', 1);
    expect(resEnd.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'new-1']);
    expect(resEnd.newActiveIndex).toBe(3);
  });
});
