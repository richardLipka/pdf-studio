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
  ChevronDown,
  Lock,
  Download,
} from 'lucide-react';

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
    thumbCanvas.width = tw;
    thumbCanvas.height = th;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, tw, th);
    return thumbCanvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
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
    replacePageImage,
    exportPageImage,
    removeMultiplePageElements,
    applyStreamSegmentEdit,
    applyPageContentStreamEdit,
    applyBlockTextEdit,
    selectedAnnotationId,
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
  // Fragments the canvas shows as one block (e.g. a list number and its text), keyed by segment id
  const [segmentGroups, setSegmentGroups] = useState<Map<string, string[]>>(new Map());
  const [images, setImages] = useState<PageImageInfo[]>([]);

  // Search & Filters
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image'>('all');

  // Selection for Deletion
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());

  // Stream Editor Tab State
  const [streamEditorSubTab, setStreamEditorSubTab] = useState<'segment' | 'fullStream'>('segment');
  const [editorContent, setEditorContent] = useState<string>('');
  // Readable code: string operands shown as «decoded text» instead of font codes
  const [readableMode, setReadableMode] = useState<boolean>(true);
  const [readableText, setReadableText] = useState<string>('');
  const [readableState, setReadableState] = useState<{
    blockId: string;
    readable: ReadableBlock;
    model: PageTextModel;
    block: TextBlock;
  } | null>(null);
  const [quickReplaceNewText, setQuickReplaceNewText] = useState<string>('');
  const [isDocumentEncrypted, setIsDocumentEncrypted] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{
    type: 'idle' | 'success' | 'error';
    text?: string;
  }>({ type: 'idle' });

  // Several loads can overlap (one edit changes the source, history and page); only the newest applies
  const loadSequenceRef = useRef(0);
  // Canvas target (clicked text / position) already applied to the selection; the reloads that
  // follow every edit must not jump the selection back to it
  const consumedTargetRef = useRef<{ text: unknown; pos: unknown } | null>(null);
  const modelTextIdsRef = useRef<Set<string>>(new Set());
  const segmentHasModelText = (id: string) => modelTextIdsRef.current.has(id);

  // Load stream and images when panel opens or page changes
  const loadPageData = async (
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

        // Enrich segments with true Unicode text from visual blocks
        const activePageModel = pages[activePageIndex];
        const activeSource = activePageModel
          ? sources.find((s) => s.id === activePageModel.sourceDocId) || sources[0]
          : null;
        if (activePageModel && activeSource) {
          try {
            // The text model knows the real text of every block, whatever the font encoding
            const model = await getPageTextModel(activeSource, activePageModel);
            modelTextIdsRef.current = new Set();
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
                  // Glyph IDs of embedded (Identity-H) fonts decode to control characters
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
            // ignore visual enrich failure
          }
        }

        if (isStale()) return;
        setFullStreamText(streamRes.streamText);
        setSegments(textSegments);
      } else {
        setFullStreamText('');
        setSegments([]);
        setSegmentGroups(new Map());
      }

      if (imagesRes.images) {
        const enrichedImages = [...imagesRes.images];
        const activePageModel = pages[activePageIndex];
        const canvasEl = document.getElementById(
          `page_canvas_${activePageModel?.id}`
        ) as HTMLCanvasElement | null;
        if (canvasEl && activePageModel) {
          enrichedImages.forEach((im) => {
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
        setImages(enrichedImages);
      } else {
        setImages([]);
      }

      const targetText =
        preferredTargetText !== undefined ? preferredTargetText : streamReplaceTargetText;
      const targetPos =
        preferredTargetPos !== undefined ? preferredTargetPos : streamReplaceTargetPosition;

      const isFreshTarget =
        preferredTargetText !== undefined ||
        preferredTargetPos !== undefined ||
        consumedTargetRef.current?.text !== targetText ||
        consumedTargetRef.current?.pos !== targetPos;
      // An image selected on the canvas stays selected; the nearest text block must not replace it
      const selectedImage =
        Boolean(selectedStreamBlockId) &&
        (selectedStreamBlockId!.startsWith('img_') || selectedStreamBlockId!.startsWith('/'));
      const keepSelection =
        (selectedImage && preferredTargetText === undefined && preferredTargetPos === undefined) ||
        (!isFreshTarget &&
          Boolean(selectedStreamBlockId) &&
          textSegments.some((s) => s.id === selectedStreamBlockId));

      // If opened with target block from canvas click: the block under the clicked point (exact
      // text model boxes), otherwise the best text match
      if (keepSelection) {
        // Reload after an edit or undo: stay on the block the user is working with
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

  const imageReplaceInputRef = useRef<HTMLInputElement>(null);
  const [targetReplacingImage, setTargetReplacingImage] = useState<PageImageInfo | null>(null);

  const triggerImageReplace = (im: PageImageInfo) => {
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
      const res = await replacePageImage(targetReplacingImage.name, file);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Obrázek ${targetReplacingImage.cleanName} byl úspěšně nahrazen.`,
        });
        await loadPageData();
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Výměna obrázku selhala.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || String(err),
      });
    } finally {
      setIsSaving(false);
      setTargetReplacingImage(null);
    }
  };

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

    const res = await exportPageImage(im.name, activePageIndex, canvasEl, pdfBox);
    if (res.success) {
      setStatusMessage({
        type: 'success',
        text: `Obrázek ${im.cleanName} byl úspěšně exportován.`,
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: res.error || 'Export obrázku selhal.',
      });
    }
  };

  const handleDeleteImage = async (im: PageImageInfo) => {
    setIsSaving(true);
    try {
      const res = await removeMultiplePageElements([], [im.name], activePageIndex);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Obrázek ${im.cleanName} byl úspěšně odstraněn.`,
        });
        setSelectedImageNames((prev) => {
          const next = new Set(prev);
          next.delete(im.name);
          return next;
        });
        await loadPageData();
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Odstranění obrázku selhalo.',
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

  // Delete / Backspace removes the page element selected on the canvas or in the list (an image or
  // a text block), unless the user is typing or an annotation is selected (that has its own handler)
  const deleteSelectedElementRef = useRef<() => boolean>(() => false);
  deleteSelectedElementRef.current = () => {
    if (!selectedStreamBlockId || selectedAnnotationId || isSaving || isLoading) return false;
    const image = images.find(
      (im) =>
        selectedStreamBlockId === im.name ||
        selectedStreamBlockId === `img_${im.cleanName}` ||
        selectedStreamBlockId === `/${im.cleanName}`
    );
    if (image) {
      handleDeleteImage(image);
      return true;
    }
    if (segments.some((seg) => seg.id === selectedStreamBlockId)) {
      handleDeleteSingleBlock(selectedStreamBlockId);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!isEditSidePanelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
      // Marked as handled so the page-deletion shortcut (App) leaves it alone; the capture phase
      // runs before the other window-level keyboard handlers
      if (deleteSelectedElementRef.current()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isEditSidePanelOpen]);

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
            )
              return im;
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

  // Sort Mode State: 'reading' (Visual top-to-bottom hierarchy) vs 'stream' (Raw stream byte order)
  const [sortMode, setSortMode] = useState<'reading' | 'stream'>('reading');

  // React to Undo / Redo, page switch, and source PDF byte buffer updates automatically
  useEffect(() => {
    if (isEditSidePanelOpen) {
      loadPageData();
    }
  }, [isEditSidePanelOpen, activePageIndex, historyIndex, sourceUpdatedAt, sourceByteLength]);

  // A new canvas target (clicked block or text, selection sent to the editor) while the panel is
  // already open selects the block under it right away
  useEffect(() => {
    if (isEditSidePanelOpen && (streamReplaceTargetText || streamReplaceTargetPosition)) {
      loadPageData();
    }
  }, [streamReplaceTargetText, streamReplaceTargetPosition]);

  // The result of the last operation stays visible after the reload its own commit triggers
  useEffect(() => {
    setStatusMessage({ type: 'idle' });
  }, [isEditSidePanelOpen, activePageIndex]);

  // Readable form of the selected block, built from the page text model
  useEffect(() => {
    let cancelled = false;
    setReadableState(null);
    const activePageModel = pages[activePageIndex];
    const activeSource = activePageModel
      ? sources.find((src) => src.id === activePageModel.sourceDocId) || sources[0]
      : null;
    if (!selectedStreamBlockId || !activePageModel || !activeSource) return;
    getPageTextModel(activeSource, activePageModel).then((model) => {
      if (cancelled || !model?.aligned) return;
      const block = model.blocksById.get(selectedStreamBlockId);
      const segment = segments.find((seg) => seg.id === selectedStreamBlockId);
      if (!block || !segment || model.streamText.substring(block.startIndex, block.endIndex) !== segment.rawContent) return;
      const readable = toReadableBlock(model, block);
      if (readable.originals.length === 0) return;
      setReadableState({ blockId: selectedStreamBlockId, readable, model, block });
      setReadableText(readable.text);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStreamBlockId, segments, activePageIndex, sources, pages]);

  const showReadable = readableMode && readableState?.blockId === selectedStreamBlockId;

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

  // Unified page elements (text and bitmap images interleaved in reading order)
  type PageElement =
    | { kind: 'text'; block: StreamSegment; y: number; x: number }
    | { kind: 'image'; image: PageImageInfo; y: number; x: number };

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

    if (sortMode === 'stream') {
      return [...textItems, ...imageItems];
    }

    // Top-of-page first (higher Y in PDF points)
    return [...textItems, ...imageItems].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 5) {
        return b.y - a.y;
      }
      return a.x - b.x;
    });
  }, [filteredBlocks, filteredImages, sortMode, filterType]);

  const unplacedImages = useMemo(() => {
    return filteredImages.filter((im) => im.x === undefined || im.y === undefined);
  }, [filteredImages]);

  const fullPageScanImage = useMemo(() => {
    return images.find((im) => im.isFullPageScan);
  }, [images]);

  const hasFullPageScan = Boolean(fullPageScanImage && segments.length <= 2);

  // Semantic document sections for true tree hierarchy (Reading mode)
  interface DocumentSection {
    id: string;
    headingBlock?: StreamSegment;
    title: string;
    role: 'h1' | 'h2' | 'intro';
    items: PageElement[];
  }

  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());

  const toggleSectionCollapse = (secId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  };

  const documentSections = useMemo(() => {
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
            title: 'Úvodní obsah / Záhlaví',
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
  }, [allPageElements]);

  const toggleSectionSelection = (section: DocumentSection, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    const allTextIds: string[] = [];
    const allImageNames: string[] = [];
    if (section.headingBlock) allTextIds.push(section.headingBlock.id);
    section.items.forEach((c) => {
      if (c.kind === 'text') allTextIds.push(c.block.id);
      else allImageNames.push(c.image.name);
    });

    const allTextSelected = allTextIds.every((id) => selectedBlockIds.has(id));
    const allImgSelected = allImageNames.every((name) => selectedImageNames.has(name));
    const allSelected = allTextSelected && allImgSelected;

    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allTextIds.forEach((id) => next.delete(id));
      else allTextIds.forEach((id) => next.add(id));
      return next;
    });

    setSelectedImageNames((prev) => {
      const next = new Set(prev);
      if (allSelected) allImageNames.forEach((name) => next.delete(name));
      else allImageNames.forEach((name) => next.add(name));
      return next;
    });
  };

  const handleDeleteSection = async (section: DocumentSection, e: React.MouseEvent) => {
    e.stopPropagation();
    const allTextIds: string[] = [];
    const allImageNames: string[] = [];
    if (section.headingBlock) allTextIds.push(section.headingBlock.id);
    section.items.forEach((c) => {
      if (c.kind === 'text') allTextIds.push(c.block.id);
      else allImageNames.push(c.image.name);
    });
    if (allTextIds.length === 0 && allImageNames.length === 0) return;

    setIsSaving(true);
    try {
      const res = await removeMultiplePageElements(allTextIds, allImageNames, activePageIndex, expectedContentsFor(allTextIds));
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Celá sekce (${allTextIds.length + allImageNames.length} prvků) byla úspěšně odstraněna.`,
        });
        setSelectedBlockIds((prev) => {
          const next = new Set(prev);
          allTextIds.forEach((id) => next.delete(id));
          return next;
        });
        setSelectedImageNames((prev) => {
          const next = new Set(prev);
          allImageNames.forEach((name) => next.delete(name));
          return next;
        });
        await loadPageData();
      } else {
        setStatusMessage({ type: 'error', text: res.error || 'Odstranění sekce selhalo.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Stream text of the segments as listed, so a stale list can never remove a different block
  const expectedContentsFor = (ids: string[]): Record<string, string> => {
    const expected: Record<string, string> = {};
    for (const id of ids) {
      const seg = segments.find((s) => s.id === id);
      if (seg) expected[id] = seg.rawContent;
    }
    return expected;
  };

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
        const pageHeight = pages[activePageIndex]?.height || 842;
        setStreamReplaceTargetPosition({ x: found.x, y: pageHeight - found.y });
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

    // Expand the selection with fragments that belong to the same visual block
    const allTargetSegmentIds = new Set<string>();
    for (const id of selectedBlockIds) {
      (segmentGroups.get(id) ?? [id]).forEach((sid) => allTargetSegmentIds.add(sid));
    }

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await removeMultiplePageElements(
        Array.from(allTargetSegmentIds),
        Array.from(selectedImageNames),
        activePageIndex,
        expectedContentsFor(Array.from(allTargetSegmentIds))
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
          setSegmentGroups(new Map());

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
  const handleDeleteSingleBlock = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const origBlock = segments.find((s) => s.id === id);
    if (!origBlock) return;

    // Include directly adjacent fragments of the same visual block (e.g. number bullet + text chunk),
    // but not other blocks that merely share the baseline, such as neighbouring table columns
    const targetSegmentIds = segmentGroups.get(id) ?? [id];

    setIsSaving(true);
    try {
      const res = await removeMultiplePageElements(targetSegmentIds, [], activePageIndex, expectedContentsFor(targetSegmentIds));
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Blok ${id} byl úspěšně odstraněn.`,
        });

        setSelectedBlockIds((prev) => {
          const next = new Set(prev);
          targetSegmentIds.forEach((sid) => next.delete(sid));
          return next;
        });

        if (targetSegmentIds.includes(selectedStreamBlockId || '')) {
          setStreamReplaceTargetText('');
          setStreamReplaceTargetPosition(null);
        }

        if (res.updatedStream !== undefined) {
          setFullStreamText(res.updatedStream);
          const parsed = parseStreamSegments(res.updatedStream);
          const textSegments = parsed.filter((s) => s.type === 'text');
          setSegments(textSegments);
          setSegmentGroups(new Map());

          if (targetSegmentIds.includes(selectedStreamBlockId || '')) {
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
          await loadPageData();
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
    let content = editorContent;
    if (showReadable && readableState) {
      const converted = fromReadableBlock(readableState.model, readableState.block, readableState.readable, readableText);
      if ('error' in converted) {
        setStatusMessage({ type: 'error', text: converted.error });
        return;
      }
      content = converted.raw;
    }

    setIsSaving(true);
    setStatusMessage({ type: 'idle' });

    try {
      const res = await applyStreamSegmentEdit(
        origBlock.rawContent,
        content,
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
          setSegmentGroups(new Map());

          const updatedBlock =
            textSegments.find((s) => s.id === selectedStreamBlockId) ||
            textSegments.find((s) => s.rawContent === content) ||
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

  // Rewrites the text of the selected block (encoded with the block's own font when possible)
  const handleApplyTextEdit = async () => {
    if (!selectedStreamBlockId) return;
    const blockId = selectedStreamBlockId;
    setIsSaving(true);
    setStatusMessage({ type: 'idle' });
    try {
      const res = await applyBlockTextEdit(blockId, quickReplaceNewText, activePageIndex);
      if (!res.success) {
        setStatusMessage({ type: 'error', text: res.error || 'Přepis textu selhal.' });
        return;
      }
      setStatusMessage({
        type: 'success',
        text: res.fontSubstituted
          ? 'Text byl přepsán. Vložené písmo dokumentu neobsahuje všechny znaky nového textu, proto bylo pro tento blok použito náhradní písmo.'
          : 'Text byl přepsán původním písmem na stejném místě.',
      });
      // The committed document reloads the panel (segments with their decoded text) automatically
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setIsSaving(false);
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
          setSegmentGroups(new Map());
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

  const renderBlockCard = (b: StreamSegment, isChild: boolean = false) => {
    const isChecked = selectedBlockIds.has(b.id);
    const isCurrentActive = selectedStreamBlockId === b.id;
    const isHovered =
      hoveredBlockId === b.id ||
      (Boolean(hoveredBlockText) &&
        b.previewText.length >= 4 &&
        (b.previewText === hoveredBlockText ||
          b.previewText.toLowerCase().includes(hoveredBlockText!.toLowerCase())));

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
          isChild ? 'border-l-2 border-l-indigo-400/60' : ''
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
                {b.markedContentTag}
              </span>
            )}

            {/* Indentation Depth Badge (only if genuine text indent) */}
            {indentMm > 6 && indentMm < 75 && b.headingRole !== 'h1' && b.headingRole !== 'h2' && (
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
  };

  const renderImageCard = (im: PageImageInfo, isChild = false) => {
    const isChecked = selectedImageNames.has(im.name);
    const isCurrentActive =
      selectedStreamBlockId === im.name ||
      selectedStreamBlockId === `img_${im.cleanName}` ||
      selectedStreamBlockId === `/${im.cleanName}`;

    return (
      <div
        key={im.name}
        id={`panel_item_img_${im.cleanName}`}
        onClick={() => {
          setSelectedStreamBlockId(im.name);
          toggleImageSelection(im.name);
        }}
        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
          isChild ? 'border-l-2 border-l-amber-500/60' : ''
        } ${
          isCurrentActive
            ? isMinimal
              ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-400 shadow-sm'
              : isLcars
              ? 'bg-[#ffcc00]/25 border-[#ffcc00] ring-1 ring-[#ffcc00]'
              : 'bg-amber-950/40 border-amber-500 ring-1 ring-amber-500/60 shadow-lg shadow-amber-950/30'
            : isChecked
            ? isMinimal
              ? 'bg-rose-50 border-rose-300'
              : 'bg-rose-950/20 border-rose-700/60'
            : isMinimal
            ? 'bg-neutral-50/70 hover:bg-neutral-100 border-neutral-200'
            : isLcars
            ? 'bg-[#111111] hover:bg-[#1a1a1a] border-[#333333]'
            : 'bg-slate-800/30 hover:bg-slate-800/70 border-slate-750'
        }`}
      >
        {/* Top bar with Checkbox, CleanName, Badges, and Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                toggleImageSelection(im.name);
              }}
              className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
            />
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                isCurrentActive
                  ? 'bg-amber-600 text-white'
                  : isMinimal
                  ? 'bg-neutral-200 text-neutral-800'
                  : 'bg-slate-900 text-amber-300 border border-slate-700'
              }`}
            >
              /{im.cleanName}
            </span>

            {/* Format Badge */}
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
              {im.format ? im.format.toUpperCase() : im.filter || 'BITMAP'}
            </span>

            {/* DPI Badge */}
            {im.dpi ? (
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  im.dpi >= 200
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
                title={im.dpi >= 200 ? 'Vysoké rozlišení (tisk)' : 'Nízké rozlišení (náhled/web)'}
              >
                {im.dpi} DPI
              </span>
            ) : null}

            {/* Full-Page Scan Badge */}
            {im.isFullPageScan && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                Sken
              </span>
            )}
          </div>

          {/* Action buttons: Export, Replace, Delete */}
          <div className="flex items-center gap-1 shrink-0 ml-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleExportImage(im);
              }}
              className={`p-1 rounded transition-colors text-slate-400 hover:text-sky-300 ${
                isMinimal ? 'hover:bg-neutral-200' : 'hover:bg-slate-700'
              }`}
              title="Exportovat / Stáhnout obrázek (PNG/JPG)"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerImageReplace(im);
              }}
              className={`p-1 rounded transition-colors text-slate-400 hover:text-amber-300 ${
                isMinimal ? 'hover:bg-neutral-200' : 'hover:bg-slate-700'
              }`}
              title="Nahradit obrázek (Vyměnit za jiný soubor)"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteImage(im);
              }}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
              title="Smazat obrázek ze stránky"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Thumbnail Preview & Technical Metrics */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
            {im.thumbnailDataUrl ? (
              <img
                src={im.thumbnailDataUrl}
                alt={im.cleanName}
                className="w-full h-full object-contain"
              />
            ) : (
              <ImageIcon className="w-6 h-6 text-slate-600" />
            )}
          </div>

          <div className="flex flex-col gap-0.5 min-w-0 flex-1 text-[10px] font-mono text-slate-400">
            <div>
              <span className="text-slate-500">Rozlišení: </span>
              <span className="text-slate-200 font-semibold">
                {im.pixelWidth || '?'} × {im.pixelHeight || '?'} px
              </span>
            </div>
            <div>
              <span className="text-slate-500">Na stránce: </span>
              <span>
                {im.width ? Math.round(im.width) : '?'} × {im.height ? Math.round(im.height) : '?'} pt
              </span>
            </div>
            <div className="truncate">
              <span className="text-slate-500">Barevný prostor: </span>
              <span>{im.colorSpace || 'DeviceRGB'}</span>
            </div>
          </div>
        </div>
      </div>
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
        {isLoading && segments.length === 0 && images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-rose-500" />
            <p className="text-xs font-medium">Načítám prvky a stream stránky...</p>
          </div>
        ) : editSidePanelTab === 'remove' ? (
          /* =========================================================================
             TAB 1: REMOVE ELEMENTS (BLOCKS & IMAGES)
             ========================================================================= */
          <div className="p-3 flex flex-col gap-3">
            {isDocumentEncrypted && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="flex-1">
                  <div className="font-bold text-amber-200">Šifrovaný PDF dokument</div>
                  <div className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
                    Tento soubor obsahuje standardní šifrování oprávnění. Přímé mazání streamových segmentů je uzamčeno. Pro úpravu využijte <strong>Vizuální přepis</strong> v liště nástrojů nebo nástroje v záložce <strong>Revize</strong>.
                  </div>
                </div>
              </div>
            )}

            {hasFullPageScan && (
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
                <ImageIcon className="w-4 h-4 shrink-0 mt-0.5 text-purple-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-purple-200 flex items-center justify-between">
                    <span>Naskenovaná stránka ({fullPageScanImage?.dpi || 300} DPI)</span>
                    <span className="text-[10px] font-mono text-purple-300/80">
                      {fullPageScanImage?.pixelWidth}×{fullPageScanImage?.pixelHeight} px
                    </span>
                  </div>
                  <div className="text-[11px] text-purple-300/80 mt-1 leading-relaxed">
                    Tato stránka je bitmapový sken. Text nelze editovat jako operátory content streamu, můžete však obrázek vyměnit, exportovat nebo využít Vizuální přepis.
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => fullPageScanImage && triggerImageReplace(fullPageScanImage)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Nahradit sken</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fullPageScanImage && handleExportImage(fullPageScanImage)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-950/60 hover:bg-purple-900 border border-purple-500/40 text-purple-200 text-[11px] font-semibold transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      <span>Stáhnout PNG</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                    : 'bg-slate-800/60 border-slate-750 text-slate-100 focus:border-rose-500'
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

            {/* Element Type Segmented Filter Pills */}
            {images.length > 0 && (
              <div
                className={`flex items-center p-0.5 rounded-lg border text-xs ${
                  isMinimal
                    ? 'bg-neutral-100 border-neutral-300'
                    : isLcars
                    ? 'bg-[#111111] border-[#ff9900]/40'
                    : 'bg-slate-800/60 border-slate-750'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setFilterType('all')}
                  className={`flex-1 py-1 px-2 rounded-md font-medium text-[11px] transition-all flex items-center justify-center gap-1 ${
                    filterType === 'all'
                      ? isMinimal
                        ? 'bg-white text-black font-bold shadow-xs'
                        : isLcars
                        ? 'bg-[#ff9900] text-black font-bold'
                        : 'bg-rose-600 text-white font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Vše ({filteredBlocks.length + filteredImages.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('text')}
                  className={`flex-1 py-1 px-2 rounded-md font-medium text-[11px] transition-all flex items-center justify-center gap-1 ${
                    filterType === 'text'
                      ? isMinimal
                        ? 'bg-white text-black font-bold shadow-xs'
                        : isLcars
                        ? 'bg-[#ff9900] text-black font-bold'
                        : 'bg-rose-600 text-white font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Type className="w-3 h-3" />
                  <span>Text ({filteredBlocks.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('image')}
                  className={`flex-1 py-1 px-2 rounded-md font-medium text-[11px] transition-all flex items-center justify-center gap-1 ${
                    filterType === 'image'
                      ? isMinimal
                        ? 'bg-white text-black font-bold shadow-xs'
                        : isLcars
                        ? 'bg-[#ffcc00] text-black font-bold'
                        : 'bg-amber-600 text-white font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ImageIcon className="w-3 h-3" />
                  <span>Obrázky ({filteredImages.length})</span>
                </button>
              </div>
            )}

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
                <span>
                  {filterType === 'image'
                    ? `OBRÁZKY (${allPageElements.length})`
                    : filterType === 'text'
                    ? `TEXTOVÉ BLOKY (${allPageElements.length})`
                    : `PRVKY STRÁNKY (${allPageElements.length})`}
                </span>
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

              {allPageElements.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  Nebyly nalezeny žádné prvky na stránce.
                </div>
              ) : sortMode === 'reading' ? (
                /* Semantic Document Tree Mode */
                <div className="flex flex-col gap-2.5">
                  {documentSections.map((sec) => {
                    const isCollapsed = collapsedSectionIds.has(sec.id);
                    const totalItems = (sec.headingBlock ? 1 : 0) + sec.items.length;
                    const allTextIds = [
                      ...(sec.headingBlock ? [sec.headingBlock.id] : []),
                      ...sec.items.filter((c) => c.kind === 'text').map((c) => (c as any).block.id),
                    ];
                    const allImgNames = sec.items.filter((c) => c.kind === 'image').map((c) => (c as any).image.name);
                    const isSecAllChecked =
                      (allTextIds.length > 0 || allImgNames.length > 0) &&
                      allTextIds.every((id) => selectedBlockIds.has(id)) &&
                      allImgNames.every((name) => selectedImageNames.has(name));
                    const isSecPartiallyChecked =
                      !isSecAllChecked &&
                      (allTextIds.some((id) => selectedBlockIds.has(id)) ||
                        allImgNames.some((name) => selectedImageNames.has(name)));

                    return (
                      <div
                        key={sec.id}
                        className={`rounded-xl border transition-all overflow-hidden ${
                          isMinimal
                            ? 'bg-neutral-50/50 border-neutral-300 shadow-xs'
                            : isLcars
                            ? 'bg-[#111111] border-[#ff9900]/40'
                            : 'bg-slate-900/40 border-slate-800 shadow-sm'
                        }`}
                      >
                        {/* Section Header */}
                        <div
                          onClick={(e) => toggleSectionCollapse(sec.id, e)}
                          className={`p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none transition-colors ${
                            isMinimal
                              ? 'hover:bg-neutral-100 bg-neutral-100/60 border-b border-neutral-200'
                              : isLcars
                              ? 'hover:bg-[#ff9900]/10 bg-black border-b border-[#333333]'
                              : 'hover:bg-slate-800/60 bg-slate-950/60 border-b border-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <button
                              type="button"
                              className="text-slate-400 hover:text-white transition-colors shrink-0"
                              title={isCollapsed ? 'Rozbalit sekci' : 'Sbalit sekci'}
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-rose-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-rose-400" />
                              )}
                            </button>

                            <input
                              type="checkbox"
                              checked={isSecAllChecked}
                              ref={(input) => {
                                if (input) input.indeterminate = isSecPartiallyChecked;
                              }}
                              onChange={(e) => toggleSectionSelection(sec, e)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-600 text-rose-600 focus:ring-rose-500"
                              title="Vybrat celou sekci"
                            />

                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                                sec.role === 'h1'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : sec.role === 'h2'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {sec.role === 'h1' ? 'H1 Sekce' : sec.role === 'h2' ? 'H2 Sekce' : 'Záhlaví / Text'}
                            </span>

                            <span className="text-xs font-bold text-slate-200 truncate" title={sec.title}>
                              {sec.title}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-slate-400 font-medium px-1.5 py-0.5 rounded bg-slate-800/80">
                              {totalItems} {totalItems === 1 ? 'položka' : totalItems < 5 ? 'položky' : 'položek'}
                            </span>

                            <button
                              type="button"
                              onClick={(e) => handleDeleteSection(sec, e)}
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                              title="Smazat celou sekci včetně podřízených prvků a obrázků"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Section Body (Heading card + indented children) */}
                        {!isCollapsed && (
                          <div className="p-2 flex flex-col gap-2">
                            {sec.headingBlock && renderBlockCard(sec.headingBlock, false)}
                            {sec.items.length > 0 && (
                              <div className="border-l-2 border-indigo-500/30 pl-2.5 ml-2.5 flex flex-col gap-2">
                                {sec.items.map((child) =>
                                  child.kind === 'text'
                                    ? renderBlockCard(child.block, true)
                                    : renderImageCard(child.image, true)
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Flat Linear Stream Mode */
                <div className="flex flex-col gap-2">
                  {allPageElements.map((el) =>
                    el.kind === 'text'
                      ? renderBlockCard(el.block, false)
                      : renderImageCard(el.image, false)
                  )}
                </div>
              )}
            </div>

            {/* Any unplaced image objects in resources */}
            {unplacedImages.length > 0 && (
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-slate-800">
                <div className="text-[11px] font-semibold text-slate-400 px-1">
                  NEZAŘAZENÉ OBRÁZKY ({unplacedImages.length})
                </div>
                {unplacedImages.map((im) => renderImageCard(im, false))}
              </div>
            )}
          </div>
        ) : (
          /* =========================================================================
             TAB 2: STREAM & OPERATOR EDITOR
             ========================================================================= */
          <div className="p-3 flex flex-col gap-3">
            {isDocumentEncrypted && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="flex-1">
                  <div className="font-bold text-amber-200">Šifrovaný PDF dokument</div>
                  <div className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
                    Content streamy tohoto dokumentu jsou šifrovány autorem PDF (Standard Security). Přímá editace kódu operátorů je uzamčena. Můžete využít <strong>Vizuální přepis (Whiteout)</strong>.
                  </div>
                </div>
              </div>
            )}

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
                        Upravit text bloku
                      </span>
                    </div>

                    <textarea
                      value={quickReplaceNewText}
                      onChange={(e) => setQuickReplaceNewText(e.target.value)}
                      rows={Math.min(8, Math.max(2, quickReplaceNewText.split('\n').length + 1))}
                      placeholder="Zadejte nový text pro tento blok..."
                      className={`w-full px-2.5 py-1.5 rounded-lg text-xs outline-none border transition-colors resize-y ${
                        isMinimal
                          ? 'bg-white border-neutral-300 text-black focus:border-indigo-500'
                          : 'bg-slate-900 border-slate-700 text-slate-100 focus:border-indigo-500'
                      }`}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400 leading-snug">
                        Zapíše se na stejné místo, stejnou velikostí a barvou. Každý řádek = jeden řádek v PDF.
                      </span>
                      <button
                        onClick={handleApplyTextEdit}
                        disabled={isSaving || isDocumentEncrypted}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors flex items-center gap-1"
                      >
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        <span>Přepsat text</span>
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
                      <span className="flex items-center gap-2">
                        {readableState?.blockId === selectedStreamBlockId && (
                          <label
                            className="flex items-center gap-1 cursor-pointer select-none"
                            title="Řetězce se zobrazí jako čitelný text «…» místo kódů písma; při uložení se změněné řetězce zakódují zpět."
                          >
                            <input
                              type="checkbox"
                              checked={readableMode}
                              onChange={(e) => setReadableMode(e.target.checked)}
                              className="accent-indigo-500"
                            />
                            Čitelný text
                          </label>
                        )}
                        <span>{editorContent.length} bajtů</span>
                      </span>
                    </div>

                    <textarea
                      value={showReadable ? readableText : editorContent}
                      onChange={(e) => (showReadable ? setReadableText(e.target.value) : setEditorContent(e.target.value))}
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

      {/* Hidden File Input for Image Replacement */}
      <input
        type="file"
        ref={imageReplaceInputRef}
        style={{ display: 'none' }}
        accept="image/png,image/jpeg,image/webp"
        onChange={handleImageFilePicked}
      />
    </aside>
  );
};
