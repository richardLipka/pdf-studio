import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel, SourceDocument, DocumentMetadata } from '../types/document';
import { Annotation } from '../types/annotations';
import { logger } from './logger';
import { sanitizePdfBuffer, extractPdfHeader } from './pdfExporter';
import {
  getPageContentStream,
  parseStreamSegments,
  normalizeTextForSearch,
} from './contentStreamEditor';

// Configure pdfjs worker in Vite for browser
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.js',
      import.meta.url
    ).toString();
  } catch (e) {
    console.warn('Falling back to CDN worker for pdf.js', e);
    logger.warn('load', 'Použit záložní CDN worker pro pdf.js', e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  }
}

// In-memory cache of loaded pdf documents
const docCache = new Map<string, pdfjsLib.PDFDocumentProxy>();
const activeRenderTasks = new WeakMap<HTMLCanvasElement, any>();

export const getCachedPdfDocument = async (
  sourceId: string,
  arrayBuffer: ArrayBuffer
): Promise<pdfjsLib.PDFDocumentProxy> => {
  if (docCache.has(sourceId)) {
    return docCache.get(sourceId)!;
  }
  // Create a copy of the buffer because pdfjs-dist may transfer ownership
  const copyBuffer = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: copyBuffer });
  const pdfDoc = await loadingTask.promise;
  docCache.set(sourceId, pdfDoc);
  return pdfDoc;
};

export const clearPdfCache = () => {
  for (const doc of docCache.values()) {
    try {
      doc.cleanup();
      doc.destroy();
    } catch {
      // ignore
    }
  }
  docCache.clear();
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

// Extract existing annotations & comments from PDF document
export const extractPdfAnnotations = async (
  arrayBuffer: ArrayBuffer,
  sourceDocId: string,
  pages: PdfPageModel[]
): Promise<Annotation[]> => {
  try {
    const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
    const loadedAnnotations: Annotation[] = [];

    for (let i = 0; i < pages.length; i++) {
      const pageModel = pages[i];
      if (pageModel.sourceType !== 'pdf') continue;

      let pdfAnnotations: any[] = [];
      try {
        const page = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
        pdfAnnotations = await page.getAnnotations();
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

      for (const ann of pdfAnnotations) {
        if (!ann.rect || ann.rect.length < 4) continue;

        const [x1, y1, x2, y2] = ann.rect;
        const pageHeight = pageModel.height;
        const x = Math.min(x1, x2);
        const y = Math.min(pageHeight - y1, pageHeight - y2);
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
        } else if (ann.subtype === 'Underline') {
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'underline',
            x,
            y,
            width: Math.max(10, width),
            height: 2,
            strokeWidth,
            color: extractColor(ann.color, '#0284c7'),
            opacity: 0.9,
            comment: textContent,
            author,
            createdAt: now,
            updatedAt: now,
          });
        } else if (ann.subtype === 'StrikeOut') {
          loadedAnnotations.push({
            id,
            pageId: pageModel.id,
            type: 'strikethrough',
            x,
            y,
            width: Math.max(10, width),
            height: 2,
            strokeWidth,
            color: extractColor(ann.color, '#dc2626'),
            opacity: 0.9,
            comment: textContent,
            author,
            createdAt: now,
            updatedAt: now,
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
            const inkPath = inkLists[pIdx];
            const points: { x: number; y: number }[] = [];
            for (let k = 0; k < inkPath.length; k += 2) {
              points.push({
                x: inkPath[k],
                y: pageHeight - inkPath[k + 1],
              });
            }
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
          const startX = lx1;
          const startY = pageHeight - ly1;
          const endX = lx2;
          const endY = pageHeight - ly2;
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

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const renderContext = {
    canvasContext: ctx,
    viewport,
    annotationMode: 0, // 0 = AnnotationMode.DISABLE
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

  try {
    const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
    const pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);

    const viewport = pdfPage.getViewport({
      scale,
      rotation: pageModel.rotation,
    });

    const textContent = await pdfPage.getTextContent();
    container.innerHTML = '';
    container.style.setProperty('--scale-factor', `${scale}`);

    const task = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container,
      viewport,
      textDivs: [],
    });

    await task.promise;
  } catch (err: any) {
    if (err?.name === 'RenderingCancelledException') {
      return;
    }
    console.warn(`Text layer render skipped for page ${pageModel.id}:`, err);
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

    const textContent = await pdfPage.getTextContent();
    if (!textContent.items || textContent.items.length === 0) {
      return [];
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

      const rect = viewport.convertToViewportRectangle([tx, ty, tx + w, ty + h]);
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
          const textSegments = rawSegments.filter((s) => s.type === 'text');

          if (textSegments.length > 0) {
            const visualBlocks: import('../utils/textSnap').VisualTextBlock[] = [];
            const usedItemIndices = new Set<number>();

            for (const seg of textSegments) {
              const normSeg = normalizeTextForSearch(seg.previewText);
              const segWords = normSeg.split(' ').filter((w) => w.length > 1);

              const matchedItems: ItemEntry[] = [];

              items.forEach((item, itemIdx) => {
                if (usedItemIndices.has(itemIdx)) return;
                const normItem = normalizeTextForSearch(item.text);
                if (!normItem) return;

                const isWordMatch =
                  normSeg.includes(normItem) ||
                  normItem.includes(normSeg) ||
                  segWords.some((w) => normItem.includes(w) || w.includes(normItem));

                if (isWordMatch) {
                  matchedItems.push(item);
                  usedItemIndices.add(itemIdx);
                }
              });

              if (matchedItems.length > 0) {
                const minX = Math.min(...matchedItems.map((s) => s.x));
                const maxX = Math.max(...matchedItems.map((s) => s.x + s.w));
                const minY = Math.min(...matchedItems.map((s) => s.y));
                const maxY = Math.max(...matchedItems.map((s) => s.y + s.h));

                visualBlocks.push({
                  id: seg.id,
                  x: Math.max(0, minX - 2),
                  y: Math.max(0, minY - 1),
                  width: Math.max(12, maxX - minX + 4),
                  height: Math.max(10, maxY - minY + 2),
                  text: seg.previewText,
                });
              } else {
                // Fallback: estimate viewport position from stream coordinates
                let posX = 30;
                let posY = 50;
                let width = 200;
                let height = 20;

                if (seg.x !== undefined && seg.y !== undefined) {
                  const fs = seg.fontSize || 12;
                  const lc = seg.lineCount || 1;
                  const pdfRect = [
                    seg.x,
                    seg.y - fs * lc,
                    seg.x + Math.min(500, Math.max(50, seg.previewText.length * fs * 0.55)),
                    seg.y + fs * 0.5,
                  ];
                  const vpRect = viewport.convertToViewportRectangle(pdfRect);
                  posX = Math.min(vpRect[0], vpRect[2]);
                  posY = Math.min(vpRect[1], vpRect[3]);
                  width = Math.abs(vpRect[2] - vpRect[0]);
                  height = Math.abs(vpRect[3] - vpRect[1]);
                }

                visualBlocks.push({
                  id: seg.id,
                  x: Math.max(0, posX - 2),
                  y: Math.max(0, posY - 1),
                  width: Math.max(12, width + 4),
                  height: Math.max(10, height + 2),
                  text: seg.previewText,
                });
              }
            }

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

    return lineGroups.map((group, idx) => {
      group.sort((a, b) => a.x - b.x);
      const minX = Math.min(...group.map((s) => s.x));
      const maxX = Math.max(...group.map((s) => s.x + s.w));
      const minY = Math.min(...group.map((s) => s.y));
      const maxY = Math.max(...group.map((s) => s.y + s.h));
      const text = group.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

      return {
        id: `block_${idx + 1}`,
        x: Math.max(0, minX - 2),
        y: Math.max(0, minY - 1),
        width: Math.max(12, maxX - minX + 4),
        height: Math.max(10, maxY - minY + 2),
        text,
      };
    });
  } catch (err) {
    console.warn(`Failed to extract text blocks for page ${pageModel.id}:`, err);
    return [];
  }
};
