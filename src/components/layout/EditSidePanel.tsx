import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import {
  X,
  Trash2,
  Search,
  AlertCircle,
  Loader2,
  Type,
  Image as ImageIcon,
  CheckSquare,
  FileCode2,
  Code,
  Save,
  Layers,
  RefreshCw,
  ListTree,
  Binary,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Download,
  Replace,
  RotateCcw,
  SlidersHorizontal,
  GripVertical,
  AlertTriangle,
} from 'lucide-react';
import {
  parseStreamSegments,
  StreamSegment,
  PageImageInfo,
  findBestMatchingBlock,
  normalizeTextForSearch,
} from '../../services/contentStreamEditor';
import { getPageTextBlocks, getPageTextModel } from '../../services/pdfLoader';
import { fromReadableBlock, ReadableBlock, toReadableBlock } from '../../services/pdfReadableStream';
import type { PageTextModel, TextBlock } from '../../services/pdfTextModel';
import { VisualTextBlock } from '../../utils/textSnap';
import {
  EDIT_PANEL_DEFAULT_WIDTH,
  clampEditPanelWidth,
  getNextSelectionAfterRemoval,
} from '../../utils/editModeState';

const PANEL_WIDTH_STORAGE_KEY = 'pdf_studio_edit_panel_width_v1';

/**
 * Utility to crop a high-quality thumbnail from the rendered page canvas.
 */
function cropImageThumbnail(
  canvas: HTMLCanvasElement,
  pdfBox: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  maxThumbSize = 96
): string | null {
  try {
    const scaleX = canvas.width / pageWidth;
    const scaleY = canvas.height / pageHeight;
    const sx = Math.max(0, Math.round(pdfBox.x * scaleX));
    const sy = Math.max(0, Math.round(pdfBox.y * scaleY));
    const sw = Math.min(canvas.width - sx, Math.round(pdfBox.width * scaleX));
    const sh = Math.min(canvas.height - sy, Math.round(pdfBox.height * scaleY));

    if (sw <= 2 || sh <= 2) return null;

    const aspect = sw / sh;
    let tw = maxThumbSize;
    let th = maxThumbSize;
    if (aspect >= 1) {
      th = Math.max(16, Math.round(maxThumbSize / aspect));
    } else {
      tw = Math.max(16, Math.round(maxThumbSize * aspect));
    }

    const thumbCanvas = document.createElement('canvas');
    try {
      thumbCanvas.width = tw;
      thumbCanvas.height = th;
      const ctx = thumbCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, tw, th);
      return thumbCanvas.toDataURL('image/jpeg', 0.85);
    } finally {
      thumbCanvas.width = 0;
      thumbCanvas.height = 0;
    }
  } catch {
    return null;
  }
}

type PageElement =
  | { kind: 'text'; block: StreamSegment; y: number; x: number }
  | { kind: 'image'; image: PageImageInfo; y: number; x: number };

interface DocumentSection {
  id: string;
  headingBlock?: StreamSegment;
  title: string;
  role: 'h1' | 'h2' | 'intro';
  items: PageElement[];
}

interface PendingConfirm {
  kind: 'batch' | 'section';
  title?: string;
  count: number;
  blockIds: string[];
  imageIds: string[];
}

export const EditSidePanel: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isEditSidePanelOpen,
    setIsEditSidePanelOpen,
    editSidePanelTab,
    setEditSidePanelTab,
    showEditNotice,
    selectedStreamBlockId,
    selectedStreamBlockPageId,
    setSelectedStreamBlockId,
    hoveredBlockId,
    hoveredBlockPageId,
    setHoveredBlockId,
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
    replacePageImage,
    exportPageImage,
    removeMultiplePageElements,
    applyStreamSegmentEdit,
    applyPageContentStreamEdit,
    applyBlockTextEdit,
    applyContentStreamReplacement,
    selectedAnnotationId,
  } = useDocument();

  const activeSourceDoc = sources.find((s) => s.id === pages[activePageIndex]?.sourceDocId);
  const sourceUpdatedAt = activeSourceDoc?.updatedAt || 0;
  const sourceByteLength = activeSourceDoc?.arrayBuffer?.byteLength || 0;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Resizable panel width (persisted in localStorage)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
      if (saved) return clampEditPanelWidth(saved);
    } catch {
      // ignore
    }
    return EDIT_PANEL_DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const nextWidth = clampEditPanelWidth(window.innerWidth - e.clientX);
      setPanelWidth(nextWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) return;
    try {
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
    } catch {
      // ignore
    }
  }, [panelWidth, isResizing]);

  // Core page stream & elements state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [originalFullStreamText, setOriginalFullStreamText] = useState<string>('');
  const [fullStreamText, setFullStreamText] = useState<string>('');
  const [segments, setSegments] = useState<StreamSegment[]>([]);
  const [segmentGroups, setSegmentGroups] = useState<Map<string, string[]>>(new Map());
  const [images, setImages] = useState<PageImageInfo[]>([]);
  const [isDocumentEncrypted, setIsDocumentEncrypted] = useState<boolean>(false);
  const [isTextModelAligned, setIsTextModelAligned] = useState<boolean>(true);

  // Elements List Filters & Batch Mode
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image'>('all');
  const [sortMode, setSortMode] = useState<'reading' | 'stream'>('reading');
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Inspector Text & Advanced Stream Code State
  const [quickReplaceNewText, setQuickReplaceNewText] = useState<string>('');
  const [showAdvancedCode, setShowAdvancedCode] = useState<boolean>(false);
  const [editorContent, setEditorContent] = useState<string>('');
  const [readableMode, setReadableMode] = useState<boolean>(true);
  const [readableText, setReadableText] = useState<string>('');
  const [readableState, setReadableState] = useState<{
    blockId: string;
    readable: ReadableBlock;
    model: PageTextModel;
    block: TextBlock;
  } | null>(null);

  // Find & Replace Tab State
  const [findQuery, setFindQuery] = useState<string>('');
  const [replaceValue, setReplaceValue] = useState<string>('');
  const [replaceMatchCase, setReplaceMatchCase] = useState<boolean>(true);
  const [replaceScope, setReplaceScope] = useState<'current' | 'all'>('current');
  const [isReplacingText, setIsReplacingText] = useState<boolean>(false);

  // Image Replace File Input
  const imageReplaceInputRef = useRef<HTMLInputElement>(null);
  const [targetReplacingImage, setTargetReplacingImage] = useState<PageImageInfo | null>(null);

  const loadSequenceRef = useRef(0);
  const consumedTargetRef = useRef<{ text: unknown; pos: unknown } | null>(null);
  const modelTextIdsRef = useRef<Set<string>>(new Set());
  const segmentHasModelText = (id: string) => modelTextIdsRef.current.has(id);

  // Active page identity checks
  const activePageId = pages[activePageIndex]?.id ?? null;
  const selectionIsOnActivePage = !selectedStreamBlockPageId || selectedStreamBlockPageId === activePageId;
  const hoverIsOnActivePage = !hoveredBlockPageId || hoveredBlockPageId === activePageId;
  const lastActivePageIdRef = useRef(activePageId);

  useEffect(() => {
    if (lastActivePageIdRef.current === activePageId) return;
    lastActivePageIdRef.current = activePageId;
    if (selectedStreamBlockId && selectedStreamBlockPageId !== activePageId) {
      setSelectedStreamBlockId(null);
    }
    setSelectedBlockIds(new Set());
    setSelectedImageNames(new Set());
    setPendingConfirm(null);
  }, [activePageId, selectedStreamBlockId, selectedStreamBlockPageId, setSelectedStreamBlockId]);

  // Load stream, text model enrichment, and images for the active page
  const loadPageData = useCallback(
    async (
      preferredTargetText?: string,
      preferredTargetPos?: { x: number; y: number } | null
    ) => {
      const sequence = ++loadSequenceRef.current;
      const isStale = () => sequence !== loadSequenceRef.current;
      setIsLoading(true);

      try {
        const [streamRes, imagesRes] = await Promise.all([
          getPageStream(activePageIndex),
          getPageImagesList(activePageIndex),
        ]);
        if (isStale()) return;

        setIsDocumentEncrypted(Boolean(streamRes.isEncrypted));

        let textSegments: StreamSegment[] = [];
        let visualBlocks: VisualTextBlock[] = [];
        if (streamRes.streamText) {
          const parsed = parseStreamSegments(streamRes.streamText);
          textSegments = parsed.filter((s) => s.type === 'text');

          const activePageModel = pages[activePageIndex];
          const activeSource = activePageModel
            ? sources.find((s) => s.id === activePageModel.sourceDocId) || sources[0]
            : null;
          if (activePageModel && activeSource) {
            try {
              const model = await getPageTextModel(activeSource, activePageModel);
              modelTextIdsRef.current = new Set();
              setIsTextModelAligned(Boolean(model?.aligned));
              if (model?.aligned) {
                textSegments.forEach((seg) => {
                  const block = model.blocksById.get(seg.id);
                  if (block?.text) {
                    seg.previewText = block.text;
                    modelTextIdsRef.current.add(seg.id);
                  }
                });
              }
              visualBlocks = await getPageTextBlocks(activeSource, activePageModel);
              if (isStale()) return;
              const blockMap = new Map(visualBlocks.map((vb) => [vb.id, vb.text]));
              const groups = new Map<string, string[]>();
              visualBlocks.forEach((vb) => {
                if (vb.segmentIds && vb.segmentIds.length > 1) {
                  vb.segmentIds.forEach((id) => groups.set(id, vb.segmentIds!));
                }
              });
              setSegmentGroups(groups);
              textSegments.forEach((seg) => {
                const decoded = blockMap.get(seg.id);
                if (
                  decoded &&
                  !segmentHasModelText(seg.id) &&
                  (!seg.previewText ||
                    seg.previewText.startsWith('[Textový') ||
                    seg.previewText.startsWith('<') ||
                    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/.test(seg.previewText) ||
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
              setIsTextModelAligned(false);
            }
          }

          if (isStale()) return;
          setOriginalFullStreamText(streamRes.streamText);
          setFullStreamText(streamRes.streamText);
          setSegments(textSegments);
        } else {
          setOriginalFullStreamText('');
          setFullStreamText('');
          setSegments([]);
          setSegmentGroups(new Map());
          setIsTextModelAligned(true);
        }

        let loadedImages: PageImageInfo[] = [];
        if (imagesRes.images) {
          loadedImages = [...imagesRes.images];
          const activePageModel = pages[activePageIndex];
          const canvasEl = document.getElementById(
            `page_canvas_${activePageModel?.id}`
          ) as HTMLCanvasElement | null;
          if (canvasEl && activePageModel) {
            loadedImages.forEach((im) => {
              if (im.x !== undefined && im.y !== undefined && im.width && im.height) {
                const pageH = activePageModel.height;
                const boxY = pageH - im.y - im.height;
                im.thumbnailDataUrl =
                  cropImageThumbnail(
                    canvasEl,
                    { x: im.x, y: Math.max(0, boxY), width: im.width, height: im.height },
                    activePageModel.width,
                    activePageModel.height
                  ) || undefined;
              }
            });
          }
          setImages(loadedImages);
        } else {
          setImages([]);
        }

        // Resolve fresh canvas click target cleanly (NEVER checks batch-delete checkboxes!)
        const targetText =
          preferredTargetText !== undefined ? preferredTargetText : streamReplaceTargetText;
        const targetPos =
          preferredTargetPos !== undefined ? preferredTargetPos : streamReplaceTargetPosition;

        const isFreshTarget =
          preferredTargetText !== undefined ||
          preferredTargetPos !== undefined ||
          consumedTargetRef.current?.text !== targetText ||
          consumedTargetRef.current?.pos !== targetPos;

        const isSelectedImageValid =
          Boolean(selectedStreamBlockId) &&
          loadedImages.some((im) => im.id === selectedStreamBlockId);
        const isSelectedTextValid =
          Boolean(selectedStreamBlockId) &&
          textSegments.some((s) => s.id === selectedStreamBlockId);

        const keepSelection =
          (isSelectedImageValid && preferredTargetText === undefined && preferredTargetPos === undefined) ||
          (!isFreshTarget && isSelectedTextValid);

        if (keepSelection) {
          // Preserve user's active selection across reloads/edits
        } else if (targetText || targetPos) {
          consumedTargetRef.current = { text: targetText, pos: targetPos };
          const hit = targetPos
            ? visualBlocks
                .filter(
                  (vb) =>
                    vb.type !== 'image' &&
                    targetPos.x >= vb.x - 1 &&
                    targetPos.x <= vb.x + vb.width + 1 &&
                    targetPos.y >= vb.y - 1 &&
                    targetPos.y <= vb.y + vb.height + 1
                )
                .sort((a, b) => a.width * a.height - b.width * b.height)[0]
            : undefined;
          const best =
            (hit && textSegments.find((seg) => seg.id === hit.id)) ||
            findBestMatchingBlock(textSegments, targetText, targetPos);
          if (best) {
            setSelectedStreamBlockId(best.id, activePageId);
            setEditorContent(best.rawContent);
            setQuickReplaceNewText(best.previewText);

            setTimeout(() => {
              const el = document.getElementById(`panel_item_${best.id}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }, 120);
          }
        } else if (selectedStreamBlockId && !isSelectedTextValid && !isSelectedImageValid) {
          // Previously selected element no longer exists
          setSelectedStreamBlockId(null);
        }
      } catch (err: any) {
        showEditNotice({ type: 'error', text: err?.message || String(err) });
      } finally {
        if (!isStale()) {
          setIsLoading(false);
        }
      }
    },
    [
      activePageIndex,
      activePageId,
      getPageStream,
      getPageImagesList,
      pages,
      sources,
      streamReplaceTargetText,
      streamReplaceTargetPosition,
      selectedStreamBlockId,
      setSelectedStreamBlockId,
      showEditNotice,
    ]
  );

  // Trigger reloads on panel open, page switch, undo/redo, or binary updates
  useEffect(() => {
    if (isEditSidePanelOpen) {
      void loadPageData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditSidePanelOpen, activePageIndex, historyIndex, sourceUpdatedAt, sourceByteLength]);

  useEffect(() => {
    if (isEditSidePanelOpen && (streamReplaceTargetText || streamReplaceTargetPosition)) {
      void loadPageData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReplaceTargetText, streamReplaceTargetPosition]);

  // Generate thumbnails if canvas finishes rendering after loadPageData
  useEffect(() => {
    const activePageModel = pages[activePageIndex];
    if (!activePageModel || images.length === 0) return;
    if (images.some((im) => !im.thumbnailDataUrl)) {
      const timer = setTimeout(() => {
        const canvasEl = document.getElementById(
          `page_canvas_${activePageModel.id}`
        ) as HTMLCanvasElement | null;
        if (!canvasEl || canvasEl.width <= 0) return;
        setImages((prev) =>
          prev.map((im) => {
            if (
              im.thumbnailDataUrl ||
              im.x === undefined ||
              im.y === undefined ||
              !im.width ||
              !im.height
            ) {
              return im;
            }
            const pageH = activePageModel.height;
            const boxY = pageH - im.y - im.height;
            const thumb = cropImageThumbnail(
              canvasEl,
              { x: im.x, y: Math.max(0, boxY), width: im.width, height: im.height },
              activePageModel.width,
              activePageModel.height
            );
            return thumb ? { ...im, thumbnailDataUrl: thumb } : im;
          })
        );
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [images, pages, activePageIndex]);

  // Readable form of the selected block (for Advanced: PDF Stream Code disclosure)
  useEffect(() => {
    let cancelled = false;
    setReadableState(null);
    const activePageModel = pages[activePageIndex];
    const activeSource = activePageModel
      ? sources.find((src) => src.id === activePageModel.sourceDocId) || sources[0]
      : null;
    if (!selectedStreamBlockId || !selectionIsOnActivePage || !activePageModel || !activeSource) return;
    getPageTextModel(activeSource, activePageModel).then((model) => {
      if (cancelled || !model?.aligned) return;
      const block = model.blocksById.get(selectedStreamBlockId);
      const segment = segments.find((seg) => seg.id === selectedStreamBlockId);
      if (!block || !segment || model.streamText.substring(block.startIndex, block.endIndex) !== segment.rawContent) {
        return;
      }
      const readable = toReadableBlock(model, block);
      if (readable.originals.length === 0) return;
      setReadableState({ blockId: selectedStreamBlockId, readable, model, block });
      setReadableText(readable.text);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStreamBlockId, selectionIsOnActivePage, segments, activePageIndex, sources, pages]);

  const showReadable = readableMode && readableState?.blockId === selectedStreamBlockId;

  // Sync inspector fields when selected text block or segments refresh
  useEffect(() => {
    if (selectedStreamBlockId && selectionIsOnActivePage && segments.length > 0) {
      const found = segments.find((s) => s.id === selectedStreamBlockId);
      if (found) {
        setEditorContent(found.rawContent);
        setQuickReplaceNewText(found.previewText);
      }
    }
  }, [selectedStreamBlockId, selectionIsOnActivePage, segments]);

  // Derived selected text block or selected image
  const selectedTextBlock = useMemo(() => {
    if (!selectedStreamBlockId || !selectionIsOnActivePage) return null;
    return segments.find((s) => s.id === selectedStreamBlockId) || null;
  }, [selectedStreamBlockId, selectionIsOnActivePage, segments]);

  const selectedImageInfo = useMemo(() => {
    if (!selectedStreamBlockId || !selectionIsOnActivePage) return null;
    return images.find((im) => im.id === selectedStreamBlockId) || null;
  }, [selectedStreamBlockId, selectionIsOnActivePage, images]);

  // Filtered blocks & images
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
      return qWords.length > 0 && qWords.every((w) => normPreview.includes(w) || normRaw.includes(w));
    });
  }, [segments, filterQuery]);

  const displayedBlocks = useMemo(() => {
    if (sortMode === 'stream') return filteredBlocks;
    return [...filteredBlocks].sort((a, b) => {
      const ay = a.y !== undefined ? a.y : -999999;
      const by = b.y !== undefined ? b.y : -999999;
      if (Math.abs(ay - by) > 5) return by - ay;
      return (a.x ?? 0) - (b.x ?? 0);
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

  const allPageElements = useMemo<PageElement[]>(() => {
    const textItems: PageElement[] =
      filterType === 'all' || filterType === 'text'
        ? filteredBlocks.map((b) => ({
            kind: 'text',
            block: b,
            y: b.y !== undefined ? b.y : -999999,
            x: b.x !== undefined ? b.x : 0,
          }))
        : [];
    const imageItems: PageElement[] =
      filterType === 'all' || filterType === 'image'
        ? filteredImages
            .filter((im) => im.x !== undefined && im.y !== undefined)
            .map((im) => ({
              kind: 'image',
              image: im,
              y: im.y!,
              x: im.x!,
            }))
        : [];
    if (sortMode === 'stream') return [...textItems, ...imageItems];
    return [...textItems, ...imageItems].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 5) return b.y - a.y;
      return a.x - b.x;
    });
  }, [filteredBlocks, filteredImages, sortMode, filterType]);

  const unplacedImages = useMemo(
    () =>
      filterType === 'all' || filterType === 'image'
        ? filteredImages.filter((im) => im.x === undefined || im.y === undefined)
        : [],
    [filteredImages, filterType]
  );

  const orderedElementIds = useMemo(() => {
    const ids = allPageElements.map((el) => (el.kind === 'text' ? el.block.id : el.image.id));
    unplacedImages.forEach((im) => ids.push(im.id));
    return ids;
  }, [allPageElements, unplacedImages]);

  const fullPageScanImage = useMemo(() => images.find((im) => im.isFullPageScan), [images]);
  const hasFullPageScan = Boolean(fullPageScanImage && segments.length <= 2);

  // Semantic reading sections
  const documentSections = useMemo<DocumentSection[]>(() => {
    if (allPageElements.length === 0) return [];
    const sections: DocumentSection[] = [];
    let currentSec: DocumentSection | null = null;
    let secIndex = 1;
    for (const el of allPageElements) {
      if (el.kind === 'text' && (el.block.headingRole === 'h1' || el.block.headingRole === 'h2')) {
        currentSec = {
          id: `sec_${el.block.id}`,
          headingBlock: el.block,
          title: el.block.previewText,
          role: el.block.headingRole,
          items: [],
        };
        sections.push(currentSec);
        secIndex++;
      } else {
        if (!currentSec) {
          currentSec = {
            id: `sec_intro_${secIndex}`,
            title: t.editPanel.sectionIntro,
            role: 'intro',
            items: [],
          };
          sections.push(currentSec);
          secIndex++;
        }
        currentSec.items.push(el);
      }
    }
    return sections;
  }, [allPageElements, t.editPanel.sectionIntro]);

  // Live preview match count on current page for Find & Replace tab
  const currentPageFindMatches = useMemo(() => {
    if (!findQuery) return 0;
    const needle = replaceMatchCase ? findQuery : findQuery.toLowerCase();
    let count = 0;
    for (const seg of segments) {
      const hay = replaceMatchCase ? seg.previewText : seg.previewText.toLowerCase();
      let idx = 0;
      while ((idx = hay.indexOf(needle, idx)) !== -1) {
        count++;
        idx += Math.max(1, needle.length);
      }
    }
    return count;
  }, [findQuery, replaceMatchCase, segments]);

  // Expected raw contents map to prevent deleting stale segments
  const expectedContentsFor = useCallback(
    (ids: string[]): Record<string, string> => {
      const expected: Record<string, string> = {};
      for (const id of ids) {
        const seg = segments.find((s) => s.id === id);
        if (seg) expected[id] = seg.rawContent;
      }
      return expected;
    },
    [segments]
  );

  // Batch checkbox toggles (decoupled from card inspect selection!)
  const toggleBatchBlock = (id: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBatchImage = (id: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setSelectedImageNames((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSectionBatchSelection = (section: DocumentSection, e: React.SyntheticEvent) => {
    e.stopPropagation();
    const allTextIds: string[] = [];
    const allImageIds: string[] = [];
    if (section.headingBlock) allTextIds.push(section.headingBlock.id);
    section.items.forEach((c) => {
      if (c.kind === 'text') allTextIds.push(c.block.id);
      else allImageIds.push(c.image.id);
    });
    const allSelected =
      allTextIds.every((id) => selectedBlockIds.has(id)) &&
      allImageIds.every((id) => selectedImageNames.has(id));

    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allTextIds.forEach((id) => next.delete(id));
      else allTextIds.forEach((id) => next.add(id));
      return next;
    });
    setSelectedImageNames((prev) => {
      const next = new Set(prev);
      if (allSelected) allImageIds.forEach((id) => next.delete(id));
      else allImageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectAllVisible = () => {
    setIsBatchMode(true);
    if (filterType !== 'image') {
      setSelectedBlockIds(new Set(displayedBlocks.map((b) => b.id)));
    }
    if (filterType !== 'text') {
      setSelectedImageNames(new Set(filteredImages.map((im) => im.id)));
    }
  };

  const clearBatchSelection = () => {
    setSelectedBlockIds(new Set());
    setSelectedImageNames(new Set());
    setPendingConfirm(null);
  };

  const totalBatchSelected = selectedBlockIds.size + selectedImageNames.size;

  // Execute removal of 1 or more text blocks and/or images cleanly
  const executeElementsRemoval = useCallback(
    async (blockIds: string[], imageIds: string[], successMessage: string) => {
      if (blockIds.length === 0 && imageIds.length === 0) return;

      const expandedBlockIds = new Set<string>();
      for (const id of blockIds) {
        (segmentGroups.get(id) ?? [id]).forEach((sid) => expandedBlockIds.add(sid));
      }
      const targetBlockIdList = Array.from(expandedBlockIds);
      const removedAllSet = new Set<string>([...targetBlockIdList, ...imageIds]);

      // Determine nearest surviving neighbour so selection moves smoothly without jumping to index 0
      const remainingIds = orderedElementIds.filter((id) => !removedAllSet.has(id));
      const nextSelected = getNextSelectionAfterRemoval(
        remainingIds,
        removedAllSet,
        selectedStreamBlockId,
        orderedElementIds
      );

      setIsSaving(true);
      setPendingConfirm(null);
      try {
        const res = await removeMultiplePageElements(
          targetBlockIdList,
          imageIds,
          activePageIndex,
          expectedContentsFor(targetBlockIdList)
        );
        if (res.success) {
          showEditNotice({ type: 'success', text: successMessage, canUndo: true });
          setSelectedBlockIds((prev) => {
            const next = new Set(prev);
            targetBlockIdList.forEach((id) => next.delete(id));
            return next;
          });
          setSelectedImageNames((prev) => {
            const next = new Set(prev);
            imageIds.forEach((id) => next.delete(id));
            return next;
          });
          if (selectedStreamBlockId && removedAllSet.has(selectedStreamBlockId)) {
            setStreamReplaceTargetText('');
            setStreamReplaceTargetPosition(null);
            setSelectedStreamBlockId(nextSelected, nextSelected ? activePageId : null);
          }
          // Let commitSourceBytes -> useEffect reload enriched segments cleanly (zero garbled flash!)
        } else {
          showEditNotice({ type: 'error', text: res.error || t.editPanel.blockDeleteFailed });
        }
      } catch (err: any) {
        showEditNotice({ type: 'error', text: err?.message || String(err) });
      } finally {
        setIsSaving(false);
      }
    },
    [
      segmentGroups,
      orderedElementIds,
      selectedStreamBlockId,
      removeMultiplePageElements,
      activePageIndex,
      expectedContentsFor,
      showEditNotice,
      setStreamReplaceTargetText,
      setStreamReplaceTargetPosition,
      setSelectedStreamBlockId,
      activePageId,
      t.editPanel.blockDeleteFailed,
    ]
  );

  // Single block deletion (immediate + Undo toast)
  const handleDeleteSingleBlock = useCallback(
    (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      void executeElementsRemoval([id], [], t.editPanel.blockDeleted);
    },
    [executeElementsRemoval, t.editPanel.blockDeleted]
  );

  // Single image deletion (immediate + Undo toast)
  const handleDeleteSingleImage = useCallback(
    (im: PageImageInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      void executeElementsRemoval([], [im.id], t.editPanel.imageDeleted);
    },
    [executeElementsRemoval, t.editPanel.imageDeleted]
  );

  // Batch deletion request (uses inline confirmation when >= 2 elements)
  const requestBatchDeletion = useCallback(() => {
    const blockIds = Array.from(selectedBlockIds);
    const imageIds = Array.from(selectedImageNames);
    const count = blockIds.length + imageIds.length;
    if (count === 0) return;
    if (count === 1) {
      const msg = blockIds.length === 1 ? t.editPanel.blockDeleted : t.editPanel.imageDeleted;
      void executeElementsRemoval(blockIds, imageIds, msg);
      return;
    }
    setPendingConfirm({ kind: 'batch', count, blockIds, imageIds });
  }, [selectedBlockIds, selectedImageNames, executeElementsRemoval, t.editPanel.blockDeleted, t.editPanel.imageDeleted]);

  // Section deletion request (uses inline confirmation when >= 2 elements)
  const requestSectionDeletion = (section: DocumentSection, e: React.MouseEvent) => {
    e.stopPropagation();
    const blockIds: string[] = [];
    const imageIds: string[] = [];
    if (section.headingBlock) blockIds.push(section.headingBlock.id);
    section.items.forEach((c) => {
      if (c.kind === 'text') blockIds.push(c.block.id);
      else imageIds.push(c.image.id);
    });
    const count = blockIds.length + imageIds.length;
    if (count === 0) return;
    if (count === 1) {
      const msg = blockIds.length === 1 ? t.editPanel.blockDeleted : t.editPanel.imageDeleted;
      void executeElementsRemoval(blockIds, imageIds, msg);
      return;
    }
    setPendingConfirm({
      kind: 'section',
      title: section.title,
      count,
      blockIds,
      imageIds,
    });
  };

  const confirmPendingDeletion = () => {
    if (!pendingConfirm) return;
    const msg = t.editPanel.elementsDeleted
      .replace('{count}', String(pendingConfirm.count))
      .replace('{page}', String(activePageIndex + 1));
    void executeElementsRemoval(pendingConfirm.blockIds, pendingConfirm.imageIds, msg);
  };

  // Keyboard shortcuts while EditSidePanel is open
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) {
      return;
    }
    if (e.key === 'Escape') {
      if (pendingConfirm) {
        e.preventDefault();
        setPendingConfirm(null);
      } else if (isBatchMode || totalBatchSelected > 0) {
        e.preventDefault();
        clearBatchSelection();
        setIsBatchMode(false);
      } else if (selectedStreamBlockId) {
        e.preventDefault();
        setSelectedStreamBlockId(null);
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedAnnotationId || isSaving || isLoading) return;
      if (totalBatchSelected > 0) {
        e.preventDefault();
        requestBatchDeletion();
        return;
      }
      if (selectedStreamBlockId && selectionIsOnActivePage) {
        const img = images.find((im) => im.id === selectedStreamBlockId);
        if (img) {
          e.preventDefault();
          handleDeleteSingleImage(img);
          return;
        }
        if (segments.some((seg) => seg.id === selectedStreamBlockId)) {
          e.preventDefault();
          handleDeleteSingleBlock(selectedStreamBlockId);
        }
      }
    }
  };

  useEffect(() => {
    if (!isEditSidePanelOpen) return;
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [isEditSidePanelOpen]);

  // Image export & replace handlers
  const handleExportImage = async (im: PageImageInfo) => {
    const activePageModel = pages[activePageIndex];
    const canvasEl = document.getElementById(
      `page_canvas_${activePageModel?.id}`
    ) as HTMLCanvasElement | null;
    const pdfBox =
      im.x !== undefined && im.y !== undefined && im.width && im.height && activePageModel
        ? {
            x: im.x,
            y: activePageModel.height - im.y - im.height,
            width: im.width,
            height: im.height,
          }
        : undefined;

    const res = await exportPageImage(im.name || im.cleanName || 'inline-image', activePageIndex, canvasEl, pdfBox);
    if (!res.success) {
      showEditNotice({ type: 'error', text: res.error || t.editPanel.imageExportFailed });
    }
  };

  const triggerImageReplace = (im: PageImageInfo) => {
    if (im.kind === 'inline' || !im.name) return;
    setTargetReplacingImage(im);
    if (imageReplaceInputRef.current) {
      imageReplaceInputRef.current.value = '';
      imageReplaceInputRef.current.click();
    }
  };

  const handleImageFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetReplacingImage) return;
    setIsSaving(true);
    try {
      const res = await replacePageImage(targetReplacingImage.name, file, undefined, activePageIndex);
      if (res.success) {
        showEditNotice({ type: 'success', text: t.editPanel.imageReplaced, canUndo: true });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.imageReplaceFailed });
      }
    } catch (err: any) {
      showEditNotice({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
      setTargetReplacingImage(null);
    }
  };

  // Text block plain-text rewrite
  const handleApplyTextEdit = async () => {
    if (!selectedTextBlock || isSaving) return;
    setIsSaving(true);
    try {
      const res = await applyBlockTextEdit(selectedTextBlock.id, quickReplaceNewText, activePageIndex);
      if (res.success) {
        showEditNotice({
          type: 'success',
          text: res.fontSubstituted ? t.editPanel.textUpdatedSubFont : t.editPanel.textUpdatedOriginalFont,
          canUndo: true,
        });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.textUpdateFailed });
      }
    } catch (err: any) {
      showEditNotice({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Advanced stream code save for selected block
  const handleSaveSegmentEdit = async () => {
    if (!selectedTextBlock || !editorContent.trim() || isSaving) return;
    let content = editorContent;
    if (showReadable && readableState) {
      const converted = fromReadableBlock(
        readableState.model,
        readableState.block,
        readableState.readable,
        readableText
      );
      if ('error' in converted) {
        showEditNotice({ type: 'error', text: converted.error });
        return;
      }
      content = converted.raw;
    }

    setIsSaving(true);
    try {
      const res = await applyStreamSegmentEdit(selectedTextBlock.rawContent, content, activePageIndex);
      if (res.success) {
        showEditNotice({ type: 'success', text: t.editPanel.streamCodeSaved, canUndo: true });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.streamCodeSaveFailed });
      }
    } catch (err: any) {
      showEditNotice({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Full page stream save
  const handleSaveFullStream = async () => {
    if (!fullStreamText.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await applyPageContentStreamEdit(fullStreamText, activePageIndex);
      if (res.success) {
        showEditNotice({ type: 'success', text: t.editPanel.fullStreamSaved, canUndo: true });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.fullStreamSaveFailed });
      }
    } catch (err: any) {
      showEditNotice({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Find & Replace execution
  const handleRunFindReplace = async () => {
    if (!findQuery || isReplacingText) return;
    setIsReplacingText(true);
    try {
      const res = await applyContentStreamReplacement(findQuery, replaceValue, {
        pageIndex: activePageIndex,
        replaceAllPages: replaceScope === 'all',
        matchCase: replaceMatchCase,
      });
      if (res.success && res.totalReplaced > 0) {
        showEditNotice({
          type: 'success',
          text: t.editPanel.replacedSuccess.replace('{count}', String(res.totalReplaced)),
          canUndo: true,
        });
      } else if (res.error) {
        showEditNotice({ type: 'error', text: res.error });
      } else {
        showEditNotice({ type: 'error', text: t.editPanel.replacedNone });
      }
    } catch (err: any) {
      showEditNotice({ type: 'error', text: err?.message || t.editPanel.replaceFailed });
    } finally {
      setIsReplacingText(false);
    }
  };

  // Prev / Next text block navigation in Inspector
  const navigateSelectedBlock = (delta: -1 | 1) => {
    if (displayedBlocks.length === 0) return;
    const idx = displayedBlocks.findIndex((b) => b.id === selectedStreamBlockId);
    const nextIdx = idx === -1 ? 0 : (idx + delta + displayedBlocks.length) % displayedBlocks.length;
    const target = displayedBlocks[nextIdx];
    if (target) {
      setSelectedStreamBlockId(target.id, activePageId);
      setTimeout(() => {
        document.getElementById(`panel_item_${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 40);
    }
  };

  // Close panel cleanly
  const handleClosePanel = () => {
    setIsEditSidePanelOpen(false);
    setIsRemoveElementsModalOpen(false);
    setIsStreamReplaceModalOpen(false);
  };

  const toggleSectionCollapse = (secId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  };

  // Compact text block list row
  const renderTextBlockRow = (b: StreamSegment, indented = false) => {
    const isChecked = selectedBlockIds.has(b.id);
    const isSelected = selectionIsOnActivePage && selectedStreamBlockId === b.id;
    const isHovered = hoverIsOnActivePage && hoveredBlockId === b.id;
    const roleLabel =
      b.headingRole === 'h1'
        ? t.editPanel.roleH1
        : b.headingRole === 'h2'
        ? t.editPanel.roleH2
        : b.headingRole === 'small'
        ? t.editPanel.roleSmall
        : null;

    return (
      <div
        key={b.id}
        id={`panel_item_${b.id}`}
        onMouseEnter={() => {
          setHoveredBlockId(b.id, activePageId);
          setHoveredBlockText(b.previewText);
        }}
        onMouseLeave={() => {
          setHoveredBlockId(null);
          setHoveredBlockText(null);
        }}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            setIsBatchMode(true);
            toggleBatchBlock(b.id, e);
            return;
          }
          // Clicking a row ONLY inspects/selects it (never toggles batch-delete checkbox!)
          setSelectedStreamBlockId(b.id, activePageId);
        }}
        className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-all ${
          indented ? 'ml-3' : ''
        } ${
          isSelected
            ? isMinimal
              ? 'bg-indigo-50/90 border-indigo-500 ring-1 ring-indigo-400'
              : isLcars
              ? 'bg-[#1a2233] border-[#99ccff] ring-1 ring-[#99ccff]'
              : 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-400/60'
            : isHovered
            ? isMinimal
              ? 'bg-neutral-100 border-neutral-400'
              : isLcars
              ? 'bg-[#1c1c1c] border-[#ff9900]'
              : 'bg-slate-800/80 border-indigo-500/50'
            : isMinimal
            ? 'bg-white border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300'
            : isLcars
            ? 'bg-[#0b0b0b] border-[#333333] hover:border-[#ff9966]'
            : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
        }`}
      >
        {(isBatchMode || totalBatchSelected > 0) && (
          <input
            type="checkbox"
            checked={isChecked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggleBatchBlock(b.id, e)}
            aria-label={b.previewText}
            className="mt-0.5 rounded border-slate-600 text-rose-500 focus:ring-rose-500 cursor-pointer shrink-0"
          />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={`text-xs leading-snug line-clamp-2 break-words ${
              b.headingRole === 'h1'
                ? 'font-bold'
                : b.headingRole === 'h2'
                ? 'font-semibold'
                : 'font-normal'
            } ${
              isMinimal
                ? 'text-neutral-900'
                : isLcars
                ? isSelected
                  ? 'text-[#ffff66]'
                  : 'text-[#ff9900]'
                : 'text-slate-100'
            }`}
          >
            {b.previewText || `[${b.id}]`}
          </p>
          <div className="flex items-center gap-1.5 mt-1 text-[10px]">
            {roleLabel && (
              <span
                className={`px-1 py-0.2 rounded font-semibold ${
                  isMinimal
                    ? 'bg-neutral-200 text-neutral-700'
                    : isLcars
                    ? 'bg-[#ff9900]/20 text-[#ffcc00]'
                    : 'bg-indigo-500/20 text-indigo-300'
                }`}
              >
                {roleLabel}
              </span>
            )}
            {b.fontSize !== undefined && (
              <span className={isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}>
                {Number.isInteger(b.fontSize) ? b.fontSize : b.fontSize.toFixed(1)} pt
              </span>
            )}
            {b.lineCount && b.lineCount > 1 && (
              <span className={isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#99ccff]' : 'text-slate-500'}>
                • {b.lineCount} {t.editPanel.linesShort}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={isSaving}
          onClick={(e) => handleDeleteSingleBlock(b.id, e)}
          className={`p-1 rounded transition-opacity shrink-0 disabled:opacity-40 ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          } ${
            isMinimal
              ? 'text-neutral-400 hover:text-rose-600 hover:bg-rose-50'
              : isLcars
              ? 'text-[#ff6666] hover:bg-[#cc3333]/30'
              : 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/60'
          }`}
          title={t.editPanel.deleteBlockBtn}
          aria-label={t.editPanel.deleteBlockBtn}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  // Compact image list row
  const renderImageRow = (im: PageImageInfo, indented = false) => {
    const isChecked = selectedImageNames.has(im.id);
    const isSelected = selectionIsOnActivePage && selectedStreamBlockId === im.id;
    const isHovered = hoverIsOnActivePage && hoveredBlockId === im.id;
    const isInline = im.kind === 'inline' || !im.name;

    return (
      <div
        key={im.id}
        id={`panel_item_img_${im.id}`}
        onMouseEnter={() => {
          setHoveredBlockId(im.id, activePageId);
          setHoveredBlockText(im.cleanName);
        }}
        onMouseLeave={() => {
          setHoveredBlockId(null);
          setHoveredBlockText(null);
        }}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            setIsBatchMode(true);
            toggleBatchImage(im.id, e);
            return;
          }
          // Clicking an image row ONLY selects/inspects it
          setSelectedStreamBlockId(im.id, activePageId);
        }}
        className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-all ${
          indented ? 'ml-3' : ''
        } ${
          isSelected
            ? isMinimal
              ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-400'
              : isLcars
              ? 'bg-[#261a00] border-[#ffcc00] ring-1 ring-[#ffcc00]'
              : 'bg-amber-950/40 border-amber-500 ring-1 ring-amber-400/60'
            : isHovered
            ? isMinimal
              ? 'bg-neutral-100 border-amber-400'
              : isLcars
              ? 'bg-[#1c1c1c] border-[#ffcc00]'
              : 'bg-slate-800/80 border-amber-500/50'
            : isMinimal
            ? 'bg-white border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300'
            : isLcars
            ? 'bg-[#0b0b0b] border-[#333333] hover:border-[#ffcc00]'
            : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
        }`}
      >
        {(isBatchMode || totalBatchSelected > 0) && (
          <input
            type="checkbox"
            checked={isChecked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggleBatchImage(im.id, e)}
            aria-label={im.cleanName}
            className="rounded border-slate-600 text-rose-500 focus:ring-rose-500 cursor-pointer shrink-0"
          />
        )}

        <div
          className={`w-10 h-10 rounded border flex items-center justify-center overflow-hidden shrink-0 ${
            isMinimal
              ? 'bg-neutral-100 border-neutral-200'
              : isLcars
              ? 'bg-black border-[#ff9900]/40'
              : 'bg-slate-950 border-slate-700/70'
          }`}
        >
          {im.thumbnailDataUrl ? (
            <img src={im.thumbnailDataUrl} alt={im.cleanName} className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className={`w-4 h-4 ${isMinimal ? 'text-amber-600' : 'text-amber-400'}`} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs font-mono font-semibold truncate ${
                isMinimal ? 'text-neutral-900' : isLcars ? 'text-[#ffcc00]' : 'text-amber-200'
              }`}
            >
              {im.cleanName}
            </span>
            {isInline && (
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-semibold uppercase ${
                  isMinimal
                    ? 'bg-neutral-200 text-neutral-700'
                    : isLcars
                    ? 'bg-[#ff9966]/20 text-[#ff9966]'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {t.editPanel.inlineImageBadge}
              </span>
            )}
            {im.isFullPageScan && (
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-semibold ${
                  isMinimal
                    ? 'bg-amber-100 text-amber-800'
                    : isLcars
                    ? 'bg-[#ff9900]/30 text-[#ffff66]'
                    : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {t.editPanel.fullPageScanBadge}
              </span>
            )}
          </div>
          <div className={`text-[10px] mt-0.5 flex items-center gap-1.5 ${isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`}>
            {im.pixelWidth && im.pixelHeight && <span>{im.pixelWidth}×{im.pixelHeight} px</span>}
            {im.dpi && <span>• {im.dpi} DPI</span>}
            {im.placementCount && im.placementCount > 1 && (
              <span>
                •{' '}
                {t.editPanel.placementBadge
                  .replace('{current}', String((im.occurrence ?? 0) + 1))
                  .replace('{total}', String(im.placementCount))}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={isSaving}
          onClick={(e) => handleDeleteSingleImage(im, e)}
          className={`p-1 rounded transition-opacity shrink-0 disabled:opacity-40 ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          } ${
            isMinimal
              ? 'text-neutral-400 hover:text-rose-600 hover:bg-rose-50'
              : isLcars
              ? 'text-[#ff6666] hover:bg-[#cc3333]/30'
              : 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/60'
          }`}
          title={t.editPanel.deleteImageBtn}
          aria-label={t.editPanel.deleteImageBtn}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  if (!isEditSidePanelOpen) return null;

  const panelSurfaceClass = isMinimal
    ? 'bg-white border-neutral-200 text-neutral-900'
    : isLcars
    ? 'bg-black border-[#ff9900] text-[#ff9900]'
    : 'bg-slate-900 border-slate-800 text-slate-100';

  const subtleSurfaceClass = isMinimal
    ? 'bg-neutral-50 border-neutral-200'
    : isLcars
    ? 'bg-[#0c0c0c] border-[#ff9900]/40'
    : 'bg-slate-950/60 border-slate-800';

  const inputClass = isMinimal
    ? 'bg-white border-neutral-300 text-black placeholder-neutral-400 focus:border-black'
    : isLcars
    ? 'bg-black border-[#ff9900]/70 text-[#ffff66] placeholder-[#ff9966]/60 focus:border-[#ffcc00]'
    : 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-indigo-500';

  const primaryBtnClass = isMinimal
    ? 'bg-black hover:bg-neutral-800 text-white rounded-md'
    : isLcars
    ? 'bg-[#ff9900] hover:bg-[#ffcc00] text-black font-bold rounded-full uppercase'
    : 'bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm';

  const secondaryBtnClass = isMinimal
    ? 'bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 rounded-md'
    : isLcars
    ? 'bg-[#111111] hover:bg-[#222222] text-[#ff9966] border border-[#ff9966] rounded-full'
    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg';

  const dangerBtnClass = isMinimal
    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md'
    : isLcars
    ? 'bg-[#cc3333]/25 hover:bg-[#cc3333]/40 text-[#ff6666] border border-[#ff3333] rounded-full'
    : 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-700/50 rounded-lg';

  return (
    <aside
      style={{ width: `${panelWidth}px` }}
      className={`relative shrink-0 h-full border-l flex flex-col z-20 transition-colors ${panelSurfaceClass}`}
    >
      {/* Left-edge Resize Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.editPanel.resizeHandleTitle}
        title={t.editPanel.resizeHandleTitle}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        className={`absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize z-30 flex items-center justify-center group ${
          isResizing
            ? isLcars
              ? 'bg-[#ff9900]/60'
              : 'bg-indigo-500/60'
            : 'hover:bg-indigo-500/35'
        }`}
      >
        <GripVertical className="w-2.5 h-4 opacity-0 group-hover:opacity-75 text-indigo-400 pointer-events-none" />
      </div>

      {/* Hidden File Input for Image Replace */}
      <input
        ref={imageReplaceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageFilePicked}
      />

      {/* Panel Header */}
      <div className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${subtleSurfaceClass}`}>
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal
            className={`w-4 h-4 shrink-0 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-indigo-400'
            }`}
          />
          <h2 className="text-xs font-bold tracking-wide truncate">{t.editPanel.panelTitle}</h2>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
              isMinimal
                ? 'bg-neutral-200 text-neutral-700'
                : isLcars
                ? 'bg-[#ff9900]/20 text-[#ffcc00]'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t.editPanel.pageBadge.replace('{page}', String(activePageIndex + 1))}
          </span>
        </div>

        <button
          type="button"
          onClick={handleClosePanel}
          className={`p-1 rounded-md transition-colors ${
            isMinimal
              ? 'text-neutral-500 hover:text-black hover:bg-neutral-200'
              : isLcars
              ? 'text-[#ff9966] hover:text-[#ffff66] hover:bg-[#222222]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title={t.editPanel.closePanel}
          aria-label={t.editPanel.closePanel}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 3-Tab Navigation Bar: Elements (Inspector) | Find & Replace | Full Stream */}
      <div className={`px-3 py-2 border-b shrink-0 ${subtleSurfaceClass}`}>
        <div
          className={`grid grid-cols-3 gap-1 p-0.5 border ${
            isMinimal
              ? 'rounded-md bg-neutral-200/70 border-neutral-300'
              : isLcars
              ? 'rounded-full bg-black border-[#ff9900]'
              : 'rounded-lg bg-slate-900 border-slate-800'
          }`}
        >
          {(
            [
              { id: 'remove', label: t.editPanel.tabElements, icon: <Layers className="w-3.5 h-3.5" /> },
              { id: 'replace', label: t.editPanel.tabFindReplace, icon: <Replace className="w-3.5 h-3.5" /> },
              { id: 'stream', label: t.editPanel.tabFullStream, icon: <FileCode2 className="w-3.5 h-3.5" /> },
            ] as const
          ).map((tab) => {
            const active = editSidePanelTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEditSidePanelTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-semibold transition-all ${
                  active
                    ? isMinimal
                      ? 'rounded bg-white text-black shadow-xs border border-neutral-300'
                      : isLcars
                      ? 'rounded-full bg-[#ff9900] text-black font-bold uppercase'
                      : 'rounded-md bg-indigo-600 text-white shadow-sm'
                    : isMinimal
                    ? 'text-neutral-600 hover:text-black'
                    : isLcars
                    ? 'text-[#ff9966] hover:text-[#ff9900]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Encrypted Document Warning */}
      {isDocumentEncrypted && (
        <div
          className={`mx-3 mt-3 p-2.5 rounded-lg border flex items-start gap-2 text-xs shrink-0 ${
            isMinimal
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : isLcars
              ? 'bg-[#261a00] border-[#ff9900] text-[#ffcc00]'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t.editPanel.encryptedWarningTitle}</p>
            <p className="text-[11px] opacity-85 mt-0.5">{t.editPanel.encryptedWarningDesc}</p>
          </div>
        </div>
      )}

      {/* TAB 1: UNIFIED ELEMENTS & INSPECTOR */}
      {editSidePanelTab === 'remove' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Pinned Selected Element Inspector Card */}
          <div className={`px-3 py-2.5 border-b shrink-0 ${subtleSurfaceClass}`}>
            {selectedTextBlock ? (
              <div className="space-y-2">
                {/* Text Block Inspector Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Type
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isMinimal ? 'text-indigo-700' : isLcars ? 'text-[#99ccff]' : 'text-indigo-400'
                      }`}
                    />
                    <span className="text-[11px] font-bold truncate">{t.editPanel.selectedTextBlock}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded truncate ${
                        isMinimal
                          ? 'bg-neutral-200 text-neutral-700'
                          : isLcars
                          ? 'bg-[#1c1c1c] text-[#99ccff]'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {selectedTextBlock.fontInfo || selectedTextBlock.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => navigateSelectedBlock(-1)}
                      className={`p-1 rounded transition-colors ${
                        isMinimal
                          ? 'hover:bg-neutral-200 text-neutral-600'
                          : isLcars
                          ? 'hover:bg-[#222] text-[#ff9966]'
                          : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                      title={t.editPanel.prevBlock}
                      aria-label={t.editPanel.prevBlock}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateSelectedBlock(1)}
                      className={`p-1 rounded transition-colors ${
                        isMinimal
                          ? 'hover:bg-neutral-200 text-neutral-600'
                          : isLcars
                          ? 'hover:bg-[#222] text-[#ff9966]'
                          : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                      title={t.editPanel.nextBlock}
                      aria-label={t.editPanel.nextBlock}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedStreamBlockId(null)}
                      className={`p-1 rounded transition-colors ${
                        isMinimal
                          ? 'hover:bg-neutral-200 text-neutral-500'
                          : isLcars
                          ? 'hover:bg-[#222] text-[#ff9966]'
                          : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                      title={t.editPanel.clearSelection}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Metadata compact line */}
                {selectedTextBlock.positionInfo && (
                  <div
                    className={`flex items-center gap-2 text-[10px] font-mono ${
                      isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                    }`}
                  >
                    <span>{selectedTextBlock.id}</span>
                    <span>•</span>
                    <span>{selectedTextBlock.positionInfo}</span>
                    {selectedTextBlock.lineCount && (
                      <>
                        <span>•</span>
                        <span>
                          {selectedTextBlock.lineCount} {t.editPanel.linesShort}
                        </span>
                      </>
                    )}
                  </div>
                )}

                {!isTextModelAligned && (
                  <div
                    className={`p-2 rounded border text-[11px] flex items-start gap-1.5 ${
                      isMinimal
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : isLcars
                        ? 'bg-[#261a00] border-[#ff9900]/60 text-[#ffcc00]'
                        : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{t.editPanel.textNotMappedWarning}</span>
                  </div>
                )}

                {/* Primary Plain-Text Editor */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="edit-inspector-plain-text"
                      className={`text-[11px] font-semibold ${
                        isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ffcc00]' : 'text-slate-300'
                      }`}
                    >
                      {t.editPanel.plainTextLabel}
                    </label>
                    <span
                      className={`text-[10px] ${
                        isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9966]/75' : 'text-slate-500'
                      }`}
                    >
                      {t.editPanel.applyTextShortcutHint}
                    </span>
                  </div>
                  <textarea
                    id="edit-inspector-plain-text"
                    rows={3}
                    value={quickReplaceNewText}
                    disabled={isSaving || isDocumentEncrypted}
                    placeholder={t.editPanel.plainTextPlaceholder}
                    onChange={(e) => setQuickReplaceNewText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void handleApplyTextEdit();
                      }
                    }}
                    className={`w-full px-2.5 py-1.5 text-xs rounded-md border outline-none resize-y min-h-[58px] max-h-40 ${inputClass}`}
                  />
                </div>

                {/* Primary Actions Row (Single unambiguous Save + Delete) */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      isSaving ||
                      isDocumentEncrypted ||
                      !isTextModelAligned ||
                      quickReplaceNewText === selectedTextBlock.previewText
                    }
                    onClick={handleApplyTextEdit}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{isSaving ? t.editPanel.saving : t.editPanel.applyTextBtn}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving || isDocumentEncrypted}
                    onClick={() => handleDeleteSingleBlock(selectedTextBlock.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 ${dangerBtnClass}`}
                    title={t.editPanel.deleteBlockBtn}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.editPanel.canvasDelete}</span>
                  </button>
                </div>

                {/* Collapsible Advanced: PDF Stream Code Disclosure */}
                <div className={`pt-1.5 border-t ${isMinimal ? 'border-neutral-200' : isLcars ? 'border-[#333333]' : 'border-slate-800'}`}>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedCode((prev) => !prev)}
                    aria-expanded={showAdvancedCode}
                    className={`w-full flex items-center justify-between py-1 text-[11px] font-semibold transition-colors ${
                      isMinimal
                        ? 'text-neutral-600 hover:text-black'
                        : isLcars
                        ? 'text-[#99ccff] hover:text-[#ffff66]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5" />
                      <span>{t.editPanel.advancedCodeToggle}</span>
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showAdvancedCode ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showAdvancedCode && (
                    <div className="mt-2 space-y-2">
                      {readableState?.blockId === selectedTextBlock.id && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setReadableMode(true)}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                              readableMode ? primaryBtnClass : secondaryBtnClass
                            }`}
                          >
                            {t.editPanel.readableCode}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReadableMode(false)}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                              !readableMode ? primaryBtnClass : secondaryBtnClass
                            }`}
                          >
                            {t.editPanel.rawCode}
                          </button>
                        </div>
                      )}

                      <textarea
                        rows={5}
                        spellCheck={false}
                        value={showReadable ? readableText : editorContent}
                        disabled={isSaving || isDocumentEncrypted}
                        onChange={(e) => {
                          if (showReadable) setReadableText(e.target.value);
                          else setEditorContent(e.target.value);
                        }}
                        className={`w-full px-2.5 py-2 text-[11px] font-mono rounded-md border outline-none resize-y ${inputClass}`}
                      />

                      <button
                        type="button"
                        disabled={isSaving || isDocumentEncrypted}
                        onClick={handleSaveSegmentEdit}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 ${secondaryBtnClass}`}
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>{t.editPanel.saveStreamCodeBtn}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedImageInfo ? (
              <div className="space-y-2.5">
                {/* Image Inspector Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ImageIcon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isMinimal ? 'text-amber-700' : isLcars ? 'text-[#ffcc00]' : 'text-amber-400'
                      }`}
                    />
                    <span className="text-[11px] font-bold truncate">{t.editPanel.selectedImage}</span>
                    <span className="text-[11px] font-mono truncate opacity-80">{selectedImageInfo.cleanName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedStreamBlockId(null)}
                    className={`p-1 rounded transition-colors ${
                      isMinimal
                        ? 'hover:bg-neutral-200 text-neutral-500'
                        : isLcars
                        ? 'hover:bg-[#222] text-[#ff9966]'
                        : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Thumbnail + Technical Specs */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-16 h-16 rounded-lg border flex items-center justify-center overflow-hidden shrink-0 ${
                      isMinimal
                        ? 'bg-neutral-100 border-neutral-200'
                        : isLcars
                        ? 'bg-black border-[#ff9900]/50'
                        : 'bg-slate-950 border-slate-700'
                    }`}
                  >
                    {selectedImageInfo.thumbnailDataUrl ? (
                      <img
                        src={selectedImageInfo.thumbnailDataUrl}
                        alt={selectedImageInfo.cleanName}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-amber-400" />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] flex-1 min-w-0">
                    {selectedImageInfo.pixelWidth && selectedImageInfo.pixelHeight && (
                      <div>
                        <span className="opacity-60 block text-[10px]">{t.editPanel.resolutionLabel}</span>
                        <span className="font-mono font-semibold">
                          {selectedImageInfo.pixelWidth}×{selectedImageInfo.pixelHeight}
                        </span>
                      </div>
                    )}
                    {selectedImageInfo.dpi && (
                      <div>
                        <span className="opacity-60 block text-[10px]">{t.editPanel.dpiLabel}</span>
                        <span className="font-mono font-semibold">{selectedImageInfo.dpi} DPI</span>
                      </div>
                    )}
                    {selectedImageInfo.width && selectedImageInfo.height && (
                      <div>
                        <span className="opacity-60 block text-[10px]">{t.editPanel.sizePtLabel}</span>
                        <span className="font-mono font-semibold">
                          {Math.round(selectedImageInfo.width)}×{Math.round(selectedImageInfo.height)} pt
                        </span>
                      </div>
                    )}
                    {selectedImageInfo.format && (
                      <div>
                        <span className="opacity-60 block text-[10px]">{t.editPanel.formatLabel}</span>
                        <span className="font-mono font-semibold uppercase">{selectedImageInfo.format}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Image Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleExportImage(selectedImageInfo)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors ${secondaryBtnClass}`}
                    title={t.editPanel.downloadImage}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.editPanel.downloadImage}</span>
                  </button>

                  <button
                    type="button"
                    disabled={
                      isSaving ||
                      isDocumentEncrypted ||
                      selectedImageInfo.kind === 'inline' ||
                      !selectedImageInfo.name
                    }
                    onClick={() => triggerImageReplace(selectedImageInfo)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
                    title={
                      selectedImageInfo.kind === 'inline' || !selectedImageInfo.name
                        ? t.editPanel.replaceInlineDisabled
                        : t.editPanel.replaceImage
                    }
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t.editPanel.replaceImage}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving || isDocumentEncrypted}
                    onClick={() => handleDeleteSingleImage(selectedImageInfo)}
                    className={`p-1.5 transition-colors disabled:opacity-45 ${dangerBtnClass}`}
                    title={t.editPanel.deleteImageBtn}
                    aria-label={t.editPanel.deleteImageBtn}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-1 text-center">
                <p
                  className={`text-xs font-semibold ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ffcc00]' : 'text-slate-300'
                  }`}
                >
                  {t.editPanel.noElementSelected}
                </p>
                <p
                  className={`text-[11px] mt-0.5 leading-relaxed ${
                    isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]/80' : 'text-slate-400'
                  }`}
                >
                  {t.editPanel.noElementSelectedHint}
                </p>
              </div>
            )}
          </div>

          {/* Search, Type Filters, View Order & Explicit Batch Mode Bar */}
          <div className="px-3 py-2 border-b space-y-2 shrink-0 border-inherit">
            {/* Search Input */}
            <div className="relative">
              <Search
                className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${
                  isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]' : 'text-slate-500'
                }`}
              />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={t.editPanel.searchElementsPlaceholder}
                className={`w-full pl-8 pr-7 py-1.5 text-xs rounded-md border outline-none ${inputClass}`}
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Pills + Sort + Batch Select */}
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'all', label: `${t.editPanel.filterAll} (${segments.length + images.length})` },
                    { id: 'text', label: `${t.editPanel.filterText} (${segments.length})` },
                    { id: 'image', label: `${t.editPanel.filterImages} (${images.length})` },
                  ] as const
                ).map((pill) => {
                  const active = filterType === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setFilterType(pill.id)}
                      className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        active ? primaryBtnClass : secondaryBtnClass
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSortMode((m) => (m === 'reading' ? 'stream' : 'reading'))}
                  className={`p-1 transition-colors ${secondaryBtnClass}`}
                  title={sortMode === 'reading' ? t.editPanel.viewTree : t.editPanel.viewStream}
                  aria-label={sortMode === 'reading' ? t.editPanel.viewTree : t.editPanel.viewStream}
                >
                  {sortMode === 'reading' ? <ListTree className="w-3.5 h-3.5" /> : <Binary className="w-3.5 h-3.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (isBatchMode) {
                      clearBatchSelection();
                      setIsBatchMode(false);
                    } else {
                      setIsBatchMode(true);
                    }
                  }}
                  aria-pressed={isBatchMode}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    isBatchMode ? dangerBtnClass : secondaryBtnClass
                  }`}
                  title={isBatchMode ? t.editPanel.batchModeExit : t.editPanel.batchMode}
                >
                  <CheckSquare className="w-3 h-3" />
                  <span>{isBatchMode ? t.editPanel.batchModeExit : t.editPanel.batchMode}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Scrollable Elements List */}
          <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2 min-h-0">
            {isLoading ? (
              <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <span>{t.editPanel.loadingPage}</span>
              </div>
            ) : segments.length === 0 && images.length === 0 ? (
              <div className="py-10 text-center space-y-1">
                <p className="text-xs font-semibold opacity-80">{t.editPanel.emptyPageTitle}</p>
                <p className="text-[11px] opacity-60">{t.editPanel.emptyPageDesc}</p>
              </div>
            ) : allPageElements.length === 0 && unplacedImages.length === 0 ? (
              <div className="py-8 text-center text-xs opacity-65">{t.editPanel.noFilterMatches}</div>
            ) : (
              <>
                {hasFullPageScan && fullPageScanImage && (
                  <div
                    className={`p-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
                      isMinimal
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : isLcars
                        ? 'bg-[#261a00] border-[#ffcc00] text-[#ffcc00]'
                        : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <span className="font-semibold">{t.editPanel.fullPageScanBadge}</span>
                    <span className="font-mono text-[10px] opacity-80">
                      {fullPageScanImage.pixelWidth}×{fullPageScanImage.pixelHeight} px
                      {fullPageScanImage.dpi ? ` • ${fullPageScanImage.dpi} DPI` : ''}
                    </span>
                  </div>
                )}

                {sortMode === 'reading' ? (
                  <div className="space-y-2.5">
                    {documentSections.map((section) => {
                      const isCollapsed = collapsedSectionIds.has(section.id);
                      const secBlockIds = [
                        ...(section.headingBlock ? [section.headingBlock.id] : []),
                        ...section.items.filter((i) => i.kind === 'text').map((i) => i.block.id),
                      ];
                      const secImageIds = section.items
                        .filter((i) => i.kind === 'image')
                        .map((i) => i.image.id);
                      const secCount = secBlockIds.length + secImageIds.length;
                      const allSecChecked =
                        secCount > 0 &&
                        secBlockIds.every((id) => selectedBlockIds.has(id)) &&
                        secImageIds.every((id) => selectedImageNames.has(id));

                      return (
                        <div key={section.id} className="space-y-1.5">
                          {/* Section Header */}
                          <div
                            onClick={(e) => toggleSectionCollapse(section.id, e)}
                            className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none ${
                              isMinimal
                                ? 'bg-neutral-100 hover:bg-neutral-200/70 text-neutral-800'
                                : isLcars
                                ? 'bg-[#151515] hover:bg-[#222222] text-[#ffcc00]'
                                : 'bg-slate-800/70 hover:bg-slate-800 text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <ChevronDown
                                className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                                  isCollapsed ? '-rotate-90' : ''
                                }`}
                              />
                              {(isBatchMode || totalBatchSelected > 0) && (
                                <input
                                  type="checkbox"
                                  checked={allSecChecked}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => toggleSectionBatchSelection(section, e)}
                                  className="rounded border-slate-600 text-rose-500 cursor-pointer shrink-0"
                                />
                              )}
                              <span className="text-[11px] font-semibold truncate">{section.title}</span>
                              <span className="text-[10px] opacity-60 shrink-0">({secCount})</span>
                            </div>

                            {secCount > 1 && !isDocumentEncrypted && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={(e) => requestSectionDeletion(section, e)}
                                className={`p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity ${
                                  isMinimal
                                    ? 'hover:text-rose-600'
                                    : isLcars
                                    ? 'text-[#ff6666]'
                                    : 'hover:text-rose-400'
                                }`}
                                title={t.editPanel.deleteSectionTooltip}
                                aria-label={t.editPanel.deleteSectionTooltip}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {!isCollapsed && (
                            <div className="space-y-1.5">
                              {section.headingBlock && renderTextBlockRow(section.headingBlock, false)}
                              {section.items.map((el) =>
                                el.kind === 'text'
                                  ? renderTextBlockRow(el.block, Boolean(section.headingBlock))
                                  : renderImageRow(el.image, Boolean(section.headingBlock))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {allPageElements.map((el) =>
                      el.kind === 'text' ? renderTextBlockRow(el.block) : renderImageRow(el.image)
                    )}
                  </div>
                )}

                {unplacedImages.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60 px-1">
                      {t.editPanel.imagesSection} ({unplacedImages.length})
                    </p>
                    {unplacedImages.map((im) => renderImageRow(im))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Inline 2-Step Confirmation Banner (Bulk / Section Deletes >= 2 items) */}
          {pendingConfirm && (
            <div
              role="alertdialog"
              aria-label={t.editPanel.confirmBatchTitle}
              className={`mx-3 mb-2 p-2.5 rounded-lg border space-y-2 shrink-0 animate-in fade-in duration-150 ${
                isMinimal
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : isLcars
                  ? 'bg-[#260000] border-[#ff3333] text-[#ff9999]'
                  : 'bg-rose-950/70 border-rose-500/60 text-rose-100'
              }`}
            >
              <div className="flex items-start gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="min-w-0">
                  <p className="font-bold">{t.editPanel.confirmBatchTitle}</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {pendingConfirm.kind === 'section'
                      ? t.editPanel.confirmSectionMessage
                          .replace('{title}', pendingConfirm.title || '')
                          .replace('{count}', String(pendingConfirm.count))
                      : t.editPanel.confirmBatchMessage.replace('{count}', String(pendingConfirm.count))}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className={`px-2.5 py-1 text-[11px] font-semibold ${secondaryBtnClass}`}
                >
                  {t.editPanel.cancelAction}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={confirmPendingDeletion}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
                >
                  {t.editPanel.confirmDeleteAction}
                </button>
              </div>
            </div>
          )}

          {/* Sticky Batch Action Bar (visible in Batch Mode or when >= 1 checkbox checked) */}
          {(isBatchMode || totalBatchSelected > 0) && (
            <div className={`px-3 py-2.5 border-t flex flex-col gap-2 shrink-0 ${subtleSurfaceClass}`}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold">
                  {t.editPanel.selectedCountBadge.replace('{count}', String(totalBatchSelected))}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="underline hover:opacity-100 opacity-80 text-[11px]"
                  >
                    {t.editPanel.selectAll}
                  </button>
                  {totalBatchSelected > 0 && (
                    <button
                      type="button"
                      onClick={clearBatchSelection}
                      className="underline hover:opacity-100 opacity-80 text-[11px]"
                    >
                      {t.editPanel.clearSelection}
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={totalBatchSelected === 0 || isSaving || isDocumentEncrypted}
                onClick={requestBatchDeletion}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.editPanel.deleteSelectedBtn.replace('{count}', String(totalBatchSelected))}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FIND & REPLACE IN CONTENT STREAMS */}
      {editSidePanelTab === 'replace' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="edit-find-input" className="block text-xs font-semibold">
              {t.editPanel.findLabel}
            </label>
            <input
              id="edit-find-input"
              type="text"
              value={findQuery}
              disabled={isReplacingText || isDocumentEncrypted}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder={t.editPanel.findPlaceholder}
              className={`w-full px-3 py-2 text-xs rounded-md border outline-none ${inputClass}`}
            />
            {findQuery && (
              <p
                className={`text-[11px] ${
                  currentPageFindMatches > 0
                    ? isMinimal
                      ? 'text-emerald-700'
                      : isLcars
                      ? 'text-[#ffcc00]'
                      : 'text-emerald-400'
                    : 'opacity-65'
                }`}
              >
                {currentPageFindMatches > 0
                  ? t.editPanel.matchesPreview.replace('{count}', String(currentPageFindMatches))
                  : t.editPanel.matchesNonePreview}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-replace-input" className="block text-xs font-semibold">
              {t.editPanel.replaceLabel}
            </label>
            <input
              id="edit-replace-input"
              type="text"
              value={replaceValue}
              disabled={isReplacingText || isDocumentEncrypted}
              onChange={(e) => setReplaceValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleRunFindReplace();
                }
              }}
              placeholder={t.editPanel.replacePlaceholder}
              className={`w-full px-3 py-2 text-xs rounded-md border outline-none ${inputClass}`}
            />
          </div>

          {/* Match Case Checkbox */}
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={replaceMatchCase}
              onChange={(e) => setReplaceMatchCase(e.target.checked)}
              className="rounded border-slate-600 text-indigo-500 cursor-pointer"
            />
            <span>{t.editPanel.matchCase}</span>
          </label>

          {/* Scope Selector */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold">{t.editPanel.scopeLabel}</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setReplaceScope('current')}
                className={`py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  replaceScope === 'current' ? primaryBtnClass : secondaryBtnClass
                }`}
              >
                {t.editPanel.scopeCurrentPage}
              </button>
              <button
                type="button"
                onClick={() => setReplaceScope('all')}
                className={`py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  replaceScope === 'all' ? primaryBtnClass : secondaryBtnClass
                }`}
              >
                {t.editPanel.scopeAllPages} ({pages.length})
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={!findQuery || isReplacingText || isDocumentEncrypted}
            onClick={handleRunFindReplace}
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold transition-all disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
          >
            {isReplacingText ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Replace className="w-4 h-4" />
            )}
            <span>{isReplacingText ? t.editPanel.replacingAction : t.editPanel.replaceAction}</span>
          </button>

          <div
            className={`p-2.5 rounded-lg border text-[11px] leading-relaxed opacity-85 ${subtleSurfaceClass}`}
          >
            {t.editPanel.findReplaceNote}
          </div>
        </div>
      )}

      {/* TAB 3: FULL PAGE CONTENT STREAM (POWER USER) */}
      {editSidePanelTab === 'stream' && (
        <div className="flex-1 flex flex-col min-h-0 p-3 space-y-2.5">
          <div
            className={`p-2 rounded-lg border text-[11px] flex items-start gap-2 shrink-0 ${
              isMinimal
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : isLcars
                ? 'bg-[#261a00] border-[#ff9900]/60 text-[#ffcc00]'
                : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t.editPanel.fullStreamWarning}</span>
          </div>

          <div className="flex items-center justify-between text-[11px] shrink-0">
            <span className="font-semibold">{t.editPanel.fullStreamLabel}</span>
            <span className="font-mono opacity-65">{fullStreamText.length.toLocaleString()} chars</span>
          </div>

          <textarea
            spellCheck={false}
            value={fullStreamText}
            disabled={isSaving || isLoading || isDocumentEncrypted}
            onChange={(e) => setFullStreamText(e.target.value)}
            className={`flex-1 min-h-0 w-full p-2.5 text-[11px] font-mono leading-relaxed rounded-md border outline-none resize-none ${inputClass}`}
          />

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving || fullStreamText === originalFullStreamText}
              onClick={() => setFullStreamText(originalFullStreamText)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${secondaryBtnClass}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.editPanel.resetChanges}</span>
            </button>

            <button
              type="button"
              disabled={
                isSaving ||
                isDocumentEncrypted ||
                !fullStreamText.trim() ||
                fullStreamText === originalFullStreamText
              }
              onClick={handleSaveFullStream}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSaving ? t.editPanel.saving : t.editPanel.saveFullStreamBtn}</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
