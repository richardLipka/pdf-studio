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
  UnderlineAnnotation,
} from '../../types/annotations';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { useI18n } from '../../i18n/context';
import { screenToPdfPoint } from '../../utils/coordinate';
import {
  MessageSquare,
  Trash2,
  Check,
} from 'lucide-react';

interface AnnotationLayerProps {
  page: PdfPageModel;
  scale: number;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({ page, scale }) => {
  const { t } = useI18n();
  const {
    activeTool,
    strokeColor,
    highlightColor,
    textColor,
    strokeWidth,
    fontSize,
  } = useEditor();

  const {
    annotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    selectedAnnotationId,
    setSelectedAnnotationId,
  } = useDocument();

  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing / Dragging state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // Repositioning / Resizing selected annotation
  const [draggingAnnId, setDraggingAnnId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [resizingAnnId, setResizingAnnId] = useState<string | null>(null);

  // Open note card modal/popover
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteEditText, setNoteEditText] = useState<string>('');

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
    // If clicking an existing element in select mode, don't create new
    if ((e.target as HTMLElement).closest('.annotation-item')) {
      return;
    }

    const pt = getPdfCoords(e);

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
    } else if (activeTool === 'note') {
      // Place a new note
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
      setNoteEditText('');
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
        color: textColor,
        opacity: 1.0,
        text: 'Text...',
        fontSize,
        fontFamily: 'Inter',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAnnotation(newText);
      setSelectedAnnotationId(newText.id);
    } else if (activeTool === 'select') {
      setSelectedAnnotationId(null);
      setActiveNoteId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = getPdfCoords(e);

    if (isDrawing) {
      if (activeTool === 'drawing') {
        setCurrentPoints((prev) => [...prev, pt]);
      }
    } else if (draggingAnnId) {
      // Dragging an existing annotation - update without pushing history snapshot per pixel
      const target = annotations.find((a) => a.id === draggingAnnId);
      if (target) {
        updateAnnotation({
          ...target,
          x: Math.max(0, Math.min(page.width - target.width, pt.x - dragOffset.x)),
          y: Math.max(0, Math.min(page.height - target.height, pt.y - dragOffset.y)),
          updatedAt: Date.now(),
        }, false);
      }
    } else if (resizingAnnId) {
      // Resizing an existing annotation - update without pushing history snapshot per pixel
      const target = annotations.find((a) => a.id === resizingAnnId);
      if (target) {
        const newWidth = Math.max(30, pt.x - target.x);
        const newHeight = Math.max(20, pt.y - target.y);
        updateAnnotation({
          ...target,
          width: newWidth,
          height: newHeight,
          updatedAt: Date.now(),
        }, false);
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
          width: maxX - minX,
          height: maxY - minY,
          color: strokeColor,
          opacity: 1.0,
          points: currentPoints,
          strokeWidth,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addAnnotation(newDrawing);
      } else if (startPoint) {
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.max(10, Math.abs(endPoint.x - startPoint.x));
        const height = Math.max(8, Math.abs(endPoint.y - startPoint.y));

        if (activeTool === 'highlight') {
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
        } else if (activeTool === 'underline') {
          const newUnderline: UnderlineAnnotation = {
            id: `ul_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pageId: page.id,
            type: 'underline',
            x,
            y: startPoint.y,
            width,
            height: strokeWidth,
            color: strokeColor,
            opacity: 0.9,
            strokeWidth,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          addAnnotation(newUnderline);
        } else if (activeTool === 'strikethrough') {
          const newStrike: StrikethroughAnnotation = {
            id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pageId: page.id,
            type: 'strikethrough',
            x,
            y: startPoint.y,
            width,
            height: strokeWidth,
            color: strokeColor,
            opacity: 0.9,
            strokeWidth,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          addAnnotation(newStrike);
        }
      }

      setIsDrawing(false);
      setStartPoint(null);
      setCurrentPoints([]);
    }
  };

  const handleAnnotationClick = (ann: Annotation, e: React.MouseEvent) => {
    e.stopPropagation();

    if (activeTool === 'eraser') {
      deleteAnnotation(ann.id);
      return;
    }

    setSelectedAnnotationId(ann.id);

    if (ann.type === 'note') {
      setActiveNoteId(ann.id);
      setNoteEditText((ann as NoteAnnotation).text || '');
    }
  };

  const handleStartDragAnn = (ann: Annotation, e: React.MouseEvent) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    const pt = getPdfCoords(e);
    setDraggingAnnId(ann.id);
    setSelectedAnnotationId(ann.id);
    setDragOffset({
      x: pt.x - ann.x,
      y: pt.y - ann.y,
    });
  };

  const handleSaveNote = (noteId: string) => {
    const note = annotations.find((a) => a.id === noteId) as NoteAnnotation;
    if (note) {
      updateAnnotation({
        ...note,
        text: noteEditText,
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
        activeTool === 'pan'
          ? 'cursor-grab'
          : activeTool === 'drawing' || activeTool === 'highlight' || activeTool === 'underline' || activeTool === 'strikethrough'
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
                <rect
                  key={ann.id}
                  x={ann.x}
                  y={ann.y}
                  width={ann.width}
                  height={ann.height}
                  fill={ann.color}
                  fillOpacity={ann.opacity || 0.35}
                  className={`pointer-events-auto cursor-pointer ${
                    isSelected ? 'stroke-2 stroke-sky-500' : ''
                  }`}
                  onClick={(e) => handleAnnotationClick(ann, e)}
                />
              );

            case 'underline': {
              const u = ann as UnderlineAnnotation;
              return (
                <line
                  key={ann.id}
                  x1={u.x}
                  y1={u.y + u.height}
                  x2={u.x + u.width}
                  y2={u.y + u.height}
                  stroke={u.color}
                  strokeWidth={u.strokeWidth || 2}
                  strokeOpacity={u.opacity || 0.9}
                  strokeLinecap="round"
                  className={`pointer-events-auto cursor-pointer ${
                    isSelected ? 'stroke-sky-400 stroke-[3px]' : ''
                  }`}
                  onClick={(e) => handleAnnotationClick(ann, e)}
                />
              );
            }

            case 'strikethrough': {
              const s = ann as StrikethroughAnnotation;
              return (
                <line
                  key={ann.id}
                  x1={s.x}
                  y1={s.y + s.height / 2}
                  x2={s.x + s.width}
                  y2={s.y + s.height / 2}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth || 2}
                  strokeOpacity={s.opacity || 0.9}
                  strokeLinecap="round"
                  className={`pointer-events-auto cursor-pointer ${
                    isSelected ? 'stroke-sky-400 stroke-[3px]' : ''
                  }`}
                  onClick={(e) => handleAnnotationClick(ann, e)}
                />
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
                <path
                  key={ann.id}
                  d={pathStr}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={d.strokeWidth || 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`pointer-events-auto cursor-pointer ${
                    isSelected ? 'filter drop-shadow(0 0 3px #38bdf8)' : ''
                  }`}
                  onClick={(e) => handleAnnotationClick(ann, e)}
                />
              );
            }

            default:
              return null;
          }
        })}

        {/* Live Drawing Preview Path */}
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

        {/* Live Highlight Preview Box */}
        {isDrawing && activeTool === 'highlight' && startPoint && currentPoints.length > 0 && (
          <rect
            x={Math.min(startPoint.x, currentPoints[currentPoints.length - 1].x)}
            y={Math.min(startPoint.y, currentPoints[currentPoints.length - 1].y)}
            width={Math.abs(currentPoints[currentPoints.length - 1].x - startPoint.x)}
            height={Math.abs(currentPoints[currentPoints.length - 1].y - startPoint.y)}
            fill={highlightColor}
            fillOpacity={0.4}
          />
        )}
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
              onClick={(e) => handleAnnotationClick(sig, e)}
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
              className={`annotation-item absolute group ${
                isSelected ? 'ring-2 ring-sky-500 rounded p-0.5' : ''
              }`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                minWidth: `${Math.max(60, width)}px`,
              }}
              onMouseDown={(e) => handleStartDragAnn(txt, e)}
              onClick={(e) => handleAnnotationClick(txt, e)}
            >
              <input
                type="text"
                value={txt.text}
                onChange={(e) =>
                  updateAnnotation({
                    ...txt,
                    text: e.target.value,
                    width: Math.max(80, e.target.value.length * txt.fontSize * 0.6),
                  })
                }
                style={{
                  fontSize: `${txt.fontSize * scale}px`,
                  color: txt.color,
                  backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                }}
                className="bg-transparent border-none outline-none font-medium px-1 py-0.5 rounded shadow-none w-full"
                placeholder={t.annotations.textPlaceholder}
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

        if (ann.type === 'note') {
          const note = ann as NoteAnnotation;
          const isNoteOpen = activeNoteId === note.id;

          return (
            <div
              key={note.id}
              className="annotation-item absolute z-30"
              style={{
                left: `${left}px`,
                top: `${top}px`,
              }}
              onClick={(e) => handleAnnotationClick(note, e)}
            >
              {/* Note Badge Icon */}
              <button
                className="w-7 h-7 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 flex items-center justify-center shadow-lg border-2 border-amber-500 transition-transform active:scale-95"
                title={note.text || t.tools.note}
              >
                <MessageSquare className="w-4 h-4 fill-amber-950/20" />
              </button>

              {/* Popover Card */}
              {isNoteOpen && (
                <div
                  className="absolute left-8 -top-2 w-64 bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl p-3 z-40 text-slate-100 backdrop-blur-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-amber-400">
                      {t.annotations.noteBy}
                    </span>
                    <button
                      onClick={() => deleteAnnotation(note.id)}
                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      title={t.annotations.deleteAnnotation}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <textarea
                    value={noteEditText}
                    onChange={(e) => setNoteEditText(e.target.value)}
                    placeholder={t.annotations.notePlaceholder}
                    rows={3}
                    className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500 resize-none"
                    autoFocus
                  />

                  <div className="flex items-center justify-end gap-1.5 mt-2">
                    <button
                      onClick={() => handleSaveNote(note.id)}
                      className="flex items-center gap-1 px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t.annotations.saveNote}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};
