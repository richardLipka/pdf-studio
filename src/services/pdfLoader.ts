import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel, SourceDocument } from '../types/document';
import { Annotation } from '../types/annotations';

// Configure pdfjs worker in Vite
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url
  ).toString();
} catch (e) {
  console.warn('Falling back to CDN worker for pdf.js', e);
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
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
  docCache.clear();
};

export const parsePdfPages = async (
  arrayBuffer: ArrayBuffer,
  sourceDocId: string = 'main'
): Promise<PdfPageModel[]> => {
  const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
  const pages: PdfPageModel[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
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
  }

  return pages;
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

      const page = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
      const pdfAnnotations = await page.getAnnotations();

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
        const strokeWidth =
          ann.borderStyle?.width ?? (ann.border && ann.border[2]) ?? ann.strokeWidth ?? 2;

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

    return loadedAnnotations;
  } catch (err) {
    console.warn('Could not extract PDF annotations:', err);
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
    throw err;
  } finally {
    if (activeRenderTasks.get(canvas) === renderTask) {
      activeRenderTasks.delete(canvas);
    }
  }
};

/**
 * Renders a PDF page to a compressed image data URL (fallback only)
 */
export const renderPdfPageToDataUrl = async (
  sourceDoc: SourceDocument,
  pageModel: PdfPageModel,
  scale: number = 1.5
): Promise<string> => {
  const canvas = document.createElement('canvas');
  await renderPdfPageToCanvas(sourceDoc, pageModel, canvas, scale);
  return canvas.toDataURL('image/jpeg', 0.88);
};
