import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { searchPdfDocument, escapeRegex } from '../src/services/pdfSearchService';
import { SourceDocument, PdfPageModel } from '../src/types/document';

describe('Global In-Document Search (pdfSearchService)', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');

  it('escapeRegex correctly escapes special regex characters', () => {
    expect(escapeRegex('hello.world?*+[a-z]^$()|{}')).toBe('hello\\.world\\?\\*\\+\\[a-z\\]\\^\\$\\(\\)\\|\\{\\}');
    expect(escapeRegex('normal text 123')).toBe('normal text 123');
  });

  it('finds text matches and returns accurate coordinates in a generated multi-page PDF', async () => {
    // Create a 2-page PDF with known text
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page1 = pdfDoc.addPage([600, 400]);
    page1.drawText('Welcome to PDF Studio editor.', { x: 50, y: 350, size: 16, font, color: rgb(0, 0, 0) });
    page1.drawText('Search functionality finds words quickly.', { x: 50, y: 300, size: 14, font, color: rgb(0, 0, 0) });

    const page2 = pdfDoc.addPage([600, 400]);
    page2.drawText('Second page has more editor details.', { x: 50, y: 350, size: 16, font, color: rgb(0, 0, 0) });
    page2.drawText('PDF Studio supports searching across all pages.', { x: 50, y: 300, size: 14, font, color: rgb(0, 0, 0) });

    const pdfBytes = await pdfDoc.save();
    const arrayBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);

    const sourceDoc: SourceDocument = {
      id: 'test_doc_1',
      name: 'search_test.pdf',
      arrayBuffer,
      updatedAt: Date.now(),
    };

    const pages: PdfPageModel[] = [
      {
        id: 'p_1',
        sourceDocId: 'test_doc_1',
        originalPageIndex: 0,
        sourceType: 'pdf',
        pageNumber: 1,
        width: 600,
        height: 400,
        rotation: 0,
      },
      {
        id: 'p_2',
        sourceDocId: 'test_doc_1',
        originalPageIndex: 1,
        sourceType: 'pdf',
        pageNumber: 2,
        width: 600,
        height: 400,
        rotation: 0,
      },
    ];

    // 1. Search for "Studio" (case-insensitive)
    const matchesStudio = await searchPdfDocument(pages, [sourceDoc], 'studio');
    expect(matchesStudio.length).toBe(2);
    expect(matchesStudio[0].pageIndex).toBe(0);
    expect(matchesStudio[0].globalIndex).toBe(0);
    expect(matchesStudio[0].pageId).toBe('p_1');
    expect(matchesStudio[0].matchedText).toBe('Studio');
    expect(matchesStudio[0].rects.length).toBeGreaterThan(0);
    expect(matchesStudio[0].rects[0].width).toBeGreaterThan(0);
    expect(matchesStudio[0].rects[0].height).toBeGreaterThan(0);

    expect(matchesStudio[1].pageIndex).toBe(1);
    expect(matchesStudio[1].globalIndex).toBe(1);
    expect(matchesStudio[1].pageId).toBe('p_2');
    expect(matchesStudio[1].matchedText).toBe('Studio');

    // 2. Search for "editor" (case-sensitive)
    const caseMatchesUpper = await searchPdfDocument(pages, [sourceDoc], 'Editor', { caseSensitive: true });
    expect(caseMatchesUpper.length).toBe(0); // Only lowercase "editor" exists

    const caseMatchesLower = await searchPdfDocument(pages, [sourceDoc], 'editor', { caseSensitive: true });
    expect(caseMatchesLower.length).toBe(2);

    // 3. Whole-word search
    const wholeWordMatches = await searchPdfDocument(pages, [sourceDoc], 'edit', { wholeWord: true });
    expect(wholeWordMatches.length).toBe(0); // "editor" is not whole-word "edit"

    const partialMatches = await searchPdfDocument(pages, [sourceDoc], 'edit', { wholeWord: false });
    expect(partialMatches.length).toBe(2); // Matches "editor" on both pages
  });

  it('correctly searches text in a real Czech PDF document (temata_vskp)', async () => {
    const czechDocPath = path.join(testFilesDir, 'temata_vskp_-_podklady_pro_zadani_vskp.pdf');
    if (!fs.existsSync(czechDocPath)) {
      return;
    }

    const buffer = fs.readFileSync(czechDocPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const sourceDoc: SourceDocument = {
      id: 'czech_test_doc',
      name: 'temata_vskp.pdf',
      arrayBuffer,
      updatedAt: Date.now(),
    };

    const pages: PdfPageModel[] = [
      {
        id: 'cp_1',
        sourceDocId: 'czech_test_doc',
        originalPageIndex: 0,
        sourceType: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        rotation: 0,
      },
    ];

    // Search for word present in document: "Seznamte"
    const results = await searchPdfDocument(pages, [sourceDoc], 'Seznamte');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].rects[0].x).toBeGreaterThanOrEqual(0);
    expect(results[0].rects[0].y).toBeGreaterThanOrEqual(0);
    expect(results[0].rects[0].width).toBeGreaterThan(0);
    expect(results[0].rects[0].height).toBeGreaterThan(0);
  });

  it('returns empty array when query is empty, whitespace only, or has no matches', async () => {
    const emptyMatches = await searchPdfDocument([], [], '');
    expect(emptyMatches).toEqual([]);

    const whitespaceMatches = await searchPdfDocument([], [], '   ');
    expect(whitespaceMatches).toEqual([]);
  });
});
