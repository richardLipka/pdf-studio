import React, { useState, useRef } from 'react';
import { PdfPageModel } from '../../types/document';
import {
  Annotation,
  DrawingAnnotation,
  HighlightAnnotation,
  NoteAnnotation,
  Point,
  SignatureAnnotation,
  StrikethroughAnnotation,
  TextAnnotation,
  WhiteoutAnnotation,
  UnderlineAnnotation,
  ShapeAnnotation,
} from '../../types/annotations';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../i18n/context';
import { screenToPdfPoint } from '../../utils/coordinate';
import { cropPageRegionToClipboard, CropResult } from '../../services/imageCropper';
import { findIntersectedTextLines } from '../../utils/textSnap';
import { NoteDialog } from '../common/NoteDialog';
import {
  MessageSquare,
  Trash2,
  Check,
  Download,
  X,
  Camera,
  BookmarkPlus,
} from 'lucide-react';

interface AnnotationLayerProps {
  page: PdfPageModel;
  scale: number;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({ page, scale }) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';
  const {
    activeTool,
    strokeColor,
    highlightColor,
    textColor,
    fillColor,
    strokeWidth,
    fontSize,
    fontFamily,
    isNotesPanelOpen,
    addStamp,
  } = useEditor();

  const {
    annotations,
    sources,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    selectedAnnotationId,
    setSelectedAnnotationId,
  } = useDocument();

  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing / Dragging / Cropping state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // Crop / Snapshot Tool State
  const [cropToastResult, setCropToastResult] = useState<CropResult | null>(null);
  const [cropFlash, setCropFlash] = useState<boolean>(false);
  const [cropStampSaved, setCropStampSaved] = useState<boolean>(false);

  // Repositioning / Resizing selected annotation
  const [draggingAnnId, setDraggingAnnId] = useState<string | null>(null);
  const [dragStartMouse, setDragStartMouse] = useState<Point>({ x: 0, y: 0 });
  const [dragStartAnnPos, setDragStartAnnPos] = useState<Point>({ x: 0, y: 0 });
  const [resizingAnnId, setResizingAnnId] = useState<string | null>(null);

  // Open note card modal/popover
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Inline comment popover for markups, lines, shapes, drawings
  const [activeCommentAnnId, setActiveCommentAnnId] = useState<string | null>(null);

  // Page annotations
  const pageAnnotations = annotations.filter((a) => a.pageId === page.id);

  const getPdfCoords = (e: React.MouseEvent): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return screenToPdfPoint(
      e.clientX,
      e.clientY,
      rect,
      scale,
      page.rotation,
      page.width,
      page.height
    );
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // If clicking an existing element or interactive widget, let its own handler handle it
    const targetEl = e.target as Element | null;
    if (
      targetEl &&
      (targetEl.closest?.('.annotation-item') ||
        targetEl.closest?.('button') ||
        targetEl.closest?.('input') ||
        targetEl.closest?.('textarea') ||
        targetEl.closest?.('.comment-popover'))
    ) {
      return;
    }

    const pt = getPdfCoords(e);

    // Hit test to see if user clicked within the bounds of any existing annotation on this page
    const hitAnnotation = pageAnnotations.find((ann) => {
      const pad = 8;
      if (
        ann.type === 'highlight' ||
        ann.type === 'underline' ||
        ann.type === 'strikethrough' ||
        ann.type === 'text' ||
        ann.type === 'whiteout' ||
        ann.type === 'drawing'
      ) {
        return (
          pt.x >= ann.x - pad &&
          pt.x <= ann.x + ann.width + pad &&
          pt.y >= ann.y - pad &&
          pt.y <= ann.y + ann.height + pad
        );
      }
      if (ann.type === 'note') {
        return (
          pt.x >= ann.x - pad &&
          pt.x <= ann.x + 28 + pad &&
          pt.y >= ann.y - pad &&
          pt.y <= ann.y + 28 + pad
        );
      }
      return false;
    });

    if (hitAnnotation) {
      setSelectedAnnotationId(hitAnnotation.id);
      if (activeTool === 'note') {
        // DO NOT add new element! Open comment/note on this existing element!
        if (hitAnnotation.type === 'note') {
          setActiveNoteId(hitAnnotation.id);
        } else {
          setActiveCommentAnnId(hitAnnotation.id);
        }
        return;
      }
    }

    if (activeTool === 'crop' || activeTool === 'whiteout') {
      setIsDrawing(true);
      setStartPoint(pt);
      setCurrentPoints([pt]);
      return;
    }

    if (activeTool === 'drawing') {
      setIsDrawing(true);
      setCurrentPoints([pt]);
    } else if (
      activeTool === 'highlight' ||
      activeTool === 'underline' ||
      activeTool === 'strikethrough'
    ) {
      setIsDrawing(true);
      setStartPoint(pt);
      setCurrentPoints([pt]);
    } else if (activeTool === 'note') {
      // Place a new standalone sticky note ONLY if clicked on empty canvas
      const newNote: NoteAnnotation = {
        id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.id,
        type: 'note',
        x: pt.x - 10,
        y: pt.y - 10,
        width: 24,
        height: 24,
        color: '#f59e0b',
        opacity: 1.0,
        text: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newNote);
      setActiveNoteId(newNote.id);
      setSelectedAnnotationId(newNote.id);
    } else if (activeTool === 'text') {
      // Place a new text box
      const newText: TextAnnotation = {
        id: `text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.id,
        type: 'text',
        x: pt.x,
        y: pt.y,
        width: 150,
        height: fontSize * 1.5,
        color: textColor || '#0f172a',
        opacity: 1.0,
        text: '',
        fontSize,
        fontFamily: fontFamily || 'Inter',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newText);
      setSelectedAnnotationId(newText.id);
    } else if (activeTool === 'select') {
      setSelectedAnnotationId(null);
      setActiveNoteId(null);
      setActiveCommentAnnId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = getPdfCoords(e);

    if (isDrawing) {
      if (activeTool === 'drawing') {
        setCurrentPoints((prev) => [...prev, pt]);
      } else if (
        activeTool === 'highlight' ||
        activeTool === 'underline' ||
        activeTool === 'strikethrough' ||
        activeTool === 'crop' ||
        activeTool === 'whiteout'
      ) {
        // Immediate visual preview updating as mouse moves
        setCurrentPoints([pt]);
      }
    } else if (draggingAnnId) {
      // Dragging an existing annotation
      const target = annotations.find((a) => a.id === draggingAnnId);
      if (target) {
        const dx = pt.x - dragStartMouse.x;
        const dy = pt.y - dragStartMouse.y;
        const newX = Math.max(0, Math.min(page.width - target.width, dragStartAnnPos.x + dx));
        const newY = Math.max(0, Math.min(page.height - target.height, dragStartAnnPos.y + dy));

        if (target.type === 'drawing') {
          const drawAnn = target as DrawingAnnotation;
          const shiftX = newX - target.x;
          const shiftY = newY - target.y;
          const updatedPoints = drawAnn.points.map((p) => ({
            x: p.x + shiftX,
            y: p.y + shiftY,
          }));
          updateAnnotation(
            {
              ...drawAnn,
              x: newX,
              y: newY,
              points: updatedPoints,
              updatedAt: Date.now(),
            },
            false
          );
        } else {
          updateAnnotation(
            {
              ...target,
              x: newX,
              y: newY,
              updatedAt: Date.now(),
            },
            false
          );
        }
      }
    } else if (resizingAnnId) {
      // Resizing an existing annotation
      const target = annotations.find((a) => a.id === resizingAnnId);
      if (target) {
        const newWidth = Math.max(30, pt.x - target.x);
        const newHeight = Math.max(20, pt.y - target.y);
        updateAnnotation(
          {
            ...target,
            width: newWidth,
            height: newHeight,
            updatedAt: Date.now(),
          },
          false
        );
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // If we just finished dragging or resizing an annotation, commit one history snapshot
    if (draggingAnnId) {
      const target = annotations.find((a) => a.id === draggingAnnId);
      if (target) {
        updateAnnotation(target, true);
      }
      setDraggingAnnId(null);
    }

    if (resizingAnnId) {
      const target = annotations.find((a) => a.id === resizingAnnId);
      if (target) {
        updateAnnotation(target, true);
      }
      setResizingAnnId(null);
    }

    if (isDrawing) {
      const endPoint = getPdfCoords(e);

      if (activeTool === 'drawing' && currentPoints.length > 1) {
        const minX = Math.min(...currentPoints.map((p) => p.x));
        const minY = Math.min(...currentPoints.map((p) => p.y));
        const maxX = Math.max(...currentPoints.map((p) => p.x));
        const maxY = Math.max(...currentPoints.map((p) => p.y));

        const newDrawing: DrawingAnnotation = {
          id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          pageId: page.id,
          type: 'drawing',
          x: minX,
          y: minY,
          width: Math.max(10, maxX - minX),
          height: Math.max(10, maxY - minY),
          color: strokeColor,
          opacity: 1.0,
          points: currentPoints,
          strokeWidth,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addAnnotation(newDrawing);
        setSelectedAnnotationId(newDrawing.id);
      } else if (startPoint) {
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.max(8, Math.abs(endPoint.x - startPoint.x));
        const height = Math.max(8, Math.abs(endPoint.y - startPoint.y));
        const dragBox = { x, y, width, height };

        // Check if drawn over text lines on this page
        const pageContainer = containerRef.current?.parentElement || containerRef.current;
        const textLines = findIntersectedTextLines(pageContainer, dragBox, scale);

        if (activeTool === 'whiteout') {
          const maskColor = fillColor && fillColor !== 'transparent' ? fillColor : '#ffffff';
          const newWhiteout: WhiteoutAnnotation = {
            id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pageId: page.id,
            type: 'whiteout',
            x,
            y,
            width: Math.max(30, width),
            height: Math.max(18, height),
            color: maskColor,
            fillColor: maskColor,
            opacity: 1.0,
            text: '',
            textColor: textColor || '#0f172a',
            fontSize: fontSize || 12,
            fontFamily: fontFamily || 'Inter',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          addAnnotation(newWhiteout);
          setSelectedAnnotationId(newWhiteout.id);
          setIsDrawing(false);
          setStartPoint(null);
          setCurrentPoints([]);
          return;
        }

        if (activeTool === 'highlight') {
          if (textLines.length > 0) {
            let lastId = '';
            textLines.forEach((line, idx) => {
              const newHighlight: HighlightAnnotation = {
                id: `hl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
                pageId: page.id,
                type: 'highlight',
                x: line.x,
                y: line.y,
                width: line.width,
                height: line.height,
                color: highlightColor,
                opacity: 0.4,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              addAnnotation(newHighlight);
              lastId = newHighlight.id;
            });
            if (lastId) setSelectedAnnotationId(lastId);
          } else {
            const newHighlight: HighlightAnnotation = {
              id: `hl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              pageId: page.id,
              type: 'highlight',
              x,
              y,
              width,
              height,
              color: highlightColor,
              opacity: 0.4,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            addAnnotation(newHighlight);
            setSelectedAnnotationId(newHighlight.id);
            if (isNotesPanelOpen) {
              setActiveCommentAnnId(newHighlight.id);
            } else {
              setActiveCommentAnnId(null);
            }
          }
        } else if (activeTool === 'underline') {
          const uColor = strokeColor || '#0284c7';
          const lineThickness = strokeWidth || 2;

          if (textLines.length > 0) {
            let lastId = '';
            textLines.forEach((line, idx) => {
              const newUnderline: UnderlineAnnotation = {
                id: `ul_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
                pageId: page.id,
                type: 'underline',
                x: line.x,
                y: line.bottom - lineThickness,
                width: line.width,
                height: lineThickness,
                color: uColor,
                opacity: 0.9,
                strokeWidth: lineThickness,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              addAnnotation(newUnderline);
              lastId = newUnderline.id;
            });
            if (lastId) setSelectedAnnotationId(lastId);
          } else {
            const newUnderline: UnderlineAnnotation = {
              id: `ul_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              pageId: page.id,
              type: 'underline',
              x: Math.min(startPoint.x, endPoint.x),
              y: startPoint.y,
              width,
              height: lineThickness,
              color: uColor,
              opacity: 0.9,
              strokeWidth: lineThickness,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            addAnnotation(newUnderline);
            setSelectedAnnotationId(newUnderline.id);
            if (isNotesPanelOpen) {
              setActiveCommentAnnId(newUnderline.id);
            } else {
              setActiveCommentAnnId(null);
            }
          }
        } else if (activeTool === 'strikethrough') {
          const sColor = strokeColor === '#0284c7' ? '#dc2626' : (strokeColor || '#dc2626');
          const lineThickness = strokeWidth || 2;

          if (textLines.length > 0) {
            let lastId = '';
            textLines.forEach((line, idx) => {
              const newStrike: StrikethroughAnnotation = {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${idx}`,
                pageId: page.id,
                type: 'strikethrough',
                x: line.x,
                y: line.top + line.height * 0.5 - lineThickness / 2,
                width: line.width,
                height: lineThickness,
                color: sColor,
                opacity: 0.9,
                strokeWidth: lineThickness,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              addAnnotation(newStrike);
              lastId = newStrike.id;
            });
            if (lastId) setSelectedAnnotationId(lastId);
          } else {
            const newStrike: StrikethroughAnnotation = {
              id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              pageId: page.id,
              type: 'strikethrough',
              x: Math.min(startPoint.x, endPoint.x),
              y: startPoint.y,
              width,
              height: lineThickness,
              color: sColor,
              opacity: 0.9,
              strokeWidth: lineThickness,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            addAnnotation(newStrike);
            setSelectedAnnotationId(newStrike.id);
            if (isNotesPanelOpen) {
              setActiveCommentAnnId(newStrike.id);
            } else {
              setActiveCommentAnnId(null);
            }
          }
        } else if (activeTool === 'crop') {
          const cropW = Math.abs(endPoint.x - startPoint.x);
          const cropH = Math.abs(endPoint.y - startPoint.y);
          if (cropW >= 8 && cropH >= 8) {
            setCropFlash(true);
            setTimeout(() => setCropFlash(false), 450);

            const sourceDoc = sources.find((s) => s.id === page.sourceDocId);
            cropPageRegionToClipboard(sourceDoc, page, { x, y, width: cropW, height: cropH }, pageAnnotations, 3.0)
              .then((res) => {
                if (res.success) {
                  setCropToastResult(res);
                  setCropStampSaved(false);
                }
              })
              .catch((err) => {
                console.error('Crop failed:', err);
              });
          }
        }
      }

      setIsDrawing(false);
      setStartPoint(null);
      setCurrentPoints([]);
    }
  };

  const handleStartDragAnn = (ann: Annotation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeTool === 'eraser') {
      deleteAnnotation(ann.id);
      return;
    }

    setSelectedAnnotationId(ann.id);

    if (activeTool === 'note') {
      // User clicked existing markup with note tool -> open comment editing on THIS element!
      if (ann.type === 'note') {
        setActiveNoteId(ann.id);
      } else {
        setActiveCommentAnnId(ann.id);
      }
      return;
    }

    const pt = getPdfCoords(e);
    setDraggingAnnId(ann.id);
    setDragStartMouse(pt);
    setDragStartAnnPos({ x: ann.x, y: ann.y });

    if (ann.type === 'note') {
      setActiveNoteId(ann.id);
    }
  };

  const handleSaveNote = (noteId: string, textToSave: string = '') => {
    const note = annotations.find((a) => a.id === noteId) as NoteAnnotation;
    if (note) {
      updateAnnotation({
        ...note,
        text: textToSave,
        updatedAt: Date.now(),
      });
    }
    setActiveNoteId(null);
  };

  const pixelWidth = page.width * scale;
  const pixelHeight = page.height * scale;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        width: `${pixelWidth}px`,
        height: `${pixelHeight}px`,
      }}
      className={`absolute inset-0 select-none ${
        activeTool === 'textSelect'
          ? 'pointer-events-none'
          : 'pointer-events-auto'
      } ${
        activeTool === 'pan'
          ? 'cursor-grab'
          : activeTool === 'drawing' ||
            activeTool === 'highlight' ||
            activeTool === 'underline' ||
            activeTool === 'strikethrough' ||
            activeTool === 'crop'
          ? 'cursor-crosshair'
          : activeTool === 'note' || activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'eraser'
          ? 'cursor-not-allowed'
          : 'cursor-default'
      }`}
    >
      {/* SVG Layer for Drawings, Highlights, Underlines, Strikes */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${page.width} ${page.height}`}
      >
        {/* Render Saved Annotations */}
        {pageAnnotations.map((ann) => {
          const isSelected = selectedAnnotationId === ann.id;

          switch (ann.type) {
            case 'highlight':
              return (
                <g key={ann.id} className="annotation-item pointer-events-auto">
                  <rect
                    x={ann.x}
                    y={ann.y}
                    width={ann.width}
                    height={ann.height}
                    fill={ann.color}
                    fillOpacity={ann.opacity || 0.4}
                    stroke="none"
                    className="cursor-move transition-opacity hover:opacity-90"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  {isSelected && (
                    <rect
                      x={ann.x - 2}
                      y={ann.y - 2}
                      width={ann.width + 4}
                      height={ann.height + 4}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      className="pointer-events-none"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                    />
                  )}
                </g>
              );

            case 'underline': {
              const u = ann as UnderlineAnnotation;
              const uHeight = u.strokeWidth || 2;
              return (
                <g key={ann.id} className="annotation-item pointer-events-auto">
                  {/* Hit-test invisible wide padding */}
                  <line
                    x1={u.x}
                    y1={u.y + u.height}
                    x2={u.x + u.width}
                    y2={u.y + u.height}
                    stroke="transparent"
                    strokeWidth={Math.max(14, uHeight * 3)}
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  <line
                    x1={u.x}
                    y1={u.y + u.height}
                    x2={u.x + u.width}
                    y2={u.y + u.height}
                    stroke={u.color}
                    strokeWidth={uHeight}
                    strokeOpacity={u.opacity || 0.9}
                    strokeLinecap="round"
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  {isSelected && (
                    <rect
                      x={u.x - 2}
                      y={u.y + u.height - Math.max(3, uHeight + 2)}
                      width={u.width + 4}
                      height={Math.max(8, uHeight * 2 + 4)}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      className="pointer-events-none"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                    />
                  )}
                </g>
              );
            }

            case 'strikethrough': {
              const s = ann as StrikethroughAnnotation;
              const sHeight = s.strokeWidth || 2;
              return (
                <g key={ann.id} className="annotation-item pointer-events-auto">
                  {/* Hit-test invisible wide padding */}
                  <line
                    x1={s.x}
                    y1={s.y + s.height / 2}
                    x2={s.x + s.width}
                    y2={s.y + s.height / 2}
                    stroke="transparent"
                    strokeWidth={Math.max(14, sHeight * 3)}
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  <line
                    x1={s.x}
                    y1={s.y + s.height / 2}
                    x2={s.x + s.width}
                    y2={s.y + s.height / 2}
                    stroke={s.color}
                    strokeWidth={sHeight}
                    strokeOpacity={s.opacity || 0.9}
                    strokeLinecap="round"
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  {isSelected && (
                    <rect
                      x={s.x - 2}
                      y={s.y + s.height / 2 - Math.max(3, sHeight + 2)}
                      width={s.width + 4}
                      height={Math.max(8, sHeight * 2 + 4)}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      className="pointer-events-none"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                    />
                  )}
                </g>
              );
            }

            case 'drawing': {
              const d = ann as DrawingAnnotation;
              if (!d.points || d.points.length < 2) return null;
              const pathStr = d.points.reduce(
                (acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`,
                ''
              );
              return (
                <g key={ann.id} className="annotation-item pointer-events-auto">
                  {/* Invisible fat stroke for easy grabbing */}
                  <path
                    d={pathStr}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, (d.strokeWidth || 2) * 3)}
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  <path
                    d={pathStr}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={d.strokeWidth || 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="cursor-move"
                    onMouseDown={(e) => handleStartDragAnn(ann, e)}
                  />
                  {isSelected && (
                    <rect
                      x={d.x - 4}
                      y={d.y - 4}
                      width={d.width + 8}
                      height={d.height + 8}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      className="pointer-events-none"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                    />
                  )}
                </g>
              );
            }

            case 'shape': {
              const sh = ann as ShapeAnnotation;
              const sWidth = sh.strokeWidth || 2;
              const hasFill = sh.fillColor && sh.fillColor !== 'transparent';

              if (sh.shapeType === 'line') {
                const endX = sh.endPoint ? sh.endPoint.x : sh.x + sh.width;
                const endY = sh.endPoint ? sh.endPoint.y : sh.y + sh.height;
                return (
                  <g key={ann.id} className="annotation-item pointer-events-auto">
                    {/* Invisible fat hit line */}
                    <line
                      x1={sh.x}
                      y1={sh.y}
                      x2={endX}
                      y2={endY}
                      stroke="transparent"
                      strokeWidth={Math.max(16, sWidth * 3)}
                      className="cursor-move"
                      onMouseDown={(e) => handleStartDragAnn(ann, e)}
                    />
                    <line
                      x1={sh.x}
                      y1={sh.y}
                      x2={endX}
                      y2={endY}
                      stroke={sh.color}
                      strokeWidth={sWidth}
                      strokeLinecap="round"
                      strokeOpacity={sh.opacity || 1.0}
                      className="cursor-move"
                      onMouseDown={(e) => handleStartDragAnn(ann, e)}
                    />
                    {isSelected && (
                      <rect
                        x={Math.min(sh.x, endX) - 4}
                        y={Math.min(sh.y, endY) - 4}
                        width={Math.abs(endX - sh.x) + 8}
                        height={Math.abs(endY - sh.y) + 8}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              }

              if (sh.shapeType === 'rectangle') {
                return (
                  <g key={ann.id} className="annotation-item pointer-events-auto">
                    <rect
                      x={sh.x}
                      y={sh.y}
                      width={sh.width}
                      height={sh.height}
                      fill={hasFill ? sh.fillColor : 'transparent'}
                      stroke={sh.color}
                      strokeWidth={sWidth}
                      strokeOpacity={sh.opacity || 1.0}
                      className="cursor-move"
                      onMouseDown={(e) => handleStartDragAnn(ann, e)}
                    />
                    {isSelected && (
                      <rect
                        x={sh.x - 3}
                        y={sh.y - 3}
                        width={sh.width + 6}
                        height={sh.height + 6}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              }

              if (sh.shapeType === 'ellipse') {
                return (
                  <g key={ann.id} className="annotation-item pointer-events-auto">
                    <ellipse
                      cx={sh.x + sh.width / 2}
                      cy={sh.y + sh.height / 2}
                      rx={Math.max(1, sh.width / 2)}
                      ry={Math.max(1, sh.height / 2)}
                      fill={hasFill ? sh.fillColor : 'transparent'}
                      stroke={sh.color}
                      strokeWidth={sWidth}
                      strokeOpacity={sh.opacity || 1.0}
                      className="cursor-move"
                      onMouseDown={(e) => handleStartDragAnn(ann, e)}
                    />
                    {isSelected && (
                      <rect
                        x={sh.x - 3}
                        y={sh.y - 3}
                        width={sh.width + 6}
                        height={sh.height + 6}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              }
              return null;
            }

            default:
              return null;
          }
        })}

        {/* LIVE DRAWING PREVIEW: Freehand Pen */}
        {isDrawing && activeTool === 'drawing' && currentPoints.length > 1 && (
          <path
            d={currentPoints.reduce(
              (acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`,
              ''
            )}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* LIVE DRAWING PREVIEW: Highlight Box */}
        {isDrawing && activeTool === 'highlight' && startPoint && currentPoints.length > 0 && (
          <rect
            x={Math.min(startPoint.x, currentPoints[0].x)}
            y={Math.min(startPoint.y, currentPoints[0].y)}
            width={Math.max(4, Math.abs(currentPoints[0].x - startPoint.x))}
            height={Math.max(4, Math.abs(currentPoints[0].y - startPoint.y))}
            fill={highlightColor}
            fillOpacity={0.4}
            stroke={highlightColor}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {/* LIVE DRAWING PREVIEW: Underline */}
        {isDrawing && activeTool === 'underline' && startPoint && currentPoints.length > 0 && (
          <line
            x1={Math.min(startPoint.x, currentPoints[0].x)}
            y1={startPoint.y + strokeWidth}
            x2={Math.max(startPoint.x, currentPoints[0].x)}
            y2={startPoint.y + strokeWidth}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={0.9}
            strokeLinecap="round"
          />
        )}

        {/* LIVE DRAWING PREVIEW: Strikethrough */}
        {isDrawing && activeTool === 'strikethrough' && startPoint && currentPoints.length > 0 && (
          <line
            x1={Math.min(startPoint.x, currentPoints[0].x)}
            y1={startPoint.y + strokeWidth / 2}
            x2={Math.max(startPoint.x, currentPoints[0].x)}
            y2={startPoint.y + strokeWidth / 2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={0.9}
            strokeLinecap="round"
          />
        )}

        {/* LIVE DRAWING PREVIEW: Whiteout Box */}
        {isDrawing && activeTool === 'whiteout' && startPoint && currentPoints.length > 0 && (() => {
          const x1 = Math.min(startPoint.x, currentPoints[0].x);
          const y1 = Math.min(startPoint.y, currentPoints[0].y);
          const w = Math.max(8, Math.abs(currentPoints[0].x - startPoint.x));
          const h = Math.max(8, Math.abs(currentPoints[0].y - startPoint.y));
          const bgCol = fillColor && fillColor !== 'transparent' ? fillColor : '#ffffff';

          return (
            <g className="pointer-events-none">
              <rect
                x={x1}
                y={y1}
                width={w}
                height={h}
                fill={bgCol}
                fillOpacity={1.0}
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
              <g transform={`translate(${x1 + w / 2}, ${y1 > 20 ? y1 - 8 : y1 + h + 14})`}>
                <rect
                  x={-45}
                  y={-9}
                  width={90}
                  height={18}
                  rx={4}
                  fill="#1e1b4b"
                  stroke="#6366f1"
                  strokeWidth={1}
                />
                <text
                  textAnchor="middle"
                  y={3}
                  fill="#c7d2fe"
                  fontSize={10}
                  fontFamily="sans-serif"
                  fontWeight="600"
                >
                  Whiteout
                </text>
              </g>
            </g>
          );
        })()}

        {/* LIVE DRAWING PREVIEW: Crop Region Selection Marquee */}
        {isDrawing && activeTool === 'crop' && startPoint && currentPoints.length > 0 && (() => {
          const x1 = Math.min(startPoint.x, currentPoints[0].x);
          const y1 = Math.min(startPoint.y, currentPoints[0].y);
          const w = Math.max(4, Math.abs(currentPoints[0].x - startPoint.x));
          const h = Math.max(4, Math.abs(currentPoints[0].y - startPoint.y));
          const pixelW = Math.round(w * 3);
          const pixelH = Math.round(h * 3);

          return (
            <g className="pointer-events-none">
              {/* Dimmed outer mask */}
              <path
                d={`M 0 0 L ${page.width} 0 L ${page.width} ${page.height} L 0 ${page.height} Z M ${x1} ${y1} L ${x1} ${y1 + h} L ${x1 + w} ${y1 + h} L ${x1 + w} ${y1} Z`}
                fill="rgba(15, 23, 42, 0.45)"
                fillRule="evenodd"
              />

              {/* Glowing cut marquee rectangle */}
              <rect
                x={x1}
                y={y1}
                width={w}
                height={h}
                fill="rgba(56, 189, 248, 0.08)"
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="6 3"
              />

              {/* Corner bracket handles */}
              <path
                d={`
                  M ${x1} ${y1 + 10} L ${x1} ${y1} L ${x1 + 10} ${y1}
                  M ${x1 + w - 10} ${y1} L ${x1 + w} ${y1} L ${x1 + w} ${y1 + 10}
                  M ${x1 + w} ${y1 + h - 10} L ${x1 + w} ${y1 + h} L ${x1 + w - 10} ${y1 + h}
                  M ${x1 + 10} ${y1 + h} L ${x1} ${y1 + h} L ${x1} ${y1 + h - 10}
                `}
                fill="none"
                stroke="#ffffff"
                strokeWidth={3}
              />

              {/* Live resolution tag */}
              <g transform={`translate(${x1 + w / 2}, ${y1 + h + 18 > page.height ? y1 - 10 : y1 + h + 16})`}>
                <rect
                  x={-75}
                  y={-10}
                  width={150}
                  height={20}
                  rx={5}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth={1}
                />
                <text
                  textAnchor="middle"
                  y={4}
                  fill="#38bdf8"
                  fontSize={10}
                  fontFamily="sans-serif"
                  fontWeight="bold"
                >
                  {pixelW} × {pixelH} px • Ultra HD
                </text>
              </g>
            </g>
          );
        })()}
      </svg>

      {/* HTML Elements Layer (Signatures, Text Boxes, Sticky Notes) */}
      {pageAnnotations.map((ann) => {
        const isSelected = selectedAnnotationId === ann.id;
        const left = ann.x * scale;
        const top = ann.y * scale;
        const width = ann.width * scale;
        const height = ann.height * scale;

        if (ann.type === 'signature') {
          const sig = ann as SignatureAnnotation;
          return (
            <div
              key={sig.id}
              className={`annotation-item absolute group cursor-move ${
                isSelected ? 'ring-2 ring-sky-500 rounded' : ''
              }`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
              onMouseDown={(e) => handleStartDragAnn(sig, e)}
            >
              <img
                src={sig.imageDataUrl}
                alt="Signature"
                className="w-full h-full object-contain pointer-events-none"
              />

              {/* Selection Controls (Resize handle + Delete button) */}
              {isSelected && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnnotation(sig.id);
                    }}
                    className="absolute -top-3 -right-3 p-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-transform scale-100"
                    title={t.annotations.deleteAnnotation}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setResizingAnnId(sig.id);
                    }}
                    className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-500 border-2 border-white rounded-full cursor-se-resize shadow"
                  />
                </>
              )}
            </div>
          );
        }

        if (ann.type === 'text') {
          const txt = ann as TextAnnotation;
          return (
            <div
              key={txt.id}
              className={`annotation-item absolute group cursor-move ${
                isSelected ? 'ring-2 ring-sky-500 rounded p-0.5' : ''
              }`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                minWidth: `${Math.max(60, width)}px`,
              }}
              onMouseDown={(e) => handleStartDragAnn(txt, e)}
            >
              <input
                type="text"
                value={txt.text || ''}
                onChange={(e) =>
                  updateAnnotation({
                    ...txt,
                    text: e.target.value,
                    width: Math.max(80, e.target.value.length * (txt.fontSize || 14) * 0.65),
                  })
                }
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId(txt.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                    setSelectedAnnotationId(null);
                  }
                }}
                style={{
                  fontSize: `${(txt.fontSize || 14) * scale}px`,
                  fontFamily: txt.fontFamily || 'Inter',
                  color: txt.color || '#0f172a',
                  backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.95)' : 'transparent',
                }}
                className="border-none outline-none font-medium px-1.5 py-0.5 rounded shadow-none w-full"
                placeholder={t.annotations.textPlaceholder}
                autoFocus={isSelected && !txt.text}
              />

              {isSelected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAnnotation(txt.id);
                  }}
                  className="absolute -top-3 -right-3 p-1 rounded-full bg-rose-600 text-white shadow"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        }

        if (ann.type === 'whiteout') {
          const wo = ann as WhiteoutAnnotation;
          const bgCol = wo.fillColor || wo.color || '#ffffff';
          const txtCol = wo.textColor || '#0f172a';
          const fontSz = (wo.fontSize || 12) * scale;
          const fontFm = wo.fontFamily || 'Inter';

          return (
            <div
              key={wo.id}
              className={`annotation-item absolute group cursor-move transition-shadow ${
                isSelected
                  ? 'ring-2 ring-indigo-500 rounded shadow-md z-30'
                  : 'hover:ring-1 hover:ring-indigo-400/60 z-20'
              }`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${Math.max(30, width)}px`,
                height: `${Math.max(18, height)}px`,
                backgroundColor: bgCol,
                opacity: wo.opacity ?? 1.0,
              }}
              onMouseDown={(e) => handleStartDragAnn(wo, e)}
            >
              <textarea
                value={wo.text || ''}
                onChange={(e) => {
                  updateAnnotation({
                    ...wo,
                    text: e.target.value,
                    updatedAt: Date.now(),
                  });
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId(wo.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                    setSelectedAnnotationId(null);
                  }
                }}
                style={{
                  fontSize: `${fontSz}px`,
                  fontFamily: fontFm,
                  color: txtCol,
                  backgroundColor: 'transparent',
                  resize: 'none',
                }}
                className="w-full h-full border-none outline-none font-medium px-1 py-0.5 shadow-none overflow-hidden"
                placeholder={isSelected && !wo.text ? t.tools.whiteoutPlaceholder : ''}
                autoFocus={isSelected && !wo.text}
              />

              {isSelected && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnnotation(wo.id);
                    }}
                    className="absolute -top-3 -right-3 p-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md z-40 transition-transform hover:scale-110"
                    title={t.annotations.deleteAnnotation}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setResizingAnnId(wo.id);
                    }}
                    className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-indigo-500 border-2 border-white rounded-full cursor-se-resize shadow z-40"
                    title="Změnit velikost"
                  />
                </>
              )}
            </div>
          );
        }

        if (ann.type === 'note') {
          const note = ann as NoteAnnotation;
          const isNoteOpen = activeNoteId === note.id;

          return (
            <div
              key={note.id}
              className="annotation-item absolute z-30 cursor-move"
              style={{
                left: `${left}px`,
                top: `${top}px`,
              }}
              onMouseDown={(e) => handleStartDragAnn(note, e)}
            >
              {/* Note Badge Icon */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId(note.id);
                  if (isNoteOpen) {
                    setActiveNoteId(null);
                  } else {
                    setActiveNoteId(note.id);
                  }
                }}
                style={{ backgroundColor: note.color || '#f59e0b' }}
                className="w-7 h-7 rounded-full text-slate-950 flex items-center justify-center shadow-lg border-2 border-white/60 transition-transform active:scale-95 hover:scale-105"
                title={note.text || t.tools.note}
              >
                <MessageSquare className="w-4 h-4 fill-slate-950/20" />
              </button>

              {/* Unified NoteDialog Popover Card */}
              {isNoteOpen && (
                <NoteDialog
                  title={t.annotations.noteBy}
                  initialText={note.text || ''}
                  placeholder={t.annotations.notePlaceholder}
                  onSave={(txt) => {
                    handleSaveNote(note.id, txt);
                  }}
                  onCancel={() => {
                    setActiveNoteId(null);
                  }}
                  onDelete={() => {
                    deleteAnnotation(note.id);
                    setActiveNoteId(null);
                  }}
                  positionClassName="absolute left-8 -top-2"
                  widthClassName="w-64"
                />
              )}
            </div>
          );
        }

        return null;
      })}

      {/* Comment Badges & Inline Popovers on Markups, Shapes, Lines, and Drawings */}
      {pageAnnotations.map((ann) => {
        if (
          ann.type !== 'highlight' &&
          ann.type !== 'underline' &&
          ann.type !== 'strikethrough' &&
          ann.type !== 'shape' &&
          ann.type !== 'drawing'
        ) {
          return null;
        }
        if (!ann.comment && selectedAnnotationId !== ann.id && activeCommentAnnId !== ann.id) {
          return null;
        }

        const left = (ann.x + ann.width) * scale;
        const top = ann.y * scale;
        const isCommentOpen = activeCommentAnnId === ann.id;
        const isSelected = selectedAnnotationId === ann.id;

        return (
          <div
            key={`comment_group_${ann.id}`}
            className="annotation-item absolute z-30 pointer-events-auto flex flex-col items-start gap-1"
            style={{ left: `${left + 4}px`, top: `${top - 8}px` }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* For line & markup elements: Garbage bin button available above Add Note / Comment button */}
            {(isSelected || isCommentOpen) && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAnnotation(ann.id);
                  setActiveCommentAnnId(null);
                }}
                className={`p-1 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center justify-center ${
                  isMinimal
                    ? 'bg-white text-neutral-500 hover:text-red-600 border border-neutral-300 hover:border-red-300'
                    : isLcars
                    ? 'bg-black text-[#cc3333] border border-[#cc3333] hover:bg-[#cc3333] hover:text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/50 shadow-slate-950/40'
                }`}
                title={t.annotations.deleteAnnotation}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}

            {/* Comment Indicator Badge */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedAnnotationId(ann.id);
                if (isCommentOpen) {
                  setActiveCommentAnnId(null);
                } else {
                  setActiveCommentAnnId(ann.id);
                }
              }}
              className={`px-1.5 py-0.5 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center gap-1 text-[10px] font-bold ${
                ann.comment
                  ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-300'
                  : 'bg-slate-800/90 text-amber-300 border border-amber-500/50 hover:bg-slate-700'
              }`}
              title={ann.comment || t.notesPanel.addComment}
            >
              <MessageSquare className="w-3 h-3" />
              {ann.comment ? (
                <span className="max-w-[80px] truncate text-[9px] font-semibold">
                  {ann.comment}
                </span>
              ) : (
                <span className="text-[9px] font-semibold">
                  + {t.notesPanel.addComment}
                </span>
              )}
            </button>

            {/* Unified NoteDialog Inline Popover */}
            {isCommentOpen && (
              <NoteDialog
                title={`${t.notesPanel.addComment} (PDF)`}
                initialText={ann.comment || ''}
                placeholder={t.notesPanel.commentPlaceholder}
                onSave={(txt) => {
                  updateAnnotation(
                    { ...ann, comment: txt.trim() || undefined, updatedAt: Date.now() },
                    true
                  );
                  setActiveCommentAnnId(null);
                }}
                onCancel={() => {
                  setActiveCommentAnnId(null);
                }}
                onDelete={() => {
                  deleteAnnotation(ann.id);
                  setActiveCommentAnnId(null);
                }}
                positionClassName="absolute left-0 top-12"
                widthClassName="w-64"
              />
            )}
          </div>
        );
      })}

      {/* Camera Flash effect upon cropping */}
      {cropFlash && (
        <div className="absolute inset-0 bg-white/40 pointer-events-none animate-out fade-out duration-500 z-50 rounded-lg" />
      )}

      {/* Floating Crop Snippet Toast & Quick Actions Card */}
      {cropToastResult && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-slate-900/95 border border-sky-500/60 rounded-2xl shadow-2xl p-4 max-w-sm w-full backdrop-blur-xl animate-in fade-in slide-in-from-bottom-6 duration-200 text-slate-100"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>{t.cropSnippet.copiedTitle}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-sky-500 text-slate-950">
                    {t.cropSnippet.resBadge}
                  </span>
                </h4>
                <p className="text-[11px] text-slate-400">
                  {cropToastResult.pixelWidth} × {cropToastResult.pixelHeight} px • {t.cropSnippet.copiedDesc}
                </p>
              </div>
            </div>
            <button
              onClick={() => setCropToastResult(null)}
              className="p-1 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Snippet Preview Image */}
          <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 mb-3 max-h-36 flex items-center justify-center p-1.5">
            <img
              src={cropToastResult.dataUrl}
              alt="Snippet"
              className="max-h-32 object-contain rounded-lg"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const a = document.createElement('a');
                a.href = cropToastResult.dataUrl;
                a.download = `vystrizek-${Date.now()}.png`;
                a.click();
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.cropSnippet.downloadPng}</span>
            </button>

            <button
              onClick={() => {
                addStamp({
                  title: `Výstřižek ${new Date().toLocaleTimeString()}`,
                  imageDataUrl: cropToastResult.dataUrl,
                  width: Math.round(cropToastResult.pixelWidth / 3),
                  height: Math.round(cropToastResult.pixelHeight / 3),
                });
                setCropStampSaved(true);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
                cropStampSaved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/30'
              }`}
            >
              {cropStampSaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
              <span>{cropStampSaved ? t.cropSnippet.stampSaved : t.cropSnippet.saveAsStamp}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
