import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cropPageRegionToClipboard } from '../src/services/imageCropper';
import { PdfPageModel } from '../src/types/document';

describe('imageCropper', () => {
  beforeEach(() => {
    const mockCtx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      font: '',
    };

    const createMockCanvas = () => {
      const c = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockCtx),
        toDataURL: vi.fn(() => 'data:image/png;base64,mockbase64image'),
        toBlob: vi.fn((cb) => cb(new Blob(['mockdata'], { type: 'image/png' }))),
      };
      return c;
    };

    Object.defineProperty(globalThis, 'document', {
      value: {
        createElement: vi.fn((tag: string) => {
          if (tag === 'canvas') {
            return createMockCanvas();
          }
          return {};
        }),
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          write: vi.fn().mockResolvedValue(undefined),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  it('should crop a rectangular region at high resolution (3.0x)', async () => {
    const pageModel: PdfPageModel = {
      id: 'blank-p1',
      sourceDocId: 'src-1',
      originalPageIndex: 0,
      pageNumber: 1,
      width: 600,
      height: 800,
      rotation: 0,
      sourceType: 'blank',
    };

    const rect = {
      x: 100,
      y: 150,
      width: 200,
      height: 100,
    };

    const result = await cropPageRegionToClipboard(undefined, pageModel, rect, [], 3.0);

    expect(result.success).toBe(true);
    expect(result.pixelWidth).toBe(600); // 200 * 3
    expect(result.pixelHeight).toBe(300); // 100 * 3
    expect(result.dataUrl).toContain('data:image/png;base64');
  });

  it('should clamp crop coordinates to page boundaries', async () => {
    const pageModel: PdfPageModel = {
      id: 'blank-p2',
      sourceDocId: 'src-1',
      originalPageIndex: 0,
      pageNumber: 1,
      width: 500,
      height: 500,
      rotation: 0,
      sourceType: 'blank',
    };

    const rect = {
      x: 450,
      y: 450,
      width: 200, // exceeds right edge
      height: 200, // exceeds bottom edge
    };

    const result = await cropPageRegionToClipboard(undefined, pageModel, rect, [], 2.0);

    expect(result.success).toBe(true);
    // Page canvas is 1000x1000 px at 2.0x. Crop starts at 900x900 px. Remaining space is 100x100 px.
    expect(result.pixelWidth).toBe(100);
    expect(result.pixelHeight).toBe(100);
  });
});
