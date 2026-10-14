import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { renderPdfPageToCanvas } from '../../services/pdfLoader';
import { renderQueue, RenderPriority } from '../../services/renderQueue';
import {
  RotateCcw,
  RotateCw,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  CheckSquare,
  Square,
  Layers,
  X,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Bookmark,
  Loader2,
} from 'lucide-react';
import { PdfOutlineItem } from '../../types/document';
import { resolveOutlineTarget } from '../../utils/outlineTargets';
import { usePageZones, useCanvasPixelRatio } from '../../hooks/usePageZones';

interface OutlineNodeProps {
  item: PdfOutlineItem;
  level: number;
  activePageIndex: number;
  /** Index of the outline target in the edited document (-1 when the page was deleted) */
  resolvePage: (sourcePageIndex: number | null) => number;
  onSelect: (pageIndex: number) => void;
  theme: string;
  untitledLabel: string;
}

const OutlineNode: React.FC<OutlineNodeProps> = ({ item, level, activePageIndex, resolvePage, onSelect, theme, untitledLabel }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const hasChildren = Boolean(item.items && item.items.length > 0);
  const targetIndex = resolvePage(item.pageIndex);
  const isSelected = targetIndex >= 0 && targetIndex === activePageIndex;
  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <div className="flex flex-col select-none text-xs">
      <div
        className={`group flex items-center py-1.5 px-2 rounded cursor-pointer transition-colors ${
          isSelected
            ? isMinimal
              ? 'bg-neutral-200 font-semibold text-black'
              : isLcars
              ? 'bg-[#222222] font-semibold text-[#ffcc00] border-l-2 border-[#ff9900]'
              : 'bg-sky-950/80 font-semibold text-sky-300 border-l-2 border-sky-500'
            : isMinimal
            ? 'hover:bg-neutral-100 text-neutral-700'
            : isLcars
            ? 'hover:bg-[#111111] text-[#99ccff]'
            : 'hover:bg-slate-800/70 text-slate-300'
        }`}
        style={{ paddingLeft: `${Math.max(8, level * 14 + 6)}px` }}
        onClick={() => {
          if (targetIndex >= 0) {
            onSelect(targetIndex);
          } else if (hasChildren) {
            setIsExpanded((prev) => !prev);
          }
        }}
        title={item.title}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="mr-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-inherit"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            )}
          </button>
        ) : (
          <span className="w-3.5 mr-1" />
        )}

        <span
          className={`flex-1 truncate ${item.bold ? 'font-bold' : ''} ${item.italic ? 'italic' : ''}`}
        >
          {item.title || untitledLabel}
        </span>

        {targetIndex >= 0 && (
          <span
            className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono opacity-70 flex-shrink-0 ${
              isMinimal ? 'bg-neutral-100' : isLcars ? 'bg-black text-[#ff9900]' : 'bg-slate-800'
            }`}
          >
            {targetIndex + 1}
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="flex flex-col">
          {item.items.map((child) => (
            <OutlineNode
              key={child.id}
              item={child}
              level={level + 1}
              activePageIndex={activePageIndex}
              resolvePage={resolvePage}
              onSelect={onSelect}
              theme={theme}
              untitledLabel={untitledLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    pages,
    sources,
    activePageIndex,
    setActivePageIndex,
    selectedPageIds,
    setSelectedPageIds,
    togglePageSelection,
    selectAllPages,
    clearPageSelection,
    rotatePageById,
    rotateSelectedPages,
    reorderPagesByIndex,
    outlines,
    isLoadingOutlines,
    sidebarTab,
    setSidebarTab,
    isSidebarOpen,
    toggleSidebar,
  } = useDocument();

  const {
    setIsAddPageModalOpen,
    setIsDeleteConfirmModalOpen,
    setDeleteTargetPageId,
    setDeleteMode,
  } = useEditor();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Thumbnails are small JPEG images rendered on demand: a <canvas> per page costs Chromium about
  // 1 MB each, which made the page list the largest memory user of long documents. The images
  // survive collapsing the sidebar and switching tabs, so nothing has to be rendered again.
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  // Page state last requested per page and the object URL shown for it
  const thumbnailStateRef = useRef(new Map<string, { key: string; url?: string }>());
  const thumbnailRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Thumbnails are rendered when they scroll into (or near) the visible part of the list
  const thumbListRef = useRef<HTMLDivElement>(null);
  const showsThumbnails = isSidebarOpen && sidebarTab === 'thumbnails';
  const { zoneOf: thumbZoneOf } = usePageZones(thumbListRef, showsThumbnails ? pages.map((p) => p.id) : []);
  const thumbPixelRatio = useCanvasPixelRatio();
  // Height of a page card, measured from rendered cards; cards far from the visible part of the
  // list are empty boxes of this height (a full card per page made long documents slow)
  const cardHeightRef = useRef<number>(262);

  // Scroll active thumbnail into view when active page changes
  useEffect(() => {
    const activePage = pages[activePageIndex];
    if (activePage) {
      const el = thumbnailRefs.current[activePage.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activePageIndex, pages]);

  // Render thumbnails of the pages scrolled near the visible part of the list
  useEffect(() => {
    if (!showsThumbnails) return;
    pages.forEach((page, index) => {
      if (thumbZoneOf(page.id) === 'far') return;
      const sourceDoc = sources.find((s) => s.id === page.sourceDocId) || sources[0];
      if (!sourceDoc && page.sourceType === 'pdf') return;

      const key = `${page.id}_${page.rotation}_${page.sourceType}_${sourceDoc?.updatedAt || 0}_${page.imageDataUrl ? page.imageDataUrl.length : ''}_${thumbPixelRatio}`;
      const state = thumbnailStateRef.current.get(page.id);
      // Compared with the last *requested* state: after rotate + undo the page is back at the state
      // rendered first, but the rotated render queued in between must not stay on screen
      if (state?.key === key) return;
      thumbnailStateRef.current.set(page.id, { key, url: state?.url });

      const isNearActive = Math.abs(index - activePageIndex) <= 2;
      renderQueue
        .enqueue(`thumb_${key}`, isNearActive ? RenderPriority.BACKGROUND : RenderPriority.THUMBNAIL, async () => {
          const canvas = document.createElement('canvas');
          try {
            await renderPdfPageToCanvas(sourceDoc, page, canvas, 0.22, thumbPixelRatio);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            const current = thumbnailStateRef.current.get(page.id);
            if (!blob || current?.key !== key) return; // superseded or page removed
            const url = URL.createObjectURL(blob);
            if (current.url) URL.revokeObjectURL(current.url);
            thumbnailStateRef.current.set(page.id, { key, url });
            setThumbnailUrls((prev) => ({ ...prev, [page.id]: url }));
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        })
        .catch((err) => {
          // Let the next effect run try again
          const current = thumbnailStateRef.current.get(page.id);
          if (current?.key === key) thumbnailStateRef.current.set(page.id, { key: '', url: current.url });
          console.error('Thumbnail render error:', err);
        });
    });
  }, [pages, sources, activePageIndex, showsThumbnails, thumbZoneOf, thumbPixelRatio]);

  // Images of removed pages (and of a closed document) are released
  useEffect(() => {
    const ids = new Set(pages.map((p) => p.id));
    let removed = false;
    for (const [id, state] of thumbnailStateRef.current) {
      if (ids.has(id)) continue;
      if (state.url) URL.revokeObjectURL(state.url);
      thumbnailStateRef.current.delete(id);
      removed = true;
    }
    if (removed) setThumbnailUrls((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
  }, [pages]);

  useEffect(() => {
    const states = thumbnailStateRef.current;
    return () => {
      for (const state of states.values()) if (state.url) URL.revokeObjectURL(state.url);
      states.clear();
    };
  }, []);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      reorderPagesByIndex(draggedIndex, targetIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDeleteSinglePage = (pageId: string) => {
    setDeleteTargetPageId(pageId);
    setDeleteMode('single');
    setIsDeleteConfirmModalOpen(true);
  };

  const handleDeleteSelectedBatch = () => {
    if (selectedPageIds.length === 1) {
      setDeleteTargetPageId(selectedPageIds[0]);
      setDeleteMode('single');
      setIsDeleteConfirmModalOpen(true);
    } else if (selectedPageIds.length > 1) {
      setDeleteMode('multiple');
      setIsDeleteConfirmModalOpen(true);
    }
  };

  const isMultipleSelected = selectedPageIds.length > 1;

  // Outline destinations are pages of the opened file; pages may since have been moved, deleted or
  // had pages inserted before them
  const resolveOutlinePage = (sourcePageIndex: number | null) =>
    resolveOutlineTarget(pages, sources[0]?.id, sourcePageIndex);

  if (!isSidebarOpen) {
    return (
      <aside
        className={`w-12 border-r flex flex-col items-center py-2 z-10 select-none transition-colors ${
          isMinimal
            ? 'bg-white border-neutral-200 text-black'
            : isLcars
            ? 'bg-black border-[#cc99cc] text-[#ff9900]'
            : 'bg-slate-900/95 border-slate-800 text-slate-300'
        }`}
      >
        <button
          onClick={toggleSidebar}
          className={`p-2 rounded-lg transition-colors mb-3 ${
            isMinimal
              ? 'hover:bg-neutral-100 text-black'
              : isLcars
              ? 'hover:bg-[#222222] text-[#ff9900]'
              : 'hover:bg-slate-800 text-slate-300 hover:text-sky-400'
          }`}
          title={t.sidebar.toggleSidebar}
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>

        <div className="flex flex-col gap-2 items-center w-full px-1">
          <button
            onClick={() => {
              setSidebarTab('thumbnails');
              toggleSidebar();
            }}
            className={`p-2 rounded-lg relative transition-colors ${
              sidebarTab === 'thumbnails'
                ? isMinimal
                  ? 'bg-black text-white'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-600 text-white'
                : isMinimal
                ? 'hover:bg-neutral-100 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#111111] text-[#99ccff]'
                : 'hover:bg-slate-800 text-slate-400'
            }`}
            title={`${t.sidebar.thumbnailsTab} (${pages.length})`}
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setSidebarTab('outlines');
              toggleSidebar();
            }}
            className={`p-2 rounded-lg relative transition-colors ${
              sidebarTab === 'outlines'
                ? isMinimal
                  ? 'bg-black text-white'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-600 text-white'
                : isMinimal
                ? 'hover:bg-neutral-100 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#111111] text-[#99ccff]'
                : 'hover:bg-slate-800 text-slate-400'
            }`}
            title={`${t.sidebar.outlinesTab} (${outlines.length})`}
          >
            <ListTree className="w-4 h-4" />
            {outlines.length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-sky-400" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`w-64 border-r flex flex-col h-full select-none transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-black'
          : isLcars
          ? 'bg-black border-[#cc99cc] text-[#ff9900]'
          : 'bg-slate-900/95 border-slate-800 text-white'
      }`}
    >
      {/* Top Tab Bar: Pages vs Outlines + Collapse Button */}
      <div
        className={`p-2 border-b flex items-center justify-between gap-1.5 ${
          isMinimal
            ? 'border-neutral-200 bg-neutral-50'
            : isLcars
            ? 'border-[#333333] bg-[#0a0a0a]'
            : 'border-slate-800 bg-slate-950/50'
        }`}
      >
        <div
          className={`flex items-center gap-1 p-0.5 rounded-lg flex-1 min-w-0 text-xs ${
            isMinimal
              ? 'bg-neutral-200/70'
              : isLcars
              ? 'bg-[#1a1a1a]'
              : 'bg-slate-800/80'
          }`}
        >
          <button
            onClick={() => setSidebarTab('thumbnails')}
            className={`flex-1 min-w-0 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 font-medium whitespace-nowrap transition-all ${
              sidebarTab === 'thumbnails'
                ? isMinimal
                  ? 'bg-white text-black shadow-sm'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-600 text-white shadow'
                : isMinimal
                ? 'text-neutral-600 hover:text-black'
                : isLcars
                ? 'text-[#99ccff] hover:text-[#ff9900]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={`${t.sidebar.thumbnailsTab} (${pages.length})`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.sidebar.thumbnailsTab}</span>
            <span
              className={`shrink-0 min-w-[1.25rem] px-1 rounded-full text-[10px] font-mono leading-4 ${
                isMinimal ? 'bg-black/10' : isLcars ? 'bg-black/30' : 'bg-black/25'
              }`}
            >
              {pages.length}
            </span>
          </button>

          <button
            onClick={() => setSidebarTab('outlines')}
            className={`flex-1 min-w-0 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 font-medium whitespace-nowrap transition-all ${
              sidebarTab === 'outlines'
                ? isMinimal
                  ? 'bg-white text-black shadow-sm'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-600 text-white shadow'
                : isMinimal
                ? 'text-neutral-600 hover:text-black'
                : isLcars
                ? 'text-[#99ccff] hover:text-[#ff9900]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={outlines.length > 0 ? `${t.sidebar.outlinesTab} (${outlines.length})` : t.sidebar.outlinesTab}
          >
            <ListTree className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.sidebar.outlinesTabShort}</span>
            {outlines.length > 0 && (
              <span
              className={`shrink-0 min-w-[1.25rem] px-1 rounded-full text-[10px] font-mono leading-4 ${
                isMinimal ? 'bg-black/10' : isLcars ? 'bg-black/30' : 'bg-black/25'
              }`}
            >
                {outlines.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={toggleSidebar}
          className={`shrink-0 p-1.5 rounded-md transition-colors ${
            isMinimal
              ? 'hover:bg-neutral-200 text-neutral-600 hover:text-black'
              : isLcars
              ? 'hover:bg-[#222222] text-[#ff9900]'
              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={t.sidebar.toggleSidebar}
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {sidebarTab === 'thumbnails' ? (
        <>
          {/* Sidebar Header (Thumbnails mode) */}
          <div
            className={`p-3 border-b flex items-center justify-between ${
              isMinimal
                ? 'border-neutral-200 bg-white'
                : isLcars
                ? 'border-[#333333] bg-black'
                : 'border-slate-800'
            }`}
          >
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${
              isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
            }`}
          >
            {t.sidebar.pagesList}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              isMinimal
                ? 'bg-neutral-100 text-black border border-neutral-300'
                : isLcars
                ? 'bg-black text-[#ff9900] border border-[#ff9900]'
                : 'bg-slate-800 text-sky-400 border border-slate-700'
            }`}
          >
            {pages.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={selectAllPages}
            className={`p-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-600 hover:text-black'
                : isLcars
                ? 'hover:bg-[#111111] text-[#99ccff] hover:text-[#ff9900]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-sky-400'
            }`}
            title={t.sidebar.selectAll}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsAddPageModalOpen(true)}
            className={`p-1 transition-colors ${
              isMinimal
                ? 'rounded-md bg-black hover:bg-neutral-800 text-white'
                : isLcars
                ? 'rounded-full bg-[#ff9900] hover:bg-[#ffcc00] text-black'
                : 'rounded-md bg-sky-600 hover:bg-sky-500 text-white'
            }`}
            title={t.tools.addPage}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Multi-Select Action Bar (appears when >= 1 page selected) */}
      {isMultipleSelected && (
        <div
          className={`border-b px-3 py-2 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150 ${
            isMinimal
              ? 'bg-neutral-100 border-neutral-200'
              : isLcars
              ? 'bg-[#111111] border-[#ff9900]'
              : 'bg-sky-950/80 border-sky-800/80'
          }`}
        >
          <div
            className={`flex items-center justify-between text-xs font-semibold ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-sky-300'
            }`}
          >
            <span>
              {t.sidebar.selectedCount.replace('{count}', String(selectedPageIds.length))}
            </span>
            <button
              onClick={clearPageSelection}
              className={`p-0.5 rounded ${
                isMinimal
                  ? 'hover:bg-neutral-200 text-neutral-600 hover:text-black'
                  : isLcars
                  ? 'hover:bg-black text-[#ff9900]'
                  : 'hover:bg-sky-900 text-sky-400 hover:text-white'
              }`}
              title={t.sidebar.clearSelection}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              onClick={() => rotateSelectedPages(-90)}
              className={`flex-1 py-1 px-1.5 text-[11px] font-medium flex items-center justify-center gap-1 border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-white hover:bg-neutral-50 text-black border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-black hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
                  : 'rounded-lg bg-sky-900 hover:bg-sky-800 text-sky-200 border-sky-700/60'
              }`}
              title={t.sidebar.rotateLeft}
            >
              <RotateCcw className="w-3 h-3" />
              <span>-90°</span>
            </button>

            <button
              onClick={() => rotateSelectedPages(90)}
              className={`flex-1 py-1 px-1.5 text-[11px] font-medium flex items-center justify-center gap-1 border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-white hover:bg-neutral-50 text-black border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-black hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
                  : 'rounded-lg bg-sky-900 hover:bg-sky-800 text-sky-200 border-sky-700/60'
              }`}
              title={t.sidebar.rotateRight}
            >
              <RotateCw className="w-3 h-3" />
              <span>+90°</span>
            </button>

            <button
              onClick={handleDeleteSelectedBatch}
              className={`py-1 px-2 text-[11px] font-medium flex items-center justify-center gap-1 border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
                  : isLcars
                  ? 'rounded-full bg-[#cc3333] hover:bg-[#ff3333] text-white border-[#cc3333]'
                  : 'rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-200 border-rose-700/60'
              }`}
              title={t.sidebar.deleteSelected}
            >
              <Trash2 className="w-3 h-3" />
              <span>({selectedPageIds.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Thumbnails Scrollable List */}
      <div
        ref={thumbListRef}
        className={`flex-1 overflow-y-auto p-3 space-y-3 ${
          isMinimal ? 'bg-white' : ''
        }`}
      >
        {pages.map((page, index) => {
          const isActive = index === activePageIndex;
          const isSelected = selectedPageIds.includes(page.id);
          const isDragging = draggedIndex === index;
          const isOver = dragOverIndex === index;

          if (thumbZoneOf(page.id) === 'far') {
            return (
              <div
                key={page.id}
                data-page-id={page.id}
                ref={(el) => (thumbnailRefs.current[page.id] = el)}
                style={{ height: cardHeightRef.current }}
                aria-hidden
              />
            );
          }

          return (
            <div
              key={page.id}
              data-page-id={page.id}
              ref={(el) => {
                thumbnailRefs.current[page.id] = el;
                if (el && el.offsetHeight > 0) cardHeightRef.current = el.offsetHeight;
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={(e) => {
                const isMulti = e.ctrlKey || e.metaKey;
                const isRange = e.shiftKey;
                togglePageSelection(page.id, isMulti, isRange);
              }}
              className={`group relative p-2.5 transition-all cursor-pointer border ${
                isMinimal
                  ? isSelected || isActive
                    ? 'rounded-lg bg-neutral-50 border-2 border-black shadow-sm'
                    : 'rounded-lg bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-400'
                  : isLcars
                  ? isSelected || isActive
                    ? 'rounded-2xl bg-[#111111] border-2 border-[#ff9900] shadow-[0_0_10px_rgba(255,153,0,0.3)]'
                    : 'rounded-2xl bg-black hover:bg-[#0a0a0a] border border-[#333333]'
                  : isSelected
                  ? 'rounded-xl bg-sky-950/60 border-sky-400 ring-2 ring-sky-500/80 shadow-lg shadow-sky-900/30'
                  : isActive
                  ? 'rounded-xl bg-slate-800/80 border-slate-600 ring-1 ring-slate-500'
                  : 'rounded-xl bg-slate-800/40 hover:bg-slate-800 border-slate-700/60'
              } ${isDragging ? 'opacity-40 scale-95' : ''} ${
                isOver
                  ? isMinimal
                    ? 'border-t-2 border-t-black'
                    : 'border-t-2 border-t-sky-400'
                  : ''
              }`}
            >
              {/* Header: Checkbox, Page Number, Drag Handle, Quick Up/Down */}
              <div
                className={`flex items-center justify-between mb-2 text-[11px] ${
                  isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePageSelection(page.id, true, e.shiftKey);
                    }}
                    className={`p-0.5 rounded ${
                      isMinimal
                        ? 'text-black hover:text-neutral-600'
                        : isLcars
                        ? 'text-[#ff9900]'
                        : 'text-slate-400 hover:text-sky-400'
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare
                        className={`w-3.5 h-3.5 ${
                          isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-sky-400'
                        }`}
                      />
                    ) : (
                      <Square
                        className={`w-3.5 h-3.5 ${
                          isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#555555]' : 'text-slate-500'
                        }`}
                      />
                    )}
                  </button>

                  <GripVertical
                    className={`w-3 h-3 opacity-40 group-hover:opacity-100 cursor-grab ${
                      isMinimal ? 'text-black' : 'text-slate-500'
                    }`}
                  />
                  <span
                    className={`font-semibold ${
                      isMinimal
                        ? 'text-black'
                        : isSelected
                        ? 'text-sky-300'
                        : isLcars
                        ? 'text-[#ff9900]'
                        : 'text-slate-300'
                    }`}
                  >
                    {t.sidebar.pageNumber} {index + 1}
                  </span>
                </div>

                {/* Quick Move Up/Down */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderPagesByIndex(index, index - 1);
                    }}
                    className={`p-0.5 rounded disabled:opacity-20 ${
                      isMinimal
                        ? 'hover:bg-neutral-200 text-black'
                        : isLcars
                        ? 'hover:bg-[#222222] text-[#ff9900]'
                        : 'hover:bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                    title={t.sidebar.moveUp}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    disabled={index === pages.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderPagesByIndex(index, index + 1);
                    }}
                    className={`p-0.5 rounded disabled:opacity-20 ${
                      isMinimal
                        ? 'hover:bg-neutral-200 text-black'
                        : isLcars
                        ? 'hover:bg-[#222222] text-[#ff9900]'
                        : 'hover:bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                    title={t.sidebar.moveDown}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Canvas Thumbnail Preview (Unobstructed & Clean) */}
              <div
                className={`relative flex items-center justify-center overflow-hidden p-1 min-h-[140px] border ${
                  isMinimal
                    ? 'bg-neutral-50 rounded-md border-neutral-200'
                    : isLcars
                    ? 'bg-[#050505] rounded-xl border-[#333333]'
                    : 'bg-white/5 rounded-lg border-slate-700/50'
                }`}
              >
                {thumbnailUrls[page.id] ? (
                  <img
                    src={thumbnailUrls[page.id]}
                    alt=""
                    draggable={false}
                    data-page-thumbnail={page.id}
                    className="rounded shadow-sm max-w-full max-h-[150px] object-contain block"
                  />
                ) : (
                  <div
                    className="rounded bg-white/90 max-w-full max-h-[130px] animate-pulse"
                    style={{ aspectRatio: `${page.rotation % 180 === 0 ? page.width : page.height} / ${page.rotation % 180 === 0 ? page.height : page.width}`, height: 130 }}
                  />
                )}
              </div>

              {/* Bottom Card Toolbar: Dedicated buttons for rotate and delete */}
              <div
                className={`flex items-center justify-between mt-2 pt-1.5 border-t ${
                  isMinimal
                    ? 'border-neutral-200'
                    : isLcars
                    ? 'border-[#333333]'
                    : 'border-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      rotatePageById(page.id, -90);
                    }}
                    className={`p-1 rounded-md transition-colors ${
                      isMinimal
                        ? 'hover:bg-neutral-200 text-black'
                        : isLcars
                        ? 'hover:bg-[#222222] text-[#ff9900]'
                        : 'hover:bg-slate-700 text-slate-400 hover:text-sky-300'
                    }`}
                    title={t.sidebar.rotateLeft}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      rotatePageById(page.id, 90);
                    }}
                    className={`p-1 rounded-md transition-colors ${
                      isMinimal
                        ? 'hover:bg-neutral-200 text-black'
                        : isLcars
                        ? 'hover:bg-[#222222] text-[#ff9900]'
                        : 'hover:bg-slate-700 text-slate-400 hover:text-sky-300'
                    }`}
                    title={t.sidebar.rotateRight}
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {pages.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSinglePage(page.id);
                    }}
                    className={`p-1 rounded-md transition-colors ${
                      isMinimal
                        ? 'hover:bg-red-100 text-red-600'
                        : isLcars
                        ? 'hover:bg-[#cc3333] text-[#cc3333] hover:text-white'
                        : 'hover:bg-rose-950/80 text-slate-500 hover:text-rose-400'
                    }`}
                    title={t.sidebar.deletePage}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      ) : (
        /* Outlines Tab Content */
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div
            className={`p-3 border-b flex items-center justify-between text-xs font-semibold ${
              isMinimal
                ? 'border-neutral-200 bg-white text-neutral-700'
                : isLcars
                ? 'border-[#333333] bg-black text-[#ff9900]'
                : 'border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5" />
              <span>{t.sidebar.outlinesTab}</span>
            </div>
            {outlines.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isMinimal
                    ? 'bg-neutral-100 text-black border border-neutral-300'
                    : isLcars
                    ? 'bg-black text-[#ff9900] border border-[#ff9900]'
                    : 'bg-slate-800 text-sky-400 border border-slate-700'
                }`}
              >
                {outlines.length}
              </span>
            )}
          </div>

          {isLoadingOutlines ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-sky-400 mb-2" />
              <span className="text-xs text-slate-400">{t.sidebar.loadingOutlines}</span>
            </div>
          ) : outlines.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Bookmark
                className={`w-10 h-10 mb-2 opacity-30 ${
                  isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]' : 'text-slate-500'
                }`}
              />
              <span
                className={`text-xs font-semibold mb-1 ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
                }`}
              >
                {t.sidebar.noOutlines}
              </span>
              <p
                className={`text-[11px] leading-relaxed max-w-[200px] ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#99ccff]' : 'text-slate-400'
                }`}
              >
                {t.sidebar.noOutlinesDesc}
              </p>
            </div>
          ) : (
            <div
              className={`flex-1 overflow-y-auto p-2 space-y-0.5 ${
                isMinimal ? 'bg-white' : ''
              }`}
            >
              {outlines.map((item) => (
                <OutlineNode
                  key={item.id}
                  item={item}
                  level={0}
                  activePageIndex={activePageIndex}
                  resolvePage={resolveOutlinePage}
                  onSelect={(idx) => {
                    setActivePageIndex(idx);
                    setSelectedPageIds([pages[idx].id]);
                  }}
                  theme={theme}
                  untitledLabel={t.sidebar.untitledOutline}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
