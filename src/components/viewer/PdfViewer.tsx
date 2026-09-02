import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { useTheme } from '../../context/ThemeContext';
import { PageCanvas } from './PageCanvas';
import { TextLayer } from './TextLayer';
import { AnnotationLayer } from './AnnotationLayer';
import { FormLayer } from './FormLayer';

export const PdfViewer: React.FC = () => {
  const { theme } = useTheme();
  const {
    pages,
    sources,
    scale,
    activePageIndex,
    setActivePageIndex,
    selectedPageIds,
    setSelectedPageIds,
    togglePageSelection,
  } = useDocument();
  const { activeTool } = useEditor();

  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Flag to distinguish between user scrolling with mousewheel vs programmatic scroll
  const isUserScrollingRef = useRef<boolean>(false);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Pan dragging state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Scroll active page into main view when selected from outside (sidebar click, arrow keys)
  useEffect(() => {
    if (isUserScrollingRef.current) {
      return; // Do not interrupt user mousewheel / scrollbar scrolling
    }
    const activePage = pages[activePageIndex];
    if (activePage) {
      const el = pageContainerRefs.current[activePage.id];
      if (el) {
        isProgrammaticScrollRef.current = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const timer = window.setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 400);
        return () => window.clearTimeout(timer);
      }
    }
  }, [activePageIndex, pages]);

  // Track viewport scroll position and update active page + sidebar thumbnail on mousewheel
  const handleScroll = useCallback(() => {
    if (!containerRef.current || pages.length === 0) return;
    if (isProgrammaticScrollRef.current) return; // Skip programmatic scroll events!

    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 250);

    const containerRect = containerRef.current.getBoundingClientRect();
    const viewportCenterY = containerRect.top + containerRect.height / 2;

    let closestIndex = activePageIndex;
    let minDistance = Infinity;

    pages.forEach((page, index) => {
      const el = pageContainerRefs.current[page.id];
      if (el) {
        const pageRect = el.getBoundingClientRect();
        const pageCenterY = pageRect.top + pageRect.height / 2;
        const dist = Math.abs(pageCenterY - viewportCenterY);
        if (dist < minDistance) {
          minDistance = dist;
          closestIndex = index;
        }
      }
    });

    if (closestIndex !== activePageIndex) {
      setActivePageIndex(closestIndex);
      // Preserve multi-page selections when scrolling with mousewheel!
      if (selectedPageIds.length <= 1) {
        setSelectedPageIds([pages[closestIndex].id]);
      }
    }
  }, [pages, activePageIndex, setActivePageIndex, selectedPageIds, setSelectedPageIds]);

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

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <main
      ref={containerRef}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      tabIndex={0}
      className={`flex-1 overflow-auto p-6 md:p-10 flex flex-col items-center select-none outline-none ${
        isMinimal
          ? 'bg-[#ffffff] text-black'
          : isLcars
          ? 'bg-[#000000] text-amber-500'
          : 'bg-slate-950 text-slate-100'
      } ${activeTool === 'pan' || isPanning ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex flex-col items-center gap-8 pb-20">
        {pages.map((page, index) => {
          const sourceDoc = sources.find((s) => s.id === page.sourceDocId) || sources[0];
          const isCurrent = index === activePageIndex;
          const isSelected = selectedPageIds.includes(page.id);

          return (
            <div
              key={page.id}
              ref={(el) => (pageContainerRefs.current[page.id] = el)}
              onClick={(e) => {
                const isMulti = e.ctrlKey || e.metaKey;
                const isRange = e.shiftKey;
                togglePageSelection(page.id, isMulti, isRange);
              }}
              className={`relative transition-all duration-200 cursor-pointer ${
                isMinimal
                  ? isCurrent || isSelected
                    ? 'border-2 border-black shadow-md'
                    : 'border border-neutral-300 shadow-sm hover:border-black'
                  : isLcars
                  ? isCurrent || isSelected
                    ? 'border-2 border-[#ff9900] shadow-[0_0_15px_rgba(255,153,0,0.4)]'
                    : 'border border-[#333333] hover:border-[#ff9966]'
                  : isCurrent
                  ? 'ring-2 ring-sky-500/80 shadow-2xl shadow-sky-950/50 scale-[1.002]'
                  : 'shadow-xl hover:ring-1 hover:ring-slate-700'
              }`}
            >
              {/* PDF Canvas */}
              <PageCanvas page={page} sourceDoc={sourceDoc} scale={scale} />

              {/* PDF Text Selection & Copy Layer */}
              <TextLayer page={page} sourceDoc={sourceDoc} scale={scale} />

              {/* Interactive Form Fields Layer */}
              <FormLayer page={page} scale={scale} />

              {/* Annotation & Interaction Overlay */}
              <AnnotationLayer page={page} scale={scale} />
            </div>
          );
        })}
      </div>
    </main>
  );
};
