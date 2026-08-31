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

  const { selectedAnnotationId, deleteAnnotation, annotations } = useDocument();

  const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId);

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

      {/* Contextual Style Controls */}
      <div className="flex items-center gap-3">
        {/* Highlight Color Pickers */}
        {activeTool === 'highlight' && (
          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
            <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.color}:</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setHighlightColor(c)}
                style={{ backgroundColor: c }}
                className={`w-4 h-4 rounded-full transition-transform ${
                  highlightColor === c ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110 opacity-80'
                }`}
              />
            ))}
          </div>
        )}

        {/* Drawing & Underline / Strike Color & Stroke */}
        {(activeTool === 'drawing' || activeTool === 'underline' || activeTool === 'strikethrough') && (
          <div className="flex items-center gap-3 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.color}:</span>
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setStrokeColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-4 h-4 rounded-full border border-slate-600 transition-transform ${
                    strokeColor === c ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110'
                  }`}
                />
              ))}
            </div>

            <div className="h-4 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.strokeWidth}:</span>
              {[2, 4, 7].map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    strokeWidth === w ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {w === 2 ? 'S' : w === 4 ? 'M' : 'L'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Text Tool Styles */}
        {activeTool === 'text' && (
          <div className="flex items-center gap-3 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.textColor}:</span>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-4 h-4 rounded-full border border-slate-600 transition-transform ${
                    textColor === c ? 'scale-125 ring-2 ring-sky-400' : 'hover:scale-110'
                  }`}
                />
              ))}
            </div>

            <div className="h-4 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 font-medium mr-1">{t.styles.fontSize}:</span>
              {[12, 16, 22, 32].map((s) => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    fontSize === s ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
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
