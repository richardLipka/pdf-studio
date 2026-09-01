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

  it('should capture structured diagnostics and attempts when loading unparseable buffers', async () => {
    const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const { loadSourcePdfDocWithDiagnostics, extractPdfHeader } = await import('../src/services/pdfExporter');

    const result = await loadSourcePdfDocWithDiagnostics(invalidBuffer);
    expect(result.doc).toBeNull();
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[0].errorMessage).toBeDefined();

    const header = extractPdfHeader(invalidBuffer);
    expect(header).toBeDefined();
  });

  it('should accept custom rasterization settings (scale, format, jpegQuality) during export', async () => {
    const { DEFAULT_RASTERIZATION_SETTINGS } = await import('../src/types/document');
    expect(DEFAULT_RASTERIZATION_SETTINGS.scale).toBe(2.0);
    expect(DEFAULT_RASTERIZATION_SETTINGS.format).toBe('image/jpeg');
    expect(DEFAULT_RASTERIZATION_SETTINGS.jpegQuality).toBe(0.90);

    const sampleDoc = await PDFDocument.create();
    sampleDoc.addPage([400, 600]);
    const buffer = await sampleDoc.save();

    const sources: SourceDocument[] = [{ id: 'src-1', name: 'test.pdf', arrayBuffer: buffer.buffer }];
    const pages: PdfPageModel[] = [
      { id: 'p1', sourceDocId: 'src-1', originalPageIndex: 0, pageNumber: 1, width: 400, height: 600, rotation: 0, sourceType: 'pdf' },
    ];

    const fakeLink = { href: '', download: '', style: {}, click: vi.fn() };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: vi.fn().mockReturnValue(true) },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const customSettings = {
      scale: 1.5,
      format: 'image/jpeg' as const,
      jpegQuality: 0.85,
    };

    const pdfBytes = await exportEditedPdf(sources, pages, [], 'custom-settings.pdf', customSettings);
    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);

    delete (globalThis as any).document;
  });

  it('should write and persist modified document metadata into exported PDF bytes', async () => {
    const { DEFAULT_DOCUMENT_METADATA } = await import('../src/types/document');
    const { extractPdfMetadata } = await import('../src/services/pdfLoader');

    expect(DEFAULT_DOCUMENT_METADATA.creator).toBe('PDF Studio');

    const sampleDoc = await PDFDocument.create();
    sampleDoc.addPage([500, 700]);
    const buffer = await sampleDoc.save();

    const sources: SourceDocument[] = [{ id: 'main', name: 'contract.pdf', arrayBuffer: buffer.buffer }];
    const pages: PdfPageModel[] = [
      { id: 'p1', sourceDocId: 'main', originalPageIndex: 0, pageNumber: 1, width: 500, height: 700, rotation: 0, sourceType: 'pdf' },
    ];

    const fakeLink = { href: '', download: '', style: {}, click: vi.fn() };
    (globalThis as any).document = {
      createElement: vi.fn().mockReturnValue(fakeLink),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: vi.fn().mockReturnValue(true) },
    };
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const customMetadata = {
      title: 'Smlouva o poskytnutí služeb 2026',
      author: 'Ing. Jan Novák',
      subject: 'Dodatek č. 1',
      keywords: 'smlouva, služby, 2026, finance',
      creator: 'PDF Studio Creator App',
      producer: 'PDF Studio Producer Engine',
      creationDate: '2026-05-15T10:30:00.000Z',
    };

    const pdfBytes = await exportEditedPdf(
      sources,
      pages,
      [],
      'contract-with-meta.pdf',
      undefined,
      customMetadata
    );

    expect(pdfBytes).toBeDefined();
    expect(pdfBytes.length).toBeGreaterThan(0);

    // Verify metadata was written into PDF dictionary via pdf-lib
    const loadedDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    expect(loadedDoc.getTitle()).toBe('Smlouva o poskytnutí služeb 2026');
    expect(loadedDoc.getAuthor()).toBe('Ing. Jan Novák');
    expect(loadedDoc.getSubject()).toBe('Dodatek č. 1');
    expect(loadedDoc.getKeywords()).toContain('smlouva');
    expect(loadedDoc.getKeywords()).toContain('služby');
    expect(loadedDoc.getKeywords()).toContain('finance');
    expect(loadedDoc.getCreator()).toBe('PDF Studio Creator App');
    expect(loadedDoc.getProducer()).toBe('PDF Studio Producer Engine');
    expect(loadedDoc.getCreationDate()?.toISOString()).toBe('2026-05-15T10:30:00.000Z');
    expect(loadedDoc.getModificationDate()).toBeDefined();

    // Verify metadata extraction via pdfLoader
    const extracted = await extractPdfMetadata('main', pdfBytes.buffer);
    expect(extracted.title).toBe('Smlouva o poskytnutí služeb 2026');
    expect(extracted.author).toBe('Ing. Jan Novák');
    expect(extracted.subject).toBe('Dodatek č. 1');

    delete (globalThis as any).document;
  });
});
