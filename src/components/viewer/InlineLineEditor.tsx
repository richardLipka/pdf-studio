import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TextLine } from '../../services/pdfTextModel';
import type { TranslationSchema } from '../../types/i18n';
import { clampInlineEditorPosition } from '../../utils/editModeState';

export interface InlineLineEditorState {
  lineId: string;
  text: string;
  original: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface InlineLineEditorProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  lineEditor: InlineLineEditorState;
  selectedBlockLines: TextLine[];
  pageWidth: number;
  pageHeight: number;
  scale: number;
  isSavingLine: boolean;
  isMinimal: boolean;
  isLcars: boolean;
  t: TranslationSchema;
  onChangeText: (text: string) => void;
  onStepToLine: (line: TextLine) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
}

export const InlineLineEditor: React.FC<InlineLineEditorProps> = ({
  editorRef,
  lineEditor,
  selectedBlockLines,
  pageWidth,
  pageHeight,
  scale,
  isSavingLine,
  isMinimal,
  isLcars,
  t,
  onChangeText,
  onStepToLine,
  onSave,
  onClose,
}) => {
  const layout = clampInlineEditorPosition(lineEditor.box, pageWidth, pageHeight, scale);
  const curLineIdx = selectedBlockLines.findIndex((l) => l.id === lineEditor.lineId);
  const hasSiblingLines = selectedBlockLines.length > 1 && curLineIdx >= 0;

  const stepToSiblingLine = (delta: -1 | 1) => {
    if (!hasSiblingLines) return;
    const nextIdx = (curLineIdx + delta + selectedBlockLines.length) % selectedBlockLines.length;
    onStepToLine(selectedBlockLines[nextIdx]);
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
        onClick={() => void onSave()}
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
        onClick={onClose}
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
      ref={editorRef}
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
        onChange={(e) => onChangeText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
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
};
