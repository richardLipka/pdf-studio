import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfTextLayer, getPageTextBlocks, getPageTextModel } from '../../services/pdfLoader';
import { renderQueue, RenderPriority } from '../../services/renderQueue';
import type { PageZone } from '../../hooks/usePageZones';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import {
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
  WhiteoutAnnotation,
} from '../../types/annotations';
import {
  Copy,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough as StrikeIcon,
  Check,
  X,
  FileCode2,
  SquarePen,
  Trash2,
  Image as ImageIcon,
  Download,
  RefreshCw,
  Pencil,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { TextLine } from '../../services/pdfTextModel';
import { VisualTextBlock } from '../../utils/textSnap';
import {
  isEditCanvasOverlayActive,
  clampInlineEditorPosition,
} from '../../utils/editModeState';

interface TextLayerProps {
  page: PdfPageModel;
  sourceDoc: SourceDocument;
  scale: number;
  /** Distance from the viewport (usePageZones); the text layer and edit overlays exist only near it */
  zone?: PageZone;
}

export const TextLayer: React.FC<TextLayerProps> = ({ page, sourceDoc, scale, zone = 'near' }) => {
  const isNear = zone === 'near';
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    activeTool,
    highlightColor,
    strokeColor,
    strokeWidth,
    setStreamReplaceTargetText,
    setStreamReplaceTargetPosition,
    isEditSidePanelOpen,
    setIsEditSidePanelOpen,
    editSidePanelTab,
    setEditSidePanelTab,
    showAllEditOutlines,
    showEditNotice,
    selectedStreamBlockId,
    selectedStreamBlockPageId,
    setSelectedStreamBlockId,
    selectedLineId,
    setSelectedLineId,
    hoveredLineId,
    setHoveredLineId,
    hoveredBlockId,
    hoveredBlockPageId,
    setHoveredBlockId,
    setHoveredBlockText,
    activeTab,
    setActiveTab,
    isSearchOpen,
    searchResults,
    activeSearchMatchIndex,
  } = useEditor();
  const {
    addAnnotation,
    setSelectedAnnotationId,
    pages,
    removeMultiplePageElements,
    applyLineTextEdit,
    removeLineText,
    removePageImage,
    replacePageImage,
    exportPageImage,
    transformPageImage,
    transformPageTextBlocks,
    reflowPageTextBlocks,
    activePageIndex,
    setActivePageIndex,
    setSelectedPageIds,
  } = useDocument();

  const containerRef = useRef<HTMLDivElement>(null);
  const inlineEditorRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedRects, setSelectedRects] = useState<DOMRect[]>([]);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Page element overlays belong to the edit tab only and MUST yield to Whiteout drawing
  const isEditOverlayActive = isEditCanvasOverlayActive(activeTab, activeTool);
  const pageIndex = pages.findIndex((p) => p.id === page.id);
  const isActivePage = pageIndex === activePageIndex;
  // Element ids (block_3, img:Im1:0) repeat on every page: a selection or hover applies to its own
  // page, or to the active page when it came from the edit panel (which lists the active page)
  const selectionOnThisPage = selectedStreamBlockPageId ? selectedStreamBlockPageId === page.id : isActivePage;
  const hoverOnThisPage = hoveredBlockPageId ? hoveredBlockPageId === page.id : isActivePage;

  // Search matches belonging to this page
  const pageSearchMatches = useMemo(() => {
    if (!isSearchOpen || !searchResults || searchResults.length === 0) return [];
    return searchResults.filter((m) => m.pageId === page.id);
  }, [isSearchOpen, searchResults, page.id]);

  /** Makes this page the active one (the edit panel lists the active page) without scrolling it */
  const activateThisPage = () => {
    if (pageIndex >= 0 && pageIndex !== activePageIndex) {
      setActivePageIndex(pageIndex, { scrollIntoView: false });
      setSelectedPageIds([page.id]);
    }
  };
  const [visualBlocks, setVisualBlocks] = useState<VisualTextBlock[]>([]);
  const [selectedBlockLines, setSelectedBlockLines] = useState<TextLine[]>([]);
  const visualLoadRef = useRef(0);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);

  // Interactive canvas drag-to-move & resize gesture for selected native PDF images and text blocks
  type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  interface ActiveTransformGesture {
    block: VisualTextBlock;
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    startClientX: number;
    startClientY: number;
    origRect: { x: number; y: number; width: number; height: number };
    currentRect: { x: number; y: number; width: number; height: number };
    committedDrag: boolean;
    isReflow: boolean;
  }
  const [dragOp, setDragOp] = useState<ActiveTransformGesture | null>(null);
  const dragOpRef = useRef<ActiveTransformGesture | null>(null);
  dragOpRef.current = dragOp;
  const suppressNextClickRef = useRef(false);
  // Holds the target box briefly while the async PDF edit commits & re-renders so the box never snaps back
  const [pendingRect, setPendingRect] = useState<{
    blockId: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  // Inline editor for one line of text, opened by double-clicking a line or via floating pill
  const [lineEditor, setLineEditor] = useState<{
    lineId: string;
    text: string;
    original: string;
    box: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [isSavingLine, setIsSavingLine] = useState(false);

  // Load individual lines of the currently selected multi-line text block from the cached text model
  useEffect(() => {
    let cancelled = false;
    if (!isEditOverlayActive || !selectionOnThisPage || !selectedStreamBlockId || page.sourceType !== 'pdf') {
      setSelectedBlockLines([]);
      return;
    }
    const visualBlock = visualBlocks.find(
      (b) => b.id === selectedStreamBlockId || Boolean(b.segmentIds && b.segmentIds.includes(selectedStreamBlockId))
    );
    if (!visualBlock || visualBlock.type === 'image') {
      setSelectedBlockLines([]);
      return;
    }
    const targetIds = new Set(
      visualBlock.segmentIds && visualBlock.segmentIds.length > 0 ? visualBlock.segmentIds : [selectedStreamBlockId]
    );
    getPageTextModel(sourceDoc, page).then((model) => {
      if (cancelled) return;
      if (!model?.aligned) {
        setSelectedBlockLines([]);
        return;
      }
      const lines = model.blocks
        .filter((b) => targetIds.has(b.segmentId))
        .flatMap((b) => b.lines);
      setSelectedBlockLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [isEditOverlayActive, selectionOnThisPage, selectedStreamBlockId, visualBlocks, sourceDoc, page]);

  const openLineEditorForLine = (line: TextLine) => {
    setSelectedLineId(line.id);
    setLineEditor({ lineId: line.id, text: line.text, original: line.text, box: line.bbox });
  };

  const openLineEditorAtPdfPoint = async (x: number, y: number, fallbackBlockId?: string) => {
    if (page.sourceType !== 'pdf') return;
    const model = await getPageTextModel(sourceDoc, page);
    if (!model?.aligned) {
      showEditNotice({ type: 'error', text: t.editPanel.lineNotMapped });
      return;
    }
    let line: TextLine | undefined = model.blocks
      .flatMap((b) => b.lines)
      .filter(
        (l) => x >= l.bbox.x - 2 && x <= l.bbox.x + l.bbox.width + 2 && y >= l.bbox.y - 2 && y <= l.bbox.y + l.bbox.height + 2
      )
      .sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height)[0];
    if (!line && fallbackBlockId) {
      const matchedBlock = model.blocks.find((b) => b.segmentId === fallbackBlockId);
      line = matchedBlock?.lines[0];
    }
    if (!line) {
      // Nearest line vertically within the same region
      line = model.blocks
        .flatMap((b) => b.lines)
        .sort(
          (a, b) =>
            Math.hypot(a.bbox.x + a.bbox.width / 2 - x, a.bbox.y + a.bbox.height / 2 - y) -
            Math.hypot(b.bbox.x + b.bbox.width / 2 - x, b.bbox.y + b.bbox.height / 2 - y)
        )[0];
    }
    if (!line) return;
    openLineEditorForLine(line);
  };

  const selectLineAtClientPoint = async (clientX: number, clientY: number, block: VisualTextBlock) => {
    const container = containerRef.current;
    if (!container || page.sourceType !== 'pdf') return;
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    const model = await getPageTextModel(sourceDoc, page);
    if (!model?.aligned) return;
    const targetIds = new Set(block.segmentIds && block.segmentIds.length > 0 ? block.segmentIds : [block.id]);
    const blockLines = model.blocks.filter((b) => targetIds.has(b.segmentId)).flatMap((b) => b.lines);
    if (blockLines.length <= 1) return;
    const hit =
      blockLines
        .filter(
          (l) => x >= l.bbox.x - 2 && x <= l.bbox.x + l.bbox.width + 2 && y >= l.bbox.y - 2 && y <= l.bbox.y + l.bbox.height + 2
        )
        .sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height)[0] ||
      blockLines.sort(
        (a, b) =>
          Math.abs(a.bbox.y + a.bbox.height / 2 - y) - Math.abs(b.bbox.y + b.bbox.height / 2 - y)
      )[0];
    if (hit) setSelectedLineId(hit.id);
  };

  const deleteSingleLineOnCanvas = useCallback(
    async (line: TextLine) => {
      const targetPageIndex = pages.findIndex((p) => p.id === page.id);
      if (targetPageIndex < 0 || deletingBlockId) return;
      setDeletingBlockId(line.id);
      try {
        const res = await removeLineText(line.id, targetPageIndex);
        if (res.success) {
          showEditNotice({ type: 'success', text: t.editPanel.lineDeleted, canUndo: true });
          setSelectedLineId(null);
          setHoveredLineId(null);
          setLineEditor(null);
        } else {
          showEditNotice({ type: 'error', text: res.error || t.editPanel.lineDeleteFailed });
        }
      } finally {
        setDeletingBlockId(null);
      }
    },
    [
      pages,
      page.id,
      deletingBlockId,
      removeLineText,
      showEditNotice,
      t.editPanel.lineDeleted,
      t.editPanel.lineDeleteFailed,
      setSelectedLineId,
      setHoveredLineId,
    ]
  );

  const openLineEditor = async (clientX: number, clientY: number, fallbackBlockId?: string) => {
    const container = containerRef.current;
    if (!container || page.sourceType !== 'pdf') return;
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    await openLineEditorAtPdfPoint(x, y, fallbackBlockId);
  };

  const saveLineEditor = async () => {
    if (!lineEditor || isSavingLine) return;
    if (lineEditor.text === lineEditor.original) {
      setLineEditor(null);
      return;
    }
    const targetPageIndex = pages.findIndex((p) => p.id === page.id);
    if (targetPageIndex < 0) return;
    setIsSavingLine(true);
    try {
      const res = await applyLineTextEdit(lineEditor.lineId, lineEditor.text, targetPageIndex);
      if (res.success) {
        setLineEditor(null);
        showEditNotice({
          type: 'success',
          text: res.fontSubstituted ? t.editPanel.lineUpdatedSubFont : t.editPanel.lineUpdatedOriginalFont,
          canUndo: true,
        });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.lineUpdateFailed });
      }
    } finally {
      setIsSavingLine(false);
    }
  };

  // Click outside closes the inline line editor cleanly
  useEffect(() => {
    if (!lineEditor) return;
    const handleOutsideMouseDown = (e: MouseEvent) => {
      if (inlineEditorRef.current && !inlineEditorRef.current.contains(e.target as Node)) {
        setLineEditor(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideMouseDown, true);
    return () => window.removeEventListener('mousedown', handleOutsideMouseDown, true);
  }, [lineEditor]);

  // An element selected in the edit panel is scrolled into view on its page
  useEffect(() => {
    if (!isEditOverlayActive || !selectedStreamBlockId || !selectionOnThisPage || selectedStreamBlockPageId) return;
    const timer = setTimeout(() => {
      const overlay = containerRef.current?.parentElement?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(selectedStreamBlockId)}"]`
      );
      overlay?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, 60);
    return () => clearTimeout(timer);
  }, [selectedStreamBlockId, selectedStreamBlockPageId, selectionOnThisPage, isEditOverlayActive]);

  // A different document version or page invalidates an open editor or pending drag preview
  useEffect(() => {
    setLineEditor(null);
    setDragOp(null);
    setPendingRect(null);
  }, [sourceDoc.updatedAt, page.id, page.rotation]);

  const startElementMove = useCallback(
    (e: React.MouseEvent, block: VisualTextBlock) => {
      if (e.button !== 0 || lineEditor || deletingBlockId || isTransforming) return;
      const orig = { x: block.x, y: block.y, width: block.width, height: block.height };
      setDragOp({
        block,
        mode: 'move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origRect: orig,
        currentRect: orig,
        committedDrag: false,
        isReflow: false,
      });
    },
    [lineEditor, deletingBlockId, isTransforming]
  );

  const startElementResize = useCallback(
    (e: React.MouseEvent, block: VisualTextBlock, handle: ResizeHandle) => {
      if (e.button !== 0 || lineEditor || deletingBlockId || isTransforming) return;
      e.stopPropagation();
      e.preventDefault();
      const orig = { x: block.x, y: block.y, width: block.width, height: block.height };
      const isReflow = block.type !== 'image' && (handle === 'w' || handle === 'e');
      setDragOp({
        block,
        mode: 'resize',
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origRect: orig,
        currentRect: orig,
        committedDrag: true,
        isReflow,
      });
    },
    [lineEditor, deletingBlockId, isTransforming]
  );

  const commitTransformGesture = useCallback(
    async (op: ActiveTransformGesture) => {
      const targetPageIndex = pages.findIndex((p) => p.id === page.id);
      if (targetPageIndex < 0) return;

      const { block, origRect, currentRect, isReflow } = op;
      const unchanged =
        Math.abs(origRect.x - currentRect.x) < 0.25 &&
        Math.abs(origRect.y - currentRect.y) < 0.25 &&
        Math.abs(origRect.width - currentRect.width) < 0.25 &&
        Math.abs(origRect.height - currentRect.height) < 0.25;
      if (unchanged) return;

      setIsTransforming(true);
      setPendingRect({ blockId: block.id, rect: currentRect });
      try {
        if (block.type === 'image') {
          const res = await transformPageImage(block.id, currentRect, {
            space: 'display',
            pageIndex: targetPageIndex,
          });
          if (res.success) {
            showEditNotice({ type: 'success', text: t.editPanel.imageTransformed, canUndo: true });
          } else {
            setPendingRect(null);
            showEditNotice({ type: 'error', text: res.error || t.editPanel.imageTransformFailed });
          }
          return;
        }

        const segIds = block.segmentIds && block.segmentIds.length > 0 ? block.segmentIds : [block.id];
        if (isReflow) {
          const res = await reflowPageTextBlocks(segIds, currentRect.width, {
            deltaDisplayX: currentRect.x - origRect.x,
            deltaDisplayY: 0,
            pageIndex: targetPageIndex,
          });
          if (res.success) {
            const msg = t.editPanel.textReflowed.replace('{lines}', String(res.lineCount ?? 1));
            showEditNotice({ type: 'success', text: msg, canUndo: true });
          } else {
            setPendingRect(null);
            showEditNotice({ type: 'error', text: res.error || t.editPanel.textReflowFailed });
          }
          return;
        }

        const res = await transformPageTextBlocks(segIds, origRect, currentRect, {
          space: 'display',
          pageIndex: targetPageIndex,
        });
        if (res.success) {
          showEditNotice({ type: 'success', text: t.editPanel.textTransformed, canUndo: true });
        } else {
          setPendingRect(null);
          showEditNotice({ type: 'error', text: res.error || t.editPanel.textTransformFailed });
        }
      } finally {
        setIsTransforming(false);
      }
    },
    [
      pages,
      page.id,
      transformPageImage,
      transformPageTextBlocks,
      reflowPageTextBlocks,
      showEditNotice,
      t.editPanel.imageTransformed,
      t.editPanel.imageTransformFailed,
      t.editPanel.textTransformed,
      t.editPanel.textTransformFailed,
      t.editPanel.textReflowed,
      t.editPanel.textReflowFailed,
    ]
  );

  // Global mousemove / mouseup / Escape listeners while dragging or resizing a native PDF element
  const isDragActive = Boolean(dragOp);
  useEffect(() => {
    if (!isDragActive) return;

    const handleMouseMove = (ev: MouseEvent) => {
      const op = dragOpRef.current;
      if (!op) return;

      const rawDx = ev.clientX - op.startClientX;
      const rawDy = ev.clientY - op.startClientY;
      if (!op.committedDrag && Math.hypot(rawDx, rawDy) < 4) return;

      const dx = rawDx / scale;
      const dy = rawDy / scale;
      const o = op.origRect;
      let next = { ...o };

      if (op.mode === 'move') {
        next = { x: o.x + dx, y: o.y + dy, width: o.width, height: o.height };
      } else if (op.handle) {
        const h = op.handle;
        const isImage = op.block.type === 'image';
        const isCorner = h === 'nw' || h === 'ne' || h === 'se' || h === 'sw';
        const minW = op.isReflow ? 32 : isImage ? 8 : 16;
        const minH = 8;

        if (op.isReflow) {
          // Width-only reflow: keep top & height steady while showing the new target width
          if (h === 'e') {
            next = { ...o, width: Math.max(minW, o.width + dx) };
          } else if (h === 'w') {
            const newW = Math.max(minW, o.width - dx);
            next = { ...o, x: o.x + (o.width - newW), width: newW };
          }
        } else if (isCorner && (!isImage || !ev.shiftKey)) {
          // Uniform aspect-locked scaling anchored at the opposite corner
          const aspect = o.width > 0 && o.height > 0 ? o.width / o.height : 1;
          const anchorX = h === 'nw' || h === 'sw' ? o.x + o.width : o.x;
          const anchorY = h === 'nw' || h === 'ne' ? o.y + o.height : o.y;
          const signX = h === 'nw' || h === 'sw' ? -1 : 1;
          const signY = h === 'nw' || h === 'ne' ? -1 : 1;
          const candW = Math.max(minW, o.width + signX * dx);
          const candH = Math.max(minH, o.height + signY * dy);
          const scaleX = candW / Math.max(1, o.width);
          const scaleY = candH / Math.max(1, o.height);
          const uniformScale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
          const finalW = Math.max(minW, o.width * uniformScale);
          const finalH = Math.max(minH, finalW / aspect);
          const finalX = signX < 0 ? anchorX - finalW : anchorX;
          const finalY = signY < 0 ? anchorY - finalH : anchorY;
          next = { x: finalX, y: finalY, width: finalW, height: finalH };
        } else {
          // Free-axis resize (image edges, or image corners while holding Shift)
          let left = o.x;
          let top = o.y;
          let right = o.x + o.width;
          let bottom = o.y + o.height;
          if (h.includes('w')) left = Math.min(right - minW, o.x + dx);
          if (h.includes('e')) right = Math.max(left + minW, o.x + o.width + dx);
          if (h.includes('n')) top = Math.min(bottom - minH, o.y + dy);
          if (h.includes('s')) bottom = Math.max(top + minH, o.y + o.height + dy);
          next = { x: left, y: top, width: right - left, height: bottom - top };
        }
      }

      setDragOp((prev) => (prev ? { ...prev, committedDrag: true, currentRect: next } : null));
    };

    const handleMouseUp = () => {
      const op = dragOpRef.current;
      setDragOp(null);
      if (!op || !op.committedDrag) return;
      suppressNextClickRef.current = true;
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      void commitTransformGesture(op);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        setDragOp(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isDragActive, scale, commitTransformGesture]);

  const refreshVisualBlocks = useCallback(async () => {
    // Newest load wins: a slower load started for an older version of the document must not
    // bring back blocks (and segment ids) that no longer exist
    const token = ++visualLoadRef.current;
    if (!isEditOverlayActive || !isNear || page.sourceType !== 'pdf') {
      setVisualBlocks([]);
      return;
    }
    try {
      const blocks = await getPageTextBlocks(sourceDoc, page);
      if (token === visualLoadRef.current) setVisualBlocks(blocks);
    } catch {
      if (token === visualLoadRef.current) setVisualBlocks([]);
    }
  }, [isEditOverlayActive, isNear, sourceDoc, page]);
  // Async callbacks (text layer render) must use the current mode and document, not the ones
  // captured when they were started
  const refreshVisualBlocksRef = useRef(refreshVisualBlocks);
  refreshVisualBlocksRef.current = refreshVisualBlocks;

  /** Deletes a text block straight from the canvas, guarded against stale segment ids */
  const deleteVisualTextBlock = useCallback(async (block: VisualTextBlock) => {
    const targetPageIndex = pages.findIndex((p) => p.id === page.id);
    if (targetPageIndex < 0 || deletingBlockId) return;
    const ids = block.segmentIds && block.segmentIds.length > 0 ? block.segmentIds : [block.id];
    const expected: Record<string, string> = {};
    ids.forEach((id, idx) => {
      const content = block.segmentContents?.[idx];
      if (content !== undefined) expected[id] = content;
    });
    setDeletingBlockId(block.id);
    // Hide the box at once; the page re-renders when the edited document is committed
    setVisualBlocks((prev) => prev.filter((b) => b.id !== block.id));
    try {
      const res = await removeMultiplePageElements(ids, [], targetPageIndex, expected);
      if (res.success) {
        showEditNotice({ type: 'success', text: t.editPanel.blockDeleted, canUndo: true });
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.blockDeleteFailed });
        refreshVisualBlocksRef.current();
      }
      setSelectedStreamBlockId(null);
      setHoveredBlockId(null);
      setHoveredBlockText(null);
    } finally {
      setDeletingBlockId(null);
    }
  }, [
    pages,
    page.id,
    deletingBlockId,
    removeMultiplePageElements,
    showEditNotice,
    t.editPanel.blockDeleted,
    t.editPanel.blockDeleteFailed,
    setSelectedStreamBlockId,
    setHoveredBlockId,
    setHoveredBlockText,
  ]);

  const deleteVisualImageBlock = useCallback(async (block: VisualTextBlock) => {
    const targetPageIndex = pages.findIndex((p) => p.id === page.id);
    if (targetPageIndex < 0 || deletingBlockId) return;
    setDeletingBlockId(block.id);
    setVisualBlocks((prev) => prev.filter((b) => b.id !== block.id));
    try {
      const res = await removePageImage(block.id, targetPageIndex);
      if (res.success) {
        showEditNotice({ type: 'success', text: t.editPanel.imageDeleted, canUndo: true });
        setSelectedStreamBlockId(null);
        setHoveredBlockId(null);
        setHoveredBlockText(null);
      } else {
        showEditNotice({ type: 'error', text: res.error || t.editPanel.imageDeleteFailed });
        refreshVisualBlocksRef.current();
      }
    } finally {
      setDeletingBlockId(null);
    }
  }, [
    pages,
    page.id,
    deletingBlockId,
    removePageImage,
    showEditNotice,
    t.editPanel.imageDeleted,
    t.editPanel.imageDeleteFailed,
    setSelectedStreamBlockId,
    setHoveredBlockId,
    setHoveredBlockText,
  ]);

  // Canvas-level Escape (deselect) and Delete/Backspace (delete selected element even when side panel is closed)
  useEffect(() => {
    if (!isEditOverlayActive || !selectionOnThisPage || !selectedStreamBlockId || lineEditor) return;
    const handleCanvasEditKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (selectedLineId) {
          setSelectedLineId(null);
        } else {
          setSelectedStreamBlockId(null);
        }
        return;
      }
      // When EditSidePanel is open, it owns Delete/Backspace (handling both batch & single selection).
      // When EditSidePanel is closed, the canvas handles deleting the targeted line or element directly.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditSidePanelOpen) {
        if (selectedLineId && selectedBlockLines.length > 1) {
          const targetLine = selectedBlockLines.find((l) => l.id === selectedLineId);
          if (targetLine) {
            e.preventDefault();
            void deleteSingleLineOnCanvas(targetLine);
            return;
          }
        }
        const block = visualBlocks.find(
          (b) =>
            b.id === selectedStreamBlockId ||
            Boolean(b.segmentIds && b.segmentIds.includes(selectedStreamBlockId))
        );
        if (!block) return;
        e.preventDefault();
        if (block.type === 'image') {
          void deleteVisualImageBlock(block);
        } else {
          void deleteVisualTextBlock(block);
        }
      }
    };
    window.addEventListener('keydown', handleCanvasEditKey);
    return () => window.removeEventListener('keydown', handleCanvasEditKey);
  }, [
    isEditOverlayActive,
    selectionOnThisPage,
    selectedStreamBlockId,
    selectedLineId,
    selectedBlockLines,
    lineEditor,
    isEditSidePanelOpen,
    visualBlocks,
    setSelectedLineId,
    setSelectedStreamBlockId,
    deleteSingleLineOnCanvas,
    deleteVisualImageBlock,
    deleteVisualTextBlock,
  ]);

  useEffect(() => {
    if (isEditOverlayActive && isNear) {
      refreshVisualBlocksRef.current();
    } else {
      setVisualBlocks([]);
    }
  }, [isEditOverlayActive, isNear, refreshVisualBlocks, page.id, page.rotation, sourceDoc.updatedAt]);

  // Render text layer from PDF.js (only near the viewport; far pages drop their spans)
  const renderedTextKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let isCancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const taskId = `text_${page.id}`;
    const textKey = `${page.id}|${page.originalPageIndex}|${page.rotation}|${page.sourceDocId}|${sourceDoc.updatedAt}|${scale}`;
    if (zone === 'far') {
      renderQueue.cancel(taskId);
      if (renderedTextKeyRef.current !== null) {
        container.innerHTML = '';
        renderedTextKeyRef.current = null;
      }
      return;
    }
    if (zone !== 'near' || renderedTextKeyRef.current === textKey) return;

    renderQueue
      .enqueue(taskId, RenderPriority.BACKGROUND, async () => {
        if (isCancelled || !container) return;
        await renderPdfTextLayer(sourceDoc, page, container, scale);
      })
      .then(() => {
        // pdf.js sizes (and for rotated pages rotates) the layer itself
        if (!isCancelled && container) {
          renderedTextKeyRef.current = textKey;
          refreshVisualBlocksRef.current();
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn(`Text layer rendering failed for page ${page.id}:`, err);
        }
      });

    return () => {
      isCancelled = true;
      renderQueue.cancel(taskId);
    };
  }, [
    page.id,
    page.originalPageIndex,
    page.rotation,
    page.sourceDocId,
    page.sourceType,
    page.width,
    page.height,
    sourceDoc,
    scale,
    zone,
  ]);

  // Handle selection changes
  const checkSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setFloatingMenuPos(null);
      setSelectedText('');
      setSelectedRects([]);
      return;
    }

    const range = sel.getRangeAt(0);
    // Check if the selection intersects this page's container
    if (!container.contains(range.commonAncestorContainer)) {
      setFloatingMenuPos(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setFloatingMenuPos(null);
      return;
    }

    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 2 && r.height > 2
    );

    if (clientRects.length === 0) {
      setFloatingMenuPos(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const primaryRect = clientRects[0];
    const boundingRangeRect = range.getBoundingClientRect();

    const top = Math.max(8, boundingRangeRect.top - containerRect.top - 46);
    const left = Math.max(
      80,
      Math.min(
        containerRect.width - 120,
        primaryRect.left - containerRect.left + primaryRect.width / 2
      )
    );

    setSelectedText(text);
    setSelectedRects(clientRects);
    setFloatingMenuPos({ x: left, y: top });
  }, []);

  const handleMouseUp = () => {
    // Delay slightly to let browser complete selection bounds calculation
    setTimeout(checkSelection, 50);
  };

  const handleCopyText = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedText) return;

    try {
      await navigator.clipboard.writeText(selectedText);
      setCopiedToast(true);
      setTimeout(() => {
        setCopiedToast(false);
        setFloatingMenuPos(null);
        window.getSelection()?.removeAllRanges();
      }, 1000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleHighlight = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container || selectedRects.length === 0) return;

    const containerRect = container.getBoundingClientRect();

    selectedRects.forEach((rect, idx) => {
      const pdfX = (rect.left - containerRect.left) / scale;
      const pdfY = (rect.top - containerRect.top) / scale;
      const pdfWidth = rect.width / scale;
      const pdfHeight = rect.height / scale;

      const newHighlight: HighlightAnnotation = {
        id: `hl_text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
        pageId: page.id,
        type: 'highlight',
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        color: highlightColor || '#fde047',
        opacity: 0.4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newHighlight);
    });

    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleUnderline = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container || selectedRects.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const lineThickness = strokeWidth || 2;

    selectedRects.forEach((rect, idx) => {
      const pdfX = (rect.left - containerRect.left) / scale;
      const pdfY = (rect.top - containerRect.top) / scale;
      const pdfWidth = rect.width / scale;
      const pdfHeight = rect.height / scale;

      const newUnderline: UnderlineAnnotation = {
        id: `ul_text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
        pageId: page.id,
        type: 'underline',
        x: pdfX,
        y: pdfY + pdfHeight - lineThickness,
        width: pdfWidth,
        height: lineThickness,
        strokeWidth: lineThickness,
        color: strokeColor || '#0284c7',
        opacity: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newUnderline);
    });

    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleStrikethrough = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container || selectedRects.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const lineThickness = strokeWidth || 2;
    const strikeCol = strokeColor === '#0284c7' ? '#dc2626' : (strokeColor || '#dc2626');

    selectedRects.forEach((rect, idx) => {
      const pdfX = (rect.left - containerRect.left) / scale;
      const pdfY = (rect.top - containerRect.top) / scale;
      const pdfWidth = rect.width / scale;
      const pdfHeight = rect.height / scale;

      const newStrike: StrikethroughAnnotation = {
        id: `st_text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
        pageId: page.id,
        type: 'strikethrough',
        x: pdfX,
        y: pdfY + pdfHeight / 2 - lineThickness / 2,
        width: pdfWidth,
        height: lineThickness,
        strokeWidth: lineThickness,
        color: strikeCol,
        opacity: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newStrike);
    });

    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleWhiteout = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container || selectedRects.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const minLeft = Math.min(...selectedRects.map((r) => r.left));
    const minTop = Math.min(...selectedRects.map((r) => r.top));
    const maxRight = Math.max(...selectedRects.map((r) => r.right));
    const maxBottom = Math.max(...selectedRects.map((r) => r.bottom));

    const pdfX = (minLeft - containerRect.left) / scale;
    const pdfY = (minTop - containerRect.top) / scale;
    const pdfWidth = Math.max(30, (maxRight - minLeft) / scale);
    const pdfHeight = Math.max(18, (maxBottom - minTop) / scale);

    const newWhiteout: WhiteoutAnnotation = {
      id: `wo_sel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pageId: page.id,
      type: 'whiteout',
      x: pdfX,
      y: pdfY,
      width: pdfWidth,
      height: pdfHeight,
      color: '#ffffff',
      fillColor: '#ffffff',
      opacity: 1.0,
      text: '',
      textColor: '#0f172a',
      fontSize: Math.max(10, Math.min(24, Math.round(pdfHeight * 0.75))),
      fontFamily: 'Inter',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addAnnotation(newWhiteout);
    setSelectedAnnotationId(newWhiteout.id);
    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleStreamReplace = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedText) return;
    activateThisPage();
    const container = containerRef.current;
    if (container && selectedRects.length > 0) {
      const containerRect = container.getBoundingClientRect();
      const rect = selectedRects[0];
      const pdfX = (rect.left + rect.width / 2 - containerRect.left) / scale;
      const pdfY = (rect.top + rect.height / 2 - containerRect.top) / scale;
      setStreamReplaceTargetPosition({ x: pdfX, y: pdfY });
    }
    setStreamReplaceTargetText(selectedText);
    setActiveTab('edit');
    setEditSidePanelTab('remove');
    setIsEditSidePanelOpen(true);
    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleLayerClick = (e: React.MouseEvent) => {
    if (isEditOverlayActive) {
      activateThisPage();
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const clickPdfX = (e.clientX - containerRect.left) / scale;
      const clickPdfY = (e.clientY - containerRect.top) / scale;

      const target = e.target as HTMLElement;
      let text = '';
      if (target && target.tagName === 'SPAN' && target.textContent) {
        text = target.textContent.trim();
      } else if (target && target.closest('span')) {
        text = target.closest('span')?.textContent?.trim() || '';
      }

      if (!text) {
        // Clicking empty whitespace deselects current element cleanly
        setSelectedStreamBlockId(null);
        return;
      }

      e.stopPropagation();
      setStreamReplaceTargetPosition({ x: clickPdfX, y: clickPdfY });
      setStreamReplaceTargetText(text);
    }
  };

  const isTextSelectActive =
    activeTool === 'textSelect' ||
    activeTool === 'select' ||
    isEditOverlayActive;

  return (
    <div
      style={{
        width: `${page.width * scale}px`,
        height: `${page.height * scale}px`,
      }}
      className="absolute inset-0 pointer-events-none"
    >
      {/* 1. PDF.js dedicated text container (MUTATED ONLY BY PDF.JS - ZERO REACT CHILDREN) */}
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        onClick={handleLayerClick}
        style={{
          ['--scale-factor' as any]: scale,
        }}
        className={`textLayer absolute inset-0 select-text ${
          isMinimal ? 'textLayer-minimal' : isLcars ? 'textLayer-lcars' : ''
        } ${
          isTextSelectActive
            ? 'pointer-events-auto cursor-text z-20'
            : 'pointer-events-none z-0'
        } ${isEditOverlayActive ? 'cursor-default' : ''}`}
      />

      {/* 2. React Overlay Container (Blocks, Search Highlights & Floating Toolbar) */}
      <div className="absolute inset-0 pointer-events-none z-30">
        {/* In-Document Search Highlights */}
        {isSearchOpen &&
          pageSearchMatches.map((match) => {
            const isActiveMatch = match.globalIndex === activeSearchMatchIndex;
            return match.rects.map((rect, rIdx) => (
              <div
                key={`search-${match.id}-${rIdx}`}
                id={isActiveMatch && rIdx === 0 ? 'active-search-match' : undefined}
                data-search-match={rIdx === 0 ? match.id : undefined}
                style={{
                  left: `${rect.x * scale}px`,
                  top: `${rect.y * scale}px`,
                  width: `${rect.width * scale}px`,
                  height: `${rect.height * scale}px`,
                }}
                className={`absolute pointer-events-none transition-all duration-150 rounded-sm ${
                  isActiveMatch
                    ? isLcars
                      ? 'bg-[#ffcc00]/60 ring-2 ring-[#ffcc00] shadow-[0_0_12px_#ffcc00] z-30'
                      : isMinimal
                      ? 'bg-amber-400/60 ring-2 ring-amber-600 shadow-md z-30'
                      : 'bg-amber-400/50 ring-2 ring-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)] z-30'
                    : isLcars
                    ? 'bg-[#ff9900]/30 border border-[#ff9900]/60 z-20'
                    : isMinimal
                    ? 'bg-yellow-300/40 border border-yellow-400/70 z-20'
                    : 'bg-yellow-400/35 border border-yellow-400/50 z-20'
                }`}
              />
            ));
          })}

        {/* Hover-First Interactive PDF Element Overlays (Edit Tab, Non-Whiteout) */}
        {isEditOverlayActive &&
          [...visualBlocks]
            .sort((a, b) => {
              // 1. Images behind text
              if (a.type === 'image' && b.type !== 'image') return -1;
              if (a.type !== 'image' && b.type === 'image') return 1;
              // 2. Larger blocks first, smaller blocks last (DOM order puts smaller blocks on top)
              const areaA = a.width * a.height;
              const areaB = b.width * b.height;
              return areaB - areaA;
            })
            .map((block) => {
              const isImage = block.type === 'image';
              const isInlineImage = isImage && !block.imageName;

              const isSelected =
                selectionOnThisPage &&
                (selectedStreamBlockId === block.id ||
                  Boolean(
                    block.segmentIds &&
                      selectedStreamBlockId &&
                      block.segmentIds.includes(selectedStreamBlockId)
                  ));

              const isHovered =
                hoverOnThisPage &&
                (hoveredBlockId === block.id ||
                  Boolean(
                    block.segmentIds &&
                      hoveredBlockId &&
                      block.segmentIds.includes(hoveredBlockId)
                  ));

              // Calculate z-index: smaller blocks get higher z-index so inner items are clickable over enclosing boxes
              const area = block.width * block.height;
              const baseZ = isImage ? 10 : Math.max(12, Math.min(28, 28 - Math.round(area / 12000)));
              const zIndex = isSelected ? 40 : isHovered ? 35 : baseZ;

              const restingOutlineClass = showAllEditOutlines
                ? isImage
                  ? isMinimal
                    ? 'border border-dashed border-amber-600/60 bg-amber-500/5 hover:bg-amber-500/20 hover:border-amber-700'
                    : isLcars
                    ? 'border border-dashed border-[#ffcc00]/60 bg-[#ffcc00]/10 hover:bg-[#ffcc00]/25'
                    : 'border border-dashed border-amber-500/50 bg-amber-500/5 hover:border-amber-400 hover:bg-amber-500/20'
                  : isMinimal
                  ? 'border border-indigo-600/50 bg-indigo-500/5 hover:bg-indigo-500/15 hover:border-indigo-700'
                  : isLcars
                  ? 'border border-[#99ccff]/55 bg-[#99ccff]/5 hover:bg-[#99ccff]/20'
                  : 'border border-indigo-500/45 bg-indigo-500/5 hover:border-indigo-400 hover:bg-indigo-500/15'
                : isImage
                ? isMinimal
                  ? 'border border-transparent bg-transparent hover:border-dashed hover:border-amber-600/80 hover:bg-amber-500/10'
                  : isLcars
                  ? 'border border-transparent bg-transparent hover:border-dashed hover:border-[#ffcc00] hover:bg-[#ffcc00]/15'
                  : 'border border-transparent bg-transparent hover:border-dashed hover:border-amber-400/80 hover:bg-amber-500/10'
                : isMinimal
                ? 'border border-transparent bg-transparent hover:border-indigo-600/80 hover:bg-indigo-500/10'
                : isLcars
                ? 'border border-transparent bg-transparent hover:border-[#99ccff] hover:bg-[#99ccff]/15'
                : 'border border-transparent bg-transparent hover:border-indigo-400/80 hover:bg-indigo-500/10';

              const activeOutlineClass = isImage
                ? isSelected
                  ? isMinimal
                    ? 'border-2 border-dashed border-amber-600 bg-amber-600/20 ring-2 ring-amber-500 shadow-md'
                    : isLcars
                    ? 'border-2 border-dashed border-[#ffcc00] bg-[#ffcc00]/30 ring-2 ring-[#ffcc00]'
                    : 'border-2 border-dashed border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/80 shadow-[0_0_14px_rgba(251,191,36,0.55)]'
                  : isHovered
                  ? isMinimal
                    ? 'border-2 border-dashed border-amber-600/90 bg-amber-600/15 ring-1 ring-amber-400'
                    : isLcars
                    ? 'border-2 border-dashed border-[#ffcc00] bg-[#ffcc00]/20'
                    : 'border-2 border-dashed border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
                  : restingOutlineClass
                : isSelected
                ? isMinimal
                  ? 'border-2 border-indigo-600 bg-indigo-600/15 ring-2 ring-indigo-500 shadow-md'
                  : isLcars
                  ? 'border-2 border-[#99ccff] bg-[#99ccff]/25 ring-2 ring-[#99ccff]'
                  : 'border-2 border-indigo-400 bg-indigo-500/20 ring-2 ring-indigo-400/80 shadow-[0_0_12px_rgba(99,102,241,0.55)]'
                : isHovered
                ? isMinimal
                  ? 'border border-indigo-600/90 bg-indigo-600/10 ring-1 ring-indigo-400'
                  : isLcars
                  ? 'border border-[#99ccff] bg-[#99ccff]/15'
                  : 'border border-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-400/50'
                : restingOutlineClass;

              const isDraggingThis = Boolean(dragOp && dragOp.block.id === block.id && dragOp.committedDrag);
              const activeBox = isDraggingThis
                ? dragOp!.currentRect
                : pendingRect && pendingRect.blockId === block.id
                ? pendingRect.rect
                : { x: block.x, y: block.y, width: block.width, height: block.height };

              const placeBarBelow = activeBox.y * scale < 42;
              const showHandles = isSelected && !lineEditor && !deletingBlockId && !isTransforming;

              return (
                <div
                  key={block.id}
                  data-block-id={block.id}
                  onMouseEnter={() => {
                    if (dragOp?.committedDrag) return;
                    setHoveredBlockId(block.id, page.id);
                    setHoveredBlockText(block.text);
                  }}
                  onMouseLeave={() => {
                    if (dragOp?.committedDrag) return;
                    setHoveredBlockId(null);
                    setHoveredBlockText(null);
                  }}
                  onMouseDown={(e) => {
                    if (!isSelected || lineEditor) return;
                    startElementMove(e, block);
                  }}
                  onDoubleClick={(e) => {
                    if (isImage) return;
                    e.stopPropagation();
                    activateThisPage();
                    setSelectedStreamBlockId(block.id, page.id);
                    openLineEditor(e.clientX, e.clientY, block.id);
                  }}
                  onClick={(e) => {
                    if (suppressNextClickRef.current) {
                      e.stopPropagation();
                      return;
                    }
                    e.stopPropagation();
                    activateThisPage();
                    setSelectedStreamBlockId(block.id, page.id);
                    if (!isImage) {
                      setStreamReplaceTargetPosition({
                        x: block.x + block.width / 2,
                        y: block.y + block.height / 2,
                      });
                      setStreamReplaceTargetText(block.text);
                      void selectLineAtClientPoint(e.clientX, e.clientY, block);
                    }

                    // If the inspector panel is open on Find & Replace, switch cleanly to Elements Inspector
                    if (isEditSidePanelOpen && editSidePanelTab === 'replace') {
                      setEditSidePanelTab('remove');
                    }

                    if (isEditSidePanelOpen) {
                      setTimeout(() => {
                        const el = document.getElementById(
                          isImage ? `panel_item_img_${block.id}` : `panel_item_${block.id}`
                        );
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                      }, 80);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: `${activeBox.x * scale}px`,
                    top: `${activeBox.y * scale}px`,
                    width: `${activeBox.width * scale}px`,
                    height: `${activeBox.height * scale}px`,
                    zIndex: isDraggingThis ? 55 : zIndex,
                  }}
                  className={`group pointer-events-auto absolute rounded-[2px] ${
                    isDraggingThis ? 'transition-none cursor-grabbing' : 'transition-colors'
                  } ${isSelected && !lineEditor ? 'cursor-move' : 'cursor-pointer'} flex items-start justify-end ${activeOutlineClass}`}
                  title={
                    isImage
                      ? `${t.editPanel.selectedImage}: ${block.imageName || block.text}${
                          block.pixelWidth && block.pixelHeight ? ` (${block.pixelWidth}×${block.pixelHeight} px)` : ''
                        }\n${t.editPanel.dragToMoveHint}`
                      : `${block.text}\n(${t.editPanel.canvasDoubleClickHint} • ${t.editPanel.dragToMoveHint})`
                  }
                >
                  {/* Resize handles for selected PDF Image (8 handles) and Text Block (4 corners = scale, W/E = reflow width) */}
                  {showHandles && (
                    <>
                      {/* 4 Corner Handles (Images: aspect-locked by default, Shift=free; Text: proportional scale) */}
                      {(
                        [
                          { h: 'nw' as ResizeHandle, pos: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
                          { h: 'ne' as ResizeHandle, pos: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
                          { h: 'se' as ResizeHandle, pos: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
                          { h: 'sw' as ResizeHandle, pos: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
                        ] as const
                      ).map(({ h, pos, cursor }) => (
                        <div
                          key={h}
                          data-resize-handle={h}
                          onMouseDown={(e) => startElementResize(e, block, h)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          title={isImage ? t.editPanel.imageResizeHint : t.editPanel.cornerResizeScaleHint}
                          className={`absolute ${pos} w-3 h-3 rounded-[2px] border-2 shadow-sm pointer-events-auto z-50 ${cursor} ${
                            isImage
                              ? isMinimal
                                ? 'bg-white border-amber-600 hover:bg-amber-100'
                                : isLcars
                                ? 'bg-black border-[#ffcc00] hover:bg-[#ffcc00]'
                                : 'bg-slate-900 border-amber-400 hover:bg-amber-400'
                              : isMinimal
                              ? 'bg-white border-indigo-600 hover:bg-indigo-100'
                              : isLcars
                              ? 'bg-black border-[#99ccff] hover:bg-[#99ccff]'
                              : 'bg-slate-900 border-indigo-400 hover:bg-indigo-400'
                          }`}
                        />
                      ))}

                      {/* Top & Bottom Edge Handles (Images only: free vertical resize) */}
                      {isImage &&
                        (
                          [
                            { h: 'n' as ResizeHandle, pos: '-top-1.5 left-1/2 -translate-x-1/2' },
                            { h: 's' as ResizeHandle, pos: '-bottom-1.5 left-1/2 -translate-x-1/2' },
                          ] as const
                        ).map(({ h, pos }) => (
                          <div
                            key={h}
                            data-resize-handle={h}
                            onMouseDown={(e) => startElementResize(e, block, h)}
                            onClick={(e) => e.stopPropagation()}
                            title={t.editPanel.imageResizeHint}
                            className={`absolute ${pos} w-4 h-2.5 rounded-full border-2 shadow-sm pointer-events-auto z-50 cursor-ns-resize ${
                              isMinimal
                                ? 'bg-white border-amber-600 hover:bg-amber-100'
                                : isLcars
                                ? 'bg-black border-[#ffcc00] hover:bg-[#ffcc00]'
                                : 'bg-slate-900 border-amber-400 hover:bg-amber-400'
                            }`}
                          />
                        ))}

                      {/* Left & Right Edge Handles (Images: free horizontal resize; Text: width reflow) */}
                      {(
                        [
                          { h: 'w' as ResizeHandle, pos: 'top-1/2 -left-1.5 -translate-y-1/2' },
                          { h: 'e' as ResizeHandle, pos: 'top-1/2 -right-1.5 -translate-y-1/2' },
                        ] as const
                      ).map(({ h, pos }) => (
                        <div
                          key={h}
                          data-resize-handle={h}
                          onMouseDown={(e) => startElementResize(e, block, h)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          title={isImage ? t.editPanel.imageResizeHint : t.editPanel.sideResizeReflowHint}
                          className={`absolute ${pos} w-2.5 h-5 rounded-full border-2 shadow-sm pointer-events-auto z-50 cursor-ew-resize ${
                            isImage
                              ? isMinimal
                                ? 'bg-white border-amber-600 hover:bg-amber-100'
                                : isLcars
                                ? 'bg-black border-[#ffcc00] hover:bg-[#ffcc00]'
                                : 'bg-slate-900 border-amber-400 hover:bg-amber-400'
                              : isMinimal
                              ? 'bg-sky-50 border-sky-600 hover:bg-sky-200'
                              : isLcars
                              ? 'bg-black border-[#ffcc00] hover:bg-[#ffcc00]'
                              : 'bg-slate-900 border-sky-400 hover:bg-sky-400'
                          }`}
                        />
                      ))}
                    </>
                  )}

                  {/* Live Floating Geometry Readout Pill during Drag / Resize */}
                  {isDraggingThis && dragOp && (
                    <div
                      className={`absolute z-50 px-2 py-0.5 rounded-lg border text-[11px] font-mono font-semibold whitespace-nowrap pointer-events-none select-none shadow-xl ${
                        placeBarBelow ? 'top-full mt-1.5 left-0' : '-top-8 left-0'
                      } ${
                        isMinimal
                          ? 'bg-white/95 border-neutral-400 text-neutral-900'
                          : isLcars
                          ? 'bg-black border-2 border-[#ffcc00] text-[#ffcc00]'
                          : 'bg-slate-900/95 border-sky-400/80 text-sky-100'
                      }`}
                    >
                      {dragOp.mode === 'move' ? (
                        <span>
                          {t.editPanel.badgeMove} • X: {Math.round(activeBox.x)}, Y: {Math.round(activeBox.y)} pt
                        </span>
                      ) : dragOp.isReflow ? (
                        <span>
                          {t.editPanel.badgeReflow} • {t.editPanel.widthLabel}: {Math.round(activeBox.width)} pt
                        </span>
                      ) : isImage ? (
                        <span>
                          {Math.round(activeBox.width)} × {Math.round(activeBox.height)} pt
                          {block.pixelWidth && activeBox.width > 0
                            ? ` • ${Math.round((block.pixelWidth / activeBox.width) * 72)} DPI`
                            : ''}
                        </span>
                      ) : (
                        <span>
                          {t.editPanel.badgeScale} •{' '}
                          {Math.round((activeBox.width / Math.max(1, dragOp.origRect.width)) * 100)}% (
                          {Math.round(activeBox.width)} × {Math.round(activeBox.height)} pt)
                        </span>
                      )}
                    </div>
                  )}

                  {/* Per-line interactive hitboxes inside a selected multi-line PDF text block */}
                  {!isImage && isSelected && !lineEditor && !isDraggingThis && selectedBlockLines.length > 1 && (
                    <div className="absolute inset-0 pointer-events-none">
                      {selectedBlockLines.map((ln) => {
                        const isLineSelected = selectedLineId === ln.id;
                        const isLineHovered = hoveredLineId === ln.id;
                        return (
                          <div
                            key={ln.id}
                            data-line-id={ln.id}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              setHoveredLineId(ln.id);
                            }}
                            onMouseLeave={(e) => {
                              e.stopPropagation();
                              setHoveredLineId(null);
                            }}
                            onClick={(e) => {
                              if (suppressNextClickRef.current) {
                                e.stopPropagation();
                                return;
                              }
                              e.stopPropagation();
                              setSelectedLineId(ln.id);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              openLineEditorForLine(ln);
                            }}
                            style={{
                              left: `${(ln.bbox.x - block.x) * scale}px`,
                              top: `${(ln.bbox.y - block.y) * scale}px`,
                              width: `${Math.max(8, ln.bbox.width * scale)}px`,
                              height: `${Math.max(8, ln.bbox.height * scale)}px`,
                            }}
                            title={`${t.editPanel.lineProgressBadge
                              .replace('{current}', String(ln.index + 1))
                              .replace('{total}', String(selectedBlockLines.length))}: ${ln.text}\n(${t.editPanel.canvasDoubleClickHint})`}
                            className={`absolute pointer-events-auto rounded-[2px] transition-colors cursor-text ${
                              isLineSelected
                                ? isMinimal
                                  ? 'border border-black bg-sky-500/20 ring-1 ring-black/60'
                                  : isLcars
                                  ? 'border border-[#ffcc00] bg-[#ffcc00]/25 ring-1 ring-[#ffcc00]'
                                  : 'border border-sky-400 bg-sky-400/25 ring-1 ring-sky-400/80'
                                : isLineHovered
                                ? isMinimal
                                  ? 'border border-indigo-600/80 bg-indigo-500/15'
                                  : isLcars
                                  ? 'border border-[#ff9900] bg-[#ff9900]/20'
                                  : 'border border-sky-400/80 bg-sky-400/15'
                                : 'border border-transparent hover:border-sky-400/70 hover:bg-sky-400/10'
                            }`}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Text Block Contextual Floating Action Pill on Selection */}
                  {!isImage && isSelected && !lineEditor && !isDraggingThis && (() => {
                    const isMultiLine = selectedBlockLines.length > 1;
                    const activeLine =
                      isMultiLine && selectedLineId
                        ? selectedBlockLines.find((l) => l.id === selectedLineId) || null
                        : null;
                    const activeLineIdx = activeLine ? selectedBlockLines.indexOf(activeLine) : -1;

                    return (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className={`absolute z-50 flex items-center gap-1 px-2 py-1 shadow-2xl rounded-xl border text-xs whitespace-nowrap backdrop-blur-xl pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150 ${
                          placeBarBelow ? 'top-full mt-1.5 left-0' : '-top-10 left-0'
                        } ${
                          isMinimal
                            ? 'bg-white/95 border-neutral-300 text-neutral-800 shadow-lg'
                            : isLcars
                            ? 'bg-black border-2 border-[#99ccff] text-[#99ccff] shadow-[0_0_15px_rgba(153,204,255,0.35)]'
                            : 'bg-slate-900/95 border-indigo-500/70 text-slate-100 shadow-slate-950/80 ring-1 ring-indigo-500/30'
                        }`}
                      >
                        {/* Multi-line position badge */}
                        {isMultiLine && (
                          <>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                isMinimal
                                  ? 'bg-neutral-100 text-neutral-700'
                                  : isLcars
                                  ? 'bg-[#ff9900]/20 text-[#ffcc00]'
                                  : 'bg-indigo-500/20 text-indigo-300'
                              }`}
                            >
                              {activeLineIdx >= 0
                                ? t.editPanel.lineProgressBadge
                                    .replace('{current}', String(activeLineIdx + 1))
                                    .replace('{total}', String(selectedBlockLines.length))
                                : `${selectedBlockLines.length} ${t.editPanel.linesShort}`}
                            </span>
                            <div
                              className={`h-4 w-px mx-0.5 ${
                                isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#99ccff]/30' : 'bg-slate-700'
                              }`}
                            />
                          </>
                        )}

                        {/* Inline Edit Line (targets exact selected line in multi-line blocks!) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (activeLine) {
                              openLineEditorForLine(activeLine);
                            } else if (selectedBlockLines.length > 0) {
                              openLineEditorForLine(selectedBlockLines[0]);
                            } else {
                              void openLineEditorAtPdfPoint(
                                block.x + Math.min(block.width / 2, 24),
                                block.y + Math.min(block.height / 2, 8),
                                block.id
                              );
                            }
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                            isMinimal
                              ? 'hover:bg-indigo-50 text-indigo-700'
                              : isLcars
                              ? 'hover:bg-[#99ccff]/20 text-[#ffff66]'
                              : 'hover:bg-indigo-950/70 text-indigo-300 hover:text-indigo-200'
                          }`}
                          title={t.editPanel.canvasEditLine}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t.editPanel.canvasEditLine}</span>
                        </button>

                        {/* Open / Focus Inspector */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditSidePanelTab('remove');
                            setIsEditSidePanelOpen(true);
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                            isMinimal
                              ? 'hover:bg-neutral-100 text-neutral-700'
                              : isLcars
                              ? 'hover:bg-[#ff9900]/20 text-[#ff9900]'
                              : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                          }`}
                          title={t.editPanel.canvasInspect}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t.editPanel.canvasInspect}</span>
                        </button>

                        <div
                          className={`h-4 w-px mx-0.5 ${
                            isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#99ccff]/30' : 'bg-slate-700'
                          }`}
                        />

                        {/* Delete ONLY the targeted line (when a specific line is selected in a multi-line block) */}
                        {activeLine && (
                          <button
                            type="button"
                            disabled={Boolean(deletingBlockId)}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteSingleLineOnCanvas(activeLine);
                            }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                              isMinimal
                                ? 'hover:bg-amber-50 text-amber-800'
                                : isLcars
                                ? 'hover:bg-[#ff9900]/25 text-[#ffcc00]'
                                : 'hover:bg-amber-950/60 text-amber-300 hover:text-amber-200'
                            }`}
                            title={t.editPanel.deleteLineBtn}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t.editPanel.deleteLineBtn}</span>
                          </button>
                        )}

                        {/* Delete Whole Block (immediate + Undo toast) */}
                        <button
                          type="button"
                          disabled={Boolean(deletingBlockId)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteVisualTextBlock(block);
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                            isMinimal
                              ? 'hover:bg-rose-50 text-rose-700'
                              : isLcars
                              ? 'hover:bg-[#cc3333]/30 text-[#ff6666]'
                              : 'hover:bg-rose-950/60 text-rose-300 hover:text-rose-200'
                          }`}
                          title={t.editPanel.deleteBlockBtn}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {activeLine ? t.editPanel.deleteBlockBtn : t.editPanel.canvasDelete}
                          </span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Image Quick Action Floating Bar on Selection */}
                  {isImage && isSelected && !isDraggingThis && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute z-50 flex items-center gap-1.5 px-2.5 py-1 shadow-2xl rounded-xl border text-xs whitespace-nowrap backdrop-blur-xl pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150 ${
                        placeBarBelow ? 'top-2 left-2' : '-top-10 left-0'
                      } ${
                        isMinimal
                          ? 'bg-white/95 border-neutral-300 text-neutral-800 shadow-lg'
                          : isLcars
                          ? 'bg-black border-2 border-[#ff9900] text-[#ffcc00] shadow-[0_0_15px_rgba(255,153,0,0.4)]'
                          : 'bg-slate-900/95 border-amber-500/70 text-amber-100 shadow-slate-950/80 ring-1 ring-amber-500/30'
                      }`}
                    >
                      <div
                        className={`flex items-center gap-1 font-mono text-[11px] font-semibold mr-1 ${
                          isMinimal ? 'text-amber-700' : isLcars ? 'text-[#ffcc00]' : 'text-amber-400'
                        }`}
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>{block.imageName || t.editPanel.inlineImageBadge}</span>
                        {block.pixelWidth && block.pixelHeight && (
                          <span className="opacity-75 font-normal">({block.pixelWidth}×{block.pixelHeight})</span>
                        )}
                        {block.dpi && (
                          <span className="opacity-75 font-normal">{block.dpi} DPI</span>
                        )}
                      </div>

                      <div className={`h-4 w-px mx-0.5 ${isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#ff9900]/40' : 'bg-slate-700'}`} />

                      {/* Download Button (works for both XObject and inline images via canvas crop) */}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const canvasEl = document.getElementById(`page_canvas_${page.id}`) as HTMLCanvasElement | null;
                          const res = await exportPageImage(
                            block.imageName || block.text || 'inline-image',
                            pages.findIndex((p) => p.id === page.id),
                            canvasEl,
                            { x: block.x, y: block.y, width: block.width, height: block.height }
                          );
                          if (!res.success) {
                            showEditNotice({ type: 'error', text: res.error || t.editPanel.imageExportFailed });
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                          isMinimal
                            ? 'hover:bg-neutral-100 text-neutral-700'
                            : isLcars
                            ? 'hover:bg-[#ff9900]/20 text-[#ffff66]'
                            : 'hover:bg-slate-800 text-sky-300 hover:text-sky-200'
                        }`}
                        title={t.editPanel.downloadImage}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.editPanel.downloadImage}</span>
                      </button>

                      {/* Replace Button (disabled with clear tooltip for inline stream images) */}
                      {isInlineImage ? (
                        <button
                          type="button"
                          disabled
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium opacity-45 cursor-not-allowed ${
                            isMinimal
                              ? 'text-neutral-500'
                              : isLcars
                              ? 'text-[#ff9966]'
                              : 'text-slate-400'
                          }`}
                          title={t.editPanel.replaceInlineDisabled}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t.editPanel.replaceImage}</span>
                        </button>
                      ) : (
                        <label
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            isMinimal
                              ? 'hover:bg-emerald-50 text-emerald-700'
                              : isLcars
                              ? 'hover:bg-[#ff9900]/20 text-[#ffcc00]'
                              : 'hover:bg-emerald-950/60 text-emerald-300 hover:text-emerald-200'
                          }`}
                          title={t.editPanel.replaceImage}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t.editPanel.replaceImage}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file && block.imageName) {
                                const res = await replacePageImage(
                                  block.imageName,
                                  file,
                                  undefined,
                                  pages.findIndex((p) => p.id === page.id)
                                );
                                if (res.success) {
                                  showEditNotice({ type: 'success', text: t.editPanel.imageReplaced, canUndo: true });
                                  refreshVisualBlocksRef.current();
                                } else {
                                  showEditNotice({ type: 'error', text: res.error || t.editPanel.imageReplaceFailed });
                                }
                              }
                            }}
                          />
                        </label>
                      )}

                      {/* Delete Button (immediate + Undo toast, no native window.confirm) */}
                      <button
                        type="button"
                        disabled={Boolean(deletingBlockId)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteVisualImageBlock(block);
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                          isMinimal
                            ? 'hover:bg-rose-50 text-rose-700'
                            : isLcars
                            ? 'hover:bg-[#cc3333]/30 text-[#ff6666]'
                            : 'hover:bg-rose-950/60 text-rose-300 hover:text-rose-200'
                        }`}
                        title={t.editPanel.deleteImageBtn}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.editPanel.canvasDelete}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

        {/* Inline line editor (boundary-clamped, theme-aware, click-outside dismiss, multi-line stepping) */}
        {lineEditor && (() => {
          const layout = clampInlineEditorPosition(lineEditor.box, page.width, page.height, scale);
          const curLineIdx = selectedBlockLines.findIndex((l) => l.id === lineEditor.lineId);
          const hasSiblingLines = selectedBlockLines.length > 1 && curLineIdx >= 0;
          const stepToSiblingLine = (delta: -1 | 1) => {
            if (!hasSiblingLines) return;
            const nextIdx = (curLineIdx + delta + selectedBlockLines.length) % selectedBlockLines.length;
            openLineEditorForLine(selectedBlockLines[nextIdx]);
          };

          const controlsBar = (
            <div className={`${layout.placeControlsAbove ? 'mb-1' : 'mt-1'} flex items-center gap-1 text-[10px]`}>
              {hasSiblingLines && (
                <div
                  className={`flex items-center gap-0.5 px-1 py-0.5 rounded border ${
                    isMinimal
                      ? 'bg-white border-neutral-300 text-neutral-800'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ffcc00]'
                      : 'bg-slate-900 border-slate-700 text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => stepToSiblingLine(-1)}
                    className="p-0.5 hover:opacity-100 opacity-75"
                    title={t.editPanel.prevLine}
                    aria-label={t.editPanel.prevLine}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="font-mono px-0.5">
                    {t.editPanel.lineProgressBadge
                      .replace('{current}', String(curLineIdx + 1))
                      .replace('{total}', String(selectedBlockLines.length))}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepToSiblingLine(1)}
                    className="p-0.5 hover:opacity-100 opacity-75"
                    title={t.editPanel.nextLine}
                    aria-label={t.editPanel.nextLine}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={saveLineEditor}
                disabled={isSavingLine}
                className={`px-2 py-0.5 font-semibold transition-colors disabled:opacity-50 ${
                  isMinimal
                    ? 'rounded bg-black text-white hover:bg-neutral-800'
                    : isLcars
                    ? 'rounded-full bg-[#ff9900] text-black hover:bg-[#ffcc00] font-bold uppercase'
                    : 'rounded bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                {isSavingLine ? t.editPanel.saving : t.editPanel.inlineSave}
              </button>
              <button
                type="button"
                onClick={() => setLineEditor(null)}
                className={`px-2 py-0.5 font-medium transition-colors ${
                  isMinimal
                    ? 'rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300'
                    : isLcars
                    ? 'rounded-full bg-[#222222] text-[#ff9966] border border-[#ff9966] hover:bg-[#333333]'
                    : 'rounded bg-slate-700 text-white hover:bg-slate-600'
                }`}
              >
                {t.editPanel.inlineCancel}
              </button>
            </div>
          );
          return (
            <div
              ref={inlineEditorRef}
              className="absolute z-50 pointer-events-auto"
              style={{
                left: `${layout.left}px`,
                top: `${layout.top}px`,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {layout.placeControlsAbove && controlsBar}
              <input
                autoFocus
                value={lineEditor.text}
                disabled={isSavingLine}
                aria-label={t.editPanel.inlineEditorAria}
                onChange={(e) => setLineEditor({ ...lineEditor, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveLineEditor();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setLineEditor(null);
                  }
                }}
                style={{
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  fontSize: `${Math.max(lineEditor.box.height * scale * 0.72, 11)}px`,
                }}
                className={`px-1.5 shadow-xl outline-none font-sans border-2 ${
                  isMinimal
                    ? 'rounded border-black bg-white text-black'
                    : isLcars
                    ? 'rounded-md border-[#ff9900] bg-white text-black'
                    : 'rounded border-indigo-500 bg-white text-slate-900'
                }`}
              />
              {!layout.placeControlsAbove && controlsBar}
            </div>
          );
        })()}

        {/* Floating Quick Action Selection Toolbar */}
        {floatingMenuPos && (
          <div
            style={{
              left: `${floatingMenuPos.x}px`,
              top: `${floatingMenuPos.y}px`,
              transform: 'translateX(-50%)',
            }}
            className={`pointer-events-auto absolute z-50 flex items-center gap-1 px-2 py-1 shadow-2xl rounded-xl border animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl ${
              isMinimal
                ? 'bg-white border-neutral-300 text-black shadow-lg'
                : isLcars
                ? 'bg-black border-2 border-[#ff9900] text-[#ff9900] shadow-[0_0_15px_rgba(255,153,0,0.4)]'
                : 'bg-slate-900/95 border-sky-500/70 text-slate-100 shadow-slate-950/80 ring-1 ring-sky-500/30'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {copiedToast ? (
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-emerald-400">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.textSelection.copied}</span>
              </div>
            ) : (
              <>
                {/* Copy Button */}
                <button
                  onClick={handleCopyText}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-neutral-100 text-black'
                      : isLcars
                      ? 'hover:bg-[#222222] text-[#ff9900]'
                      : 'hover:bg-slate-800 text-slate-200 hover:text-white'
                  }`}
                  title={t.textSelection.copyText}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.copyText}</span>
                </button>

                <div
                  className={`h-4 w-px mx-0.5 ${
                    isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
                  }`}
                />

                {/* Open in Edit Inspector Button (Quick Action) */}
                <button
                  onClick={handleStreamReplace}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-purple-50 text-purple-700'
                      : isLcars
                      ? 'hover:bg-[#ff9900]/20 text-[#ffff66]'
                      : 'hover:bg-indigo-950/60 text-indigo-300'
                  }`}
                  title={t.editPanel.canvasInspect}
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.editPanel.canvasInspect}</span>
                </button>

                <div
                  className={`h-4 w-px mx-0.5 ${
                    isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
                  }`}
                />

                {/* Whiteout / Visual Rewrite Button (Quick Action) */}
                <button
                  onClick={handleWhiteout}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-indigo-50 text-indigo-700'
                      : isLcars
                      ? 'hover:bg-[#ff9900]/20 text-[#ff9966]'
                      : 'hover:bg-indigo-950/60 text-indigo-400'
                  }`}
                  title={t.textSelection.whiteout}
                >
                  <SquarePen className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.whiteout}</span>
                </button>

                <div
                  className={`h-4 w-px mx-0.5 ${
                    isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
                  }`}
                />

                {/* Highlight Button */}
                <button
                  onClick={handleHighlight}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-yellow-50 text-yellow-700'
                      : isLcars
                      ? 'hover:bg-[#ff9900]/20 text-[#ffcc00]'
                      : 'hover:bg-yellow-950/60 text-yellow-400'
                  }`}
                  title={t.textSelection.highlight}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.highlight}</span>
                </button>

                {/* Underline Button */}
                <button
                  onClick={handleUnderline}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-sky-50 text-sky-700'
                      : isLcars
                      ? 'hover:bg-[#99ccff]/20 text-[#99ccff]'
                      : 'hover:bg-sky-950/60 text-sky-400'
                  }`}
                  title={t.textSelection.underline}
                >
                  <UnderlineIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.underline}</span>
                </button>

                {/* Strikethrough Button */}
                <button
                  onClick={handleStrikethrough}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-rose-50 text-rose-700'
                      : isLcars
                      ? 'hover:bg-[#cc3333]/20 text-[#ff6666]'
                      : 'hover:bg-rose-950/60 text-rose-400'
                  }`}
                  title={t.textSelection.strikethrough}
                >
                  <StrikeIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.strikethrough}</span>
                </button>

                {/* Dismiss Button */}
                <button
                  onClick={() => {
                    setFloatingMenuPos(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  className={`p-1 rounded-md transition-colors ${
                    isMinimal
                      ? 'hover:bg-neutral-100 text-neutral-400 hover:text-black'
                      : isLcars
                      ? 'hover:bg-[#222222] text-[#ff9966]'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
