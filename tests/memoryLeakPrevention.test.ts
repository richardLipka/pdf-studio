import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDocument = vi.fn();

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return {
    ...actual,
    getDocument: (...args: any[]) => mockGetDocument(...args),
  };
});

import { getCachedPdfDocument, clearPdfCache } from '../src/services/pdfLoader';
import { searchPdfDocument } from '../src/services/pdfSearchService';

describe('Memory Leak Prevention & Resource Cleanup', () => {
  beforeEach(() => {
    clearPdfCache();
    mockGetDocument.mockReset();
  });

  it('bounds retiredDocs to prevent unbounded accumulation across document edits', async () => {
    const destroySpies: any[] = [];

    mockGetDocument.mockImplementation(() => {
      const destroySpy = vi.fn().mockResolvedValue(undefined);
      destroySpies.push(destroySpy);
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 100, height: 100, rotation: 0 }),
            cleanup: vi.fn(),
          }),
        }),
        destroy: destroySpy,
      };
    });

    const sourceId = 'test-doc-id';

    // Simulate 6 sequential edits, each creating a new ArrayBuffer
    const buffers = Array.from({ length: 6 }, () => new ArrayBuffer(16));
    for (const buf of buffers) {
      await getCachedPdfDocument(sourceId, buf);
    }

    // Since retiredDocs leeway limit is 2, and 1 is the currently active entry:
    // Out of 6 entries, the oldest 3 should have been destroyed by the eviction loop!
    const destroyedCount = destroySpies.filter((spy) => spy.mock.calls.length > 0).length;
    expect(destroyedCount).toBeGreaterThanOrEqual(3);

    // When clearPdfCache is called, all remaining active & retired entries should be destroyed
    clearPdfCache();
    const finalDestroyedCount = destroySpies.filter((spy) => spy.mock.calls.length > 0).length;
    expect(finalDestroyedCount).toBe(6);
  });

  it('guarantees pdfPage.cleanup is invoked even when search encounters page processing error', async () => {
    const cleanupSpy = vi.fn();
    const fakePage = {
      getTextContent: vi.fn().mockRejectedValue(new Error('Corrupted text stream')),
      getViewport: vi.fn().mockReturnValue({ convertToViewportPoint: (x: number, y: number) => [x, y] }),
      cleanup: cleanupSpy,
    };

    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue(fakePage),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });

    const sourceDoc = {
      id: 'main-doc',
      name: 'doc.pdf',
      arrayBuffer: new ArrayBuffer(32),
      updatedAt: 1,
    };

    const pages = [
      {
        id: 'p1',
        originalPageIndex: 0,
        sourceDocId: 'main-doc',
        sourceType: 'pdf' as const,
        rotation: 0,
        width: 100,
        height: 100,
      },
    ];

    const results = await searchPdfDocument(pages, [sourceDoc], 'search');
    expect(results).toEqual([]);
    // Cleanup must be called despite the thrown error in getTextContent
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });
});
