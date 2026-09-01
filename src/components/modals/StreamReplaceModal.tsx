import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import {
  X,
  FileCode2,
  Replace,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  FileText,
} from 'lucide-react';

export const StreamReplaceModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isStreamReplaceModalOpen,
    setIsStreamReplaceModalOpen,
    streamReplaceTargetText,
    setStreamReplaceTargetText,
  } = useEditor();

  const { activePageIndex, pages, applyContentStreamReplacement } = useDocument();

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const [searchText, setSearchText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [scope, setScope] = useState<'currentPage' | 'allPages'>('currentPage');
  const [matchCase, setMatchCase] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [resultStatus, setResultStatus] = useState<{
    type: 'idle' | 'success' | 'none' | 'error';
    message?: string;
    count?: number;
  }>({ type: 'idle' });

  // Sync target text when modal opens
  useEffect(() => {
    if (isStreamReplaceModalOpen) {
      if (streamReplaceTargetText) {
        setSearchText(streamReplaceTargetText);
      }
      setResultStatus({ type: 'idle' });
    }
  }, [isStreamReplaceModalOpen, streamReplaceTargetText]);

  if (!isStreamReplaceModalOpen) return null;

  const handleClose = () => {
    setIsStreamReplaceModalOpen(false);
    setStreamReplaceTargetText('');
    setResultStatus({ type: 'idle' });
  };

  const handleExecuteReplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchText.trim() || isProcessing) return;

    setIsProcessing(true);
    setResultStatus({ type: 'idle' });

    try {
      const result = await applyContentStreamReplacement(searchText, replaceText, {
        pageIndex: activePageIndex,
        replaceAllPages: scope === 'allPages',
        matchCase,
      });

      if (result.success && result.totalReplaced > 0) {
        setResultStatus({
          type: 'success',
          count: result.totalReplaced,
          message: t.streamReplaceModal.resultsSuccess.replace('{count}', String(result.totalReplaced)),
        });
      } else if (result.error) {
        setResultStatus({
          type: 'error',
          message: `${t.streamReplaceModal.resultsError}: ${result.error}`,
        });
      } else {
        setResultStatus({
          type: 'none',
          message: t.streamReplaceModal.resultsNone,
        });
      }
    } catch (err: any) {
      setResultStatus({
        type: 'error',
        message: `${t.streamReplaceModal.resultsError}: ${err?.message || err}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full max-w-xl shadow-2xl overflow-hidden flex flex-col ${
          isMinimal
            ? 'bg-white border-2 border-black rounded-none text-black'
            : isLcars
            ? 'bg-black border-2 border-amber-500 rounded-2xl text-amber-400 font-mono'
            : 'bg-slate-900/95 border border-slate-700/80 rounded-2xl text-slate-100 backdrop-blur-xl'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isMinimal
              ? 'border-black bg-neutral-100'
              : isLcars
              ? 'border-amber-500/50 bg-amber-500/10'
              : 'border-slate-800 bg-slate-800/50'
          }`}
        >
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-lg ${
                isMinimal
                  ? 'bg-black text-white'
                  : isLcars
                  ? 'bg-amber-500 text-black'
                  : 'bg-sky-500/20 text-sky-400'
              }`}
            >
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {t.streamReplaceModal.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal
                    ? 'text-neutral-600'
                    : isLcars
                    ? 'text-amber-400/70'
                    : 'text-slate-400'
                }`}
              >
                {t.streamReplaceModal.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-200 text-black'
                : isLcars
                ? 'hover:bg-amber-500/20 text-amber-400'
                : 'hover:bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body & Form */}
        <form onSubmit={handleExecuteReplace} className="p-6 space-y-5">
          {/* Search text field */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 opacity-90">
              {t.streamReplaceModal.searchLabel}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t.streamReplaceModal.searchPlaceholder}
                required
                className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border outline-none transition-all ${
                  isMinimal
                    ? 'bg-white border-black text-black focus:ring-1 focus:ring-black'
                    : isLcars
                    ? 'bg-black border-amber-500 text-amber-300 focus:border-amber-300'
                    : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500'
                }`}
              />
            </div>
          </div>

          {/* Replace text field */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 opacity-90">
              {t.streamReplaceModal.replaceLabel}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Replace className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={t.streamReplaceModal.replacePlaceholder}
                className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border outline-none transition-all ${
                  isMinimal
                    ? 'bg-white border-black text-black focus:ring-1 focus:ring-black'
                    : isLcars
                    ? 'bg-black border-amber-500 text-amber-300 focus:border-amber-300'
                    : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500'
                }`}
              />
            </div>
          </div>

          {/* Options: Scope and Case Sensitivity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Scope */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 opacity-90">
                {t.streamReplaceModal.scopeLabel}
              </label>
              <div className="flex flex-col space-y-2">
                <label className="flex items-center space-x-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="replaceScope"
                    checked={scope === 'currentPage'}
                    onChange={() => setScope('currentPage')}
                    className="accent-sky-500"
                  />
                  <span className="flex items-center space-x-1">
                    <FileText className="w-3.5 h-3.5 opacity-70" />
                    <span>
                      {t.streamReplaceModal.scopeCurrentPage} (str. {activePageIndex + 1})
                    </span>
                  </span>
                </label>
                <label className="flex items-center space-x-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="replaceScope"
                    checked={scope === 'allPages'}
                    onChange={() => setScope('allPages')}
                    className="accent-sky-500"
                  />
                  <span className="flex items-center space-x-1">
                    <Layers className="w-3.5 h-3.5 opacity-70" />
                    <span>
                      {t.streamReplaceModal.scopeAllPages} ({pages.length} stran)
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Case sensitivity */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 opacity-90">
                {t.styles.color ? 'Možnosti shody' : 'Match Options'}
              </label>
              <label className="flex items-center space-x-2 text-xs cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(e) => setMatchCase(e.target.checked)}
                  className="accent-sky-500 rounded"
                />
                <span>{t.streamReplaceModal.matchCaseLabel}</span>
              </label>
            </div>
          </div>

          {/* Result Alert / Notification */}
          {resultStatus.type !== 'idle' && (
            <div
              className={`p-3 rounded-lg flex items-start space-x-2.5 text-xs animate-in fade-in ${
                resultStatus.type === 'success'
                  ? isMinimal
                    ? 'bg-black text-white'
                    : isLcars
                    ? 'bg-emerald-950/60 border border-emerald-500 text-emerald-300'
                    : 'bg-emerald-950/50 border border-emerald-600/60 text-emerald-300'
                  : resultStatus.type === 'none'
                  ? isMinimal
                    ? 'bg-neutral-100 border border-black text-black'
                    : isLcars
                    ? 'bg-amber-950/60 border border-amber-500 text-amber-300'
                    : 'bg-amber-950/40 border border-amber-600/50 text-amber-300'
                  : isMinimal
                  ? 'bg-neutral-100 border border-red-600 text-red-600'
                  : 'bg-rose-950/50 border border-rose-600/60 text-rose-300'
              }`}
            >
              {resultStatus.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              )}
              {resultStatus.type === 'none' && (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              )}
              {resultStatus.type === 'error' && (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div className="leading-relaxed">{resultStatus.message}</div>
            </div>
          )}

          {/* Hint info */}
          <div
            className={`text-xs p-3 rounded-lg border leading-relaxed ${
              isMinimal
                ? 'bg-neutral-50 border-neutral-200 text-neutral-600'
                : isLcars
                ? 'bg-amber-950/20 border-amber-500/30 text-amber-400/80'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
            }`}
          >
            {t.streamReplaceModal.hintInfo}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                isMinimal
                  ? 'bg-neutral-100 hover:bg-neutral-200 text-black'
                  : isLcars
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              {t.streamReplaceModal.closeButton}
            </button>
            <button
              type="submit"
              disabled={isProcessing || !searchText.trim()}
              className={`flex items-center space-x-1.5 px-5 py-2 text-xs font-semibold rounded-lg shadow-md transition-all ${
                isMinimal
                  ? 'bg-black text-white hover:bg-neutral-800 disabled:opacity-50'
                  : isLcars
                  ? 'bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50'
                  : 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white disabled:opacity-50 shadow-sky-500/20'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.streamReplaceModal.replacing}</span>
                </>
              ) : (
                <>
                  <Replace className="w-3.5 h-3.5" />
                  <span>{t.streamReplaceModal.replaceButton}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
