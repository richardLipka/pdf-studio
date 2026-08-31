import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { renderPdfPageToCanvas } from '../../services/pdfLoader';
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
  const thumbnailRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const renderedThumbnailsRef = useRef<{ [key: string]: string }>({});

  // Auto-scroll active thumbnail into view in sidebar
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
    pages.forEach((page) => {
      const canvas = canvasRefs.current[page.id];
      if (!canvas) return;

      const pageRenderKey = `${page.id}_${page.rotation}_${page.sourceType}_${page.imageDataUrl ? page.imageDataUrl.length : ''}`;
      if (renderedThumbnailsRef.current[page.id] === pageRenderKey) {
        return; // Already rendered this exact page state
      }

      const sourceDoc = sources.find((s) => s.id === page.sourceDocId) || sources[0];
      if (!sourceDoc && page.sourceType === 'pdf') return;

      renderPdfPageToCanvas(sourceDoc, page, canvas, 0.22)
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
      handleDeleteSinglePage(selectedPageIds[0]);
    } else if (selectedPageIds.length > 1) {
      setDeleteMode('multiple');
      setIsDeleteConfirmModalOpen(true);
    }
  };

  const isMultipleSelected = selectedPageIds.length > 1;

  return (
    <aside className="w-64 bg-slate-900/95 border-r border-slate-800 flex flex-col h-full select-none">
      {/* Sidebar Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t.sidebar.pagesList}
          </span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-sky-400 border border-slate-700">
            {pages.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={selectAllPages}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-400 text-[11px] font-medium flex items-center gap-1"
            title={t.sidebar.selectAll}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsAddPageModalOpen(true)}
            className="p-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            title={t.tools.addPage}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Multi-Select Action Bar (appears when >= 1 page selected) */}
      {isMultipleSelected && (
        <div className="bg-sky-950/80 border-b border-sky-800/80 px-3 py-2 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between text-xs text-sky-300 font-semibold">
            <span>
              {t.sidebar.selectedCount.replace('{count}', String(selectedPageIds.length))}
            </span>
            <button
              onClick={clearPageSelection}
              className="p-0.5 rounded hover:bg-sky-900 text-sky-400 hover:text-white"
              title={t.sidebar.clearSelection}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              onClick={() => rotateSelectedPages(-90)}
              className="flex-1 py-1 px-1.5 rounded-lg bg-sky-900 hover:bg-sky-800 text-sky-200 text-[11px] font-medium flex items-center justify-center gap-1 border border-sky-700/60"
              title={t.sidebar.rotateLeft}
            >
              <RotateCcw className="w-3 h-3" />
              <span>-90°</span>
            </button>

            <button
              onClick={() => rotateSelectedPages(90)}
              className="flex-1 py-1 px-1.5 rounded-lg bg-sky-900 hover:bg-sky-800 text-sky-200 text-[11px] font-medium flex items-center justify-center gap-1 border border-sky-700/60"
              title={t.sidebar.rotateRight}
            >
              <RotateCw className="w-3 h-3" />
              <span>+90°</span>
            </button>

            <button
              onClick={handleDeleteSelectedBatch}
              className="py-1 px-2 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-[11px] font-medium flex items-center justify-center gap-1 border border-rose-700/60"
              title={t.sidebar.deleteSelected}
            >
              <Trash2 className="w-3 h-3" />
              <span>({selectedPageIds.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Thumbnails Scrollable List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
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
              className={`group relative rounded-xl p-2.5 transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-sky-950/60 border-sky-400 ring-2 ring-sky-500/80 shadow-lg shadow-sky-900/30'
                  : isActive
                  ? 'bg-slate-800/80 border-slate-600 ring-1 ring-slate-500'
                  : 'bg-slate-800/40 hover:bg-slate-800 border-slate-700/60'
              } ${isDragging ? 'opacity-40 scale-95' : ''} ${
                isOver ? 'border-t-2 border-t-sky-400' : ''
              }`}
            >
              {/* Header: Checkbox, Page Number, Drag Handle, Quick Up/Down */}
              <div className="flex items-center justify-between mb-2 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePageSelection(page.id, true, e.shiftKey);
                    }}
                    className="p-0.5 rounded text-slate-400 hover:text-sky-400"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                    )}
                  </button>

                  <GripVertical className="w-3 h-3 text-slate-500 opacity-40 group-hover:opacity-100 cursor-grab" />
                  <span className={`font-semibold ${isSelected ? 'text-sky-300' : 'text-slate-300'}`}>
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
                    className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-20"
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
                    className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-20"
                    title={t.sidebar.moveDown}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Canvas Thumbnail Preview (Unobstructed & Clean) */}
              <div className="relative flex items-center justify-center bg-white/5 rounded-lg overflow-hidden border border-slate-700/50 p-1 min-h-[140px]">
                <canvas
                  ref={(el) => (canvasRefs.current[page.id] = el)}
                  className="rounded shadow-sm max-w-full max-h-[150px] object-contain block"
                />
              </div>

              {/* Bottom Card Toolbar: Dedicated buttons for rotate and delete */}
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/60">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      rotatePageById(page.id, -90);
                    }}
                    className="p-1 rounded-md hover:bg-slate-700 text-slate-400 hover:text-sky-300 transition-colors"
                    title={t.sidebar.rotateLeft}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      rotatePageById(page.id, 90);
                    }}
                    className="p-1 rounded-md hover:bg-slate-700 text-slate-400 hover:text-sky-300 transition-colors"
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
                    className="p-1 rounded-md hover:bg-rose-950/80 text-slate-500 hover:text-rose-400 transition-colors"
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
