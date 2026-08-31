import React, { useEffect, useRef, useState, memo } from 'react';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfPageToCanvas } from '../../services/pdfLoader';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const hasDrawnRef = useRef<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!hasDrawnRef.current) {
      setInitialLoading(true);
    }

    renderPdfPageToCanvas(sourceDoc, page, canvas, scale)
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
    };
  }, [page.id, page.rotation, page.sourceDocId, page.sourceType, page.imageDataUrl, page.width, page.height, sourceDoc, scale]);

  return (
    <div
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
    prev.page.rotation === next.page.rotation &&
    prev.page.sourceType === next.page.sourceType &&
    prev.page.imageDataUrl === next.page.imageDataUrl &&
    prev.page.width === next.page.width &&
    prev.page.height === next.page.height &&
    prev.sourceDoc === next.sourceDoc &&
    prev.scale === next.scale
  );
});
