import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
// Importing the loader configures the pdf.js worker
import './pdfLoader';
import { getPdfjsAssetOptions } from './pdfjsAssets';
import { applyDocumentMetadata } from './pdfExporter';
import { DocumentMetadata } from '../types/document';
import { logger } from './logger';

/**
 * "Flattening" a PDF to images: every page of the finished document (annotations, signatures and
 * filled forms included) is rendered to a bitmap and a new PDF is built with one full-page image
 * per page — the result behaves like a scanned document (no selectable text, no layers, no forms).
 */

export type FlattenColorMode = 'color' | 'grayscale' | 'bw';

export interface FlattenOptions {
  /** Output resolution in dots per inch */
  dpi: number;
  colorMode: FlattenColorMode;
  /** 0.5 – 1.0, for colour and grayscale output (JPEG) */
  jpegQuality: number;
  /** Paper tone, light noise and a slight tilt, like a real scan */
  scanEffect: boolean;
}

export const DEFAULT_FLATTEN_OPTIONS: FlattenOptions = {
  dpi: 200,
  colorMode: 'color',
  jpegQuality: 0.85,
  scanEffect: false,
};

export interface FlattenedPageImage {
  /** Page size in points */
  widthPt: number;
  heightPt: number;
  bytes: Uint8Array;
  format: 'jpeg' | 'png';
}

// Browsers refuse larger canvases (Safari: 16.7 megapixels, all: 32767 px per side)
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 16_000;
const BW_THRESHOLD = 165;
const PAPER_TONE: [number, number, number] = [247, 245, 238];

/** Scale (pixels per point) for the requested DPI, reduced when the canvas would be too large */
export const flattenScaleFor = (widthPt: number, heightPt: number, dpi: number): number => {
  let scale = dpi / 72;
  const pixels = widthPt * heightPt * scale * scale;
  if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
  const side = Math.max(widthPt, heightPt) * scale;
  if (side > MAX_CANVAS_SIDE) scale *= MAX_CANVAS_SIDE / side;
  return scale;
};

/** Rough output size in bytes (for the dialog) */
export const estimateFlattenedSize = (pageSizesPt: { width: number; height: number }[], options: FlattenOptions): number => {
  const bytesPerPixel =
    options.colorMode === 'bw' ? 0.025 : (options.colorMode === 'grayscale' ? 0.07 : 0.1) * (0.4 + options.jpegQuality);
  return pageSizesPt.reduce((sum, p) => {
    const scale = flattenScaleFor(p.width, p.height, options.dpi);
    return sum + p.width * p.height * scale * scale * bytesPerPixel * (options.scanEffect ? 1.6 : 1);
  }, 0);
};

/** Builds a PDF with one full-page image per page */
export async function assembleImagePdf(images: FlattenedPageImage[], metadata?: DocumentMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (metadata) applyDocumentMetadata(doc, metadata);
  for (const img of images) {
    const embedded = img.format === 'jpeg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    const page = doc.addPage([img.widthPt, img.heightPt]);
    page.drawImage(embedded, { x: 0, y: 0, width: img.widthPt, height: img.heightPt });
  }
  return doc.save({ useObjectStreams: true });
}

/** Small deterministic PRNG, so the same document always gets the same "scan" */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Grayscale / black-and-white conversion and scan noise, in place */
export function processPixels(data: Uint8ClampedArray, options: FlattenOptions, random: () => number): void {
  const gray = options.colorMode !== 'color';
  const bw = options.colorMode === 'bw';
  const noise = options.scanEffect ? 12 : 0;
  const [pr, pg, pb] = options.scanEffect ? PAPER_TONE : [255, 255, 255];
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (gray) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = y;
    }
    if (options.scanEffect) {
      const n = (random() - 0.5) * noise;
      r = (r * pr) / 255 + n;
      g = (g * pg) / 255 + n;
      b = (b * pb) / 255 + n;
    }
    if (bw) {
      const v = (r + g + b) / 3 < BW_THRESHOLD ? 0 : 255;
      r = g = b = v;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

const canvasToBytes = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Obrázek stránky se nepodařilo zakódovat.'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      type,
      quality
    );
  });

/** Renders every page of a PDF to an image and returns the image-only PDF */
export async function flattenPdfToImages(
  pdfBytes: Uint8Array,
  options: FlattenOptions,
  metadata?: DocumentMetadata,
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const startTime = Date.now();
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(), ...getPdfjsAssetOptions() });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const random = mulberry32(total * 7919 + Math.round(options.dpi));
  const needsPixels = options.colorMode !== 'color' || options.scanEffect;
  const images: FlattenedPageImage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      onProgress?.(pageNumber - 1, total);
      const page = await pdf.getPage(pageNumber);
      const size = page.getViewport({ scale: 1 });
      const scale = flattenScaleFor(size.width, size.height, options.dpi);
      const viewport = page.getViewport({ scale });

      const rendered = document.createElement('canvas');
      rendered.width = Math.max(1, Math.ceil(viewport.width));
      rendered.height = Math.max(1, Math.ceil(viewport.height));
      // Rendered as for printing: annotations marked printable (all the editor writes, highlights,
      // stamps, signatures, flattened fields) are part of the page, as on a scanned paper copy. The
      // print intent also renders in one pass instead of continuing on animation frames, which
      // background tabs pause.
      await page.render({
        canvas: rendered,
        viewport,
        intent: 'print',
        annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      }).promise;
      page.cleanup();

      let output = rendered;
      if (options.scanEffect) {
        // A scanned sheet is never perfectly straight
        output = document.createElement('canvas');
        output.width = rendered.width;
        output.height = rendered.height;
        const ctx = output.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, output.width, output.height);
        const angle = ((random() - 0.5) * 0.7 * Math.PI) / 180;
        ctx.translate(output.width / 2, output.height / 2);
        ctx.rotate(angle);
        ctx.drawImage(rendered, -rendered.width / 2, -rendered.height / 2);
        rendered.width = 0;
        rendered.height = 0;
      }
      if (needsPixels) {
        const ctx = output.getContext('2d', { willReadFrequently: true })!;
        const imageData = ctx.getImageData(0, 0, output.width, output.height);
        processPixels(imageData.data, options, random);
        ctx.putImageData(imageData, 0, 0);
      }

      const format = options.colorMode === 'bw' ? 'png' : 'jpeg';
      const bytes = await canvasToBytes(output, format === 'png' ? 'image/png' : 'image/jpeg', options.jpegQuality);
      output.width = 0;
      output.height = 0;
      images.push({ widthPt: size.width, heightPt: size.height, bytes, format });
    }
    onProgress?.(total, total);
    const result = await assembleImagePdf(images, metadata);
    logger.success('save', `Dokument zploštěn na obrázky: ${total} stran, ${(result.length / 1024).toFixed(0)} KB`, {
      pages: total,
      options,
      durationMs: Date.now() - startTime,
    });
    return result;
  } finally {
    await loadingTask.destroy();
  }
}
