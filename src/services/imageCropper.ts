import { PdfPageModel, SourceDocument } from '../types/document';
import { Annotation } from '../types/annotations';
import { getCachedPdfDocument } from './pdfLoader';

export interface CropResult {
  success: boolean;
  dataUrl: string;
  blob: Blob | null;
  clipboardSuccess: boolean;
  pixelWidth: number;
  pixelHeight: number;
  error?: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renders a PDF, image, or blank page at ultra high resolution and extracts a cropped region to clipboard
 * @param sourceDoc Source document for PDF rendering
 * @param pageModel Target page metadata
 * @param rect Bounding box in PDF coordinate space (72 DPI points)
 * @param annotations Annotations to bake into the crop
 * @param scaleMultiplier High-resolution render multiplier (default 3.0 = 216 DPI crisp rendering)
 */
export const cropPageRegionToClipboard = async (
  sourceDoc: SourceDocument | undefined,
  pageModel: PdfPageModel,
  rect: CropRect,
  annotations: Annotation[] = [],
  scaleMultiplier: number = 3.0
): Promise<CropResult> => {
  try {
    const highResScale = Math.max(2.0, Math.min(4.0, scaleMultiplier));

    // 1. Create full-page offscreen canvas
    const fullCanvas = document.createElement('canvas');
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) {
      throw new Error('Could not create offscreen 2D canvas context');
    }

    if (pageModel.sourceType === 'pdf' && sourceDoc?.arrayBuffer) {
      const pdfDoc = await getCachedPdfDocument(sourceDoc.id, sourceDoc.arrayBuffer);
      const pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);

      const viewport = pdfPage.getViewport({
        scale: highResScale,
        rotation: pageModel.rotation,
      });

      fullCanvas.width = viewport.width;
      fullCanvas.height = viewport.height;

      const renderContext = {
        canvasContext: fullCtx,
        viewport,
        annotationMode: 0,
      };

      await pdfPage.render(renderContext).promise;
    } else if (pageModel.sourceType === 'image' && pageModel.imageDataUrl) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = pageModel.imageDataUrl!;
      });

      const width = pageModel.width * highResScale;
      const height = pageModel.height * highResScale;
      fullCanvas.width = width;
      fullCanvas.height = height;

      fullCtx.fillStyle = '#ffffff';
      fullCtx.fillRect(0, 0, width, height);

      fullCtx.save();
      if (pageModel.rotation % 360 !== 0) {
        fullCtx.translate(width / 2, height / 2);
        fullCtx.rotate((pageModel.rotation * Math.PI) / 180);
        if (pageModel.rotation % 180 !== 0) {
          fullCtx.drawImage(img, -height / 2, -width / 2, height, width);
        } else {
          fullCtx.drawImage(img, -width / 2, -height / 2, width, height);
        }
      } else {
        fullCtx.drawImage(img, 0, 0, width, height);
      }
      fullCtx.restore();
    } else {
      // Blank page
      const width = pageModel.width * highResScale;
      const height = pageModel.height * highResScale;
      fullCanvas.width = width;
      fullCanvas.height = height;

      fullCtx.fillStyle = '#ffffff';
      fullCtx.fillRect(0, 0, width, height);
    }

    // 2. Render overlapping annotations at high scale
    if (annotations.length > 0) {
      for (const ann of annotations) {
        if (ann.pageId !== pageModel.id) continue;

        fullCtx.save();
        if (ann.type === 'highlight') {
          fullCtx.fillStyle = ann.color || '#fde047';
          fullCtx.globalAlpha = ann.opacity || 0.4;
          fullCtx.fillRect(
            ann.x * highResScale,
            ann.y * highResScale,
            ann.width * highResScale,
            ann.height * highResScale
          );
        } else if (ann.type === 'underline') {
          fullCtx.strokeStyle = ann.color || '#0284c7';
          fullCtx.lineWidth = (ann.strokeWidth || 2) * highResScale;
          fullCtx.globalAlpha = ann.opacity || 0.9;
          fullCtx.lineCap = 'round';
          fullCtx.beginPath();
          fullCtx.moveTo(ann.x * highResScale, (ann.y + ann.height) * highResScale);
          fullCtx.lineTo((ann.x + ann.width) * highResScale, (ann.y + ann.height) * highResScale);
          fullCtx.stroke();
        } else if (ann.type === 'strikethrough') {
          fullCtx.strokeStyle = ann.color || '#dc2626';
          fullCtx.lineWidth = (ann.strokeWidth || 2) * highResScale;
          fullCtx.globalAlpha = ann.opacity || 0.9;
          fullCtx.lineCap = 'round';
          fullCtx.beginPath();
          fullCtx.moveTo(ann.x * highResScale, (ann.y + ann.height / 2) * highResScale);
          fullCtx.lineTo((ann.x + ann.width) * highResScale, (ann.y + ann.height / 2) * highResScale);
          fullCtx.stroke();
        } else if (ann.type === 'drawing') {
          const d = ann as any;
          if (d.points && d.points.length > 1) {
            fullCtx.strokeStyle = d.color || '#0284c7';
            fullCtx.lineWidth = (d.strokeWidth || 2) * highResScale;
            fullCtx.lineCap = 'round';
            fullCtx.lineJoin = 'round';
            fullCtx.beginPath();
            fullCtx.moveTo(d.points[0].x * highResScale, d.points[0].y * highResScale);
            for (let i = 1; i < d.points.length; i++) {
              fullCtx.lineTo(d.points[i].x * highResScale, d.points[i].y * highResScale);
            }
            fullCtx.stroke();
          }
        } else if (ann.type === 'text') {
          const t = ann as any;
          if (t.text) {
            fullCtx.fillStyle = t.color || '#0f172a';
            const fontSize = (t.fontSize || 14) * highResScale;
            fullCtx.font = `${fontSize}px ${t.fontFamily || 'Inter'}, sans-serif`;
            fullCtx.fillText(t.text, t.x * highResScale, (t.y + (t.fontSize || 14)) * highResScale);
          }
        } else if (ann.type === 'signature') {
          const sig = ann as any;
          if (sig.imageDataUrl) {
            const sigImg = new Image();
            await new Promise<void>((res) => {
              sigImg.onload = () => res();
              sigImg.onerror = () => res();
              sigImg.src = sig.imageDataUrl;
            });
            fullCtx.drawImage(
              sigImg,
              sig.x * highResScale,
              sig.y * highResScale,
              sig.width * highResScale,
              sig.height * highResScale
            );
          }
        }
        fullCtx.restore();
      }
    }

    // 3. Calculate cropped coordinates
    const cropX = Math.round(rect.x * highResScale);
    const cropY = Math.round(rect.y * highResScale);
    const cropW = Math.max(1, Math.round(rect.width * highResScale));
    const cropH = Math.max(1, Math.round(rect.height * highResScale));

    const safeCropX = Math.max(0, Math.min(fullCanvas.width - 1, cropX));
    const safeCropY = Math.max(0, Math.min(fullCanvas.height - 1, cropY));
    const safeCropW = Math.max(1, Math.min(fullCanvas.width - safeCropX, cropW));
    const safeCropH = Math.max(1, Math.min(fullCanvas.height - safeCropY, cropH));

    // 4. Create target crop canvas
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = safeCropW;
    targetCanvas.height = safeCropH;
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) {
      throw new Error('Could not create target crop canvas context');
    }

    targetCtx.drawImage(
      fullCanvas,
      safeCropX,
      safeCropY,
      safeCropW,
      safeCropH,
      0,
      0,
      safeCropW,
      safeCropH
    );

    const dataUrl = targetCanvas.toDataURL('image/png');

    const blob = await new Promise<Blob | null>((resolve) => {
      targetCanvas.toBlob((b) => resolve(b), 'image/png');
    });

    // 5. Copy directly to system clipboard
    let clipboardSuccess = false;
    if (
      blob &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.write &&
      typeof ClipboardItem !== 'undefined'
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        clipboardSuccess = true;
      } catch (clipErr) {
        console.warn('Direct ClipboardItem write failed:', clipErr);
      }
    }

    return {
      success: true,
      dataUrl,
      blob,
      clipboardSuccess,
      pixelWidth: safeCropW,
      pixelHeight: safeCropH,
    };
  } catch (err: any) {
    console.error('High-resolution region crop failed:', err);
    return {
      success: false,
      dataUrl: '',
      blob: null,
      clipboardSuccess: false,
      pixelWidth: 0,
      pixelHeight: 0,
      error: err?.message || 'Crop failed',
    };
  }
};
