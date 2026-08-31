import React, { useRef, useState, useEffect } from 'react';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { PageCanvas } from './PageCanvas';
import { AnnotationLayer } from './AnnotationLayer';

export const PdfViewer: React.FC = () => {
  const { pages, sources, scale, activePageIndex, setActivePageIndex } = useDocument();
  const { activeTool } = useEditor();

  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Pan dragging state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Scroll active page into main view whenever activePageIndex changes
  useEffect(() => {
    const activePage = pages[activePageIndex];
    if (activePage) {
      const el = pageContainerRefs.current[activePage.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activePageIndex, pages]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan if tool is pan or middle mouse button is pressed
    if (activeTool === 'pan' || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      if (containerRef.current) {
        setScrollStart({
          left: containerRef.current.scrollLeft,
          top: containerRef.current.scrollTop,
        });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && containerRef.current) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      containerRef.current.scrollLeft = scrollStart.left - dx;
      containerRef.current.scrollTop = scrollStart.top - dy;
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  return (
    <main
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      tabIndex={0}
      className={`flex-1 bg-slate-950 overflow-auto p-6 md:p-10 flex flex-col items-center select-none outline-none ${
        activeTool === 'pan' || isPanning ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <div className="flex flex-col items-center gap-8 pb-20">
        {pages.map((page, index) => {
          const sourceDoc = sources.find((s) => s.id === page.sourceDocId) || sources[0];
          const isCurrent = index === activePageIndex;

          return (
            <div
              key={page.id}
              ref={(el) => (pageContainerRefs.current[page.id] = el)}
              onClick={() => setActivePageIndex(index)}
              className={`relative transition-all duration-300 ${
                isCurrent
                  ? 'ring-2 ring-sky-500/80 shadow-2xl shadow-sky-950/50 scale-[1.002]'
                  : 'shadow-xl hover:ring-1 hover:ring-slate-700'
              }`}
            >
              {/* PDF Canvas */}
              <PageCanvas page={page} sourceDoc={sourceDoc} scale={scale} />

              {/* Annotation & Interaction Overlay */}
              <AnnotationLayer page={page} scale={scale} />
            </div>
          );
        })}
      </div>
    </main>
  );
};
