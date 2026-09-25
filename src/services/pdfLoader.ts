// The legacy build bundles polyfills: the modern build of pdf.js 6 needs very recent JS features
// (e.g. Uint8Array.prototype.toHex) and fails to open any document in older browsers
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfPageModel, SourceDocument, DocumentMetadata } from '../types/document';
import { Annotation } from '../types/annotations';
import { logger } from './logger';
import { getPdfjsAssetOptions } from './pdfjsAssets';
import { buildPageTextModel, groupAdjacentBlocks, FontMetrics, PageTextModel } from './pdfTextModel';
import { markupBoxFromLine, markupLineFromQuad } from '../utils/markupGeometry';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { sanitizePdfBuffer, extractPdfHeader } from './pdfExporter';
import {
  getPageContentStream,
  parseStreamSegments,
  normalizeTextForSearch,
  getPageImages,
  getCachedPdfLibDocument,
  PageImageInfo,
} from './contentStreamEditor';

// Configure pdfjs worker in Vite for browser
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch (e) {
    console.warn('Falling back to CDN worker for pdf.js', e);
    logger.warn('load', 'Použit záložní CDN worker pro pdf.js', e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
  }
}

// In-memory cache of loaded pdf documents, keyed by source id. Each entry remembers the exact
// ArrayBuffer it was parsed from, so a request carrying a newer buffer for the same source
// (after a stream edit, undo/redo, or a render task that raced with clearPdfCache) never gets
// served a stale document.
interface DocCacheEntry {
  buffer: ArrayBuffer;
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  promise: Promise<pdfjsLib.PDFDocumentProxy>;
}
const docCache = new Map<string, DocCacheEntry>();
// Superseded documents may still be in use by in-flight renders; they are destroyed on the next clear.
const retiredDocs: DocCacheEntry[] = [];
const activeRenderTasks = new WeakMap<HTMLCanvasElement, any>();

export const getCachedPdfDocument = async (
  sourceId: string,
  arrayBuffer: ArrayBuffer
): Promise<pdfjsLib.PDFDocumentProxy> => {
  const cached = docCache.get(sourceId);
  if (cached && cached.buffer === arrayBuffer) {
    return cached.promise;
  }
  if (cached) {
    retiredDocs.push(cached);
  }

  // Create a copy of the buffer because pdfjs-dist may transfer ownership
  const copyBuffer = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({
    data: copyBuffer,
    // Full ToUnicode tables of the fonts, used to write characters not shown on the page
    fontExtraProperties: true,
    ...getPdfjsAssetOptions(),
  });
  const entry: DocCacheEntry = { buffer: arrayBuffer, loadingTask, promise: loadingTask.promise };
  entry.promise.catch(() => {
    if (docCache.get(sourceId) === entry) {
      docCache.delete(sourceId);
    }
  });

  docCache.set(sourceId, entry);
  return entry.promise;
};

const destroyDocument = (entry: DocCacheEntry) => {
  entry.loadingTask.destroy().catch(() => {
    // ignore destroy errors
  });
};

/**
 * Maps a PDF user-space rectangle [x1, y1, x2, y2] to viewport coordinates (the corners may come
 * back in any order; callers take min/max). Replaces PageViewport.convertToViewportRectangle,
 * which pdf.js removed.
 */
export const toViewportRect = (viewport: pdfjsLib.PageViewport, rect: ArrayLike<number>): number[] => [
  ...viewport.convertToViewportPoint(rect[0], rect[1]),
  ...viewport.convertToViewportPoint(rect[2], rect[3]),
];

export const clearPdfCache = () => {
  for (const entry of docCache.values()) {
    destroyDocument(entry);
  }
  docCache.clear();
  retiredDocs.splice(0).forEach(destroyDocument);
};

export const parsePdfPages = async (
  arrayBuffer: ArrayBuffer,
  sourceDocId: string = 'main'
): Promise<PdfPageModel[]> => {
  const startTime = Date.now();
  const rawSizeKb = (arrayBuffer.byteLength / 1024).toFixed(1);
  const headerStr = extractPdfHeader(arrayBuffer);

  logger.info('load', `Zahájeno načítání PDF "${sourceDocId}" (${rawSizeKb} KB)`, {
    sourceDocId,
    bytes: arrayBuffer.byteLength,
    fileSize: `${rawSizeKb} KB`,
    pdfHeader: headerStr,
  });

  // Check for header/trailing buffer anomalies
  const sanitizedBuffer = sanitizePdfBuffer(arrayBuffer);
  if (sanitizedBuffer.byteLength !== arrayBuffer.byteLength) {
    logger.warn(
      'load',
      `Dokument "${sourceDocId}" obsahuje data mimo standardní značky PDF (%PDF- až %%EOF). Buffer byl sanitizován pro kompatibilitu (${arrayBuffer.byteLength} B -> ${sanitizedBuffer.byteLength} B).`,
      {
        sourceDocId,
        originalBytes: arrayBuffer.byteLength,
        sanitizedBytes: sanitizedBuffer.byteLength,
        diffBytes: arrayBuffer.byteLength - sanitizedBuffer.byteLength,
        pdfHeader: headerStr,
        note: 'Tento stav je běžný u skenovaných PDF a komiksových konvertorů (např. Calibre, cbr2pdf).',
      }
    );
  }

  try {
    const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
    const pages: PdfPageModel[] = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        pages.push({
          id: `${sourceDocId}_page_${i}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          originalPageIndex: i - 1,
          sourceDocId,
          sourceType: 'pdf',
          rotation: viewport.rotation || 0,
          width: viewport.width,
          height: viewport.height,
        });
      } catch (pageErr: any) {
        logger.warn(
          'load',
          `Problém při čtení strany ${i}/${pdfDoc.numPages} ze zdroje "${sourceDocId}": ${pageErr?.message || pageErr}`,
          {
            sourceDocId,
            pageNumber: i,
            totalPages: pdfDoc.numPages,
            error: pageErr?.message || String(pageErr),
            stack: pageErr?.stack,
          }
        );
      }
    }

    const elapsed = Date.now() - startTime;
    logger.success('load', `Dokument "${sourceDocId}" úspěšně načten (${pages.length} stran za ${elapsed} ms)`, {
      sourceDocId,
      totalPages: pages.length,
      durationMs: elapsed,
      fileSizeKB: rawSizeKb,
    });

    return pages;
  } catch (err: any) {
    logger.error('load', `Kritická chyba při analýze PDF dokumentu "${sourceDocId}": ${err?.message || err}`, {
      sourceDocId,
      error: err?.message || String(err),
      stack: err?.stack,
      fileSize: `${rawSizeKb} KB`,
      pdfHeader: headerStr,
    });
    throw err;
  }
};

/**
 * Extracts document metadata (Title, Author, Subject, Keywords, Creator, Producer, Dates, Version)
 */
export const extractPdfMetadata = async (
  sourceDocId: string,
  arrayBuffer: ArrayBuffer
): Promise<DocumentMetadata> => {
  try {
    const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
    const metaDataObj = await pdfDoc.getMetadata().catch(() => null);
    const info = (metaDataObj?.info as any) || {};

    const parsePdfDate = (dateStr: any): string | undefined => {
      if (!dateStr || typeof dateStr !== 'string') return undefined;
      try {
        if (dateStr.startsWith('D:')) {
          const clean = dateStr.substring(2);
          const y = clean.substring(0, 4);
          const m = clean.substring(4, 6) || '01';
          const d = clean.substring(6, 8) || '01';
          const hh = clean.substring(8, 10) || '00';
          const mm = clean.substring(10, 12) || '00';
          const ss = clean.substring(12, 14) || '00';
          return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
        }
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch {
        // ignore
      }
      return undefined;
    };

    // Non-standard Info entries (pdf.js groups them under Custom: a Map in pdf.js 6, an object
    // before) and the XMP packet
    const customEntries: [string, unknown][] =
      info.Custom instanceof Map
        ? [...(info.Custom as Map<string, unknown>).entries()]
        : info.Custom && typeof info.Custom === 'object'
        ? Object.entries(info.Custom as Record<string, unknown>)
        : [];
    const custom: Record<string, unknown> = {};
    for (const [key, raw] of customEntries) {
      // Name values arrive as { name }
      custom[key] = raw && typeof raw === 'object' && 'name' in (raw as object) ? (raw as { name: unknown }).name : raw;
    }
    const xmp = metaDataObj?.metadata as { get?: (name: string) => unknown } | null | undefined;
    const xmpText = (name: string): string | undefined => {
      try {
        const value = xmp?.get?.(name);
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map(String).join(', ');
      } catch {
        // ignore malformed XMP
      }
      return undefined;
    };
    const customProperties = Object.entries(custom)
      .filter(([key, value]) => key !== 'Source' && ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => ({ key, value: String(value) }));

    const metadata: DocumentMetadata = {
      title: info.Title || '',
      author: info.Author || '',
      subject: info.Subject || '',
      keywords: info.Keywords || '',
      creator: info.Creator || 'PDF Studio',
      producer: info.Producer || 'PDF Studio (pdf-lib)',
      creationDate: parsePdfDate(info.CreationDate),
      modificationDate: parsePdfDate(info.ModDate),
      pdfVersion: (pdfDoc as any)._pdfInfo?.version || info.PDFFormatVersion || undefined,
      source: (typeof custom.Source === 'string' ? custom.Source : undefined) || xmpText('dc:source') || '',
      language: typeof info.Language === 'string' ? info.Language : '',
      autoModificationDate: true,
      customProperties,
    };

    logger.info('load', `Extrahována metadata PDF dokumentu "${sourceDocId}"`, {
      sourceDocId,
      title: metadata.title || '(neuvedeno)',
      author: metadata.author || '(neuvedeno)',
      subject: metadata.subject || '(neuvedeno)',
      keywords: metadata.keywords || '(neuvedeno)',
      creator: metadata.creator || '(neuvedeno)',
      producer: metadata.producer || '(neuvedeno)',
      pdfVersion: metadata.pdfVersion,
    });

    return metadata;
  } catch (err: any) {
    logger.warn('load', `Nepodařilo se extrahovat metadata ze zdroje "${sourceDocId}": ${err?.message || err}`, {
      sourceDocId,
      error: err?.message || String(err),
    });
    return {
      title: '',
      author: '',
      subject: '',
      keywords: '',
      creator: 'PDF Studio',
      producer: 'PDF Studio (pdf-lib)',
    };
  }
};

/**
 * Safely extracts hex color from pdf.js annotation color representation
 * Handles Array, Uint8ClampedArray, Float32Array, and normalized 0..1 values
 */
const extractColor = (rawColor: any, defaultColor: string): string => {
  if (!rawColor) return defaultColor;
  const len = rawColor.length;
  if (typeof len !== 'number' || len < 3) return defaultColor;

  let r = Number(rawColor[0]);
  let g = Number(rawColor[1]);
  let b = Number(rawColor[2]);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return defaultColor;

  // If colors are normalized in 0.0..1.0 float range, scale to 0..255
  if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
    r = Math.round(r * 255);
    g = Math.round(g * 255);
    b = Math.round(b * 255);
  } else {
    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));
  }

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Safely extracts stroke width from pdf.js annotation representation
 * Supports borderStyle.width, borderStyle.rawWidth, borderWidth, strokeWidth, lineWidth, border[2], bs.w
 */
const extractStrokeWidth = (ann: any, defaultWidth: number = 2): number => {
  if (typeof ann.borderStyle?.width === 'number' && ann.borderStyle.width > 0) {
    return ann.borderStyle.width;
  }
  if (typeof ann.borderStyle?.rawWidth === 'number' && ann.borderStyle.rawWidth > 0) {
    return ann.borderStyle.rawWidth;
  }
  if (typeof ann.borderWidth === 'number' && ann.borderWidth > 0) {
    return ann.borderWidth;
  }
  if (typeof ann.strokeWidth === 'number' && ann.strokeWidth > 0) {
    return ann.strokeWidth;
  }
  if (typeof ann.lineWidth === 'number' && ann.lineWidth > 0) {
    return ann.lineWidth;
  }
  if (Array.isArray(ann.border) && typeof ann.border[2] === 'number' && ann.border[2] > 0) {
    return ann.border[2];
  }
  if (typeof ann.bs?.width === 'number' && ann.bs.width > 0) {
    return ann.bs.width;
  }
  if (typeof ann.bs?.w === 'number' && ann.bs.w > 0) {
    return ann.bs.w;
  }
  if (typeof ann.data?.borderStyle?.width === 'number' && ann.data.borderStyle.width > 0) {
    return ann.data.borderStyle.width;
  }
  if (typeof ann.data?.strokeWidth === 'number' && ann.data.strokeWidth > 0) {
    return ann.data.strokeWidth;
  }
  return defaultWidth;
};

/**
 * Reads annotation QuadPoints from pdf.js annotation data, which is either a flat numeric array
 * (x1 y1 ... x4 y4 per quad, newer pdf.js) or an array of four {x, y} points per quad (older pdf.js).
 */
const readQuadPoints = (raw: any): { x: number; y: number }[][] => {
  if (!raw || typeof raw.length !== 'number' || raw.length === 0) return [];
  const first = raw[0];
  if (Array.isArray(first)) {
    return raw
      .filter((quad: any) => Array.isArray(quad) && quad.length >= 4)
      .map((quad: any[]) => quad.slice(0, 4).map((p) => ({ x: Number(p.x), y: Number(p.y) })));
  }
  const quads: { x: number; y: number }[][] = [];
  for (let i = 0; i + 8 <= raw.length; i += 8) {
    quads.push([0, 2, 4, 6].map((j) => ({ x: Number(raw[i + j]), y: Number(raw[i + j + 1]) })));
  }
  return quads;
};

/**
 * Reads one ink path from pdf.js annotation data: a flat numeric array (x y x y ..., newer pdf.js)
 * or an array of {x, y} points (older pdf.js).
 */
const readPointList = (raw: any): { x: number; y: number }[] => {
  if (!raw || typeof raw.length !== 'number') return [];
  if (raw.length > 0 && typeof raw[0] === 'object') {
    return Array.from(raw as { x: number; y: number }[]).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  }
  const points: { x: number; y: number }[] = [];
  for (let k = 0; k + 1 < raw.length; k += 2) {
    points.push({ x: Number(raw[k]), y: Number(raw[k + 1]) });
  }
  return points;
};

// Extract existing annotations & comments from PDF document
export const extractPdfAnnotations = async (
  arrayBuffer: ArrayBuffer,
  sourceDocId: string,
  pages: PdfPageModel[]
): Promise<Annotation[]> => {
  try {
    const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
    const loadedAnnotations: Annotation[] = [];

    // Raw QuadPoints of an annotation, looked up by the object reference pdf.js reports as its id
    // ("12R", or "12R3" for generation 3). The pdf-lib parse is shared with the stream editor.
    let rawDocPromise: Promise<PDFDocument | null> | null = null;
    const readRawQuadPoints = async (annotationId: unknown): Promise<number[] | null> => {
      const match = /^(\d+)R(\d*)$/.exec(typeof annotationId === 'string' ? annotationId : '');
      if (!match) return null;
      rawDocPromise ??= getCachedPdfLibDocument(arrayBuffer).catch(() => null);
      const rawDoc = await rawDocPromise;
      if (!rawDoc) return null;
      try {
        const dict = rawDoc.context.lookup(PDFRef.of(Number(match[1]), Number(match[2] || 0)));
        const quadPoints = dict instanceof PDFDict ? dict.lookup(PDFName.of('QuadPoints')) : undefined;
        if (!(quadPoints instanceof PDFArray)) return null;
        const values = quadPoints.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
        return values.length > 0 && values.length % 8 === 0 && values.every(Number.isFinite) ? values : null;
      } catch {
        return null;
      }
    };

    for (let i = 0; i < pages.length; i++) {
      const pageModel = pages[i];
      if (pageModel.sourceType !== 'pdf') continue;

      let pdfAnnotations: any[] = [];
      let viewport: pdfjsLib.PageViewport;
      try {
        const page = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
        // Annotation coordinates are stored in the displayed (rotated, cropped) page space
        viewport = page.getViewport({ scale: 1.0, rotation: pageModel.rotation });
        try {
          pdfAnnotations = await page.getAnnotations();
        } finally {
          try {
            page.cleanup();
          } catch {
            // ignore
          }
        }
      } catch (pageAnnErr: any) {
        logger.warn(
          'load',
          `Nepodařilo se načíst existující anotace pro stranu ${i + 1} (${pageModel.id}): ${pageAnnErr?.message || pageAnnErr}`,
          {
            sourceDocId,
            pageId: pageModel.id,
            pageNumber: i + 1,
            error: pageAnnErr?.message || String(pageAnnErr),
          }
        );
        continue;
      }

      const toDisplayPoint = (px: number, py: number) => {
        const [dx, dy] = viewport.convertToViewportPoint(px, py);
        return { x: dx, y: dy };
      };

      for (const ann of pdfAnnotations) {
        if (!ann.rect || ann.rect.length < 4) continue;

        const [x1, y1, x2, y2] = toViewportRect(viewport, ann.rect);
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        const textContent =
          (typeof ann.contents === 'string' ? ann.contents : ann.contents?.str) ||
          (typeof ann.contentsObj === 'string' ? ann.contentsObj : ann.contentsObj?.str) ||
          (typeof ann.richText === 'string' ? ann.richText : ann.richText?.str) ||
          (typeof ann.subject === 'string' ? ann.subject : ann.subject?.str) ||
          '';
        const author =
          (typeof ann.title === 'string' ? ann.title : ann.title?.str) ||
          (typeof ann.author === 'string' ? ann.author : ann.author?.str) ||
          '';
        const strokeWidth = extractStrokeWidth(ann, 2);

        const id = `imported_${ann.id || Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();

        if (ann.subtype === 'Text') {
          // Sticky Note / Review Comment
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'note',
            x,
            y,
            width: 24,
            height: 24,
            color: extractColor(ann.color, '#f59e0b'),
            opacity: 1.0,
            text: textContent,
            author,
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'Highlight') {
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'highlight',
            x,
            y,
            width: Math.max(10, width),
            height: Math.max(8, height),
            color: extractColor(ann.color, '#fde047'),
            opacity: 0.4,
            comment: textContent,
            author,
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'Underline' || ann.subtype === 'StrikeOut') {
          const kind = ann.subtype === 'Underline' ? 'underline' : 'strikethrough';
          // One editable markup per quadrilateral (e.g. per underlined text line), mapped to the
          // displayed page. pdf.js normalizes QuadPoints to an upright box, which loses the direction
          // of rotated text, so the raw values are read from the file when possible.
          const rawQuadPoints = await readRawQuadPoints(ann.id);
          const quads = readQuadPoints(rawQuadPoints ?? ann.quadPoints);
          const displayQuads = quads.length > 0
            ? quads.map((quad) => quad.map((p) => toDisplayPoint(p.x, p.y)))
            : [[{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }]];
          displayQuads.forEach((quad, quadIdx) => {
            const { start, end, textRotation } = markupLineFromQuad(kind, quad);
            const box = markupBoxFromLine(kind, start, end, strokeWidth, textRotation);
            loadedAnnotations.push({
              id: quadIdx === 0 ? id : `${id}_q${quadIdx}`,
              pageId: pageModel.id,
              type: kind,
              ...box,
              strokeWidth,
              textRotation,
              color: extractColor(ann.color, kind === 'underline' ? '#0284c7' : '#dc2626'),
              opacity: 0.9,
              comment: quadIdx === 0 ? textContent : undefined,
              author,
              createdAt: now,
              updatedAt: now,
            });
          });
        } else if (ann.subtype === 'FreeText') {
          const textVal = textContent || ann.defaultAppearanceData?.text || '';
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'text',
            x,
            y,
            width: Math.max(80, width),
            height: Math.max(20, height),
            color: extractColor(ann.color, '#0f172a'),
            opacity: 1.0,
            text: textVal,
            fontSize: ann.defaultAppearanceData?.fontSize || 14,
            fontFamily: ann.defaultAppearanceData?.fontName || 'Inter',
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'Ink' && (ann.inkLists || ann.paths)) {
          const inkLists = ann.inkLists || ann.paths || [];
          for (let pIdx = 0; pIdx < inkLists.length; pIdx++) {
            const points = readPointList(inkLists[pIdx]).map((p) => toDisplayPoint(p.x, p.y));
            if (points.length >= 2) {
              const minX = Math.min(...points.map((p) => p.x));
              const minY = Math.min(...points.map((p) => p.y));
              const maxX = Math.max(...points.map((p) => p.x));
              const maxY = Math.max(...points.map((p) => p.y));
              loadedAnnotations.push({
                id: `${id}_path_${pIdx}`,
                pageId: pageModel.id,
                type: 'drawing',
                x: minX,
                y: minY,
                width: Math.max(10, maxX - minX),
                height: Math.max(10, maxY - minY),
                points,
                color: extractColor(ann.color, '#0284c7'),
                strokeWidth,
                opacity: 1.0,
                createdAt: now,
                updatedAt: now,
              });
            }
          }
        } else if (ann.subtype === 'Square') {
          const strokeColor = extractColor(ann.color, '#0284c7');
          const fillColor = ann.interiorColor ? extractColor(ann.interiorColor, 'transparent') : 'transparent';
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'shape',
            shapeType: 'rectangle',
            x,
            y,
            width: Math.max(10, width),
            height: Math.max(10, height),
            color: strokeColor,
            fillColor,
            strokeWidth,
            opacity: ann.opacity ?? 1.0,
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'Circle') {
          const strokeColor = extractColor(ann.color, '#0284c7');
          const fillColor = ann.interiorColor ? extractColor(ann.interiorColor, 'transparent') : 'transparent';
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'shape',
            shapeType: 'ellipse',
            x,
            y,
            width: Math.max(10, width),
            height: Math.max(10, height),
            color: strokeColor,
            fillColor,
            strokeWidth,
            opacity: ann.opacity ?? 1.0,
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'Line' && ann.lineCoordinates && ann.lineCoordinates.length >= 4) {
          const [lx1, ly1, lx2, ly2] = ann.lineCoordinates;
          const { x: startX, y: startY } = toDisplayPoint(lx1, ly1);
          const { x: endX, y: endY } = toDisplayPoint(lx2, ly2);
          const strokeColor = extractColor(ann.color, '#0284c7');
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'shape',
            shapeType: 'line',
            x: startX,
            y: startY,
            width: Math.abs(endX - startX) || 2,
            height: Math.abs(endY - startY) || 2,
            endPoint: { x: endX, y: endY },
            color: strokeColor,
            strokeWidth,
            opacity: ann.opacity ?? 1.0,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    if (loadedAnnotations.length > 0) {
      logger.info('load', `Extrahováno ${loadedAnnotations.length} existujících anotací / poznámek z PDF`, {
        sourceDocId,
        annotationsCount: loadedAnnotations.length,
      });
    }

    return loadedAnnotations;
  } catch (err: any) {
    logger.warn('load', `Nepodařilo se extrahovat existující anotace: ${err?.message || err}`, err);
    return [];
  }
};

export const renderPdfPageToCanvas = async (
  sourceDoc: SourceDocument,
  pageModel: PdfPageModel,
  canvas: HTMLCanvasElement,
  scale: number = 1.0
): Promise<void> => {
  if (pageModel.sourceType === 'image' && pageModel.imageDataUrl) {
    // Render image page directly to canvas
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = pageModel.imageDataUrl!;
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = pageModel.width * scale;
    const height = pageModel.height * scale;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    // Handle page rotation
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (pageModel.rotation % 360 !== 0) {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((pageModel.rotation * Math.PI) / 180);
      if (pageModel.rotation % 180 !== 0) {
        ctx.drawImage(img, -height / 2, -width / 2, height, width);
      } else {
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
      }
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }
    ctx.restore();
    return;
  }

  if (pageModel.sourceType === 'blank') {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = pageModel.width * scale;
    const height = pageModel.height * scale;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // If another render is running on this canvas, cancel it first
  const existingTask = activeRenderTasks.get(canvas);
  if (existingTask) {
    try {
      existingTask.cancel();
    } catch {
      // Ignore cancellation error
    }
    activeRenderTasks.delete(canvas);
  }

  // PDF Page Rendering (Disable static annotation baking so extracted annotations remain 100% interactive)
  const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
  const pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);

  // Apply user-selected rotation combined with base page rotation
  const viewport = pdfPage.getViewport({
    scale,
    rotation: pageModel.rotation,
  });

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const renderContext = {
    canvas,
    viewport,
    annotationMode: pdfjsLib.AnnotationMode.DISABLE,
  };

  const renderTask = pdfPage.render(renderContext);
  activeRenderTasks.set(canvas, renderTask);

  try {
    await renderTask.promise;
  } catch (err: any) {
    if (err?.name === 'RenderingCancelledException') {
      return; // Normal cancellation when zooming / navigating
    }
    logger.error('render', `Chyba při vykreslování strany ${pageModel.id} na plátno: ${err?.message || err}`, err);
    throw err;
  } finally {
    if (activeRenderTasks.get(canvas) === renderTask) {
      activeRenderTasks.delete(canvas);
    }
    try {
      pdfPage.cleanup();
    } catch {
      // ignore
    }
  }
};

/**
 * Renders a PDF page to a high-resolution image data URL (JPEG for photographic/scanned efficiency, or PNG)
 */
export const renderPdfPageToDataUrl = async (
  sourceDoc: SourceDocument,
  pageModel: PdfPageModel,
  scale: number = 2.0,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.88
): Promise<string> => {
  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  const canvas = document.createElement('canvas');
  await renderPdfPageToCanvas(sourceDoc, pageModel, canvas, scale);
  if (format === 'image/jpeg') {
    return canvas.toDataURL('image/jpeg', quality);
  }
  return canvas.toDataURL('image/png');
};

/**
 * Renders the interactive PDF text layer into a container DOM element for mouse selection, copying, and search
 */
export const renderPdfTextLayer = async (
  sourceDoc: SourceDocument,
  pageModel: PdfPageModel,
  container: HTMLElement,
  scale: number
): Promise<void> => {
  if (pageModel.sourceType !== 'pdf') {
    container.innerHTML = '';
    return;
  }

  let pdfPage: pdfjsLib.PDFPageProxy | null = null;
  try {
    const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
    pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);

    const viewport = pdfPage.getViewport({
      scale,
      rotation: pageModel.rotation,
    });

    const textContent = await pdfPage.getTextContent();
    container.innerHTML = '';
    container.style.setProperty('--scale-factor', `${scale}`);

    // The layer is laid out in unrotated page space; pdf.js sizes it and sets data-main-rotation,
    // which index.css turns into the matching CSS rotation
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });

    await textLayer.render();
  } catch (err: any) {
    if (err?.name === 'RenderingCancelledException') {
      return;
    }
    console.warn(`Text layer render skipped for page ${pageModel.id}:`, err);
  } finally {
    if (pdfPage) {
      try {
        pdfPage.cleanup();
      } catch {
        // ignore
      }
    }
  }
};

// Text models are cached per source buffer (buffers are never mutated, every edit creates a new one)
const textModelCache = new WeakMap<ArrayBuffer, Map<string, Promise<PageTextModel | null>>>();

/**
 * Exact text model of a page (see pdfTextModel.ts), or null for non-PDF pages, encrypted
 * documents and unreadable streams. `aligned` is false when the stream could not be matched
 * with pdf.js' interpretation; callers then fall back to text heuristics.
 */
export const getPageTextModel = (
  sourceDoc: SourceDocument | undefined,
  pageModel: PdfPageModel
): Promise<PageTextModel | null> => {
  if (pageModel.sourceType !== 'pdf' || !sourceDoc?.arrayBuffer) return Promise.resolve(null);
  let perBuffer = textModelCache.get(sourceDoc.arrayBuffer);
  if (!perBuffer) {
    perBuffer = new Map();
    textModelCache.set(sourceDoc.arrayBuffer, perBuffer);
  }
  const key = `${pageModel.originalPageIndex}|${pageModel.rotation}`;
  const cached = perBuffer.get(key);
  if (cached) return cached;

  const pending = (async (): Promise<PageTextModel | null> => {
    try {
      const { streamText, layout, error } = await getPageContentStream(
        sourceDoc.arrayBuffer,
        pageModel.originalPageIndex
      );
      if (error || !layout) return null;
      const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
      const page = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
      const viewport = page.getViewport({ scale: 1.0, rotation: pageModel.rotation });
      const operatorList = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
      const model = buildPageTextModel({
        streamText,
        layout,
        operatorList,
        ops: pdfjsLib.OPS as unknown as Record<string, number>,
        getFont: (fontKey) => {
          try {
            return page.commonObjs.has(fontKey) ? (page.commonObjs.get(fontKey) as FontMetrics) : null;
          } catch {
            return null;
          }
        },
        toDisplay: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
      });
      if (!model.aligned) {
        logger.warn(
          'edit',
          `Textový model strany ${pageModel.originalPageIndex + 1} nelze sestavit (${model.reason}); bloky se určují odhadem.`
        );
      }
      return model;
    } catch (err: any) {
      logger.warn('edit', `Textový model strany ${pageModel.originalPageIndex + 1} selhal: ${err?.message || err}`);
      return null;
    }
  })();
  perBuffer.set(key, pending);
  return pending;
};

/**
 * Discovers and calculates exact viewport bounding boxes for all images painted on a page.
 */
export const extractPageVisualImages = async (
  pdfPage: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  pageImagesInfo: PageImageInfo[] = []
): Promise<import('../utils/textSnap').VisualTextBlock[]> => {
  try {
    const opList = await pdfPage.getOperatorList();
    const ops = pdfjsLib.OPS;
    const detected: import('../utils/textSnap').VisualTextBlock[] = [];

    let currentMatrix = [1, 0, 0, 1, 0, 0];
    const matrixStack: number[][] = [];
    let imgCounter = 0;

    const multiplyTransform = (m1: number[], m2: number[]): number[] => [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === ops.save) {
        matrixStack.push([...currentMatrix]);
      } else if (fn === ops.restore) {
        currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === ops.transform) {
        currentMatrix = multiplyTransform(currentMatrix, args);
      } else if (
        fn === ops.paintImageXObject ||
        fn === ops.paintInlineImageXObject ||
        fn === ops.paintImageMaskXObject
      ) {
        imgCounter++;
        const rawName = args ? String(args[0] || '') : `img_${imgCounter}`;
        const cleanName = rawName.replace(/^\//, '');

        const p0x = currentMatrix[4];
        const p0y = currentMatrix[5];
        const p1x = currentMatrix[0] + currentMatrix[4];
        const p1y = currentMatrix[1] + currentMatrix[5];
        const p2x = currentMatrix[0] + currentMatrix[2] + currentMatrix[4];
        const p2y = currentMatrix[1] + currentMatrix[3] + currentMatrix[5];
        const p3x = currentMatrix[2] + currentMatrix[4];
        const p3y = currentMatrix[3] + currentMatrix[5];

        const minX = Math.min(p0x, p1x, p2x, p3x);
        const maxX = Math.max(p0x, p1x, p2x, p3x);
        const minY = Math.min(p0y, p1y, p2y, p3y);
        const maxY = Math.max(p0y, p1y, p2y, p3y);

        const vpRect = toViewportRect(viewport, [minX, minY, maxX, maxY]);
        const vx = Math.min(vpRect[0], vpRect[2]);
        const vy = Math.min(vpRect[1], vpRect[3]);
        const vw = Math.abs(vpRect[2] - vpRect[0]);
        const vh = Math.abs(vpRect[3] - vpRect[1]);

        if (vw > 4 && vh > 4) {
          // Correlate with pageImagesInfo from PDF dictionary
          const matchByName = pageImagesInfo.find(
            (im) => im.cleanName.toLowerCase() === cleanName.toLowerCase()
          );
          const matchByGeom = pageImagesInfo.find(
            (im) =>
              im.width !== undefined &&
              im.height !== undefined &&
              Math.abs(maxX - minX - im.width) < 6 &&
              Math.abs(maxY - minY - im.height) < 6
          );
          const matched =
            matchByName ||
            matchByGeom ||
            (pageImagesInfo.length === 1 ? pageImagesInfo[0] : pageImagesInfo[imgCounter - 1]);

          const targetName = matched?.cleanName || cleanName;
          const pixelW = matched?.pixelWidth || (args ? args[1] : undefined);
          const pixelH = matched?.pixelHeight || (args ? args[2] : undefined);
          const dpi =
            matched?.dpi ||
            (pixelW && vw > 0 ? Math.round((pixelW / vw) * 72) : undefined);
          const format =
            matched?.format ||
            (matched?.filter?.includes('DCT') ? 'jpeg' : undefined);
          const isFullPageScan =
            matched?.isFullPageScan ||
            (vw * vh) / (viewport.width * viewport.height) >= 0.82;

          detected.push({
            id: `img_${targetName || imgCounter}`,
            type: 'image',
            imageName: targetName,
            x: Math.max(0, vx),
            y: Math.max(0, vy),
            width: Math.max(8, vw),
            height: Math.max(8, vh),
            text: `/${targetName}`,
            pixelWidth: pixelW,
            pixelHeight: pixelH,
            dpi,
            format,
            colorSpace: matched?.colorSpace,
            filter: matched?.filter,
            isFullPageScan,
          });
        }
      }
    }
    return detected;
  } catch (err) {
    console.warn('extractPageVisualImages error:', err);
    return [];
  }
};

/**
 * Extracts exact line/block text geometries and content directly from PDF page vectors
 */
export const getPageTextBlocks = async (
  sourceDoc: SourceDocument,
  pageModel: PdfPageModel
): Promise<import('../utils/textSnap').VisualTextBlock[]> => {
  if (pageModel.sourceType !== 'pdf') return [];

  try {
    const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
    const pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);

    const viewport = pdfPage.getViewport({
      scale: 1.0,
      rotation: pageModel.rotation,
    });

    let pageImagesInfo: PageImageInfo[] = [];
    if (sourceDoc.arrayBuffer) {
      try {
        const imgRes = await getPageImages(sourceDoc.arrayBuffer, pageModel.originalPageIndex);
        if (imgRes.images) pageImagesInfo = imgRes.images;
      } catch {
        // ignore
      }
    }

    // Exact blocks from the text model: every text object's real extent and text, so what is
    // highlighted and clicked on the page is exactly what gets edited or removed
    const model = await getPageTextModel(sourceDoc, pageModel);
    if (model?.aligned && model.blocks.length > 0) {
      const textBlocks = groupAdjacentBlocks(model.blocks).map((group) => {
        const minX = Math.min(...group.map((b) => b.bbox.x));
        const minY = Math.min(...group.map((b) => b.bbox.y));
        const maxX = Math.max(...group.map((b) => b.bbox.x + b.bbox.width));
        const maxY = Math.max(...group.map((b) => b.bbox.y + b.bbox.height));
        return {
          id: group[0].segmentId,
          segmentIds: group.map((b) => b.segmentId),
          segmentContents: group.map((b) => model.streamText.substring(b.startIndex, b.endIndex)),
          type: 'text' as const,
          x: minX,
          y: minY,
          width: Math.max(2, maxX - minX),
          height: Math.max(2, maxY - minY),
          text: group.map((b) => b.text).join(' '),
        };
      });
      const images = await extractPageVisualImages(pdfPage, viewport, pageImagesInfo);
      return [...textBlocks, ...images];
    }

    const textContent = await pdfPage.getTextContent();
    if (!textContent.items || textContent.items.length === 0) {
      return await extractPageVisualImages(pdfPage, viewport, pageImagesInfo);
    }

    interface ItemEntry {
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      centerY: number;
    }

    const items: ItemEntry[] = [];

    for (const rawItem of textContent.items) {
      const item = rawItem as any;
      if (!item.str || !item.str.trim()) continue;

      const tx = item.transform[4];
      const ty = item.transform[5];
      const w = item.width || Math.abs(item.transform[0]) * item.str.length * 0.6;
      const h = item.height || Math.abs(item.transform[3]) || 12;

      const rect = toViewportRect(viewport, [tx, ty, tx + w, ty + h]);
      const minX = Math.min(rect[0], rect[2]);
      const minY = Math.min(rect[1], rect[3]);
      const maxX = Math.max(rect[0], rect[2]);
      const maxY = Math.max(rect[1], rect[3]);
      const itemW = maxX - minX;
      const itemH = maxY - minY;

      items.push({
        x: minX,
        y: minY,
        w: Math.max(4, itemW),
        h: Math.max(6, itemH),
        text: item.str,
        centerY: minY + itemH / 2,
      });
    }

    if (items.length === 0) return [];

    items.sort((a, b) => {
      if (Math.abs(a.centerY - b.centerY) > 4) {
        return a.centerY - b.centerY;
      }
      return a.x - b.x;
    });

    // 1. If stream segments are available, align visual blocks 1:1 with StreamSegment IDs
    if (sourceDoc.arrayBuffer) {
      try {
        const { streamText } = await getPageContentStream(
          sourceDoc.arrayBuffer,
          pageModel.originalPageIndex
        );
        if (streamText) {
          const rawSegments = parseStreamSegments(streamText);
          const rawTextSegments = rawSegments
            .filter((s) => s.type === 'text')
            .filter((s) => !s.previewText.startsWith('[Textový blok #') && s.previewText.trim().length > 0);

          // Merge contiguous same-line fragments (e.g. bullet number + text body)
          const textSegments: Array<(typeof rawTextSegments)[0] & {
            segmentIds: string[];
            lastFragX: number;
            lastFragEstWidth: number;
          }> = [];

          for (const seg of rawTextSegments) {
            const last = textSegments[textSegments.length - 1];
            const fs = seg.fontSize || 12;
            const segEstWidth = Math.max(8, seg.previewText.length * fs * 0.55);

            const isSameLine =
              last &&
              last.x !== undefined &&
              last.y !== undefined &&
              seg.x !== undefined &&
              seg.y !== undefined &&
              Math.abs(last.y - seg.y) < 2.5;

            // Gap between the END of the immediately preceding fragment and the START of current seg
            const gap = (isSameLine && seg.x !== undefined) ? (seg.x - (last.lastFragX + last.lastFragEstWidth)) : 999;
            // Only merge if fragments are immediately adjacent (not distant table columns)
            const canMergeContiguous = isSameLine && gap >= -8 && gap < 25;

            if (canMergeContiguous) {
              last.segmentIds.push(seg.id);
              last.previewText = `${last.previewText} ${seg.previewText}`.trim();
              last.lastFragX = seg.x ?? last.lastFragX;
              last.lastFragEstWidth = segEstWidth;
            } else {
              textSegments.push({
                ...seg,
                segmentIds: [seg.id],
                lastFragX: seg.x ?? 0,
                lastFragEstWidth: segEstWidth,
              });
            }
          }

          if (textSegments.length > 0) {
            const visualBlocks: import('../utils/textSnap').VisualTextBlock[] = [];
            const usedItemIndices = new Set<number>();

            for (const seg of textSegments) {
              const normSeg = normalizeTextForSearch(seg.previewText);
              const segWords = normSeg.split(' ').filter((w) => w.length > 1);

              let vpMinX = 0;
              let vpMaxX = 0;
              let vpMinY = 0;
              let vpMaxY = 0;
              let hasSpatialBox = false;

              if (seg.x !== undefined && seg.y !== undefined) {
                const fs = seg.fontSize || 12;
                const lc = seg.lineCount || 1;
                const lines = seg.previewText.split(/\r?\n/);
                const maxLineLen = lines.reduce((max, l) => Math.max(max, l.length), 0) || seg.previewText.length;
                // Bound estimated width to the remaining page width from seg.x
                const remainingPageWidth = Math.max(40, (viewport.width - Math.max(0, seg.x)) - 10);
                const estWidth = Math.min(remainingPageWidth, Math.max(20, maxLineLen * fs * 0.65));
                const pdfRect = [
                  seg.x - 4,
                  seg.y - fs * 0.3,
                  seg.x + estWidth,
                  seg.y + (lc - 1) * fs * 1.25 + fs * 0.9,
                ];
                const vpRect = toViewportRect(viewport, pdfRect);
                vpMinX = Math.min(vpRect[0], vpRect[2]);
                vpMaxX = Math.max(vpRect[0], vpRect[2]);
                vpMinY = Math.min(vpRect[1], vpRect[3]);
                vpMaxY = Math.max(vpRect[1], vpRect[3]);
                hasSpatialBox = true;
              }

              const matchedItems: ItemEntry[] = [];

              // Priority 1: High-confidence text match bounded by spatial proximity
              items.forEach((item, itemIdx) => {
                if (usedItemIndices.has(itemIdx)) return;
                const normItem = normalizeTextForSearch(item.text);
                if (!normItem) return;

                const isSubstrMatch =
                    (normSeg.length >= 3 && normItem.length >= 3 && (normSeg.includes(normItem) || normItem.includes(normSeg))) ||
                    (normSeg === normItem);
                const longWords = segWords.filter((w) => w.length >= 4);
                const isDistinctWordMatch = longWords.length > 0 && longWords.some((w) => normItem.includes(w));
                const isWordMatch = isSubstrMatch || isDistinctWordMatch;

                if (isWordMatch) {
                  const isWithinSpatial =
                    !hasSpatialBox ||
                    (item.centerY >= vpMinY - 6 &&
                      item.centerY <= vpMaxY + 6 &&
                      item.x >= vpMinX - 12 &&
                      item.x <= vpMaxX + 25);

                  if (isWithinSpatial) {
                    matchedItems.push(item);
                    usedItemIndices.add(itemIdx);
                  }
                }
              });

              // Priority 2: 2D Spatial intersection if text match didn't find items (e.g. subset fonts / hex CMap)
              if (matchedItems.length === 0 && hasSpatialBox) {
                const boxHeight = vpMaxY - vpMinY;
                items.forEach((item, itemIdx) => {
                  if (usedItemIndices.has(itemIdx)) return;

                  const yOverlap = Math.abs(item.centerY - (vpMinY + vpMaxY) / 2) <= Math.max(6, boxHeight / 2 + 1);
                  const xOverlap = (item.x + item.w) >= (vpMinX - 4) && item.x <= Math.min(viewport.width, vpMaxX + 8);

                  if (yOverlap && xOverlap) {
                    matchedItems.push(item);
                    usedItemIndices.add(itemIdx);
                  }
                });
              }

              if (matchedItems.length > 0) {
                const minX = Math.min(...matchedItems.map((s) => s.x));
                const maxX = Math.max(...matchedItems.map((s) => s.x + s.w));
                const minY = Math.min(...matchedItems.map((s) => s.y));
                const maxY = Math.max(...matchedItems.map((s) => s.y + s.h));
                const decodedText = matchedItems.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

                const blockX = Math.max(0, minX - 2);
                const blockWidth = Math.min(viewport.width - blockX - 2, Math.max(12, maxX - minX + 4));

                visualBlocks.push({
                  id: seg.id,
                  segmentIds: seg.segmentIds,
                  type: 'text',
                  x: blockX,
                  y: Math.max(0, minY - 1),
                  width: Math.max(12, blockWidth),
                  height: Math.max(10, maxY - minY + 2),
                  text: decodedText || seg.previewText,
                });
              } else if (hasSpatialBox) {
                // High-precision stream coordinate fallback
                const blockX = Math.max(0, vpMinX - 2);
                const blockWidth = Math.min(viewport.width - blockX - 2, Math.max(14, vpMaxX - vpMinX + 4));

                visualBlocks.push({
                  id: seg.id,
                  segmentIds: seg.segmentIds,
                  type: 'text',
                  x: blockX,
                  y: Math.max(0, vpMinY - 1),
                  width: Math.max(14, blockWidth),
                  height: Math.max(10, vpMaxY - vpMinY + 2),
                  text: seg.previewText,
                });
              } else {
                const blockX = 30;
                const blockWidth = Math.min(viewport.width - blockX - 10, 200);
                visualBlocks.push({
                  id: seg.id,
                  segmentIds: seg.segmentIds,
                  type: 'text',
                  x: blockX,
                  y: 50 + (visualBlocks.length % 20) * 24,
                  width: blockWidth,
                  height: 20,
                  text: seg.previewText,
                });
              }
            }

            // Also discover images on page and append as interactive visualBlocks
            const visualImages = await extractPageVisualImages(pdfPage, viewport, pageImagesInfo);
            visualBlocks.push(...visualImages);

            if (visualBlocks.length > 0) {
              return visualBlocks;
            }
          }
        }
      } catch (streamErr) {
        console.warn('Stream-aligned block extraction fallback:', streamErr);
      }
    }

    // 2. Fallback: visual line grouping if stream segments are not available
    const lineGroups: ItemEntry[][] = [];
    for (const item of items) {
      let matchedGroup = lineGroups.find((group) => {
        const avgCenterY = group.reduce((sum, s) => sum + s.centerY, 0) / group.length;
        const avgH = group.reduce((sum, s) => sum + s.h, 0) / group.length;
        return Math.abs(item.centerY - avgCenterY) < Math.max(4, avgH * 0.45);
      });

      if (matchedGroup) {
        matchedGroup.push(item);
      } else {
        lineGroups.push([item]);
      }
    }

    const fallbackBlocks: import('../utils/textSnap').VisualTextBlock[] = lineGroups.map((group, idx) => {
      group.sort((a, b) => a.x - b.x);
      const minX = Math.min(...group.map((s) => s.x));
      const maxX = Math.max(...group.map((s) => s.x + s.w));
      const minY = Math.min(...group.map((s) => s.y));
      const maxY = Math.max(...group.map((s) => s.y + s.h));
      const text = group.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

      const blockX = Math.max(0, minX - 2);
      const blockWidth = Math.min(viewport.width - blockX - 2, Math.max(12, maxX - minX + 4));

      return {
        id: `block_${idx + 1}`,
        type: 'text',
        x: blockX,
        y: Math.max(0, minY - 1),
        width: Math.max(12, blockWidth),
        height: Math.max(10, maxY - minY + 2),
        text,
      };
    });

    const fallbackImages = await extractPageVisualImages(pdfPage, viewport, pageImagesInfo);
    return [...fallbackBlocks, ...fallbackImages];
  } catch (err) {
    console.warn(`Failed to extract text blocks for page ${pageModel.id}:`, err);
    return [];
  }
};
