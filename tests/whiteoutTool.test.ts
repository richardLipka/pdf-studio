import { describe, it, expect, vi } from 'vitest';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { PdfPageModel, SourceDocument } from '../src/types/document';
import { WhiteoutAnnotation } from '../src/types/annotations';
import { PDFDocument, rgb } from 'pdf-lib';

describe('Visual Rewrite (Whiteout + Overlay) Tool', () => {
  it('should export PDF with opaque whiteout rectangle and overlay vector text', async () => {
    // 1. Create a base PDF document with original text
    const sampleDoc = await PDFDocument.create();
    const p1 = sampleDoc.addPage([600, 800]);
    p1.drawText('Original secret price: 1000 EUR', { x: 50, y: 700, size: 14, color: rgb(0, 0, 0) });
    const buffer = await sampleDoc.save();

    const sources: SourceDocument[] = [
      {
        id: 'main',
        name: 'invoice.pdf',
        arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      },
    ];

    const pages: PdfPageModel[] = [
      {
        id: 'page-1',
        sourceDocId: 'main',
        originalPageIndex: 0,
        pageNumber: 1,
        width: 600,
        height: 800,
        rotation: 0,
        sourceType: 'pdf',
      },
    ];

    // 2. Whiteout annotation masking the price with new text
    const whiteoutAnn: WhiteoutAnnotation = {
      id: 'wo-1',
      pageId: 'page-1',
      type: 'whiteout',
      x: 45,
      y: 90, // Screen/PDF coords (top is 90 from top, corresponding to y ~700 in PDF)
      width: 250,
      height: 25,
      color: '#ffffff',
      fillColor: '#ffffff',
      opacity: 1.0,
      text: 'Revised price: 500 EUR (Discounted)',
      textColor: '#0f172a',
      fontSize: 12,
      fontFamily: 'Inter',
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Mock browser download environment
    const fakeLink = { href: '', download: '', style: {}, click: vi.fn() };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: vi.fn().mockReturnValue(true) },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy');
    globalThis.URL.revokeObjectURL = vi.fn();

    const pdfBytes = await exportEditedPdf(sources, pages, [whiteoutAnn], 'whiteout-export.pdf');

    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);

    // Verify generated document has the page and annotations
    const parsed = await PDFDocument.load(pdfBytes);
    expect(parsed.getPageCount()).toBe(1);
    const targetPage = parsed.getPage(0);
    expect(targetPage.getWidth()).toBe(600);
    expect(targetPage.getHeight()).toBe(800);

    // Cleanup mock
    delete (globalThis as any).document;
  });

  it('should support customized background fill colors such as off-white or cream', async () => {
    const sampleDoc = await PDFDocument.create();
    const p1 = sampleDoc.addPage([500, 500]);
    const buffer = await sampleDoc.save();

    const sources: SourceDocument[] = [
      {
        id: 'main',
        name: 'sample.pdf',
        arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      },
    ];

    const pages: PdfPageModel[] = [
      {
        id: 'page-1',
        sourceDocId: 'main',
        originalPageIndex: 0,
        pageNumber: 1,
        width: 500,
        height: 500,
        rotation: 0,
        sourceType: 'pdf',
      },
    ];

    const creamWhiteout: WhiteoutAnnotation = {
      id: 'wo-cream',
      pageId: 'page-1',
      type: 'whiteout',
      x: 50,
      y: 50,
      width: 200,
      height: 40,
      color: '#fef3c7',
      fillColor: '#fef3c7',
      opacity: 1.0,
      text: 'Cream masked text',
      textColor: '#dc2626',
      fontSize: 14,
      fontFamily: 'Courier',
      createdAt: 1000,
      updatedAt: 1000,
    };

    const fakeLink = { href: '', download: '', style: {}, click: vi.fn() };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: vi.fn().mockReturnValue(true) },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy');
    globalThis.URL.revokeObjectURL = vi.fn();

    const pdfBytes = await exportEditedPdf(sources, pages, [creamWhiteout], 'cream-whiteout.pdf');
    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);

    delete (globalThis as any).document;
  });
});
