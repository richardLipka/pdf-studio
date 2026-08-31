import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel, SourceDocument } from '../types/document';

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

  // PDF Page Rendering
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
  };

  await pdfPage.render(renderContext).promise;
};
