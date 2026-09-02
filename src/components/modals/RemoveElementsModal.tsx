import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import {
  X,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Type,
  Image as ImageIcon,
  CheckSquare,
  Square,
  Undo2,
} from 'lucide-react';
import {
  parseStreamSegments,
  StreamSegment,
  PageImageInfo,
} from '../../services/contentStreamEditor';

export const RemoveElementsModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isRemoveElementsModalOpen,
    setIsRemoveElementsModalOpen,
    streamReplaceTargetText,
  } = useEditor();
  const {
    activePageIndex,
    getPageStream,
    getPageImagesList,
    removeMultiplePageElements,
  } = useDocument();

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const [activeTab, setActiveTab] = useState<'blocks' | 'images'>('blocks');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [filterQuery, setFilterQuery] = useState<string>('');

  const [segments, setSegments] = useState<StreamSegment[]>([]);
  const [images, setImages] = useState<PageImageInfo[]>([]);

  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());

  const [statusMessage, setStatusMessage] = useState<{
    type: 'idle' | 'success' | 'error';
    text?: string;
  }>({ type: 'idle' });

  // Load stream and images whenever modal opens or active page changes
  const loadPageElements = async () => {
    setIsLoading(true);
    setStatusMessage({ type: 'idle' });
    setSelectedBlockIds(new Set());
    setSelectedImageNames(new Set());

    try {
      const [streamRes, imagesRes] = await Promise.all([
        getPageStream(activePageIndex),
        getPageImagesList(activePageIndex),
      ]);

      if (streamRes.streamText) {
        const parsed = parseStreamSegments(streamRes.streamText);
        setSegments(parsed.filter((s) => s.type === 'text'));
      } else {
        setSegments([]);
      }

      if (imagesRes.images) {
        setImages(imagesRes.images);
      } else {
        setImages([]);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || String(err),
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isRemoveElementsModalOpen) {
      loadPageElements();
      if (streamReplaceTargetText) {
        setFilterQuery(streamReplaceTargetText);
        setActiveTab('blocks');
      } else {
        setFilterQuery('');
      }
    }
  }, [isRemoveElementsModalOpen, activePageIndex, streamReplaceTargetText]);

  // Filtered lists
  const filteredBlocks = useMemo(() => {
    if (!filterQuery.trim()) return segments;
    const q = filterQuery.toLowerCase();
    return segments.filter(
      (b) =>
        b.previewText.toLowerCase().includes(q) ||
        (b.fontInfo && b.fontInfo.toLowerCase().includes(q)) ||
        (b.positionInfo && b.positionInfo.toLowerCase().includes(q)) ||
        b.id.toLowerCase().includes(q)
    );
  }, [segments, filterQuery]);

  const filteredImages = useMemo(() => {
    if (!filterQuery.trim()) return images;
    const q = filterQuery.toLowerCase();
    return images.filter(
      (im) =>
        im.name.toLowerCase().includes(q) ||
        im.cleanName.toLowerCase().includes(q) ||
        (im.filter && im.filter.toLowerCase().includes(q)) ||
        (im.colorSpace && im.colorSpace.toLowerCase().includes(q))
    );
  }, [images, filterQuery]);

  // Selection toggle
  const toggleBlockSelection = (id: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleImageSelection = (name: string) => {
    setSelectedImageNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllCurrentTab = () => {
    if (activeTab === 'blocks') {
      const allIds = new Set(filteredBlocks.map((b) => b.id));
      setSelectedBlockIds(allIds);
    } else {
      const allNames = new Set(filteredImages.map((im) => im.cleanName));
      setSelectedImageNames(allNames);
    }
  };

  const deselectAllCurrentTab = () => {
    if (activeTab === 'blocks') {
      setSelectedBlockIds(new Set());
    } else {
      setSelectedImageNames(new Set());
    }
  };

  // Perform deletion
  const handleDelete = async (targetBlockIds: string[], targetImageNames: string[]) => {
    if (targetBlockIds.length === 0 && targetImageNames.length === 0) return;

    setIsDeleting(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await removeMultiplePageElements(
        targetBlockIds,
        targetImageNames,
        activePageIndex
      );

      if (res.error || !res.success) {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Chyba při odstraňování prvků',
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `${t.removeElementsModal.toastDeleted} (${res.removedCount || targetBlockIds.length + targetImageNames.length})`,
        });
        // Reload remaining elements
        await loadPageElements();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || String(err),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const totalSelectedCount = selectedBlockIds.size + selectedImageNames.size;

  if (!isRemoveElementsModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border ${
          isMinimal
            ? 'bg-white border-neutral-200 text-neutral-900'
            : isLcars
            ? 'bg-black border-2 border-[#ff9900] text-[#ff9900]'
            : 'bg-slate-900/95 border-slate-700/80 text-slate-100 backdrop-blur-xl'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900] bg-[#111111]'
              : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                isMinimal
                  ? 'bg-rose-100 text-rose-700'
                  : isLcars
                  ? 'bg-[#ff9900]/20 text-[#ff9900]'
                  : 'bg-rose-950/80 text-rose-400 border border-rose-800/40'
              }`}
            >
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {t.removeElementsModal.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                }`}
              >
                {t.removeElementsModal.subtitle} (Strana {activePageIndex + 1})
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsRemoveElementsModalOpen(false)}
            className={`p-2 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-200 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#ff9900]/20 text-[#ff9900]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher & Search filter */}
        <div
          className={`px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/50'
              : isLcars
              ? 'border-[#333333] bg-black'
              : 'border-slate-800/80 bg-slate-900/50'
          }`}
        >
          {/* Tabs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('blocks')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'blocks'
                  ? isMinimal
                    ? 'bg-black text-white shadow-xs'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-bold'
                    : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : isMinimal
                  ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
                  : isLcars
                  ? 'bg-[#111111] hover:bg-[#222222] text-[#ff9966]'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Type className="w-4 h-4" />
              <span>{t.removeElementsModal.tabBlocks}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'blocks'
                    ? 'bg-white/20 text-white'
                    : 'bg-black/20 text-slate-400'
                }`}
              >
                {segments.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('images')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'images'
                  ? isMinimal
                    ? 'bg-black text-white shadow-xs'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-bold'
                    : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : isMinimal
                  ? 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
                  : isLcars
                  ? 'bg-[#111111] hover:bg-[#222222] text-[#ff9966]'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              <span>{t.removeElementsModal.tabImages}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'images'
                    ? 'bg-white/20 text-white'
                    : 'bg-black/20 text-slate-400'
                }`}
              >
                {images.length}
              </span>
            </button>
          </div>

          {/* Search bar & Selection Helpers */}
          <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={t.removeElementsModal.searchPlaceholder}
                className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                  isMinimal
                    ? 'bg-white border-neutral-300 focus:border-black text-black'
                    : isLcars
                    ? 'bg-black border-[#ff9900] text-[#ffff66] focus:bg-[#111]'
                    : 'bg-slate-950/70 border-slate-700 focus:border-indigo-500 text-slate-100'
                }`}
              />
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={selectAllCurrentTab}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border ${
                isMinimal
                  ? 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                  : isLcars
                  ? 'border-[#ff9900] hover:bg-[#ff9900]/20 text-[#ff9900]'
                  : 'border-slate-700 hover:bg-slate-800 text-slate-300'
              }`}
              title={t.removeElementsModal.selectAll}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.removeElementsModal.selectAll}</span>
            </button>

            <button
              onClick={deselectAllCurrentTab}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border ${
                isMinimal
                  ? 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                  : isLcars
                  ? 'border-[#ff9900] hover:bg-[#ff9900]/20 text-[#ff9900]'
                  : 'border-slate-700 hover:bg-slate-800 text-slate-300'
              }`}
              title={t.removeElementsModal.deselectAll}
            >
              <Square className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.removeElementsModal.deselectAll}</span>
            </button>
          </div>
        </div>

        {/* Status banner if any */}
        {statusMessage.type !== 'idle' && (
          <div
            className={`flex items-center gap-2 px-6 py-2 text-xs font-medium border-b ${
              statusMessage.type === 'success'
                ? isMinimal
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                : isMinimal
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-rose-950/80 text-rose-300 border-rose-800/60'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 p-6 overflow-y-auto min-h-[300px] max-h-[500px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">Načítám prvky stránky...</p>
            </div>
          ) : activeTab === 'blocks' ? (
            /* TAB 1: TEXT BLOCKS */
            filteredBlocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                <Type className="w-12 h-12 mb-2 opacity-30" />
                <p className="text-sm font-medium">{t.removeElementsModal.noBlocksFound}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredBlocks.map((b) => {
                  const isChecked = selectedBlockIds.has(b.id);
                  return (
                    <div
                      key={b.id}
                      onClick={() => toggleBlockSelection(b.id)}
                      className={`flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isChecked
                          ? isMinimal
                            ? 'bg-rose-50/70 border-rose-400 shadow-sm'
                            : isLcars
                            ? 'bg-[#ff9900]/20 border-[#ff9900]'
                            : 'bg-rose-950/30 border-rose-500/60 shadow-lg shadow-rose-950/30'
                          : isMinimal
                          ? 'bg-neutral-50/70 hover:bg-neutral-100/80 border-neutral-200'
                          : isLcars
                          ? 'bg-[#111111] hover:bg-[#1a1a1a] border-[#333333]'
                          : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-750'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
                            />
                            <span
                              className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                isMinimal
                                  ? 'bg-neutral-200 text-neutral-800'
                                  : 'bg-slate-900 text-indigo-300 border border-slate-700'
                              }`}
                            >
                              {b.id}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete([b.id], []);
                            }}
                            disabled={isDeleting}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition-colors border border-rose-500/30"
                            title={t.removeElementsModal.deleteBlock}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t.removeElementsModal.deleteBlock}</span>
                          </button>
                        </div>

                        {/* Preview Text */}
                        <p
                          className={`text-xs font-medium line-clamp-3 mb-2 px-2 py-1.5 rounded ${
                            isMinimal
                              ? 'bg-white border border-neutral-200 text-neutral-900'
                              : 'bg-slate-950/60 border border-slate-800/80 text-slate-200 font-mono'
                          }`}
                        >
                          {b.previewText || '[Prázdný text]'}
                        </p>
                      </div>

                      {/* Metadata footer */}
                      <div
                        className={`flex items-center justify-between text-[10px] pt-1.5 border-t ${
                          isMinimal
                            ? 'border-neutral-200 text-neutral-500'
                            : 'border-slate-800/80 text-slate-400'
                        }`}
                      >
                        <span>{b.fontInfo || 'Písmo: Nativní'}</span>
                        <span>{b.positionInfo || `Bajtů: ${b.rawContent.length}`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* TAB 2: IMAGES */
            filteredImages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                <ImageIcon className="w-12 h-12 mb-2 opacity-30" />
                <p className="text-sm font-medium">{t.removeElementsModal.noImagesFound}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredImages.map((im) => {
                  const isChecked = selectedImageNames.has(im.cleanName);
                  return (
                    <div
                      key={im.id}
                      onClick={() => toggleImageSelection(im.cleanName)}
                      className={`flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isChecked
                          ? isMinimal
                            ? 'bg-rose-50/70 border-rose-400 shadow-sm'
                            : isLcars
                            ? 'bg-[#ff9900]/20 border-[#ff9900]'
                            : 'bg-rose-950/30 border-rose-500/60 shadow-lg shadow-rose-950/30'
                          : isMinimal
                          ? 'bg-neutral-50/70 hover:bg-neutral-100/80 border-neutral-200'
                          : isLcars
                          ? 'bg-[#111111] hover:bg-[#1a1a1a] border-[#333333]'
                          : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-750'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
                            />
                            <span
                              className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                isMinimal
                                  ? 'bg-neutral-200 text-neutral-800'
                                  : 'bg-slate-900 text-emerald-300 border border-slate-700'
                              }`}
                            >
                              {im.name}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete([], [im.cleanName]);
                            }}
                            disabled={isDeleting}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition-colors border border-rose-500/30"
                            title={t.removeElementsModal.deleteImage}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t.removeElementsModal.deleteImage}</span>
                          </button>
                        </div>

                        {/* Image details */}
                        <div
                          className={`p-2.5 rounded mb-2 flex items-center gap-3 ${
                            isMinimal
                              ? 'bg-white border border-neutral-200 text-neutral-800'
                              : 'bg-slate-950/60 border border-slate-800 text-slate-200'
                          }`}
                        >
                          <div className="p-2 rounded bg-indigo-600/10 text-indigo-400 border border-indigo-500/20">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                          <div className="flex-1 text-xs space-y-0.5">
                            <div className="font-semibold">
                              {im.pixelWidth && im.pixelHeight
                                ? `${im.pixelWidth} × ${im.pixelHeight} px`
                                : im.width && im.height
                                ? `${im.width} × ${im.height} pt`
                                : 'Rozměry: Nativní'}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {im.filter || 'Formát: Image XObject'}
                              {im.colorSpace ? ` • ${im.colorSpace}` : ''}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer info */}
                      <div
                        className={`flex items-center justify-between text-[10px] pt-1.5 border-t ${
                          isMinimal
                            ? 'border-neutral-200 text-neutral-500'
                            : 'border-slate-800/80 text-slate-400'
                        }`}
                      >
                        <span>
                          {im.x !== undefined && im.y !== undefined
                            ? `Pozice: X: ${im.x}, Y: ${im.y}`
                            : 'Pozice v kontextu'}
                        </span>
                        <span>{im.cleanName}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Footer actions */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-t ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900] bg-[#111111]'
              : 'border-slate-800 bg-slate-950/80'
          }`}
        >
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Undo2 className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="hidden sm:inline">{t.removeElementsModal.undoHint}</span>
          </div>

          <div className="flex items-center gap-3">
            {totalSelectedCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  handleDelete(
                    Array.from(selectedBlockIds),
                    Array.from(selectedImageNames)
                  )
                }
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>
                  {t.removeElementsModal.batchDeleteSelected.replace(
                    '{count}',
                    String(totalSelectedCount)
                  )}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsRemoveElementsModalOpen(false)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                isMinimal
                  ? 'border-neutral-300 hover:bg-neutral-200 text-neutral-800'
                  : isLcars
                  ? 'border-[#ff9900] hover:bg-[#ff9900]/20 text-[#ff9900]'
                  : 'border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {t.removeElementsModal.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
