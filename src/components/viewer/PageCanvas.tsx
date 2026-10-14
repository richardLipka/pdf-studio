import React, { useEffect, useRef, useState, memo } from 'react';
import type { PageZone } from '../../hooks/usePageZones';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfPageToCanvas } from '../../services/pdfLoader';
import { renderQueue, RenderPriority } from '../../services/renderQueue';
import { useI18n } from '../../i18n/context';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

interface PageCanvasProps {
  page: PdfPageModel;
  sourceDoc: SourceDocument;
  scale: number;
  /** Distance from the viewport (usePageZones): near pages render, far pages release their bitmap */
  zone: PageZone;
  /** Device pixels per CSS pixel the bitmap is rendered at (crisp on HiDPI screens) */
  pixelRatio: number;
}

const PageCanvasComponent: React.FC<PageCanvasProps> = ({
  page,
  sourceDoc,
  scale,
  zone,
  pixelRatio,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawn, setIsDrawn] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  // Page state of the bitmap currently on the canvas (null: blank / released)
  const drawnKeyRef = useRef<string | null>(null);

  const taskId = `canvas_${page.id}`;
  const renderKey = [
    page.id,
    page.originalPageIndex,
    page.rotation,
    page.sourceDocId,
    page.sourceType,
    page.imageDataUrl ? page.imageDataUrl.length : '',
    page.width,
    page.height,
    sourceDoc?.updatedAt ?? '',
    sourceDoc?.arrayBuffer?.byteLength ?? '',
    scale,
    pixelRatio,
    retryNonce,
  ].join('|');

  useEffect(() => {
    if (zone === 'far') {
      // The canvas element itself is unmounted below: even an empty 2D canvas costs memory
      renderQueue.cancel(taskId);
      if (drawnKeyRef.current !== null) {
        drawnKeyRef.current = null;
        setIsDrawn(false);
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const release = () => {
      renderQueue.cancel(taskId);
      if (drawnKeyRef.current !== null || canvas.width > 0) {
        // Frees the bitmap: a 0x0 canvas has no backing store
        canvas.width = 0;
        canvas.height = 0;
        drawnKeyRef.current = null;
        setIsDrawn(false);
      }
    };

    if (drawnKeyRef.current === renderKey) return;
    if (zone === 'keep') {
      // Off screen with an outdated bitmap (zoom, edit): drop it, it is re-rendered when it comes near
      if (drawnKeyRef.current !== null) release();
      return;
    }

    let isCancelled = false;
    renderQueue
      .enqueue(taskId, RenderPriority.VIEWPORT, async () => {
        if (isCancelled) return;
        await renderPdfPageToCanvas(sourceDoc, page, canvas, scale, pixelRatio);
      })
      .then(() => {
        if (!isCancelled) {
          drawnKeyRef.current = renderKey;
          setIsDrawn(true);
          setRenderError(null);
        }
      })
      .catch((err) => {
        if (!isCancelled && err?.name !== 'RenderingCancelledException') {
          console.error(`Failed to render page ${page.id}:`, err);
          setRenderError(err?.message || 'Chyba při vykreslování strany');
        }
      });

    return () => {
      isCancelled = true;
      renderQueue.cancel(taskId);
    };
    // renderKey covers the page, document version, scale and pixel ratio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, renderKey]);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    renderQueue.cancel(taskId);
    drawnKeyRef.current = null;
    setRenderError(null);
    setRetryNonce((prev) => prev + 1);
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: `${page.width * scale}px`,
        height: `${page.height * scale}px`,
      }}
      className="relative shadow-2xl rounded-sm bg-white overflow-hidden"
    >
      {zone !== 'far' && (
        <canvas
          ref={canvasRef}
          id={`page_canvas_${page.id}`}
          data-page-canvas={page.id}
          className="block select-none"
        />
      )}

      {zone === 'near' && !isDrawn && !renderError && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
        </div>
      )}

      {renderError && !isDrawn && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-10 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-white mb-1">
            {t.app.renderFailed}
          </p>
          <p className="text-xs text-slate-400 max-w-xs mb-4 line-clamp-2">
            {renderError}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-md active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.app.retry}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export const PageCanvas = memo(PageCanvasComponent, (prev, next) => {
  return (
    prev.page.id === next.page.id &&
    prev.page.originalPageIndex === next.page.originalPageIndex &&
    prev.page.rotation === next.page.rotation &&
    prev.page.sourceType === next.page.sourceType &&
    prev.page.imageDataUrl === next.page.imageDataUrl &&
    prev.page.width === next.page.width &&
    prev.page.height === next.page.height &&
    prev.sourceDoc === next.sourceDoc &&
    prev.sourceDoc?.updatedAt === next.sourceDoc?.updatedAt &&
    prev.page.sourceDocId === next.page.sourceDocId &&
    prev.scale === next.scale &&
    prev.zone === next.zone &&
    prev.pixelRatio === next.pixelRatio
  );
});
