import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import {
  X,
  FileCode2,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Type,
  Code,
  Info,
  Trash2,
} from 'lucide-react';
import {
  parseStreamSegments,
  findBestMatchingBlock,
} from '../../services/contentStreamEditor';

export const StreamReplaceModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isStreamReplaceModalOpen,
    setIsStreamReplaceModalOpen,
    streamReplaceTargetText,
    setStreamReplaceTargetText,
    streamReplaceTargetPosition,
    setStreamReplaceTargetPosition,
  } = useEditor();

  const {
    activePageIndex,
    pages,
    getPageStream,
    applyPageContentStreamEdit,
    applyStreamSegmentEdit,
    removePageBlock,
  } = useDocument();

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const [activeTab, setActiveTab] = useState<'segment' | 'fullStream'>('segment');
  const [fullStreamText, setFullStreamText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{
    type: 'idle' | 'success' | 'error';
    text?: string;
  }>({ type: 'idle' });

  // Parse segments from raw stream
  const segments = useMemo(() => {
    return parseStreamSegments(fullStreamText);
  }, [fullStreamText]);

  const textBlocks = useMemo(() => {
    return segments.filter((s) => s.type === 'text');
  }, [segments]);

  // Filtered blocks for selector
  const filteredBlocks = useMemo(() => {
    if (!filterQuery.trim()) return textBlocks;
    const q = filterQuery.toLowerCase();
    return textBlocks.filter(
      (b) =>
        b.previewText.toLowerCase().includes(q) ||
        b.rawContent.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
    );
  }, [textBlocks, filterQuery]);

  // Load stream when modal opens or active page changes
  useEffect(() => {
    if (!isStreamReplaceModalOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setStatusMessage({ type: 'idle' });

    getPageStream(activePageIndex)
      .then((res) => {
        if (!isMounted) return;
        setIsLoading(false);
        if (res.error) {
          setStatusMessage({ type: 'error', text: res.error });
          return;
        }

        setFullStreamText(res.streamText);
        const parsed = parseStreamSegments(res.streamText);
        const texts = parsed.filter((s) => s.type === 'text');

        const activePage = pages[activePageIndex];
        const matchedBlock = findBestMatchingBlock(
          texts,
          streamReplaceTargetText,
          streamReplaceTargetPosition,
          activePage?.height
        );

        const initialBlock = matchedBlock || texts[0];
        if (initialBlock) {
          setSelectedBlockId(initialBlock.id);
          setEditorContent(initialBlock.rawContent);
          setActiveTab('segment');
        } else {
          setEditorContent(res.streamText);
          setActiveTab('fullStream');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setIsLoading(false);
        setStatusMessage({ type: 'error', text: err?.message || String(err) });
      });

    return () => {
      isMounted = false;
    };
  }, [isStreamReplaceModalOpen, activePageIndex, streamReplaceTargetText, streamReplaceTargetPosition, pages, getPageStream]);

  // Update editor content when selecting a different text block
  const handleSelectBlock = (blockId: string) => {
    setSelectedBlockId(blockId);
    const block = textBlocks.find((b) => b.id === blockId);
    if (block) {
      setEditorContent(block.rawContent);
      setStatusMessage({ type: 'idle' });
    }
  };

  // Switch between Selected Block and Full Stream tabs
  const handleTabChange = (tab: 'segment' | 'fullStream') => {
    setActiveTab(tab);
    setStatusMessage({ type: 'idle' });
    if (tab === 'segment') {
      const block = textBlocks.find((b) => b.id === selectedBlockId) || textBlocks[0];
      if (block) {
        setSelectedBlockId(block.id);
        setEditorContent(block.rawContent);
      }
    } else {
      setEditorContent(fullStreamText);
    }
  };

  // Save changes to PDF stream
  const handleSaveAndApply = async () => {
    if (isSaving || isLoading) return;
    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      if (activeTab === 'segment') {
        const origBlock = textBlocks.find((b) => b.id === selectedBlockId);
        if (!origBlock) {
          setStatusMessage({ type: 'error', text: 'Původní blok nebyl nalezen' });
          setIsSaving(false);
          return;
        }

        const res = await applyStreamSegmentEdit(
          origBlock.rawContent,
          editorContent,
          activePageIndex
        );

        if (res.success) {
          setStatusMessage({
            type: 'success',
            text: t.streamReplaceModal.toastSaved,
          });
          // Refresh stream text
          const refreshed = await getPageStream(activePageIndex);
          if (refreshed.streamText) {
            setFullStreamText(refreshed.streamText);
          }
          setTimeout(() => {
            handleClose();
          }, 800);
        } else {
          setStatusMessage({
            type: 'error',
            text: res.error || 'Nepodařilo se zapsat úpravu do streamu',
          });
        }
      } else {
        // Full stream update
        const res = await applyPageContentStreamEdit(editorContent, activePageIndex);
        if (res.success) {
          setStatusMessage({
            type: 'success',
            text: t.streamReplaceModal.toastSaved,
          });
          setFullStreamText(editorContent);
          setTimeout(() => {
            handleClose();
          }, 800);
        } else {
          setStatusMessage({
            type: 'error',
            text: res.error || 'Nepodařilo se zapsat úpravu do streamu',
          });
        }
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Chyba při zápisu do PDF',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete selected text block completely from stream
  const handleDeleteBlock = async () => {
    if (isSaving || isLoading) return;
    const origBlock = textBlocks.find((b) => b.id === selectedBlockId);
    if (!origBlock) return;

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await removePageBlock(origBlock, activePageIndex);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: t.removeElementsModal.toastDeleted,
        });
        setTimeout(() => {
          handleClose();
        }, 600);
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Nepodařilo se smazat blok',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || String(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setIsStreamReplaceModalOpen(false);
    setStreamReplaceTargetText('');
    setStreamReplaceTargetPosition(null);
    setStatusMessage({ type: 'idle' });
  };

  if (!isStreamReplaceModalOpen) return null;

  const currentSelectedBlock = textBlocks.find((b) => b.id === selectedBlockId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${
          isMinimal
            ? 'bg-white border-neutral-300 text-black'
            : isLcars
            ? 'bg-black border-2 border-[#ff9900] text-[#ff9900]'
            : 'bg-slate-900 border-slate-700/80 text-white shadow-sky-950/40 ring-1 ring-sky-500/20'
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
              className={`p-2 rounded-xl border ${
                isMinimal
                  ? 'bg-purple-50 border-purple-200 text-purple-700'
                  : isLcars
                  ? 'bg-[#ff9900]/20 border-[#ff9900] text-[#ffff66]'
                  : 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
              }`}
            >
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">
                  {t.streamReplaceModal.title}
                </h2>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                    isMinimal
                      ? 'bg-neutral-200 border-neutral-300 text-neutral-800'
                      : isLcars
                      ? 'bg-[#ff9900] text-black font-bold border-[#ff9900]'
                      : 'bg-slate-800 border-slate-700 text-sky-400'
                  }`}
                >
                  {t.metadataModal.fieldPagesCount.replace('{count}', '')}{' '}
                  {activePageIndex + 1} / {pages.length}
                </span>
              </div>
              <p
                className={`text-xs mt-0.5 ${
                  isMinimal
                    ? 'text-neutral-500'
                    : isLcars
                    ? 'text-[#ff9966]'
                    : 'text-slate-400'
                }`}
              >
                {t.streamReplaceModal.subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-200 text-neutral-500 hover:text-black'
                : isLcars
                ? 'hover:bg-[#222222] text-[#ff9966]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div
          className={`flex items-center justify-between px-6 py-2 border-b text-xs font-semibold ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-100/60'
              : isLcars
              ? 'border-[#333333] bg-[#0a0a0a]'
              : 'border-slate-800 bg-slate-900/60'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTabChange('segment')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                activeTab === 'segment'
                  ? isMinimal
                    ? 'bg-white border-neutral-300 text-black shadow-xs font-bold'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-bold border-[#ff9900]'
                    : 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                  : isMinimal
                  ? 'border-transparent text-neutral-600 hover:text-black'
                  : isLcars
                  ? 'border-transparent text-[#ff9966] hover:text-[#ff9900]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>{t.streamReplaceModal.tabSelectedBlock}</span>
              <span className="ml-1 opacity-70">({textBlocks.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('fullStream')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                activeTab === 'fullStream'
                  ? isMinimal
                    ? 'bg-white border-neutral-300 text-black shadow-xs font-bold'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-bold border-[#ff9900]'
                    : 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                  : isMinimal
                  ? 'border-transparent text-neutral-600 hover:text-black'
                  : isLcars
                  ? 'border-transparent text-[#ff9966] hover:text-[#ff9900]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>{t.streamReplaceModal.tabFullStream}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] opacity-75">
            <span>
              {t.streamReplaceModal.length}: {fullStreamText.length}{' '}
              {t.streamReplaceModal.streamLength}
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <p className="text-sm opacity-70">Dekomprimuji a analyzuji content stream...</p>
            </div>
          ) : (
            <>
              {/* Segment Selector & Block Properties (if in Segment tab) */}
              {activeTab === 'segment' && (
                <div className="space-y-3">
                  {textBlocks.length === 0 ? (
                    <div
                      className={`p-4 rounded-xl border flex items-center gap-3 text-sm ${
                        isMinimal
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : isLcars
                          ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                          : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                      }`}
                    >
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span>{t.streamReplaceModal.noBlocksFound}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wider opacity-80">
                          {t.streamReplaceModal.blockSelectLabel}
                        </label>
                        {textBlocks.length > 5 && (
                          <div className="relative w-48">
                            <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                            <input
                              type="text"
                              value={filterQuery}
                              onChange={(e) => setFilterQuery(e.target.value)}
                              placeholder="Filtrovat bloky..."
                              className={`w-full text-xs pl-7 pr-2 py-1 rounded-md border ${
                                isMinimal
                                  ? 'bg-white border-neutral-300 text-black'
                                  : isLcars
                                  ? 'bg-[#111111] border-[#ff9900] text-[#ff9900]'
                                  : 'bg-slate-800/80 border-slate-700 text-slate-200'
                              }`}
                            />
                          </div>
                        )}
                      </div>

                      {/* Dropdown / Select List */}
                      <select
                        value={selectedBlockId}
                        onChange={(e) => handleSelectBlock(e.target.value)}
                        className={`w-full text-xs font-mono p-2.5 rounded-xl border outline-hidden transition-all ${
                          isMinimal
                            ? 'bg-white border-neutral-300 text-black shadow-xs'
                            : isLcars
                            ? 'bg-[#111111] border-[#ff9900] text-[#ff9900]'
                            : 'bg-slate-950 border-slate-700 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                        }`}
                      >
                        {filteredBlocks.map((b) => (
                          <option key={b.id} value={b.id}>
                            [{b.id}] &quot;{b.previewText.substring(0, 65)}
                            {b.previewText.length > 65 ? '...' : ''}&quot;
                            {b.fontInfo ? ` (${b.fontInfo})` : ''}
                          </option>
                        ))}
                      </select>

                      {/* Current Block Badges */}
                      {currentSelectedBlock && (
                        <div
                          className={`flex flex-wrap items-center gap-2 p-2.5 rounded-xl border text-xs ${
                            isMinimal
                              ? 'bg-neutral-50 border-neutral-200 text-neutral-700'
                              : isLcars
                              ? 'bg-[#111111] border-[#333333] text-[#ff9966]'
                              : 'bg-slate-950/60 border-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="font-semibold text-sky-400">
                            {t.streamReplaceModal.blockPreview}:
                          </span>
                          <span className="italic font-medium truncate max-w-md">
                            &quot;{currentSelectedBlock.previewText}&quot;
                          </span>
                          {currentSelectedBlock.fontInfo && (
                            <span
                              className={`ml-auto px-2 py-0.5 rounded-md text-[11px] border font-mono ${
                                isMinimal
                                  ? 'bg-white border-neutral-200'
                                  : isLcars
                                  ? 'bg-black border-[#ff9900] text-[#ffff66]'
                                  : 'bg-slate-800 border-slate-700 text-indigo-300'
                              }`}
                            >
                              {t.streamReplaceModal.font}: {currentSelectedBlock.fontInfo}
                            </span>
                          )}
                          {currentSelectedBlock.positionInfo && (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] border font-mono ${
                                isMinimal
                                  ? 'bg-white border-neutral-200'
                                  : isLcars
                                  ? 'bg-black border-[#ff9900] text-[#ffff66]'
                                  : 'bg-slate-800 border-slate-700 text-emerald-300'
                              }`}
                            >
                              {t.streamReplaceModal.position}: {currentSelectedBlock.positionInfo}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Code Editor Container */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider opacity-80 flex items-center gap-1.5">
                    <Code className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t.streamReplaceModal.streamEditorLabel}</span>
                  </label>
                  <span className="text-[11px] opacity-60">
                    {editorContent.length} {t.streamReplaceModal.streamLength}
                  </span>
                </div>

                <div
                  className={`rounded-xl border overflow-hidden transition-all ${
                    isMinimal
                      ? 'border-neutral-300 bg-neutral-900 text-neutral-100'
                      : isLcars
                      ? 'border-[#ff9900] bg-black text-[#ff9900]'
                      : 'border-slate-700/80 bg-slate-950 text-slate-100 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500'
                  }`}
                >
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    rows={activeTab === 'segment' ? 12 : 16}
                    spellCheck={false}
                    className="w-full p-4 font-mono text-xs leading-relaxed bg-transparent resize-y outline-hidden scrollbar-thin scrollbar-thumb-slate-700"
                    placeholder="BT ... ET"
                  />
                </div>
              </div>

              {/* PDF Content Stream Syntax Tips */}
              <div
                className={`p-3 rounded-xl border text-xs space-y-1 ${
                  isMinimal
                    ? 'bg-neutral-50 border-neutral-200 text-neutral-700'
                    : isLcars
                    ? 'bg-[#111111] border-[#333333] text-[#ff9966]'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  <span>Struktura PDF Content Streamu (operátory):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pt-1 font-mono text-[11px]">
                  <div><span className="text-indigo-400 font-bold">(Text) Tj</span> — zobrazení textového řetězce</div>
                  <div><span className="text-indigo-400 font-bold">[(T) 10 (ext)] TJ</span> — text s mezerami/kerningem</div>
                  <div><span className="text-emerald-400 font-bold">x y Td</span> — posun na souřadnice X, Y</div>
                  <div><span className="text-amber-400 font-bold">/FontName Size Tf</span> — výběr fontu a velikosti</div>
                </div>
              </div>

              {/* Status & Feedback Message */}
              {statusMessage.type !== 'idle' && (
                <div
                  className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs font-medium ${
                    statusMessage.type === 'success'
                      ? isMinimal
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : isLcars
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-300'
                        : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : isMinimal
                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : isLcars
                      ? 'bg-rose-950/50 border-rose-500 text-rose-300'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
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
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-t ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900] bg-[#111111]'
              : 'border-slate-800 bg-slate-950/80'
          }`}
        >
          <div className="flex items-center gap-1 text-xs opacity-60">
            <Info className="w-3.5 h-3.5" />
            <span>Ctrl + Z po uložení vrátí původní stav</span>
          </div>

          <div className="flex items-center gap-3">
            {activeTab === 'segment' && selectedBlockId && (
              <button
                type="button"
                onClick={handleDeleteBlock}
                disabled={isSaving || isLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition-all border border-rose-500/40 disabled:opacity-50"
                title={t.streamReplaceModal.deleteBlockButton}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.streamReplaceModal.deleteBlockButton}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClose}
              className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all ${
                isMinimal
                  ? 'bg-white hover:bg-neutral-100 border-neutral-300 text-neutral-700'
                  : isLcars
                  ? 'bg-black hover:bg-[#222222] border-[#ff9966] text-[#ff9966]'
                  : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
              }`}
            >
              {t.streamReplaceModal.cancel}
            </button>

            <button
              type="button"
              onClick={handleSaveAndApply}
              disabled={isSaving || isLoading || !editorContent.trim()}
              className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl border shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isMinimal
                  ? 'bg-black hover:bg-neutral-800 text-white border-black shadow-neutral-400/20'
                  : isLcars
                  ? 'bg-[#ff9900] hover:bg-[#ffaa00] text-black border-[#ff9900] font-black uppercase shadow-[0_0_15px_rgba(255,153,0,0.5)]'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500/80 shadow-indigo-600/30'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.streamReplaceModal.saving}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t.streamReplaceModal.saveAndApply}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
