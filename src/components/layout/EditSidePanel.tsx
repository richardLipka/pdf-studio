import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  FileCode2,
  Code,
  Save,
  Layers,
  ArrowRight,
  RefreshCw,
  ListTree,
  Binary,
  CornerDownRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  parseStreamSegments,
  StreamSegment,
  PageImageInfo,
  findBestMatchingBlock,
  normalizeTextForSearch,
  replaceTextInStreamString,
} from '../../services/contentStreamEditor';
import { getPageTextBlocks } from '../../services/pdfLoader';

export const EditSidePanel: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isEditSidePanelOpen,
    setIsEditSidePanelOpen,
    editSidePanelTab,
    setEditSidePanelTab,
    selectedStreamBlockId,
    setSelectedStreamBlockId,
    hoveredBlockId,
    setHoveredBlockId,
    hoveredBlockText,
    setHoveredBlockText,
    streamReplaceTargetText,
    setStreamReplaceTargetText,
    streamReplaceTargetPosition,
    setStreamReplaceTargetPosition,
    setIsRemoveElementsModalOpen,
    setIsStreamReplaceModalOpen,
  } = useEditor();

  const {
    activePageIndex,
    pages,
    sources,
    historyIndex,
    getPageStream,
    getPageImagesList,
    removeMultiplePageElements,
    applyStreamSegmentEdit,
    applyPageContentStreamEdit,
    removePageBlock,
  } = useDocument();

  const activeSourceDoc = sources.find((s) => s.id === pages[activePageIndex]?.sourceDocId);
  const sourceUpdatedAt = activeSourceDoc?.updatedAt || 0;
  const sourceByteLength = activeSourceDoc?.arrayBuffer?.byteLength || 0;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const listContainerRef = useRef<HTMLDivElement>(null);

  // Stream & Elements State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [fullStreamText, setFullStreamText] = useState<string>('');
  const [segments, setSegments] = useState<StreamSegment[]>([]);
  const [images, setImages] = useState<PageImageInfo[]>([]);

  // Search & Filters
  const [filterQuery, setFilterQuery] = useState<string>('');

  // Selection for Deletion
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());

  // Stream Editor Tab State
  const [streamEditorSubTab, setStreamEditorSubTab] = useState<'segment' | 'fullStream'>('segment');
  const [editorContent, setEditorContent] = useState<string>('');
  const [quickReplaceNewText, setQuickReplaceNewText] = useState<string>('');

  const [statusMessage, setStatusMessage] = useState<{
    type: 'idle' | 'success' | 'error';
    text?: string;
  }>({ type: 'idle' });

  // Load stream and images when panel opens or page changes
  // Load stream and images when panel opens or page changes
  const loadPageData = async (
    preferredTargetText?: string,
    preferredTargetPos?: { x: number; y: number } | null
  ) => {
    setIsLoading(true);
    setStatusMessage({ type: 'idle' });

    try {
      const [streamRes, imagesRes] = await Promise.all([
        getPageStream(activePageIndex),
        getPageImagesList(activePageIndex),
      ]);

      let textSegments: StreamSegment[] = [];
      if (streamRes.streamText) {
        setFullStreamText(streamRes.streamText);
        const parsed = parseStreamSegments(streamRes.streamText);
        textSegments = parsed.filter((s) => s.type === 'text');

        // Enrich segments with true Unicode text from visual blocks
        const activePageModel = pages[activePageIndex];
        const activeSource = activePageModel
          ? sources.find((s) => s.id === activePageModel.sourceDocId) || sources[0]
          : null;
        if (activePageModel && activeSource) {
          try {
            const visualBlocks = await getPageTextBlocks(activeSource, activePageModel);
            const blockMap = new Map(visualBlocks.map((vb) => [vb.id, vb.text]));
            textSegments.forEach((seg) => {
              const decoded = blockMap.get(seg.id);
              if (
                decoded &&
                (!seg.previewText ||
                  seg.previewText.startsWith('[Textový') ||
                  seg.previewText.startsWith('<') ||
                  seg.previewText.includes('Ð') ||
                  seg.previewText.includes('þ') ||
                  seg.previewText.includes('µ') ||
                  seg.previewText.includes('š') ||
                  seg.previewText.includes('Ž') ||
                  seg.previewText.length < decoded.length * 0.5)
              ) {
                seg.previewText = decoded;
              }
            });
          } catch {
            // ignore visual enrich failure
          }
        }

        setSegments(textSegments);
      } else {
        setFullStreamText('');
        setSegments([]);
      }

      if (imagesRes.images) {
        setImages(imagesRes.images);
      } else {
        setImages([]);
      }

      const targetText =
        preferredTargetText !== undefined ? preferredTargetText : streamReplaceTargetText;
      const targetPos =
        preferredTargetPos !== undefined ? preferredTargetPos : streamReplaceTargetPosition;

      // If opened with target block from canvas click, find best matching block
      if (targetText || targetPos) {
        const best = findBestMatchingBlock(textSegments, targetText, targetPos);
        if (best) {
          setSelectedStreamBlockId(best.id);
          setSelectedBlockIds(new Set([best.id]));
          setEditorContent(best.rawContent);
          setQuickReplaceNewText(best.previewText);

          // Smooth scroll to selected card in panel list
          setTimeout(() => {
            const el = document.getElementById(`panel_item_${best.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 150);
        }
      } else if (
        textSegments.length > 0 &&
        (!selectedStreamBlockId || !textSegments.some((s) => s.id === selectedStreamBlockId))
      ) {
        setSelectedStreamBlockId(textSegments[0].id);
        setEditorContent(textSegments[0].rawContent);
        setQuickReplaceNewText(textSegments[0].previewText);
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

  // Sort Mode State: 'reading' (Visual top-to-bottom hierarchy) vs 'stream' (Raw stream byte order)
  const [sortMode, setSortMode] = useState<'reading' | 'stream'>('reading');

  // React to Undo / Redo, page switch, and source PDF byte buffer updates automatically
  useEffect(() => {
    if (isEditSidePanelOpen) {
      loadPageData();
    }
  }, [isEditSidePanelOpen, activePageIndex, historyIndex, sourceUpdatedAt, sourceByteLength]);

  // When selectedStreamBlockId changes, update editorContent
  useEffect(() => {
    if (selectedStreamBlockId && segments.length > 0) {
      const found = segments.find((s) => s.id === selectedStreamBlockId);
      if (found) {
        setEditorContent(found.rawContent);
        setQuickReplaceNewText(found.previewText);
      }
    }
  }, [selectedStreamBlockId, segments]);

  // Base left margin of the page to calculate precise indentation
  const minPageX = useMemo(() => {
    const validX = segments
      .filter((s) => s.type === 'text' && s.x !== undefined && s.x >= 0)
      .map((s) => s.x!);
    return validX.length > 0 ? Math.min(...validX) : 0;
  }, [segments]);

  // Filtered blocks and images
  const filteredBlocks = useMemo(() => {
    if (!filterQuery.trim()) return segments;
    const normQ = normalizeTextForSearch(filterQuery);
    const qWords = normQ.split(' ').filter((w) => w.length >= 2);

    return segments.filter((b) => {
      const normPreview = normalizeTextForSearch(b.previewText);
      const normRaw = normalizeTextForSearch(b.rawContent);
      const normFont = normalizeTextForSearch(b.fontInfo || '');
      const normId = b.id.toLowerCase();

      if (
        normPreview.includes(normQ) ||
        normRaw.includes(normQ) ||
        normFont.includes(normQ) ||
        normId.includes(normQ)
      ) {
        return true;
      }

      if (qWords.length > 0 && qWords.every((w) => normPreview.includes(w) || normRaw.includes(w))) {
        return true;
      }

      return false;
    });
  }, [segments, filterQuery]);

  // Hierarchically sorted blocks according to selected Sort Mode
  const displayedBlocks = useMemo(() => {
    if (sortMode === 'stream') {
      return filteredBlocks;
    }
    // Reading Order: Top of page to bottom (higher Y first in PDF coords), Left to Right
    return [...filteredBlocks].sort((a, b) => {
      const ay = a.y !== undefined ? a.y : -999999;
      const by = b.y !== undefined ? b.y : -999999;
      // If distinctly different vertical lines (delta > 5 pt)
      if (Math.abs(ay - by) > 5) {
        return by - ay; // Top of page first
      }
      const ax = a.x !== undefined ? a.x : 0;
      const bx = b.x !== undefined ? b.x : 0;
      return ax - bx; // Left to right
    });
  }, [filteredBlocks, sortMode]);

  const filteredImages = useMemo(() => {
    if (!filterQuery.trim()) return images;
    const normQ = normalizeTextForSearch(filterQuery);
    return images.filter((im) => {
      const normName = normalizeTextForSearch(im.name);
      const normClean = normalizeTextForSearch(im.cleanName);
      const normFilter = normalizeTextForSearch(im.filter || '');
      return normName.includes(normQ) || normClean.includes(normQ) || normFilter.includes(normQ);
    });
  }, [images, filterQuery]);

  // Selection toggles
  const toggleBlockSelection = (id: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedStreamBlockId(id);
    const found = segments.find((s) => s.id === id);
    if (found) {
      setStreamReplaceTargetText(found.previewText);
      if (found.x !== undefined && found.y !== undefined) {
        setStreamReplaceTargetPosition({ x: found.x, y: found.y });
      }
    }
  };

  const toggleImageSelection = (name: string) => {
    setSelectedImageNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedBlockIds(new Set(displayedBlocks.map((b) => b.id)));
    setSelectedImageNames(new Set(filteredImages.map((im) => im.name)));
  };

  const clearSelection = () => {
    setSelectedBlockIds(new Set());
    setSelectedImageNames(new Set());
  };

  // Close panel
  const handleClosePanel = () => {
    setIsEditSidePanelOpen(false);
    setIsRemoveElementsModalOpen(false);
    setIsStreamReplaceModalOpen(false);
  };

  // Batch Deletion
  const handleDeleteSelected = async () => {
    const totalCount = selectedBlockIds.size + selectedImageNames.size;
    if (totalCount === 0) return;

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await removeMultiplePageElements(
        Array.from(selectedBlockIds),
        Array.from(selectedImageNames),
        activePageIndex
      );

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Úspěšně odstraněno ${totalCount} prvků ze strany ${activePageIndex + 1}.`,
        });

        clearSelection();
        setStreamReplaceTargetText('');
        setStreamReplaceTargetPosition(null);

        if (res.updatedStream !== undefined) {
          setFullStreamText(res.updatedStream);
          const parsed = parseStreamSegments(res.updatedStream);
          const textSegments = parsed.filter((s) => s.type === 'text');
          setSegments(textSegments);

          if (textSegments.length > 0) {
            setSelectedStreamBlockId(textSegments[0].id);
            setEditorContent(textSegments[0].rawContent);
            setQuickReplaceNewText(textSegments[0].previewText);
          } else {
            setSelectedStreamBlockId(null);
            setEditorContent('');
            setQuickReplaceNewText('');
          }
        } else {
          await loadPageData('', null);
        }

        const imagesRes = await getPageImagesList(activePageIndex);
        if (imagesRes.images) {
          setImages(imagesRes.images);
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Odstranění prvků selhalo.',
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

  // 1-Click Delete single block
  const handleDeleteSingleBlock = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const origBlock = segments.find((s) => s.id === id);
    if (!origBlock) return;

    setIsSaving(true);
    try {
      const res = await removePageBlock(origBlock, activePageIndex);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Blok ${id} byl úspěšně odstraněn.`,
        });

        setSelectedBlockIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });

        if (selectedStreamBlockId === id) {
          setStreamReplaceTargetText('');
          setStreamReplaceTargetPosition(null);
        }

        if (res.updatedStream !== undefined) {
          setFullStreamText(res.updatedStream);
          const parsed = parseStreamSegments(res.updatedStream);
          const textSegments = parsed.filter((s) => s.type === 'text');
          setSegments(textSegments);

          if (selectedStreamBlockId === id) {
            if (textSegments.length > 0) {
              setSelectedStreamBlockId(textSegments[0].id);
              setEditorContent(textSegments[0].rawContent);
              setQuickReplaceNewText(textSegments[0].previewText);
            } else {
              setSelectedStreamBlockId(null);
              setEditorContent('');
              setQuickReplaceNewText('');
            }
          }
        } else {
          await loadPageData('', null);
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Odstranění bloku selhalo.',
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

  // Save Segment Code Edit
  const handleSaveSegmentEdit = async () => {
    if (!selectedStreamBlockId || !editorContent.trim()) return;
    const origBlock = segments.find((s) => s.id === selectedStreamBlockId);
    if (!origBlock) return;

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await applyStreamSegmentEdit(
        origBlock.rawContent,
        editorContent,
        activePageIndex
      );

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Změny v bloku ${selectedStreamBlockId} byly úspěšně uloženy.`,
        });

        if (res.updatedStream !== undefined) {
          setFullStreamText(res.updatedStream);
          const parsed = parseStreamSegments(res.updatedStream);
          const textSegments = parsed.filter((s) => s.type === 'text');
          setSegments(textSegments);

          const updatedBlock =
            textSegments.find((s) => s.id === selectedStreamBlockId) ||
            textSegments.find((s) => s.rawContent === editorContent) ||
            textSegments[0];

          if (updatedBlock) {
            setSelectedStreamBlockId(updatedBlock.id);
            setEditorContent(updatedBlock.rawContent);
            setQuickReplaceNewText(updatedBlock.previewText);
            setStreamReplaceTargetText(updatedBlock.previewText);
          }
        } else {
          await loadPageData();
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Uložení změn v bloku selhalo.',
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

  // Quick Text Replace in Block
  const handleApplyQuickReplace = () => {
    if (!selectedStreamBlockId || !editorContent) return;

    const currentBlock = segments.find((s) => s.id === selectedStreamBlockId);
    if (!currentBlock) return;

    const { modifiedContent, count } = replaceTextInStreamString(
      editorContent,
      currentBlock.previewText,
      quickReplaceNewText,
      { matchCase: false }
    );

    if (count > 0) {
      setEditorContent(modifiedContent);
      setStatusMessage({
        type: 'idle',
        text: `Nahrazeno ${count} výskytů v kódu bloku. Klikněte na Uložit pro aplikaci.`,
      });
    } else {
      const escapedTarget = currentBlock.previewText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const literalRegex = new RegExp(`\\(${escapedTarget}\\)`, 'gi');
      let updated = editorContent;
      if (literalRegex.test(updated)) {
        updated = updated.replace(literalRegex, `(${quickReplaceNewText})`);
      } else {
        updated = updated.replace(/\((.*?)\)\s*Tj/g, `(${quickReplaceNewText}) Tj`);
      }
      setEditorContent(updated);
      setStatusMessage({
        type: 'idle',
        text: 'Náhrada byla vložena do kódu bloku. Klikněte na Uložit pro aplikaci.',
      });
    }
  };

  // Save Full Stream Edit
  const handleSaveFullStream = async () => {
    if (!fullStreamText.trim()) return;

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await applyPageContentStreamEdit(fullStreamText, activePageIndex);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Celý stream strany ${activePageIndex + 1} byl úspěšně aktualizován.`,
        });

        if (res.updatedStream !== undefined) {
          setFullStreamText(res.updatedStream);
          const parsed = parseStreamSegments(res.updatedStream);
          const textSegments = parsed.filter((s) => s.type === 'text');
          setSegments(textSegments);
        } else {
          await loadPageData();
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Uložení streamu selhalo.',
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

  // Helper to render text with highlighted active selection
  const renderHighlightedText = (text: string, blockId: string) => {
    const isBlockSelected = selectedStreamBlockId === blockId;
    const highlightTarget =
      isBlockSelected && streamReplaceTargetText ? streamReplaceTargetText.trim() : filterQuery.trim();

    if (!highlightTarget || !text) return text;

    const normText = normalizeTextForSearch(text);
    const normTarget = normalizeTextForSearch(highlightTarget);

    const matchIdx = normText.indexOf(normTarget);
    if (matchIdx === -1) {
      const words = normTarget.split(' ').filter((w) => w.length >= 2);
      if (words.length > 0 && words.some((w) => normText.includes(w))) {
        return (
          <span className="font-semibold text-rose-300">
            {text}
          </span>
        );
      }
      return text;
    }

    const start = Math.max(0, matchIdx);
    const end = Math.min(text.length, start + highlightTarget.length);

    return (
      <>
        {text.slice(0, start)}
        <mark className="bg-amber-400/35 text-amber-200 border-b border-amber-400 px-0.5 rounded font-bold">
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </>
    );
  };

  if (!isEditSidePanelOpen) return null;

  const currentSelectedBlock = segments.find((s) => s.id === selectedStreamBlockId);

  return (
    <aside
      className={`w-96 max-w-[45vw] border-l flex flex-col h-full select-none z-20 shadow-2xl animate-in slide-in-from-right duration-200 transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-black'
          : isLcars
          ? 'bg-black border-[#ff9900] text-[#ff9900]'
          : 'bg-slate-900/95 border-slate-800 text-slate-100 backdrop-blur-xl'
      }`}
    >
      {/* 1. Header & Tab Navigation */}
      <div
        className={`p-3 border-b flex flex-col gap-2.5 ${
          isMinimal ? 'border-neutral-200 bg-neutral-50' : isLcars ? 'border-[#333333] bg-black' : 'border-slate-800 bg-slate-950/60'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-rose-400" />
            <span className="text-xs font-bold uppercase tracking-wider">
              {t.tabs.edit}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isMinimal
                  ? 'bg-neutral-200 text-neutral-800'
                  : isLcars
                  ? 'bg-[#ff9900]/20 text-[#ff9900] border border-[#ff9900]'
                  : 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
              }`}
            >
              Strana {activePageIndex + 1} / {pages.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => loadPageData()}
              disabled={isLoading}
              className={`p-1 rounded-lg transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-200 text-neutral-600'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9900]'
                  : 'hover:bg-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Obnovit prvky stránky"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleClosePanel}
              className={`p-1 rounded-lg transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-200 text-neutral-600'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9966]'
                  : 'hover:bg-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Zavřít panel editace"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div
          className={`flex rounded-lg p-0.5 border text-xs font-semibold ${
            isMinimal
              ? 'bg-neutral-200/80 border-neutral-300 text-neutral-600'
              : isLcars
              ? 'bg-[#111111] border-[#ff9900]/40 text-[#ff9900]'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <button
            onClick={() => setEditSidePanelTab('remove')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
              editSidePanelTab === 'remove'
                ? isMinimal
                  ? 'bg-white text-black shadow-xs font-bold'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-rose-600 text-white shadow-md shadow-rose-950 font-bold'
                : 'hover:text-slate-200'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Odstranit prvky</span>
          </button>

          <button
            onClick={() => setEditSidePanelTab('stream')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
              editSidePanelTab === 'stream'
                ? isMinimal
                  ? 'bg-white text-black shadow-xs font-bold'
                  : isLcars
                  ? 'bg-[#99ccff] text-black font-bold'
                  : 'bg-indigo-600 text-white shadow-md shadow-indigo-950 font-bold'
                : 'hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>Editor streamu</span>
          </button>
        </div>
      </div>

      {/* Status feedback bar */}
      {statusMessage.type !== 'idle' && (
        <div
          className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b animate-in fade-in duration-150 ${
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
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}
          <span className="truncate">{statusMessage.text}</span>
        </div>
      )}

      {/* 2. Main Content Body */}
      <div className="flex-1 overflow-y-auto flex flex-col" ref={listContainerRef}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-rose-500" />
            <p className="text-xs font-medium">Načítám prvky a stream stránky...</p>
          </div>
        ) : editSidePanelTab === 'remove' ? (
          /* =========================================================================
             TAB 1: REMOVE ELEMENTS (BLOCKS & IMAGES)
             ========================================================================= */
          <div className="p-3 flex flex-col gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Hledat v textu, písmu, ID..."
                className={`w-full pl-8 pr-8 py-1.5 rounded-lg text-xs outline-none transition-colors border ${
                  isMinimal
                    ? 'bg-neutral-100 border-neutral-300 focus:border-rose-500 text-black'
                    : isLcars
                    ? 'bg-[#111111] border-[#ff9900]/40 text-[#ff9900] focus:border-[#ff9900]'
                    : 'bg-slate-800/60 border-slate-700 text-slate-100 focus:border-rose-500'
                }`}
              />
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Selection & Batch Actions Bar */}
            <div
              className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
                isMinimal
                  ? 'bg-neutral-50 border-neutral-200'
                  : isLcars
                  ? 'bg-[#111111] border-[#333333]'
                  : 'bg-slate-800/40 border-slate-750'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  onClick={selectAll}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300"
                >
                  <CheckSquare className="w-3 h-3" />
                  <span>Vše</span>
                </button>
                <span className="text-slate-600">|</span>
                <button
                  onClick={clearSelection}
                  className="text-[11px] font-semibold text-slate-400 hover:text-slate-200"
                >
                  Zrušit
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-400">
                  Vybráno: <strong className="text-rose-400">{selectedBlockIds.size + selectedImageNames.size}</strong>
                </span>

                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedBlockIds.size + selectedImageNames.size === 0 || isSaving}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                    selectedBlockIds.size + selectedImageNames.size > 0
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-950'
                      : 'bg-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                  }`}
                >
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  <span>Smazat</span>
                </button>
              </div>
            </div>

            {/* List of text blocks */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
                <span>TEXTOVÉ BLOKY ({displayedBlocks.length})</span>
                {/* Sort Mode Segmented Control */}
                <div
                  className={`flex items-center p-0.5 rounded-lg border text-[10px] ${
                    isMinimal
                      ? 'bg-neutral-200 border-neutral-300'
                      : isLcars
                      ? 'bg-[#111111] border-[#333333]'
                      : 'bg-slate-900 border-slate-750'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSortMode('reading')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all ${
                      sortMode === 'reading'
                        ? isMinimal
                          ? 'bg-white text-black font-bold shadow-xs'
                          : isLcars
                          ? 'bg-[#ff9900] text-black font-bold'
                          : 'bg-rose-600 text-white font-bold shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Vizuální stromové čtení shora dolů podle pozice na stránce"
                  >
                    <ListTree className="w-3 h-3" />
                    <span>Čtení (Strom)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('stream')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all ${
                      sortMode === 'stream'
                        ? isMinimal
                          ? 'bg-white text-black font-bold shadow-xs'
                          : isLcars
                          ? 'bg-[#99ccff] text-black font-bold'
                          : 'bg-indigo-600 text-white font-bold shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Původní fyzické pořadí v PDF /Contents streamu"
                  >
                    <Binary className="w-3 h-3" />
                    <span>Stream bajty</span>
                  </button>
                </div>
              </div>

              {displayedBlocks.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  Nebyly nalezeny žádné textové bloky.
                </div>
              ) : (
                displayedBlocks.map((b) => {
                  const isChecked = selectedBlockIds.has(b.id);
                  const isCurrentActive = selectedStreamBlockId === b.id;
                  const isHovered =
                    hoveredBlockId === b.id ||
                    (Boolean(hoveredBlockText) &&
                      (b.previewText.toLowerCase().includes(hoveredBlockText!.toLowerCase()) ||
                        hoveredBlockText!.toLowerCase().includes(b.previewText.toLowerCase())));
                  const indent = b.indentLevel ?? 0;
                  const indentMm =
                    b.x !== undefined && b.x > minPageX + 6
                      ? Math.round((b.x - minPageX) * 0.3527)
                      : 0;

                  return (
                    <div
                      key={b.id}
                      id={`panel_item_${b.id}`}
                      onClick={() => toggleBlockSelection(b.id)}
                      onMouseEnter={() => {
                        setHoveredBlockId(b.id);
                        setHoveredBlockText(b.previewText);
                      }}
                      onMouseLeave={() => {
                        setHoveredBlockId(null);
                        setHoveredBlockText(null);
                      }}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                        indent === 1
                          ? 'border-l-4 border-l-sky-500/70 ml-2.5'
                          : indent === 2
                          ? 'border-l-4 border-l-amber-500/80 ml-5'
                          : 'border-l-4 border-l-transparent'
                      } ${
                        isCurrentActive
                          ? isMinimal
                            ? 'bg-rose-50 border-rose-500 shadow-sm ring-1 ring-rose-400'
                            : isLcars
                            ? 'bg-[#ff9900]/25 border-[#ff9900] ring-1 ring-[#ff9900]'
                            : 'bg-rose-950/40 border-rose-500 ring-1 ring-rose-500/60 shadow-lg shadow-rose-950/30'
                          : isChecked
                          ? isMinimal
                            ? 'bg-rose-50/60 border-rose-300'
                            : 'bg-rose-950/20 border-rose-700/60'
                          : isHovered
                          ? isMinimal
                            ? 'bg-sky-50 border-sky-400 ring-1 ring-sky-300 shadow-xs'
                            : isLcars
                            ? 'bg-[#111111] border-[#99ccff] ring-1 ring-[#99ccff]'
                            : 'bg-slate-800/80 border-sky-400/80 ring-1 ring-sky-400/40 shadow-md shadow-sky-950/30'
                          : isMinimal
                          ? 'bg-neutral-50/70 hover:bg-neutral-100 border-neutral-200'
                          : isLcars
                          ? 'bg-[#111111] hover:bg-[#1a1a1a] border-[#333333]'
                          : 'bg-slate-800/30 hover:bg-slate-800/70 border-slate-750'
                      }`}
                    >
                      {/* Top Bar with Checkbox, ID, and Badges */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
                          />
                          <span
                            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              isCurrentActive
                                ? 'bg-rose-600 text-white'
                                : isMinimal
                                ? 'bg-neutral-200 text-neutral-800'
                                : 'bg-slate-900 text-indigo-300 border border-slate-700'
                            }`}
                          >
                            {b.id}
                          </span>

                          {/* Role Badge */}
                          {b.headingRole === 'h1' && (
                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              H1 Nadpis
                            </span>
                          )}
                          {b.headingRole === 'h2' && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              H2 Podnadpis
                            </span>
                          )}
                          {b.headingRole === 'small' && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                              Zápatí / Pozn.
                            </span>
                          )}

                          {/* Marked Content Tag */}
                          {b.markedContentTag && (
                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                              Tag: {b.markedContentTag}
                            </span>
                          )}

                          {/* Indentation Depth Badge */}
                          {indentMm > 0 && (
                            <span
                              className="text-[9px] flex items-center gap-0.5 px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40"
                              title={`Odsazeno o ${indentMm} mm od levého okraje`}
                            >
                              <CornerDownRight className="w-2.5 h-2.5" />
                              +{indentMm} mm
                            </span>
                          )}

                          {/* Line Count Badge */}
                          {b.lineCount && b.lineCount > 1 && (
                            <span className="text-[9px] text-slate-400 bg-slate-900/60 px-1 py-0.2 rounded border border-slate-750">
                              {b.lineCount} ř.
                            </span>
                          )}

                          {isCurrentActive && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-rose-400 bg-rose-950/60 px-1 py-0.2 rounded border border-rose-800/40">
                              Aktivní
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedStreamBlockId(b.id);
                              setEditSidePanelTab('stream');
                            }}
                            className={`p-1 rounded transition-colors text-slate-400 hover:text-indigo-300 ${
                              isMinimal ? 'hover:bg-neutral-200' : 'hover:bg-slate-700'
                            }`}
                            title="Upravit kód tohoto bloku"
                          >
                            <Code className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteSingleBlock(b.id, e)}
                            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                            title="Smazat pouze tento blok"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Highlighted Preview Text */}
                      <div
                        className={`text-xs font-medium line-clamp-3 p-1.5 rounded-md ${
                          isMinimal
                            ? 'bg-white text-black border border-neutral-200'
                            : isLcars
                            ? 'bg-black text-[#ff9900] border border-[#333333]'
                            : 'bg-slate-950/60 text-slate-200 border border-slate-800'
                        }`}
                      >
                        {renderHighlightedText(b.previewText, b.id)}
                      </div>

                      {/* Font & Position meta */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="truncate max-w-[180px]">{b.fontInfo || 'Výchozí písmo'}</span>
                        <span>{b.positionInfo}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* List of images */}
            {images.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="text-[11px] font-semibold text-slate-400 px-1">
                  OBRÁZKY NA STRÁNCE ({filteredImages.length})
                </div>

                {filteredImages.map((im) => {
                  const isChecked = selectedImageNames.has(im.name);
                  return (
                    <div
                      key={im.name}
                      onClick={() => toggleImageSelection(im.name)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isChecked
                          ? isMinimal
                            ? 'bg-rose-50 border-rose-400'
                            : 'bg-rose-950/30 border-rose-500/60'
                          : isMinimal
                          ? 'bg-neutral-50 hover:bg-neutral-100 border-neutral-200'
                          : 'bg-slate-800/30 hover:bg-slate-800/70 border-slate-750'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
                        />
                        <ImageIcon className="w-4 h-4 text-indigo-400" />
                        <div>
                          <div className="text-xs font-mono font-bold text-slate-200">
                            {im.cleanName}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {im.width}×{im.height} px • {im.colorSpace || 'RGB'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* =========================================================================
             TAB 2: STREAM & OPERATOR EDITOR
             ========================================================================= */
          <div className="p-3 flex flex-col gap-3">
            {/* Stream Sub-tab switch */}
            <div className="flex rounded-md p-0.5 bg-slate-800/60 border border-slate-700 text-[11px] font-semibold">
              <button
                onClick={() => setStreamEditorSubTab('segment')}
                className={`flex-1 py-1 rounded transition-colors ${
                  streamEditorSubTab === 'segment'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Vybraný blok ({selectedStreamBlockId || 'Žádný'})
              </button>
              <button
                onClick={() => setStreamEditorSubTab('fullStream')}
                className={`flex-1 py-1 rounded transition-colors ${
                  streamEditorSubTab === 'fullStream'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Celý stream stránky
              </button>
            </div>

            {streamEditorSubTab === 'segment' ? (
              /* Sub-Tab 1: Segment Editor */
              currentSelectedBlock ? (
                <div className="flex flex-col gap-3">
                  {/* Block Switcher & Metadata */}
                  <div
                    className={`p-2.5 rounded-xl border text-xs flex flex-col gap-2 ${
                      isMinimal
                        ? 'bg-neutral-50 border-neutral-200'
                        : 'bg-slate-800/40 border-slate-750'
                    }`}
                  >
                    {/* Header with Switcher Dropdown and Prev/Next buttons */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            const curIdx = displayedBlocks.findIndex(
                              (b) => b.id === selectedStreamBlockId
                            );
                            if (curIdx > 0) {
                              setSelectedStreamBlockId(displayedBlocks[curIdx - 1].id);
                            }
                          }}
                          disabled={
                            displayedBlocks.findIndex((b) => b.id === selectedStreamBlockId) <= 0
                          }
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition-colors"
                          title="Předchozí blok podle pořadí"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>

                        <select
                          value={selectedStreamBlockId || ''}
                          onChange={(e) => setSelectedStreamBlockId(e.target.value)}
                          className={`flex-1 text-[11px] font-mono py-1 px-2 rounded border outline-none truncate ${
                            isMinimal
                              ? 'bg-white border-neutral-300 text-black'
                              : 'bg-slate-900 border-slate-700 text-indigo-300'
                          }`}
                        >
                          {displayedBlocks.map((b, idx) => (
                            <option key={b.id} value={b.id}>
                              #{idx + 1} {b.id}{' '}
                              {b.headingRole === 'h1'
                                ? '[H1]'
                                : b.headingRole === 'h2'
                                ? '[H2]'
                                : ''}{' '}
                              ({b.previewText.substring(0, 24)}...)
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            const curIdx = displayedBlocks.findIndex(
                              (b) => b.id === selectedStreamBlockId
                            );
                            if (curIdx >= 0 && curIdx < displayedBlocks.length - 1) {
                              setSelectedStreamBlockId(displayedBlocks[curIdx + 1].id);
                            }
                          }}
                          disabled={
                            displayedBlocks.findIndex((b) => b.id === selectedStreamBlockId) >=
                            displayedBlocks.length - 1
                          }
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition-colors"
                          title="Následující blok podle pořadí"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                        {currentSelectedBlock.positionInfo}
                      </span>
                    </div>

                    {/* Role & Semantic Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {currentSelectedBlock.headingRole === 'h1' && (
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          H1 Nadpis
                        </span>
                      )}
                      {currentSelectedBlock.headingRole === 'h2' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          H2 Podnadpis
                        </span>
                      )}
                      {currentSelectedBlock.headingRole === 'small' && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                          Zápatí / Pozn.
                        </span>
                      )}
                      {currentSelectedBlock.markedContentTag && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                          Tag: {currentSelectedBlock.markedContentTag}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono">
                        {currentSelectedBlock.fontInfo}
                      </span>
                    </div>

                    <div className="text-[11px] font-medium text-slate-300">
                      <strong>Náhled textu:</strong>{' '}
                      {renderHighlightedText(
                        currentSelectedBlock.previewText,
                        currentSelectedBlock.id
                      )}
                    </div>
                  </div>

                  {/* Quick Text Replacer */}
                  <div
                    className={`p-2.5 rounded-xl border flex flex-col gap-2 ${
                      isMinimal
                        ? 'bg-neutral-50 border-neutral-200'
                        : 'bg-slate-800/30 border-slate-750'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <Type className="w-3.5 h-3.5 text-indigo-400" />
                        Rychlé nahrazení textu
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={quickReplaceNewText}
                        onChange={(e) => setQuickReplaceNewText(e.target.value)}
                        placeholder="Zadejte nový text pro tento blok..."
                        className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none border transition-colors ${
                          isMinimal
                            ? 'bg-white border-neutral-300 text-black focus:border-indigo-500'
                            : 'bg-slate-900 border-slate-700 text-slate-100 focus:border-indigo-500'
                        }`}
                      />
                      <button
                        onClick={handleApplyQuickReplace}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center gap-1"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Použít</span>
                      </button>
                    </div>
                  </div>

                  {/* Raw Stream Chunk Code Editor */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
                      <span className="flex items-center gap-1 font-mono">
                        <Code className="w-3.5 h-3.5 text-indigo-400" />
                        KÓD OPERÁTORŮ STREAMU
                      </span>
                      <span>{editorContent.length} bajtů</span>
                    </div>

                    <textarea
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      rows={9}
                      className={`w-full p-2.5 rounded-xl font-mono text-xs leading-relaxed outline-none border resize-y ${
                        isMinimal
                          ? 'bg-neutral-900 text-emerald-400 border-neutral-700'
                          : isLcars
                          ? 'bg-black text-[#99ccff] border-[#ff9900]'
                          : 'bg-slate-950 text-emerald-400 border-slate-750 focus:border-indigo-500 shadow-inner'
                      }`}
                      spellCheck={false}
                    />
                  </div>

                  {/* Save / Delete Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSaveSegmentEdit}
                      disabled={isSaving}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/50 transition-all"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>Uložit změny v bloku</span>
                    </button>

                    <button
                      onClick={(e) => handleDeleteSingleBlock(currentSelectedBlock.id, e)}
                      disabled={isSaving}
                      className="p-2 rounded-xl text-rose-400 hover:bg-rose-950/50 border border-rose-800/40 transition-colors"
                      title="Smazat blok ze streamu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-500">
                  Vyberte textový blok v náhledu PDF pro editaci jeho streamu.
                </div>
              )
            ) : (
              /* Sub-Tab 2: Full Page Stream Editor */
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
                  <span>KOMPLETNÍ /Contents STREAM STRÁNKY</span>
                  <span>{fullStreamText.length} znaků</span>
                </div>

                <textarea
                  value={fullStreamText}
                  onChange={(e) => setFullStreamText(e.target.value)}
                  rows={16}
                  className={`w-full p-2.5 rounded-xl font-mono text-[11px] leading-relaxed outline-none border resize-y ${
                    isMinimal
                      ? 'bg-neutral-900 text-amber-400 border-neutral-700'
                      : isLcars
                      ? 'bg-black text-[#ff9900] border-[#ff9900]'
                      : 'bg-slate-950 text-amber-400 border-slate-750 focus:border-indigo-500 shadow-inner'
                  }`}
                  spellCheck={false}
                />

                <button
                  onClick={handleSaveFullStream}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/50 transition-all mt-1"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Uložit celý stream stránky</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
