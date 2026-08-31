import { describe, it, expect, vi } from 'vitest';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { PdfPageModel, SourceDocument } from '../src/types/document';
import { Annotation } from '../src/types/annotations';
import { PDFDocument, rgb } from 'pdf-lib';

describe('PDF Export & Download Reliability', () => {
  it('should reliably export PDF bytes and trigger browser download with correct filename', async () => {
    // 1. Create a dummy source PDF doc
    const sampleDoc = await PDFDocument.create();
    const p1 = sampleDoc.addPage([595.28, 841.89]);
    p1.drawText('Sample Page Content', { x: 50, y: 750, size: 14, color: rgb(0, 0, 0) });
    const buffer = await sampleDoc.save();

    const sources: SourceDocument[] = [
      {
        id: 'main',
        name: 'contract.pdf',
        arrayBuffer: buffer.buffer,
      },
    ];

    const pages: PdfPageModel[] = [
      {
        id: 'page-1',
        sourceDocId: 'main',
        originalPageIndex: 0,
        pageNumber: 1,
        width: 595.28,
        height: 841.89,
        rotation: 90,
        sourceType: 'pdf',
      },
      {
        id: 'page-2',
        sourceDocId: 'blank',
        originalPageIndex: 0,
        pageNumber: 2,
        width: 595.28,
        height: 841.89,
        rotation: 0,
        sourceType: 'blank',
      },
    ];

    const annotations: Annotation[] = [
      {
        id: 'note-1',
        pageId: 'page-1',
        type: 'note',
        x: 100,
        y: 100,
        width: 24,
        height: 24,
        opacity: 1,
        color: '#f59e0b',
        text: 'Review note text',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    // Mock browser document environment
    const clickSpy = vi.fn();
    const fakeLink = {
      href: '',
      download: '',
      style: {},
      click: clickSpy,
    };

    const mockBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      contains: vi.fn().mockReturnValue(true),
    };

    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: mockBody,
    };

    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-pdf-blob');
    globalThis.URL.revokeObjectURL = vi.fn();

    const pdfBytes = await exportEditedPdf(sources, pages, annotations, 'my-contract-edited.pdf');

    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(fakeLink.download).toBe('my-contract-edited.pdf');
    expect(fakeLink.href).toBe('blob:http://localhost/dummy-pdf-blob');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Verify generated PDF structure by parsing it with pdf-lib
    const parsedExport = await PDFDocument.load(pdfBytes);
    expect(parsedExport.getPageCount()).toBe(2);
    expect(parsedExport.getPage(0).getRotation().angle).toBe(90);
    expect(parsedExport.getPage(1).getRotation().angle).toBe(0);

    // Clean up mock
    delete (globalThis as any).document;
  });

  it('should gracefully export when a source document is unparseable or corrupted without throwing', async () => {
    // Malformed invalid PDF buffer
    const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

    const sources: SourceDocument[] = [
      {
        id: 'corrupted-doc',
        name: 'corrupted.pdf',
        arrayBuffer: invalidBuffer,
      },
    ];

    const pages: PdfPageModel[] = [
      {
        id: 'corrupted-page-1',
        sourceDocId: 'corrupted-doc',
        originalPageIndex: 0,
        pageNumber: 1,
        width: 595.28,
        height: 841.89,
        rotation: 0,
        sourceType: 'pdf',
      },
    ];

    const annotations: Annotation[] = [];

    // Mock document environment
    const fakeLink = { href: '', download: '', style: {}, click: vi.fn() };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: vi.fn().mockReturnValue(true) },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy');
    globalThis.URL.revokeObjectURL = vi.fn();

    // Export should not throw
    const pdfBytes = await exportEditedPdf(sources, pages, annotations, 'recovered.pdf');
    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);

    const parsed = await PDFDocument.load(pdfBytes);
    expect(parsed.getPageCount()).toBe(1);

    delete (globalThis as any).document;
  });
});
