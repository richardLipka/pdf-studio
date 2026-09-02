import React, { useEffect, useRef, useState, memo } from 'react';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfPageToCanvas } from '../../services/pdfLoader';
import { renderQueue, RenderPriority } from '../../services/renderQueue';
import { Loader2 } from 'lucide-react';

interface PageCanvasProps {
  page: PdfPageModel;
  sourceDoc: SourceDocument;
  scale: number;
}

const PageCanvasComponent: React.FC<PageCanvasProps> = ({
  page,
  sourceDoc,
  scale,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const hasDrawnRef = useRef<boolean>(false);
  const isIntersectingRef = useRef<boolean>(false);

  // Track viewport visibility with IntersectionObserver to dynamically elevate render priority
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') {
      isIntersectingRef.current = true;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isIntersectingRef.current = true;
            // Elevate priority in render queue if page is currently visible
            const taskId = `canvas_${page.id}_${page.rotation}_${scale}`;
            renderQueue.elevatePriority(taskId, RenderPriority.VIEWPORT);
          } else {
            isIntersectingRef.current = false;
          }
        }
      },
      {
        root: null,
        rootMargin: '300px 0px 300px 0px', // Prefetch margin
        threshold: 0.01,
      }
    );

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [page.id, page.rotation, scale]);

  useEffect(() => {
    let isCancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!hasDrawnRef.current) {
      setInitialLoading(true);
    }

    const taskId = `canvas_${page.id}_${page.rotation}_${scale}`;
    const isInitialBatch = page.originalPageIndex < 5;
    const initialPriority = isIntersectingRef.current
      ? RenderPriority.VIEWPORT
      : isInitialBatch
      ? RenderPriority.INITIAL_BATCH
      : RenderPriority.BACKGROUND;

    renderQueue
      .enqueue(taskId, initialPriority, async () => {
        if (isCancelled || !canvas) return;
        await renderPdfPageToCanvas(sourceDoc, page, canvas, scale);
      })
      .then(() => {
        if (!isCancelled) {
          hasDrawnRef.current = true;
          setInitialLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error(`Failed to render page ${page.id}:`, err);
          setInitialLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      renderQueue.cancel(taskId);
    };
  }, [
    page.id,
    page.originalPageIndex,
    page.rotation,
    page.sourceDocId,
    page.sourceType,
    page.imageDataUrl,
    page.width,
    page.height,
    sourceDoc,
    sourceDoc?.updatedAt,
    scale,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: `${page.width * scale}px`,
        height: `${page.height * scale}px`,
      }}
      className="relative shadow-2xl rounded-sm bg-white overflow-hidden"
    >
      <canvas ref={canvasRef} className="block select-none" />

      {initialLoading && !hasDrawnRef.current && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
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
    prev.scale === next.scale
  );
});
