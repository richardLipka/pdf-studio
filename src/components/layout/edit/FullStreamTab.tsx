import React from 'react';
import { AlertTriangle, Loader2, RotateCcw, Save } from 'lucide-react';
import type { TranslationSchema } from '../../../types/i18n';

export interface FullStreamTabProps {
  fullStreamText: string;
  originalFullStreamText: string;
  setFullStreamText: (val: string) => void;
  isSaving: boolean;
  isLoading: boolean;
  isDocumentEncrypted: boolean;
  isMinimal: boolean;
  isLcars: boolean;
  inputClass: string;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  t: TranslationSchema;
  onSaveFullStream: () => Promise<void>;
}

export const FullStreamTab: React.FC<FullStreamTabProps> = ({
  fullStreamText,
  originalFullStreamText,
  setFullStreamText,
  isSaving,
  isLoading,
  isDocumentEncrypted,
  isMinimal,
  isLcars,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  t,
  onSaveFullStream,
}) => (
  <div className="flex-1 flex flex-col min-h-0 p-3 space-y-2.5">
    <div
      className={`p-2 rounded-lg border text-[11px] flex items-start gap-2 shrink-0 ${
        isMinimal
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : isLcars
          ? 'bg-[#261a00] border-[#ff9900]/60 text-[#ffcc00]'
          : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
      }`}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{t.editPanel.fullStreamWarning}</span>
    </div>

    <div className="flex items-center justify-between text-[11px] shrink-0">
      <span className="font-semibold">{t.editPanel.fullStreamLabel}</span>
      <span className="font-mono opacity-65">{fullStreamText.length.toLocaleString()} chars</span>
    </div>

    <textarea
      spellCheck={false}
      value={fullStreamText}
      disabled={isSaving || isLoading || isDocumentEncrypted}
      onChange={(e) => setFullStreamText(e.target.value)}
      className={`flex-1 min-h-0 w-full p-2.5 text-[11px] font-mono leading-relaxed rounded-md border outline-none resize-none ${inputClass}`}
    />

    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        disabled={isSaving || fullStreamText === originalFullStreamText}
        onClick={() => setFullStreamText(originalFullStreamText)}
        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${secondaryBtnClass}`}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>{t.editPanel.resetChanges}</span>
      </button>

      <button
        type="button"
        disabled={
          isSaving ||
          isDocumentEncrypted ||
          !fullStreamText.trim() ||
          fullStreamText === originalFullStreamText
        }
        onClick={() => void onSaveFullStream()}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
      >
        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        <span>{isSaving ? t.editPanel.saving : t.editPanel.saveFullStreamBtn}</span>
      </button>
    </div>
  </div>
);
