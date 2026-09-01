import React from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { ToolType, TextAnnotation } from '../../types/annotations';
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
  MessageSquare,
  Crop,
} from 'lucide-react';

const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f472b6', '#fdba74'];
const STROKE_COLORS = ['#0284c7', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0f172a', '#ffffff'];
const TEXT_COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ffffff'];
const NOTE_COLORS = ['#f59e0b', '#10b981', '#0284c7', '#8b5cf6', '#f43f5e'];

const FONT_FAMILIES = [
  { id: 'Inter', name: 'Inter (Sans)' },
  { id: 'Caveat', name: 'Caveat (Psací / Script)' },
  { id: 'Dancing Script', name: 'Dancing Script (Kurzíva)' },
  { id: 'Courier New', name: 'Courier (Strojopis)' },
  { id: 'Times New Roman', name: 'Times New Roman (Patkové)' },
  { id: 'Georgia', name: 'Georgia (Serif)' },
  { id: 'Arial', name: 'Arial (Sans)' },
];

export const Toolbar: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
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
    fontFamily,
    setFontFamily,
    setIsSignatureModalOpen,
    setIsAddPageModalOpen,
    setIsNotesPanelOpen,
  } = useEditor();

  const {
    selectedAnnotationId,
    deleteAnnotation,
    updateAnnotation,
    annotations,
  } = useDocument();

  const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

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
        selectedAnn.type === 'strikethrough' ||
        selectedAnn.type === 'shape'));

  const showTextStyles =
    activeTool === 'text' || (selectedAnn && selectedAnn.type === 'text');

  const showNoteStyles =
    activeTool === 'note' || (selectedAnn && selectedAnn.type === 'note');

  // Change color of active tool AND any currently selected element immediately
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
        selectedAnn.type === 'strikethrough' ||
        selectedAnn.type === 'shape')
    ) {
      updateAnnotation({ ...selectedAnn, color: c, updatedAt: Date.now() }, true);
    }
  };

  const handleStrokeWidthChange = (w: number) => {
    setStrokeWidth(w);
    if (
      selectedAnn &&
      (selectedAnn.type === 'drawing' ||
        selectedAnn.type === 'underline' ||
        selectedAnn.type === 'strikethrough' ||
        selectedAnn.type === 'shape')
    ) {
      updateAnnotation({ ...selectedAnn, strokeWidth: w, updatedAt: Date.now() }, true);
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
        { ...selectedAnn, fontSize: s, updatedAt: Date.now() },
        true
      );
    }
  };

  const handleFontFamilyChange = (f: string) => {
    setFontFamily(f);
    if (selectedAnn && selectedAnn.type === 'text') {
      updateAnnotation(
        { ...selectedAnn, fontFamily: f, updatedAt: Date.now() },
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
      id: 'crop',
      label: t.tools.crop,
      icon: <Crop className="w-4 h-4" />,
      desc: t.tools.cropDesc,
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
    <div
      className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-3 select-none z-20 transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-black'
          : isLcars
          ? 'bg-black border-[#ff9900] text-[#ff9900]'
          : 'bg-slate-900 border-slate-800 text-white'
      }`}
    >
      {/* Primary Tool Buttons */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        {tools.map((tool) => {
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-all ${
                isMinimal
                  ? isActive
                    ? 'rounded-md bg-black text-white border border-black shadow-none'
                    : 'rounded-md bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 hover:border-neutral-300'
                  : isLcars
                  ? isActive
                    ? 'rounded-full bg-[#ff9900] text-black font-bold border-2 border-[#ff9900]'
                    : 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9966] border border-[#ff9966]'
                  : isActive
                  ? 'rounded-lg bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
              }`}
              title={tool.desc}
            >
              {tool.icon}
              <span className="hidden sm:inline">{tool.label}</span>
            </button>
          );
        })}

        <div
          className={`h-6 w-px mx-1 ${
            isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#333333]' : 'bg-slate-800'
          }`}
        />

        {/* Signature Action Button */}
        <button
          onClick={() => setIsSignatureModalOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
            isMinimal
              ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300 shadow-none'
              : isLcars
              ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ffff66] border border-[#ffff66] uppercase'
              : 'rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50'
          }`}
          title={t.tools.signatureDesc}
        >
          <FileSignature
            className={`w-4 h-4 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ffff66]' : 'text-emerald-400'
            }`}
          />
          <span>{t.tools.signature}</span>
        </button>

        {/* Add Page Action Button */}
        <button
          onClick={() => setIsAddPageModalOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
            isMinimal
              ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300 shadow-none'
              : isLcars
              ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#99ccff] border border-[#99ccff] uppercase'
              : 'rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/50'
          }`}
          title={t.tools.addPageDesc}
        >
          <FilePlus2
            className={`w-4 h-4 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#99ccff]' : 'text-indigo-400'
            }`}
          />
          <span>{t.tools.addPage}</span>
        </button>
      </div>

      {/* Contextual Style Controls (dynamically matches selected element or active tool) */}
      <div className="flex items-center gap-3">
        {/* Highlight Color Pickers */}
        {showHighlightStyles && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1 border animate-in fade-in duration-150 ${
              isMinimal
                ? 'rounded-md bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'rounded-full bg-[#111111] border-[#ff9900]'
                : 'rounded-lg bg-slate-800 border-slate-700'
            }`}
          >
            <span
              className={`text-[11px] font-medium mr-1 ${
                isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
              }`}
            >
              {t.styles.color}:
            </span>
            {HIGHLIGHT_COLORS.map((c) => {
              const isCurrColor = (selectedAnn && selectedAnn.color === c) || highlightColor === c;
              return (
                <button
                  key={c}
                  onClick={() => handleHighlightColorChange(c)}
                  style={{ backgroundColor: c }}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    isCurrColor
                      ? isMinimal
                        ? 'scale-125 ring-2 ring-black'
                        : 'scale-125 ring-2 ring-sky-400'
                      : 'hover:scale-110 opacity-80'
                  }`}
                />
              );
            })}
          </div>
        )}

        {/* Drawing & Underline / Strike Color & Stroke */}
        {showStrokeStyles && (
          <div
            className={`flex items-center gap-3 px-2.5 py-1 border animate-in fade-in duration-150 ${
              isMinimal
                ? 'rounded-md bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'rounded-full bg-[#111111] border-[#ff9900]'
                : 'rounded-lg bg-slate-800 border-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[11px] font-medium mr-1 ${
                  isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
                }`}
              >
                {t.styles.color}:
              </span>
              {STROKE_COLORS.map((c) => {
                const isCurrColor = (selectedAnn && selectedAnn.color === c) || strokeColor === c;
                return (
                  <button
                    key={c}
                    onClick={() => handleStrokeColorChange(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full border transition-transform ${
                      isMinimal ? 'border-neutral-300' : 'border-slate-600'
                    } ${
                      isCurrColor
                        ? isMinimal
                          ? 'scale-125 ring-2 ring-black'
                          : 'scale-125 ring-2 ring-sky-400'
                        : 'hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            <div
              className={`h-4 w-px ${
                isMinimal ? 'bg-neutral-300' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
              }`}
            />

            <div className="flex items-center gap-1">
              <span
                className={`text-[11px] font-medium mr-1 ${
                  isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
                }`}
              >
                {t.styles.strokeWidth}:
              </span>
              {[1, 2, 4, 6, 8, 12].map((w) => {
                const isCurrWidth =
                  (selectedAnn && (selectedAnn as any).strokeWidth === w) ||
                  (!selectedAnn && strokeWidth === w);
                return (
                  <button
                    key={w}
                    onClick={() => handleStrokeWidthChange(w)}
                    title={`${w} pt`}
                    className={`h-6 px-1.5 rounded flex items-center justify-center gap-1 transition-all ${
                      isCurrWidth
                        ? isMinimal
                          ? 'bg-black text-white shadow-sm ring-1 ring-black'
                          : isLcars
                          ? 'bg-[#ff9900] text-black font-bold ring-1 ring-[#ffff66]'
                          : 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400'
                        : isMinimal
                        ? 'text-neutral-600 hover:text-black hover:bg-neutral-200/60'
                        : isLcars
                        ? 'text-[#99ccff] hover:text-[#ffff66] hover:bg-[#222]'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
                    }`}
                  >
                    <span
                      className="rounded-full inline-block"
                      style={{
                        width: '10px',
                        height: `${Math.min(6, Math.max(1, w / 2))}px`,
                        backgroundColor: isCurrWidth
                          ? isMinimal
                            ? '#ffffff'
                            : isLcars
                            ? '#000000'
                            : '#ffffff'
                          : isMinimal
                          ? '#525252'
                          : isLcars
                          ? '#99ccff'
                          : '#94a3b8',
                      }}
                    />
                    <span className="text-[10px] font-mono font-semibold">{w}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Text Tool Styles (Font Family, Font Size, Text Color) */}
        {showTextStyles && (
          <div
            className={`flex items-center gap-2.5 px-2.5 py-1 border animate-in fade-in duration-150 ${
              isMinimal
                ? 'rounded-md bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'rounded-full bg-[#111111] border-[#ff9900]'
                : 'rounded-lg bg-slate-800 border-slate-700'
            }`}
          >
            {/* Font Family Dropdown */}
            <div className="flex items-center gap-1">
              <select
                value={
                  selectedAnn && selectedAnn.type === 'text'
                    ? (selectedAnn as TextAnnotation).fontFamily || fontFamily
                    : fontFamily
                }
                onChange={(e) => handleFontFamilyChange(e.target.value)}
                className={`px-2 py-0.5 text-xs outline-none cursor-pointer border ${
                  isMinimal
                    ? 'rounded-md bg-white border-neutral-300 text-black'
                    : isLcars
                    ? 'rounded-full bg-black border-[#ff9966] text-[#ff9900]'
                    : 'rounded-md bg-slate-900 border-slate-700 text-slate-200 focus:border-sky-500'
                }`}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              className={`h-4 w-px ${
                isMinimal ? 'bg-neutral-300' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
              }`}
            />

            {/* Font Size Presets */}
            <div className="flex items-center gap-1">
              <span
                className={`text-[11px] font-medium mr-0.5 ${
                  isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
                }`}
              >
                {t.styles.fontSize}:
              </span>
              {[12, 14, 18, 24, 32].map((s) => {
                const isCurrSize =
                  (selectedAnn && (selectedAnn as any).fontSize === s) || fontSize === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleFontSizeChange(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      isCurrSize
                        ? isMinimal
                          ? 'bg-black text-white'
                          : isLcars
                          ? 'bg-[#ff9900] text-black font-bold'
                          : 'bg-sky-600 text-white'
                        : isMinimal
                        ? 'text-neutral-600 hover:text-black'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            <div
              className={`h-4 w-px ${
                isMinimal ? 'bg-neutral-300' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
              }`}
            />

            {/* Text Color Picker */}
            <div className="flex items-center gap-1.5">
              {TEXT_COLORS.map((c) => {
                const isCurrColor = (selectedAnn && selectedAnn.color === c) || textColor === c;
                return (
                  <button
                    key={c}
                    onClick={() => handleTextColorChange(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full border transition-transform ${
                      isMinimal ? 'border-neutral-300' : 'border-slate-600'
                    } ${
                      isCurrColor
                        ? isMinimal
                          ? 'scale-125 ring-2 ring-black'
                          : 'scale-125 ring-2 ring-sky-400'
                        : 'hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Note Pin Color */}
        {showNoteStyles && selectedAnn && selectedAnn.type === 'note' && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1 border animate-in fade-in duration-150 ${
              isMinimal
                ? 'rounded-md bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'rounded-full bg-[#111111] border-[#ff9900]'
                : 'rounded-lg bg-slate-800 border-slate-700'
            }`}
          >
            <span
              className={`text-[11px] font-medium mr-1 ${
                isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
              }`}
            >
              {t.styles.color}:
            </span>
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleNoteColorChange(c)}
                style={{ backgroundColor: c }}
                className={`w-4 h-4 rounded-full transition-transform ${
                  selectedAnn.color === c
                    ? isMinimal
                      ? 'scale-125 ring-2 ring-black'
                      : 'scale-125 ring-2 ring-sky-400'
                    : 'hover:scale-110 opacity-80'
                }`}
              />
            ))}
          </div>
        )}

        {/* Comment / Notes Panel Button for Selected Item */}
        {selectedAnn && (
          <button
            onClick={() => setIsNotesPanelOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border ${
              isMinimal
                ? 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                : isLcars
                ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ffcc00] border-[#ffcc00]'
                : 'rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/40'
            }`}
            title={t.notesPanel.title}
          >
            <MessageSquare
              className={`w-3.5 h-3.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ffcc00]' : 'text-amber-400'
              }`}
            />
            <span>{t.notesPanel.title}</span>
          </button>
        )}

        {/* Delete Selected Item button */}
        {selectedAnn && (
          <button
            onClick={() => deleteAnnotation(selectedAnn.id)}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors border ${
              isMinimal
                ? 'rounded-md bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
                : isLcars
                ? 'rounded-full bg-[#cc3333] hover:bg-[#ff3333] text-white border-[#cc3333]'
                : 'rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border-rose-500/30'
            }`}
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
