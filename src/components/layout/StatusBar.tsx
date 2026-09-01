import React from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { logger } from '../../services/logger';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';

export const StatusBar: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    pages,
    activePageIndex,
    setActivePageIndex,
    scale,
    setScale,
    zoomToFitPage,
    zoomToFitWidth,
  } = useDocument();

  const { toggleLogModal } = useEditor();

  const [issueCount, setIssueCount] = React.useState<{ warns: number; errors: number; totalIssues: number }>({
    warns: 0,
    errors: 0,
    totalIssues: 0,
  });

  React.useEffect(() => {
    return logger.subscribe(() => {
      setIssueCount(logger.getWarningAndErrorCount());
    });
  }, []);

  const handlePrevPage = () => {
    if (activePageIndex > 0) setActivePageIndex(activePageIndex - 1);
  };

  const handleNextPage = () => {
    if (activePageIndex < pages.length - 1) setActivePageIndex(activePageIndex + 1);
  };

  const hasPages = pages.length > 0;
  const zoomPercent = Math.round(scale * 100);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <footer
      className={`h-10 border-t px-4 flex items-center justify-between text-xs select-none z-20 transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-neutral-600'
          : isLcars
          ? 'bg-black border-[#ff9966] text-[#99ccff]'
          : 'bg-slate-900 border-slate-800 text-slate-400'
      }`}
    >
      {/* Left: Page Navigation when doc loaded, or Privacy badge on first page */}
      <div className="flex items-center gap-2 min-w-[140px]">
        {hasPages ? (
          <>
            <button
              onClick={handlePrevPage}
              disabled={activePageIndex === 0}
              className={`p-1 rounded disabled:opacity-30 transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-100 text-black'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9900]'
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span
              className={`font-medium ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
              }`}
            >
              {t.app.page}{' '}
              <span
                className={`font-bold ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ffff66]' : 'text-sky-400'
                }`}
              >
                {activePageIndex + 1}
              </span>{' '}
              {t.app.of} {pages.length}
            </span>

            <button
              onClick={handleNextPage}
              disabled={activePageIndex >= pages.length - 1}
              className={`p-1 rounded disabled:opacity-30 transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-100 text-black'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9900]'
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div
            className={`flex items-center gap-1.5 text-[11px] ${
              isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#99ccff]' : 'text-slate-400'
            }`}
          >
            <ShieldCheck
              className={`w-3.5 h-3.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-emerald-400'
              }`}
            />
            <span className="hidden sm:inline font-medium">100% Client-Side Privacy</span>
          </div>
        )}
      </div>

      {/* Center: Author Copyright, Email & FAV ZČU Logo */}
      <div
        className={`flex items-center gap-3 text-[11px] ${
          isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#99ccff]' : 'text-slate-400'
        }`}
      >
        <a
          href="https://www.fav.zcu.cz/cs/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          title="Fakulta aplikovaných věd ZČU v Plzni (https://www.fav.zcu.cz/cs/)"
        >
          <img src="/fav-logo.svg" alt="FAV ZČU" className="h-5 object-contain" />
        </a>

        <span
          className={`select-none ${
            isMinimal ? 'text-neutral-300' : isLcars ? 'text-[#ff9900]' : 'text-slate-700'
          }`}
        >
          •
        </span>

        <span className="flex items-center gap-1">
          <span>©</span>
          <a
            href="https://home.zcu.cz/~lipka/"
            target="_blank"
            rel="noopener noreferrer"
            className={`font-semibold hover:underline transition-colors ${
              isMinimal
                ? 'text-black hover:text-neutral-600'
                : isLcars
                ? 'text-[#ff9966] hover:text-[#ff9900]'
                : 'text-slate-300 hover:text-sky-400'
            }`}
            title="Richard Lipka (https://home.zcu.cz/~lipka/)"
          >
            Richard Lipka
          </a>
        </span>

        <span
          className={`select-none ${
            isMinimal ? 'text-neutral-300' : isLcars ? 'text-[#ff9900]' : 'text-slate-700'
          }`}
        >
          •
        </span>

        <a
          href="mailto:lipka@fav.zcu.cz"
          className={`transition-colors flex items-center gap-1 font-mono text-[10.5px] ${
            isMinimal
              ? 'text-neutral-700 hover:text-black'
              : isLcars
              ? 'text-[#cc99cc] hover:text-[#ff9900]'
              : 'text-slate-400 hover:text-amber-400'
          }`}
          title="Napsat e-mail: lipka@fav.zcu.cz"
        >
          <span>lipka@fav.zcu.cz</span>
        </a>

        <span
          className={`hidden sm:inline select-none ${
            isMinimal ? 'text-neutral-300' : isLcars ? 'text-[#ff9900]' : 'text-slate-700'
          }`}
        >
          •
        </span>

        {/* Log / Diagnostics Quick Status */}
        <button
          onClick={toggleLogModal}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
            issueCount.errors > 0
              ? isMinimal
                ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                : isLcars
                ? 'bg-rose-950/60 text-rose-400 border border-rose-500 hover:bg-rose-900/60'
                : 'bg-rose-950/40 text-rose-300 border border-rose-800/60 hover:bg-rose-900/60'
              : issueCount.warns > 0
              ? isMinimal
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                : isLcars
                ? 'bg-amber-950/60 text-amber-400 border border-amber-500 hover:bg-amber-900/60'
                : 'bg-amber-950/40 text-amber-300 border border-amber-800/60 hover:bg-amber-900/60'
              : isMinimal
              ? 'text-neutral-500 hover:text-black hover:bg-neutral-100'
              : isLcars
              ? 'text-[#99ccff] hover:text-[#ffff66] hover:bg-[#222]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title={t.logModal.buttonTooltip}
        >
          <ScrollText className="w-3 h-3" />
          <span>
            {issueCount.errors > 0
              ? `${issueCount.errors} ${t.logModal.tabErrors.toLowerCase()}`
              : issueCount.warns > 0
              ? `${issueCount.warns} ${t.logModal.tabWarnings.toLowerCase()}`
              : t.logModal.allOk}
          </span>
        </button>
      </div>

      {/* Right: Zoom Controls when doc loaded, or subtle status on first page */}
      <div className="flex items-center gap-1.5 min-w-[140px] justify-end">
        {hasPages ? (
          <>
            <button
              onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.15).toFixed(2))))}
              className={`p-1 rounded transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-100 text-black'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9900]'
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
              title={`${t.app.zoomOut} (Ctrl + -)`}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <span
              className={`w-12 text-center font-mono font-medium ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
              }`}
            >
              {zoomPercent}%
            </span>

            <button
              onClick={() => setScale((s) => Math.min(3.0, Number((s + 0.15).toFixed(2))))}
              className={`p-1 rounded transition-colors ${
                isMinimal
                  ? 'hover:bg-neutral-100 text-black'
                  : isLcars
                  ? 'hover:bg-[#222222] text-[#ff9900]'
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
              title={`${t.app.zoomIn} (Ctrl + +)`}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div
              className={`h-3.5 w-px mx-1 ${
                isMinimal ? 'bg-neutral-200' : isLcars ? 'bg-[#333333]' : 'bg-slate-700'
              }`}
            />

            {/* Fit Width */}
            <button
              onClick={() => zoomToFitWidth()}
              className={`px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#99ccff] border-[#99ccff]'
                  : 'rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title={t.app.fitWidth}
            >
              {t.app.fitWidth}
            </button>

            {/* Fit Page */}
            <button
              onClick={() => zoomToFitPage()}
              className={`px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9966] border-[#ff9966]'
                  : 'rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title={t.app.fitPage}
            >
              <Maximize2 className="w-3 h-3 inline mr-1" />
              {t.app.fitPage}
            </button>

            {/* Fit Selected */}
            <button
              onClick={() => zoomToFitPage(activePageIndex)}
              className={`px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                isMinimal
                  ? 'rounded-md bg-neutral-100 hover:bg-neutral-200 text-black border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-black hover:bg-[#111111] text-[#ffcc00] border-[#ffcc00]'
                  : 'rounded bg-sky-950/80 hover:bg-sky-900 text-sky-300 border-sky-800/80'
              }`}
              title={`${t.app.fitSelected} (Ctrl + 0)`}
            >
              {t.app.fitSelected}
            </button>
          </>
        ) : (
          <span
            className={`text-[11px] font-mono ${
              isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9966]' : 'text-slate-500'
            }`}
          >
            v1.0.0
          </span>
        )}
      </div>
    </footer>
  );
};
