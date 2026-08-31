import React from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Maximize2,
} from 'lucide-react';

export const StatusBar: React.FC = () => {
  const { t } = useI18n();
  const {
    pages,
    activePageIndex,
    setActivePageIndex,
    scale,
    setScale,
    zoomToFitPage,
    zoomToFitWidth,
  } = useDocument();

  const handlePrevPage = () => {
    if (activePageIndex > 0) setActivePageIndex(activePageIndex - 1);
  };

  const handleNextPage = () => {
    if (activePageIndex < pages.length - 1) setActivePageIndex(activePageIndex + 1);
  };

  const zoomPercent = Math.round(scale * 100);

  return (
    <footer className="h-10 bg-slate-900 border-t border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 select-none z-20">
      {/* Page Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={handlePrevPage}
          disabled={activePageIndex === 0}
          className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="font-medium text-slate-200">
          {t.app.page} <span className="text-sky-400 font-bold">{activePageIndex + 1}</span> {t.app.of}{' '}
          {pages.length}
        </span>

        <button
          onClick={handleNextPage}
          disabled={activePageIndex >= pages.length - 1}
          className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Helper text */}
      <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-400">
        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
        <span>{t.app.privacyBadge}</span>
      </div>

      {/* Zoom Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.15).toFixed(2))))}
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
          title={`${t.app.zoomOut} (Ctrl + -)`}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <span className="w-12 text-center font-mono font-medium text-slate-300">
          {zoomPercent}%
        </span>

        <button
          onClick={() => setScale((s) => Math.min(3.0, Number((s + 0.15).toFixed(2))))}
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
          title={`${t.app.zoomIn} (Ctrl + +)`}
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <div className="h-3.5 w-px bg-slate-700 mx-1" />

        {/* Dynamic Zoom to Selected Page */}
        <button
          onClick={() => zoomToFitPage(activePageIndex)}
          className="px-2 py-0.5 rounded hover:bg-slate-800 text-sky-400 hover:text-sky-300 text-[11px] font-medium flex items-center gap-1 bg-sky-950/40 border border-sky-800/40"
          title={`${t.app.fitSelected} (Ctrl + 0)`}
        >
          <Maximize2 className="w-3 h-3" />
          <span>{t.app.fitSelected}</span>
        </button>

        <button
          onClick={() => zoomToFitPage()}
          className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 text-[11px]"
          title={t.app.fitPage}
        >
          {t.app.fitPage}
        </button>

        <button
          onClick={() => zoomToFitWidth()}
          className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 text-[11px]"
          title={t.app.fitWidth}
        >
          {t.app.fitWidth}
        </button>
      </div>
    </footer>
  );
};
