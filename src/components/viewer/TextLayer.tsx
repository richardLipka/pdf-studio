import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfTextLayer, getPageTextBlocks, getPageTextModel } from '../../services/pdfLoader';
import { renderQueue, RenderPriority } from '../../services/renderQueue';
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
  Code,
  Image as ImageIcon,
  Download,
  RefreshCw,
} from 'lucide-react';
import {
  parseStreamSegments,
  findBestMatchingBlock,
} from '../../services/contentStreamEditor';
import { VisualTextBlock } from '../../utils/textSnap';

interface TextLayerProps {
  page: PdfPageModel;
  sourceDoc: SourceDocument;
  scale: number;
}

export const TextLayer: React.FC<TextLayerProps> = ({ page, sourceDoc, scale }) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    activeTool,
    highlightColor,
    strokeColor,
    strokeWidth,
    setStreamReplaceTargetText,
    setStreamReplaceTargetPosition,
    isRemoveElementsModalOpen,
    isEditSidePanelOpen,
    setIsEditSidePanelOpen,
    editSidePanelTab,
    setEditSidePanelTab,
    selectedStreamBlockId,
    selectedStreamBlockPageId,
    setSelectedStreamBlockId,
    hoveredBlockId,
    hoveredBlockPageId,
    setHoveredBlockId,
    setHoveredBlockText,
    activeTab,
  } = useEditor();
  const {
    addAnnotation,
    setSelectedAnnotationId,
    pages,
    getPageStream,
    removePageBlock,
    removeMultiplePageElements,
    applyLineTextEdit,
    removePageImage,
    replacePageImage,
    exportPageImage,
    activePageIndex,
    setActivePageIndex,
    setSelectedPageIds,
  } = useDocument();

  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedRects, setSelectedRects] = useState<DOMRect[]>([]);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Page element overlays belong to the edit tab only; the review and signature tabs never show them
  const isRemoveActive =
    activeTab === 'edit' &&
    (activeTool === 'removeElements' ||
      activeTool === 'streamReplace' ||
      isRemoveElementsModalOpen ||
      isEditSidePanelOpen);
  const pageIndex = pages.findIndex((p) => p.id === page.id);
  const isActivePage = pageIndex === activePageIndex;
  // Element ids (block_3, img:Im1:0) repeat on every page: a selection or hover applies to its own
  // page, or to the active page when it came from the edit panel (which lists the active page)
  const selectionOnThisPage = selectedStreamBlockPageId ? selectedStreamBlockPageId === page.id : isActivePage;
  const hoverOnThisPage = hoveredBlockPageId ? hoveredBlockPageId === page.id : isActivePage;

  /** Makes this page the active one (the edit panel lists the active page) without scrolling it */
  const activateThisPage = () => {
    if (pageIndex >= 0 && pageIndex !== activePageIndex) {
      setActivePageIndex(pageIndex, { scrollIntoView: false });
      setSelectedPageIds([page.id]);
    }
  };
  const [visualBlocks, setVisualBlocks] = useState<VisualTextBlock[]>([]);
  const visualLoadRef = useRef(0);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  // Inline editor for one line of text, opened by double-clicking a text block
  const [lineEditor, setLineEditor] = useState<{
    lineId: string;
    text: string;
    original: string;
    box: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [lineEditStatus, setLineEditStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSavingLine, setIsSavingLine] = useState(false);

  const openLineEditor = async (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container || page.sourceType !== 'pdf') return;
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    const model = await getPageTextModel(sourceDoc, page);
    if (!model?.aligned) {
      setLineEditStatus({ ok: false, text: 'Text této stránky nelze spolehlivě namapovat — použijte panel Editace.' });
      return;
    }
    const line = model.blocks
      .flatMap((b) => b.lines)
      .filter(
        (l) => x >= l.bbox.x - 2 && x <= l.bbox.x + l.bbox.width + 2 && y >= l.bbox.y - 2 && y <= l.bbox.y + l.bbox.height + 2
      )
      .sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height)[0];
    if (!line) return;
    setLineEditStatus(null);
    setLineEditor({ lineId: line.id, text: line.text, original: line.text, box: line.bbox });
  };

  const saveLineEditor = async () => {
    if (!lineEditor || isSavingLine) return;
    if (lineEditor.text === lineEditor.original) {
      setLineEditor(null);
      return;
    }
    const pageIndex = pages.findIndex((p) => p.id === page.id);
    if (pageIndex < 0) return;
    setIsSavingLine(true);
    try {
      const res = await applyLineTextEdit(lineEditor.lineId, lineEditor.text, pageIndex);
      if (res.success) {
        setLineEditor(null);
        setLineEditStatus({
          ok: true,
          text: res.fontSubstituted
            ? 'Řádek přepsán; chybějící znaky doplněny náhradním písmem.'
            : 'Řádek přepsán původním písmem.',
        });
      } else {
        setLineEditStatus({ ok: false, text: res.error || 'Přepis řádku selhal.' });
      }
    } finally {
      setIsSavingLine(false);
    }
  };

  useEffect(() => {
    if (!lineEditStatus) return;
    const timer = setTimeout(() => setLineEditStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [lineEditStatus]);

  // An element selected in the edit panel is scrolled into view on its page
  useEffect(() => {
    if (!isRemoveActive || !selectedStreamBlockId || !selectionOnThisPage || selectedStreamBlockPageId) return;
    const timer = setTimeout(() => {
      const overlay = containerRef.current?.parentElement?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(selectedStreamBlockId)}"]`
      );
      overlay?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, 60);
    return () => clearTimeout(timer);
  }, [selectedStreamBlockId, selectedStreamBlockPageId, selectionOnThisPage, isRemoveActive]);

  // A different document version or page invalidates an open editor
  useEffect(() => {
    setLineEditor(null);
  }, [sourceDoc.updatedAt, page.id, page.rotation]);

  const refreshVisualBlocks = useCallback(async () => {
    // Newest load wins: a slower load started for an older version of the document must not
    // bring back blocks (and segment ids) that no longer exist
    const token = ++visualLoadRef.current;
    if (!isRemoveActive || page.sourceType !== 'pdf') {
      setVisualBlocks([]);
      return;
    }
    try {
      const blocks = await getPageTextBlocks(sourceDoc, page);
      if (token === visualLoadRef.current) setVisualBlocks(blocks);
    } catch {
      if (token === visualLoadRef.current) setVisualBlocks([]);
    }
  }, [isRemoveActive, sourceDoc, page]);
  // Async callbacks (text layer render) must use the current mode and document, not the ones
  // captured when they were started
  const refreshVisualBlocksRef = useRef(refreshVisualBlocks);
  refreshVisualBlocksRef.current = refreshVisualBlocks;

  /** Deletes a text block straight from the canvas, guarded against stale segment ids */
  const deleteVisualTextBlock = async (block: VisualTextBlock) => {
    const pageIndex = pages.findIndex((p) => p.id === page.id);
    if (pageIndex < 0 || deletingBlockId) return;
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
      const res = await removeMultiplePageElements(ids, [], pageIndex, expected);
      if (!res.success) {
        console.warn('Failed to delete block:', res.error);
        refreshVisualBlocksRef.current();
      }
      setSelectedStreamBlockId(null);
      setHoveredBlockId(null);
      setHoveredBlockText(null);
    } finally {
      setDeletingBlockId(null);
    }
  };

  /** Model-based text block under the centre of the current selection */
  const findTextBlockAtSelection = async (): Promise<VisualTextBlock | null> => {
    const container = containerRef.current;
    if (!container || selectedRects.length === 0 || page.sourceType !== 'pdf') return null;
    const containerRect = container.getBoundingClientRect();
    const rect = selectedRects[0];
    const x = (rect.left + rect.width / 2 - containerRect.left) / scale;
    const y = (rect.top + rect.height / 2 - containerRect.top) / scale;
    const blocks = await getPageTextBlocks(sourceDoc, page);
    return (
      blocks
        .filter(
          (b) =>
            b.type !== 'image' &&
            b.segmentContents &&
            x >= b.x - 1 &&
            x <= b.x + b.width + 1 &&
            y >= b.y - 1 &&
            y <= b.y + b.height + 1
        )
        .sort((a, b) => a.width * a.height - b.width * b.height)[0] || null
    );
  };

  useEffect(() => {
    if (isRemoveActive) {
      refreshVisualBlocksRef.current();
    } else {
      setVisualBlocks([]);
    }
  }, [isRemoveActive, refreshVisualBlocks, page.id, page.rotation, sourceDoc.updatedAt]);

  // Render text layer from PDF.js
  useEffect(() => {
    let isCancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const taskId = `text_${page.id}_${page.rotation}_${scale}`;
    const isInitialBatch = page.originalPageIndex < 5;
    const initialPriority = isInitialBatch
      ? RenderPriority.INITIAL_BATCH
      : RenderPriority.BACKGROUND;

    renderQueue
      .enqueue(taskId, initialPriority, async () => {
        if (isCancelled || !container) return;
        await renderPdfTextLayer(sourceDoc, page, container, scale);
      })
      .then(() => {
        // pdf.js sizes (and for rotated pages rotates) the layer itself
        if (!isCancelled && container) {
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
    const container = containerRef.current;
    if (container && selectedRects.length > 0) {
      const containerRect = container.getBoundingClientRect();
      const rect = selectedRects[0];
      const pdfX = (rect.left + rect.width / 2 - containerRect.left) / scale;
      const pdfY = (rect.top + rect.height / 2 - containerRect.top) / scale;
      setStreamReplaceTargetPosition({ x: pdfX, y: pdfY });
    }
    setStreamReplaceTargetText(selectedText);
    setEditSidePanelTab('stream');
    setIsEditSidePanelOpen(true);
    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleDeleteBlockDirectly = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedText) return;
    try {
      const pageIndex = pages.findIndex((p) => p.id === page.id);
      if (pageIndex < 0) return;
      // Exact text model: delete the text object(s) drawn under the selection
      const hit = await findTextBlockAtSelection();
      if (hit) {
        await deleteVisualTextBlock(hit);
        return;
      }
      const container = containerRef.current;
      const containerRect = container?.getBoundingClientRect();
      const selectionPos =
        containerRect && selectedRects.length > 0
          ? {
              x: (selectedRects[0].left - containerRect.left) / scale,
              y: (selectedRects[0].top - containerRect.top) / scale,
            }
          : null;
      const { streamText } = await getPageStream(pageIndex);
      if (streamText) {
        // Only text blocks are candidates, and nothing is deleted without a real match
        const textSegments = parseStreamSegments(streamText).filter((s) => s.type === 'text');
        const best = findBestMatchingBlock(textSegments, selectedText, selectionPos, page.height, true);
        if (best) {
          await removePageBlock(best, pageIndex);
        }
      }
    } catch (err) {
      console.error('Failed to delete block:', err);
    } finally {
      setFloatingMenuPos(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleLayerClick = (e: React.MouseEvent) => {
    if (activeTab === 'edit' && (activeTool === 'streamReplace' || activeTool === 'removeElements')) {
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

      e.stopPropagation();
      setStreamReplaceTargetPosition({ x: clickPdfX, y: clickPdfY });
      setStreamReplaceTargetText(text);

      if (activeTool === 'streamReplace') {
        setEditSidePanelTab('stream');
        setIsEditSidePanelOpen(true);
      } else if (activeTool === 'removeElements') {
        setEditSidePanelTab('remove');
        setIsEditSidePanelOpen(true);
      }
    }
  };

  const isTextSelectActive =
    activeTool === 'textSelect' ||
    activeTool === 'select' ||
    activeTool === 'streamReplace' ||
    isRemoveActive;

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
        } ${activeTool === 'streamReplace' ? 'cursor-pointer hover:bg-sky-500/5' : ''} ${
          activeTool === 'removeElements' ? 'cursor-pointer' : ''
        }`}
      />

      {/* 2. React Overlay Container (Blocks & Floating Toolbar) */}
      <div className="absolute inset-0 pointer-events-none z-30">
        {/* Visual Block Highlight Overlay for Remove Elements & Stream Mode */}
        {isRemoveActive &&
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
              const isStreamMode =
                !isImage &&
                (activeTool === 'streamReplace' ||
                  (isEditSidePanelOpen && editSidePanelTab === 'stream'));

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

              return (
                <div
                  key={block.id}
                  data-block-id={block.id}
                  onMouseEnter={() => {
                    setHoveredBlockId(block.id, page.id);
                    setHoveredBlockText(block.text);
                  }}
                  onMouseLeave={() => {
                    setHoveredBlockId(null);
                    setHoveredBlockText(null);
                  }}
                  onDoubleClick={(e) => {
                    if (isImage) return;
                    e.stopPropagation();
                    openLineEditor(e.clientX, e.clientY);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    activateThisPage();
                    setSelectedStreamBlockId(block.id, page.id);
                    // The text target makes the panel pick the text block under it; an image is
                    // selected by its id alone
                    if (!isImage) {
                      setStreamReplaceTargetPosition({
                        x: block.x + block.width / 2,
                        y: block.y + block.height / 2,
                      });
                      setStreamReplaceTargetText(block.text);
                    }

                    setTimeout(() => {
                      const el = document.getElementById(
                        isImage ? `panel_item_img_${block.id}` : `panel_item_${block.id}`
                      );
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 80);

                    if (isImage) {
                      setEditSidePanelTab('remove');
                    } else if (activeTool === 'streamReplace') {
                      setEditSidePanelTab('stream');
                    } else {
                      setEditSidePanelTab('remove');
                    }
                    setIsEditSidePanelOpen(true);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${block.x * scale}px`,
                    top: `${block.y * scale}px`,
                    width: `${block.width * scale}px`,
                    height: `${block.height * scale}px`,
                    zIndex,
                  }}
                  className={`group pointer-events-auto absolute rounded-[2px] transition-all cursor-pointer flex items-start justify-end ${
                    isImage
                      ? isSelected
                        ? isMinimal
                          ? 'border-2 border-dashed border-amber-600 bg-amber-600/25 ring-2 ring-amber-500 shadow-md'
                          : isLcars
                          ? 'border-2 border-dashed border-[#ffcc00] bg-[#ffcc00]/35 ring-2 ring-[#ffcc00]'
                          : 'border-2 border-dashed border-amber-400 bg-amber-500/30 ring-2 ring-amber-400/80 shadow-[0_0_14px_rgba(251,191,36,0.7)]'
                        : isHovered
                        ? isMinimal
                          ? 'border-2 border-dashed border-amber-600/90 bg-amber-600/20 ring-1 ring-amber-400'
                          : isLcars
                          ? 'border-2 border-dashed border-[#ffcc00] bg-[#ffcc00]/25'
                          : 'border-2 border-dashed border-amber-400 bg-amber-500/20 ring-1 ring-amber-400/50 shadow-[0_0_10px_rgba(251,191,36,0.5)]'
                        : isMinimal
                        ? 'border border-dashed border-amber-600/70 bg-amber-600/10 hover:bg-amber-600/25 hover:border-amber-700'
                        : isLcars
                        ? 'border border-dashed border-[#ffcc00]/70 bg-[#ffcc00]/15 hover:bg-[#ffcc00]/30'
                        : 'border border-dashed border-amber-500/60 bg-amber-500/10 hover:border-amber-400 hover:bg-amber-500/25 hover:shadow-[0_0_10px_rgba(251,191,36,0.4)]'
                      : isStreamMode
                      ? isSelected
                        ? isMinimal
                          ? 'border-2 border-indigo-600 bg-indigo-600/20 ring-2 ring-indigo-500 shadow-md'
                          : isLcars
                          ? 'border-2 border-[#99ccff] bg-[#99ccff]/30 ring-2 ring-[#99ccff]'
                          : 'border-2 border-indigo-400 bg-indigo-500/25 ring-2 ring-indigo-400/80 shadow-[0_0_12px_rgba(99,102,241,0.65)]'
                        : isHovered
                        ? isMinimal
                          ? 'border border-indigo-600/90 bg-indigo-600/15 ring-1 ring-indigo-400'
                          : isLcars
                          ? 'border border-[#99ccff] bg-[#99ccff]/20'
                          : 'border border-indigo-400 bg-indigo-500/20 ring-1 ring-indigo-400/50 shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                        : isMinimal
                        ? 'border border-indigo-600/70 bg-indigo-600/5 hover:bg-indigo-600/20 hover:border-indigo-700'
                        : isLcars
                        ? 'border border-[#99ccff]/70 bg-[#99ccff]/10 hover:bg-[#99ccff]/25'
                        : 'border border-indigo-500/60 bg-indigo-500/5 hover:border-indigo-400 hover:bg-indigo-500/20 hover:shadow-[0_0_8px_rgba(99,102,241,0.35)]'
                      : isSelected
                      ? isMinimal
                        ? 'border-2 border-rose-600 bg-rose-600/20 ring-2 ring-rose-500 shadow-md'
                        : isLcars
                        ? 'border-2 border-[#ff9900] bg-[#ff9900]/30 ring-2 ring-[#ff9900]'
                        : 'border-2 border-rose-400 bg-rose-500/25 ring-2 ring-rose-400/80 shadow-[0_0_12px_rgba(244,63,94,0.65)]'
                      : isHovered
                      ? isMinimal
                        ? 'border border-rose-600/90 bg-rose-600/15 ring-1 ring-rose-400'
                        : isLcars
                        ? 'border border-[#ff9900] bg-[#ff9900]/20'
                        : 'border border-rose-400 bg-rose-500/20 ring-1 ring-rose-400/50 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                      : isMinimal
                      ? 'border border-rose-600/70 bg-rose-600/5 hover:bg-rose-600/20 hover:border-rose-700'
                      : isLcars
                      ? 'border border-[#ff3333] bg-[#ff3333]/15 hover:bg-[#ff3333]/30 hover:border-[#ff6666]'
                      : 'border border-rose-500/60 bg-rose-500/5 hover:border-rose-400 hover:bg-rose-500/20 hover:shadow-[0_0_8px_rgba(244,63,94,0.35)]'
                  }`}
                  title={
                    isImage
                      ? `Obrázek: ${block.imageName || block.text}${
                          block.pixelWidth && block.pixelHeight ? ` (${block.pixelWidth}×${block.pixelHeight} px)` : ''
                        }`
                      : `${block.text}
(dvojklikem upravíte řádek)`
                  }
                >
                  {/* Small Icon Badge on Hover or Active; in remove mode it deletes the text block */}
                  {!isImage && !isStreamMode ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteVisualTextBlock(block);
                      }}
                      disabled={Boolean(deletingBlockId)}
                      className={`${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      } transition-opacity text-white rounded-xs p-1 shadow-sm -mt-3 -mr-2 pointer-events-auto bg-rose-600 hover:bg-rose-500 hover:scale-110 disabled:opacity-50`}
                      title={`Smazat blok: ${block.text}`}
                      aria-label="Smazat blok"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  ) : (
                    <div
                      className={`opacity-0 group-hover:opacity-100 transition-opacity text-white rounded-xs p-0.5 shadow-sm -mt-2.5 -mr-1.5 pointer-events-none ${
                        isImage ? 'bg-amber-600' : 'bg-indigo-600'
                      }`}
                    >
                      {isImage ? <ImageIcon className="w-2.5 h-2.5" /> : <Code className="w-2.5 h-2.5" />}
                    </div>
                  )}

                  {/* Image Quick Action Floating Bar on Selection */}
                  {isImage && isSelected && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute z-50 flex items-center gap-1.5 px-2.5 py-1 shadow-2xl rounded-xl border text-xs whitespace-nowrap backdrop-blur-xl pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150 ${
                        block.y * scale < 45 ? 'top-2 left-2' : '-top-10 left-0'
                      } ${
                        isMinimal
                          ? 'bg-white/95 border-neutral-300 text-neutral-800 shadow-lg'
                          : isLcars
                          ? 'bg-black border-2 border-[#ff9900] text-[#ffcc00] shadow-[0_0_15px_rgba(255,153,0,0.4)]'
                          : 'bg-slate-900/95 border-amber-500/70 text-amber-100 shadow-slate-950/80 ring-1 ring-amber-500/30'
                      }`}
                    >
                      <div className="flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-400 mr-1">
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>{block.imageName || 'Obrázek'}</span>
                        {block.pixelWidth && block.pixelHeight && (
                          <span className="opacity-75 font-normal">({block.pixelWidth}×{block.pixelHeight})</span>
                        )}
                        {block.dpi && (
                          <span className="opacity-75 font-normal">{block.dpi} DPI</span>
                        )}
                      </div>

                      <div className={`h-4 w-px mx-0.5 ${isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#ff9900]/40' : 'bg-slate-700'}`} />

                      {/* Download Button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (block.imageName) {
                            const canvasEl = document.getElementById(`page_canvas_${page.id}`) as HTMLCanvasElement | null;
                            await exportPageImage(
                              block.imageName,
                              pages.findIndex((p) => p.id === page.id),
                              canvasEl,
                              { x: block.x, y: block.y, width: block.width, height: block.height }
                            );
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                          isMinimal
                            ? 'hover:bg-neutral-100 text-neutral-700'
                            : isLcars
                            ? 'hover:bg-[#ff9900]/20 text-[#ffff66]'
                            : 'hover:bg-slate-800 text-sky-300 hover:text-sky-200'
                        }`}
                        title="Stáhnout obrázek"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Stáhnout</span>
                      </button>

                      {/* Replace Button with File Input */}
                      <label
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          isMinimal
                            ? 'hover:bg-emerald-50 text-emerald-700'
                            : isLcars
                            ? 'hover:bg-[#ff9900]/20 text-[#ffcc00]'
                            : 'hover:bg-emerald-950/60 text-emerald-300 hover:text-emerald-200'
                        }`}
                        title="Nahradit obrázek"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Nahradit</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file && block.imageName) {
                              await replacePageImage(
                                block.imageName,
                                file,
                                undefined,
                                pages.findIndex((p) => p.id === page.id)
                              );
                              refreshVisualBlocksRef.current();
                            }
                          }}
                        />
                      </label>

                      {/* Delete Button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(`Opravdu chcete z dokumentu odstranit obrázek ${block.imageName || block.text}?`)
                          ) {
                            if (pageIndex < 0) return;
                            // Removes exactly this placement (its q ... Do ... Q or inline image), not a
                            // whole stream segment; the XObject entry goes once it is painted nowhere else
                            const res = await removePageImage(block.id, pageIndex);
                            if (res.success) {
                              refreshVisualBlocksRef.current();
                              setSelectedStreamBlockId(null);
                            }
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                          isMinimal
                            ? 'hover:bg-rose-50 text-rose-700'
                            : isLcars
                            ? 'hover:bg-[#cc3333]/30 text-[#ff6666]'
                            : 'hover:bg-rose-950/60 text-rose-300 hover:text-rose-200'
                        }`}
                        title="Smazat obrázek"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Smazat</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

        {/* Inline line editor */}
        {lineEditor && (
          <div
            className="absolute z-50 pointer-events-auto"
            style={{
              left: `${lineEditor.box.x * scale - 4}px`,
              top: `${lineEditor.box.y * scale - 4}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={lineEditor.text}
              disabled={isSavingLine}
              aria-label="Upravit řádek textu"
              onChange={(e) => setLineEditor({ ...lineEditor, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveLineEditor();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setLineEditor(null);
                }
              }}
              style={{
                width: `${Math.max(lineEditor.box.width * scale + 60, 160)}px`,
                height: `${Math.max(lineEditor.box.height * scale + 8, 22)}px`,
                fontSize: `${Math.max(lineEditor.box.height * scale * 0.72, 11)}px`,
              }}
              className="px-1 rounded border-2 border-indigo-500 bg-white text-slate-900 shadow-xl outline-none font-sans"
            />
            <div className="mt-1 flex gap-1 text-[10px]">
              <button
                onClick={saveLineEditor}
                disabled={isSavingLine}
                className="px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {isSavingLine ? 'Ukládám…' : 'Uložit (Enter)'}
              </button>
              <button
                onClick={() => setLineEditor(null)}
                className="px-2 py-0.5 rounded bg-slate-700 text-white hover:bg-slate-600"
              >
                Zrušit (Esc)
              </button>
            </div>
          </div>
        )}
        {lineEditStatus && (
          <div
            role="status"
            className={`absolute left-1/2 -translate-x-1/2 top-2 z-50 px-3 py-1.5 rounded-lg text-xs shadow-lg pointer-events-none ${
              lineEditStatus.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            {lineEditStatus.text}
          </div>
        )}

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

                {/* Stream Replace Button (Quick Action) */}
                <button
                  onClick={handleStreamReplace}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-purple-50 text-purple-700'
                      : isLcars
                      ? 'hover:bg-[#ff9900]/20 text-[#ffff66]'
                      : 'hover:bg-indigo-950/60 text-indigo-300'
                  }`}
                  title={t.tools.streamReplace}
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.tools.streamReplace}</span>
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

                {/* Delete Block (Direct Stream Removal) Button */}
                <button
                  onClick={handleDeleteBlockDirectly}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    isMinimal
                      ? 'hover:bg-rose-100 text-rose-700'
                      : isLcars
                      ? 'hover:bg-[#cc3333]/30 text-[#ff6666]'
                      : 'hover:bg-rose-950/80 text-rose-400'
                  }`}
                  title={t.textSelection.deleteBlock}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.textSelection.deleteBlock}</span>
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
