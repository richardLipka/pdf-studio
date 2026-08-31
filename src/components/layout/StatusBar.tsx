import React from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
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

      {/* Center: Author Copyright, Email & FAV ZČU Logo */}
      <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400">
        <a
          href="https://www.fav.zcu.cz/cs/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          title="Fakulta aplikovaných věd ZČU v Plzni (https://www.fav.zcu.cz/cs/)"
        >
          <img src="/fav-logo.svg" alt="FAV ZČU" className="h-5 object-contain" />
        </a>

        <span className="text-slate-700 select-none">•</span>

        <span className="flex items-center gap-1">
          <span>©</span>
          <a
            href="https://home.zcu.cz/~lipka/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 font-semibold hover:text-sky-400 hover:underline transition-colors"
            title="Richard Lipka (https://home.zcu.cz/~lipka/)"
          >
            Richard Lipka
          </a>
        </span>

        <span className="text-slate-700 select-none">•</span>

        <a
          href="mailto:lipka@fav.zcu.cz"
          className="text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1 font-mono text-[10.5px]"
          title="Napsat e-mail: lipka@fav.zcu.cz"
        >
          <span>lipka@fav.zcu.cz</span>
        </a>
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
