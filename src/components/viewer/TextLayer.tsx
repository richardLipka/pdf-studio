import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfPageModel, SourceDocument } from '../../types/document';
import { renderPdfTextLayer } from '../../services/pdfLoader';
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
} from 'lucide-react';
import {
  parseStreamSegments,
  findBestMatchingBlock,
} from '../../services/contentStreamEditor';

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
    setIsStreamReplaceModalOpen,
    setStreamReplaceTargetText,
    streamReplaceTargetPosition,
    setStreamReplaceTargetPosition,
  } = useEditor();
  const {
    addAnnotation,
    setSelectedAnnotationId,
    pages,
    getPageStream,
    removePageBlock,
  } = useDocument();

  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedRects, setSelectedRects] = useState<DOMRect[]>([]);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

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
        if (!isCancelled && container) {
          // Set layer dimensions
          container.style.width = `${page.width * scale}px`;
          container.style.height = `${page.height * scale}px`;
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
      const pdfX = (rect.left - containerRect.left) / scale;
      const pdfY = (rect.top - containerRect.top) / scale;
      setStreamReplaceTargetPosition({ x: pdfX, y: pdfY });
    }
    setStreamReplaceTargetText(selectedText);
    setIsStreamReplaceModalOpen(true);
    setFloatingMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleDeleteBlockDirectly = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedText) return;
    try {
      const pageIndex = pages.findIndex((p) => p.id === page.id);
      const targetIdx = pageIndex >= 0 ? pageIndex : 0;
      const { streamText } = await getPageStream(targetIdx);
      if (streamText) {
        const segments = parseStreamSegments(streamText);
        const best = findBestMatchingBlock(
          segments,
          selectedText,
          streamReplaceTargetPosition || undefined
        );
        if (best) {
          await removePageBlock(best, targetIdx);
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
    if (activeTool === 'streamReplace') {
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
      setIsStreamReplaceModalOpen(true);
    }
  };

  const isTextSelectActive =
    activeTool === 'textSelect' ||
    activeTool === 'select' ||
    activeTool === 'streamReplace';

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      onClick={handleLayerClick}
      style={{
        width: `${page.width * scale}px`,
        height: `${page.height * scale}px`,
      }}
      className={`textLayer absolute inset-0 select-text ${
        isMinimal ? 'textLayer-minimal' : isLcars ? 'textLayer-lcars' : ''
      } ${
        isTextSelectActive
          ? 'pointer-events-auto cursor-text z-20'
          : 'pointer-events-none z-0'
      } ${activeTool === 'streamReplace' ? 'cursor-pointer hover:bg-sky-500/5' : ''}`}
    >
      {/* Floating Quick Action Selection Toolbar */}
      {floatingMenuPos && (
        <div
          style={{
            left: `${floatingMenuPos.x}px`,
            top: `${floatingMenuPos.y}px`,
            transform: 'translateX(-50%)',
          }}
          className={`absolute z-50 flex items-center gap-1 px-2 py-1 shadow-2xl rounded-xl border animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl ${
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
  );
};
