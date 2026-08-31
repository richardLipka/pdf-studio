import React from 'react';
import { useI18n } from '../../i18n/context';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { ToolType } from '../../types/annotations';
import {
  MousePointer,
  Hand,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough as StrikeIcon,
  StickyNote,
  Type,
  PenTool,
  FileSignature,
  FilePlus2,
  Eraser,
  Trash2,
} from 'lucide-react';

const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f472b6', '#fdba74'];
const STROKE_COLORS = ['#0284c7', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0f172a', '#ffffff'];
const TEXT_COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ffffff'];
const NOTE_COLORS = ['#f59e0b', '#10b981', '#0284c7', '#8b5cf6', '#f43f5e'];

export const Toolbar: React.FC = () => {
  const { t } = useI18n();
  const {
    activeTool,
    setActiveTool,
    strokeColor,
    setStrokeColor,
    highlightColor,
    setHighlightColor,
    textColor,
    setTextColor,
    strokeWidth,
    setStrokeWidth,
    fontSize,
    setFontSize,
    setIsSignatureModalOpen,
    setIsAddPageModalOpen,
  } = useEditor();

  const {
    selectedAnnotationId,
    deleteAnnotation,
    updateAnnotation,
    annotations,
  } = useDocument();

  const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId);

  // Determine what style controls to show based on selected item or active tool
  const showHighlightStyles =
    activeTool === 'highlight' || (selectedAnn && selectedAnn.type === 'highlight');

  const showStrokeStyles =
    activeTool === 'drawing' ||
    activeTool === 'underline' ||
    activeTool === 'strikethrough' ||
    (selectedAnn &&
      (selectedAnn.type === 'drawing' ||
        selectedAnn.type === 'underline' ||
        selectedAnn.type === 'strikethrough'));

  const showTextStyles =
    activeTool === 'text' || (selectedAnn && selectedAnn.type === 'text');

  const showNoteStyles =
    activeTool === 'note' || (selectedAnn && selectedAnn.type === 'note');

  // Change color of active tool AND any currently selected element
  const handleHighlightColorChange = (c: string) => {
    setHighlightColor(c);
    if (selectedAnn && selectedAnn.type === 'highlight') {
      updateAnnotation({ ...selectedAnn, color: c, updatedAt: Date.now() }, true);
    }
  };

  const handleStrokeColorChange = (c: string) => {
    setStrokeColor(c);
    if (
      selectedAnn &&
      (selectedAnn.type === 'drawing' ||
        selectedAnn.type === 'underline' ||
        selectedAnn.type === 'strikethrough')
    ) {
      updateAnnotation({ ...selectedAnn, color: c, updatedAt: Date.now() }, true);
    }
  };

  const handleStrokeWidthChange = (w: number) => {
    setStrokeWidth(w);
    if (selectedAnn) {
      if (selectedAnn.type === 'drawing') {
        updateAnnotation({ ...selectedAnn, strokeWidth: w, updatedAt: Date.now() }, true);
      } else if (selectedAnn.type === 'underline' || selectedAnn.type === 'strikethrough') {
        updateAnnotation(
          { ...selectedAnn, strokeWidth: w, height: w, updatedAt: Date.now() },
          true
        );
      }
    }
  };

  const handleTextColorChange = (c: string) => {
    setTextColor(c);
    if (selectedAnn && selectedAnn.type === 'text') {
      updateAnnotation({ ...selectedAnn, color: c, updatedAt: Date.now() }, true);
    }
  };

  const handleFontSizeChange = (s: number) => {
    setFontSize(s);
    if (selectedAnn && selectedAnn.type === 'text') {
      updateAnnotation(
        { ...selectedAnn, fontSize: s, height: s * 1.5, updatedAt: Date.now() },
        true
      );
    }
  };

  const handleNoteColorChange = (c: string) => {
    if (selectedAnn && selectedAnn.type === 'note') {
      updateAnnotation({ ...selectedAnn, color: c, updatedAt: Date.now() }, true);
    }
  };

  const tools: { id: ToolType; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: 'select',
      label: t.tools.select,
      icon: <MousePointer className="w-4 h-4" />,
      desc: t.tools.selectDesc,
    },
    {
      id: 'pan',
      label: t.tools.pan,
      icon: <Hand className="w-4 h-4" />,
      desc: t.tools.panDesc,
    },
    {
      id: 'highlight',
      label: t.tools.highlight,
      icon: <Highlighter className="w-4 h-4" />,
      desc: t.tools.highlightDesc,
    },
    {
      id: 'underline',
      label: t.tools.underline,
      icon: <UnderlineIcon className="w-4 h-4" />,
      desc: t.tools.underlineDesc,
    },
    {
      id: 'strikethrough',
      label: t.tools.strikethrough,
      icon: <StrikeIcon className="w-4 h-4" />,
      desc: t.tools.strikethroughDesc,
    },
    {
      id: 'note',
      label: t.tools.note,
      icon: <StickyNote className="w-4 h-4" />,
      desc: t.tools.noteDesc,
    },
    {
      id: 'text',
      label: t.tools.text,
      icon: <Type className="w-4 h-4" />,
      desc: t.tools.textDesc,
    },
    {
      id: 'drawing',
      label: t.tools.drawing,
      icon: <PenTool className="w-4 h-4" />,
      desc: t.tools.drawingDesc,
    },
    {
      id: 'eraser',
      label: t.tools.eraser,
      icon: <Eraser className="w-4 h-4" />,
      desc: t.tools.eraserDesc,
    },
  ];

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 select-none z-20">
      {/* Primary Tool Buttons */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        {tools.map((tool) => {
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
              }`}
              title={tool.desc}
            >
              {tool.icon}
              <span className="hidden sm:inline">{tool.label}</span>
            </button>
          );
        })}

        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* Signature Action Button */}
        <button
          onClick={() => setIsSignatureModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 transition-all"
          title={t.tools.signatureDesc}
        >
          <FileSignature className="w-4 h-4 text-emerald-400" />
          <span>{t.tools.signature}</span>
        </button>

        {/* Add Page Action Button */}
        <button
          onClick={() => setIsAddPageModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/50 transition-all"
          title={t.tools.addPageDesc}
        >
          <FilePlus2 className="w-4 h-4 text-indigo-400" />
          <span>{t.tools.addPage}</span>
        </button>
      </div>

      {/* Contextual Style Controls (dynamically matches selected element or active tool) */}
      <div className="flex items-center gap-3">
        {/* Highlight Color Pickers */}
        {showHighlightStyles && (
          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700 animate-in fade-in duration-150">
            <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.color}:</span>
            {HIGHLIGHT_COLORS.map((c) => {
              const isCurrColor = (selectedAnn && selectedAnn.color === c) || highlightColor === c;
              return (
                <button
                  key={c}
                  onClick={() => handleHighlightColorChange(c)}
                  style={{ backgroundColor: c }}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    isCurrColor ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110 opacity-80'
                  }`}
                />
              );
            })}
          </div>
        )}

        {/* Drawing & Underline / Strike Color & Stroke */}
        {showStrokeStyles && (
          <div className="flex items-center gap-3 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.color}:</span>
              {STROKE_COLORS.map((c) => {
                const isCurrColor = (selectedAnn && selectedAnn.color === c) || strokeColor === c;
                return (
                  <button
                    key={c}
                    onClick={() => handleStrokeColorChange(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full border border-slate-600 transition-transform ${
                      isCurrColor ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            <div className="h-4 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.strokeWidth}:</span>
              {[2, 4, 7].map((w) => {
                const isCurrWidth =
                  (selectedAnn && (selectedAnn as any).strokeWidth === w) || strokeWidth === w;
                return (
                  <button
                    key={w}
                    onClick={() => handleStrokeWidthChange(w)}
                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                      isCurrWidth ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {w === 2 ? 'S' : w === 4 ? 'M' : 'L'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Text Tool Styles */}
        {showTextStyles && (
          <div className="flex items-center gap-3 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.textColor}:</span>
              {TEXT_COLORS.map((c) => {
                const isCurrColor = (selectedAnn && selectedAnn.color === c) || textColor === c;
                return (
                  <button
                    key={c}
                    onClick={() => handleTextColorChange(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full border border-slate-600 transition-transform ${
                      isCurrColor ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            <div className="h-4 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.fontSize}:</span>
              {[12, 16, 22, 32].map((s) => {
                const isCurrSize =
                  (selectedAnn && (selectedAnn as any).fontSize === s) || fontSize === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleFontSizeChange(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      isCurrSize ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Note Pin Color */}
        {showNoteStyles && selectedAnn && selectedAnn.type === 'note' && (
          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700 animate-in fade-in duration-150">
            <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.color}:</span>
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleNoteColorChange(c)}
                style={{ backgroundColor: c }}
                className={`w-4 h-4 rounded-full transition-transform ${
                  selectedAnn.color === c ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110 opacity-80'
                }`}
              />
            ))}
          </div>
        )}

        {/* Delete Selected Item button */}
        {selectedAnn && (
          <button
            onClick={() => deleteAnnotation(selectedAnn.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-medium transition-colors"
            title={t.annotations.deleteAnnotation}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.annotations.deleteAnnotation}</span>
          </button>
        )}
      </div>
    </div>
  );
};
