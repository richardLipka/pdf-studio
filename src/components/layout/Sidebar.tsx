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
  GripVertical,
  Plus,
  CheckSquare,
  Square,
  Layers,
  X,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    pages,
    sources,
    activePageIndex,
    selectedPageIds,
    togglePageSelection,
    selectAllPages,
    clearPageSelection,
    rotatePageById,
    rotateSelectedPages,
    reorderPagesByIndex,
  } = useDocument();

  const {
    setIsAddPageModalOpen,
    setIsDeleteConfirmModalOpen,
    setDeleteTargetPageId,
    setDeleteMode,
  } = useEditor();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const canvasRefs = useRef<{ [key: string]: HTMLCanvasElement | null }>({});
  const renderedThumbnailsRef = useRef<{ [key: string]: string }>({});
  const thumbnailRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

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

  // Render thumbnails only when page identity or rotation/source changes
  useEffect(() => {
    pages.forEach((page, index) => {
      const canvas = canvasRefs.current[page.id];
      if (!canvas) return;

      const sourceDoc = sources.find((s) => s.id === page.sourceDocId) || sources[0];
      if (!sourceDoc && page.sourceType === 'pdf') return;

      const pageRenderKey = `${page.id}_${page.rotation}_${page.sourceType}_${sourceDoc?.updatedAt || 0}_${page.imageDataUrl ? page.imageDataUrl.length : ''}`;
      if (renderedThumbnailsRef.current[page.id] === pageRenderKey) {
        return; // Already rendered this exact page state
      }

      const taskId = `thumb_${page.id}_${page.rotation}_${sourceDoc?.updatedAt || 0}`;
      const isNearActive = Math.abs(index - activePageIndex) <= 2;
      const priority = isNearActive ? RenderPriority.BACKGROUND : RenderPriority.THUMBNAIL;

      renderQueue
        .enqueue(taskId, priority, async () => {
          if (!canvas) return;
          await renderPdfPageToCanvas(sourceDoc, page, canvas, 0.22);
        })
        .then(() => {
          renderedThumbnailsRef.current[page.id] = pageRenderKey;
        })
        .catch((err) => {
          console.error('Thumbnail render error:', err);
        });
    });
  }, [pages, sources]);

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
      {/* Sidebar Header */}
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
        className={`flex-1 overflow-y-auto p-3 space-y-3 ${
          isMinimal ? 'bg-white' : ''
        }`}
      >
        {pages.map((page, index) => {
          const isActive = index === activePageIndex;
          const isSelected = selectedPageIds.includes(page.id);
          const isDragging = draggedIndex === index;
          const isOver = dragOverIndex === index;

          return (
            <div
              key={page.id}
              ref={(el) => (thumbnailRefs.current[page.id] = el)}
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
                <canvas
                  ref={(el) => (canvasRefs.current[page.id] = el)}
                  className="rounded shadow-sm max-w-full max-h-[150px] object-contain block"
                />
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
    </aside>
  );
};
