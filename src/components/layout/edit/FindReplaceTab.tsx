import React from 'react';
import { Loader2, Replace } from 'lucide-react';
import type { TranslationSchema } from '../../../types/i18n';

export interface FindReplaceTabProps {
  findQuery: string;
  setFindQuery: (val: string) => void;
  replaceValue: string;
  setReplaceValue: (val: string) => void;
  replaceMatchCase: boolean;
  setReplaceMatchCase: (val: boolean) => void;
  replaceScope: 'current' | 'all';
  setReplaceScope: (scope: 'current' | 'all') => void;
  currentPageFindMatches: number;
  pagesCount: number;
  isReplacingText: boolean;
  isDocumentEncrypted: boolean;
  isMinimal: boolean;
  isLcars: boolean;
  inputClass: string;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  subtleSurfaceClass: string;
  t: TranslationSchema;
  onRunFindReplace: () => Promise<void>;
}

export const FindReplaceTab: React.FC<FindReplaceTabProps> = ({
  findQuery,
  setFindQuery,
  replaceValue,
  setReplaceValue,
  replaceMatchCase,
  setReplaceMatchCase,
  replaceScope,
  setReplaceScope,
  currentPageFindMatches,
  pagesCount,
  isReplacingText,
  isDocumentEncrypted,
  isMinimal,
  isLcars,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  subtleSurfaceClass,
  t,
  onRunFindReplace,
}) => (
  <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
    <div className="space-y-1.5">
      <label htmlFor="edit-find-input" className="block text-xs font-semibold">
        {t.editPanel.findLabel}
      </label>
      <input
        id="edit-find-input"
        type="text"
        value={findQuery}
        disabled={isReplacingText || isDocumentEncrypted}
        onChange={(e) => setFindQuery(e.target.value)}
        placeholder={t.editPanel.findPlaceholder}
        className={`w-full px-3 py-2 text-xs rounded-md border outline-none ${inputClass}`}
      />
      {findQuery && (
        <p
          className={`text-[11px] ${
            currentPageFindMatches > 0
              ? isMinimal
                ? 'text-emerald-700'
                : isLcars
                ? 'text-[#ffcc00]'
                : 'text-emerald-400'
              : 'opacity-65'
          }`}
        >
          {currentPageFindMatches > 0
            ? t.editPanel.matchesPreview.replace('{count}', String(currentPageFindMatches))
            : t.editPanel.matchesNonePreview}
        </p>
      )}
    </div>

    <div className="space-y-1.5">
      <label htmlFor="edit-replace-input" className="block text-xs font-semibold">
        {t.editPanel.replaceLabel}
      </label>
      <input
        id="edit-replace-input"
        type="text"
        value={replaceValue}
        disabled={isReplacingText || isDocumentEncrypted}
        onChange={(e) => setReplaceValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void onRunFindReplace();
          }
        }}
        placeholder={t.editPanel.replacePlaceholder}
        className={`w-full px-3 py-2 text-xs rounded-md border outline-none ${inputClass}`}
      />
    </div>

    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
      <input
        type="checkbox"
        checked={replaceMatchCase}
        onChange={(e) => setReplaceMatchCase(e.target.checked)}
        className="rounded border-slate-600 text-indigo-500 cursor-pointer"
      />
      <span>{t.editPanel.matchCase}</span>
    </label>

    <div className="space-y-1.5">
      <span className="block text-xs font-semibold">{t.editPanel.scopeLabel}</span>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setReplaceScope('current')}
          className={`py-1.5 px-2.5 text-xs font-semibold transition-colors ${
            replaceScope === 'current' ? primaryBtnClass : secondaryBtnClass
          }`}
        >
          {t.editPanel.scopeCurrentPage}
        </button>
        <button
          type="button"
          onClick={() => setReplaceScope('all')}
          className={`py-1.5 px-2.5 text-xs font-semibold transition-colors ${
            replaceScope === 'all' ? primaryBtnClass : secondaryBtnClass
          }`}
        >
          {t.editPanel.scopeAllPages} ({pagesCount})
        </button>
      </div>
    </div>

    <button
      type="button"
      disabled={!findQuery || isReplacingText || isDocumentEncrypted}
      onClick={() => void onRunFindReplace()}
      className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold transition-all disabled:opacity-45 disabled:cursor-not-allowed ${primaryBtnClass}`}
    >
      {isReplacingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Replace className="w-4 h-4" />}
      <span>{isReplacingText ? t.editPanel.replacingAction : t.editPanel.replaceAction}</span>
    </button>

    <div className={`p-2.5 rounded-lg border text-[11px] leading-relaxed opacity-85 ${subtleSurfaceClass}`}>
      {t.editPanel.findReplaceNote}
    </div>
  </div>
);
