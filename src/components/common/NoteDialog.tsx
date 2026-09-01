import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { MessageSquare, Trash2, X, Check } from 'lucide-react';

export interface NoteDialogProps {
  title?: string;
  initialText: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  positionClassName?: string;
  widthClassName?: string;
  autoFocus?: boolean;
}

export const NoteDialog: React.FC<NoteDialogProps> = ({
  title,
  initialText,
  placeholder,
  onSave,
  onCancel,
  onDelete,
  positionClassName = 'absolute left-8 -top-2',
  widthClassName = 'w-64',
  autoFocus = true,
}) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      className={`note-dialog-card ${positionClassName} ${widthClassName} z-50 p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150 border ${
        isMinimal
          ? 'rounded-xl bg-white border-neutral-300 text-black shadow-xl ring-1 ring-black/5'
          : isLcars
          ? 'rounded-2xl bg-[#0a0a0a] border-2 border-[#ff9900] text-[#ff9900] shadow-[0_0_15px_rgba(255,153,0,0.25)]'
          : 'rounded-xl bg-slate-900/95 border-amber-500/80 text-slate-100 backdrop-blur-xl ring-1 ring-amber-500/20'
      }`}
    >
      {/* Header with Title and Top-Right Icons (Trash + Cross) */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-inherit/20">
        <div className="flex items-center gap-1.5 min-w-0">
          <MessageSquare
            className={`w-3.5 h-3.5 shrink-0 ${
              isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-amber-400'
            }`}
          />
          <span
            className={`text-xs font-bold truncate ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-amber-400'
            }`}
          >
            {title || t.tools.note}
          </span>
        </div>

        {/* Top Right: Trash next to Cross */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={`p-1 rounded transition-colors ${
              isMinimal
                ? 'hover:bg-rose-50 text-neutral-400 hover:text-rose-600'
                : isLcars
                ? 'hover:bg-[#cc3333] text-[#cc3333] hover:text-white'
                : 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
            }`}
            title={t.annotations.deleteAnnotation}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className={`p-1 rounded transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-400 hover:text-black'
                : isLcars
                ? 'hover:bg-[#333333] text-[#ff9966] hover:text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={t.addPageModal.cancel}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || t.annotations.notePlaceholder}
        rows={3}
        className={`w-full text-xs p-2.5 outline-none resize-none border font-sans transition-colors ${
          isMinimal
            ? 'rounded-lg bg-neutral-50 border-neutral-200 text-black placeholder-neutral-400 focus:border-black focus:bg-white'
            : isLcars
            ? 'rounded-xl bg-black border-[#ff9966] text-[#ff9900] placeholder-[#aa6633] focus:border-[#ff9900]'
            : 'rounded-lg bg-slate-800/90 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:bg-slate-800'
        }`}
      />

      {/* Footer with Cancel Text and Confirmation Button */}
      <div className="flex items-center justify-end gap-2 mt-2.5 pt-1 border-t border-inherit/20">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            isMinimal
              ? 'text-neutral-500 hover:text-black hover:bg-neutral-100'
              : isLcars
              ? 'text-[#ff9966] hover:text-[#ff9900] hover:bg-[#222]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          {t.addPageModal.cancel}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSave(text);
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg shadow-sm transition-all ${
            isMinimal
              ? 'bg-black hover:bg-neutral-800 text-white'
              : isLcars
              ? 'bg-[#ff9900] hover:bg-[#ffcc00] text-black font-bold'
              : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t.annotations.saveNote}</span>
        </button>
      </div>
    </div>
  );
};
