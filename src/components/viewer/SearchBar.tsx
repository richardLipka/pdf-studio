import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { searchPdfDocument } from '../../services/pdfSearchService';
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
  GripVertical,
} from 'lucide-react';

export const SearchBar: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchCaseSensitive,
    setSearchCaseSensitive,
    searchWholeWord,
    setSearchWholeWord,
    searchResults,
    setSearchResults,
    activeSearchMatchIndex,
    setActiveSearchMatchIndex,
    isSearching,
    setIsSearching,
    nextSearchMatch,
    prevSearchMatch,
  } = useEditor();

  const { pages, sources, setActivePageIndex } = useDocument();

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  // Only the latest search may publish its results (an older, slower one finishing later must not)
  const searchRunRef = useRef(0);

  // The bar can be dragged aside by its handle so it does not cover the matches
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.baseX + e.clientX - drag.startX, y: Math.max(-8, drag.baseY + e.clientY - drag.startY) });
  };
  const handleDragEnd = () => {
    dragRef.current = null;
  };

  // Auto-focus input when opened
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isSearchOpen]);

  // Execute search when query or options change
  const executeSearch = useCallback(
    async (queryText: string, caseSens: boolean, wholeW: boolean) => {
      const run = ++searchRunRef.current;
      const trimmed = queryText.trim();
      if (!trimmed || pages.length === 0) {
        setSearchResults([]);
        setActiveSearchMatchIndex(0);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const matches = await searchPdfDocument(pages, sources, trimmed, {
          caseSensitive: caseSens,
          wholeWord: wholeW,
        });
        if (run !== searchRunRef.current) return;
        // The effect below navigates to the first match
        setSearchResults(matches);
        setActiveSearchMatchIndex(0);
      } catch (err) {
        if (run !== searchRunRef.current) return;
        console.warn('Search execution failed:', err);
        setSearchResults([]);
      } finally {
        if (run === searchRunRef.current) setIsSearching(false);
      }
    },
    [pages, sources, setSearchResults, setActiveSearchMatchIndex, setIsSearching]
  );

  // Debounced search trigger on typing
  useEffect(() => {
    if (!isSearchOpen) return;

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      executeSearch(searchQuery, searchCaseSensitive, searchWholeWord);
    }, 150);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, searchCaseSensitive, searchWholeWord, isSearchOpen, executeSearch]);

  // Brings the active match into view: the match itself when its page is rendered, otherwise the page
  // first and the match once its highlight exists
  useEffect(() => {
    const activeMatch = searchResults[activeSearchMatchIndex];
    if (!activeMatch) return;
    const findHighlight = () =>
      document.querySelector<HTMLElement>(`[data-search-match="${CSS.escape(activeMatch.id)}"]`);
    const highlight = findHighlight();
    if (highlight) {
      setActivePageIndex(activeMatch.pageIndex, { scrollIntoView: false });
      highlight.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      return;
    }
    setActivePageIndex(activeMatch.pageIndex);
    const timer = window.setTimeout(() => {
      findHighlight()?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeSearchMatchIndex, searchResults, setActivePageIndex]);

  // Every opening starts with the bar at its default place
  useEffect(() => {
    if (!isSearchOpen) setOffset({ x: 0, y: 0 });
  }, [isSearchOpen]);

  // Keyboard navigation inside search input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsSearchOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        prevSearchMatch();
      } else {
        nextSearchMatch();
      }
    }
  };

  if (!isSearchOpen) return null;

  const hasMatches = searchResults.length > 0;
  const matchCountText = hasMatches
    ? t.search.matchCount
        .replace('{current}', String(activeSearchMatchIndex + 1))
        .replace('{total}', String(searchResults.length))
    : searchQuery.trim().length > 0 && !isSearching
    ? t.search.noMatches
    : '';

  return (
    <div
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={`absolute top-4 right-6 z-30 flex items-center gap-1.5 p-1.5 rounded-xl border shadow-xl transition-colors duration-150 animate-in fade-in slide-in-from-top-2 ${
        isMinimal
          ? 'bg-white border-neutral-300 text-black shadow-neutral-400/30'
          : isLcars
          ? 'bg-black border-2 border-[#ff9900] text-[#ff9900] shadow-[0_0_20px_rgba(255,153,0,0.4)]'
          : 'bg-slate-900/95 border-slate-700/80 text-slate-100 shadow-2xl shadow-black/60 backdrop-blur-md'
      }`}
    >
      {/* Drag handle */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className={`self-stretch flex items-center cursor-grab active:cursor-grabbing touch-none ${
          isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]/70' : 'text-slate-500'
        }`}
        title={t.search.dragHandle}
        aria-label={t.search.dragHandle}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Search Input Container */}
      <div className="relative flex items-center">
        <Search
          className={`w-4 h-4 ml-2 absolute pointer-events-none ${
            isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]' : 'text-slate-400'
          }`}
        />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.search.placeholder}
          className={`w-48 sm:w-60 pl-8 pr-16 py-1.5 text-xs rounded-lg border outline-none transition-colors ${
            isMinimal
              ? 'bg-neutral-50 border-neutral-300 text-black placeholder:text-neutral-400 focus:border-black focus:bg-white'
              : isLcars
              ? 'bg-[#111111] border-[#ff9900]/60 text-[#ffcc00] placeholder:text-[#996600] focus:border-[#ff9900]'
              : 'bg-slate-950/70 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950'
          }`}
        />

        {/* Status / Match count indicator inside input */}
        <div className="absolute right-2 flex items-center gap-1 pointer-events-none">
          {isSearching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
          ) : (
            matchCountText && (
              <span
                className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  hasMatches
                    ? isMinimal
                      ? 'bg-neutral-200 text-neutral-800'
                      : isLcars
                      ? 'bg-[#222222] text-[#ff9900]'
                      : 'bg-slate-800 text-sky-300'
                    : 'text-rose-400'
                }`}
              >
                {matchCountText}
              </span>
            )
          )}
        </div>
      </div>

      {/* Navigation Buttons: Previous / Next */}
      <div className="flex items-center gap-0.5 border-l pl-1 border-neutral-200 dark:border-slate-800">
        <button
          onClick={prevSearchMatch}
          disabled={!hasMatches}
          className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${
            isMinimal
              ? 'hover:bg-neutral-100 text-black'
              : isLcars
              ? 'hover:bg-[#222222] text-[#ff9900]'
              : 'hover:bg-slate-800 text-slate-300 hover:text-white'
          }`}
          title={t.search.previous}
          aria-label={t.search.previous}
        >
          <ChevronUp className="w-4 h-4" />
        </button>

        <button
          onClick={nextSearchMatch}
          disabled={!hasMatches}
          className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${
            isMinimal
              ? 'hover:bg-neutral-100 text-black'
              : isLcars
              ? 'hover:bg-[#222222] text-[#ff9900]'
              : 'hover:bg-slate-800 text-slate-300 hover:text-white'
          }`}
          title={t.search.next}
          aria-label={t.search.next}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Search Options: Case Sensitivity & Whole Words */}
      <div className="flex items-center gap-0.5 border-l pl-1 border-neutral-200 dark:border-slate-800">
        <button
          onClick={() => setSearchCaseSensitive((prev) => !prev)}
          className={`px-1.5 py-1 rounded text-[11px] font-bold font-mono transition-colors ${
            searchCaseSensitive
              ? isMinimal
                ? 'bg-black text-white'
                : isLcars
                ? 'bg-[#ff9900] text-black'
                : 'bg-sky-600 text-white'
              : isMinimal
              ? 'hover:bg-neutral-100 text-neutral-500'
              : isLcars
              ? 'hover:bg-[#111111] text-[#99ccff]'
              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={t.search.caseSensitive}
        >
          Aa
        </button>

        <button
          onClick={() => setSearchWholeWord((prev) => !prev)}
          className={`px-1.5 py-1 rounded text-[11px] font-bold font-mono transition-colors ${
            searchWholeWord
              ? isMinimal
                ? 'bg-black text-white'
                : isLcars
                ? 'bg-[#ff9900] text-black'
                : 'bg-sky-600 text-white'
              : isMinimal
              ? 'hover:bg-neutral-100 text-neutral-500'
              : isLcars
              ? 'hover:bg-[#111111] text-[#99ccff]'
              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={t.search.wholeWord}
        >
          \b
        </button>
      </div>

      {/* Close Button */}
      <button
        onClick={() => setIsSearchOpen(false)}
        className={`p-1.5 rounded-md border-l pl-1 transition-colors ${
          isMinimal
            ? 'hover:bg-neutral-100 text-neutral-600 hover:text-black border-neutral-200'
            : isLcars
            ? 'hover:bg-[#222222] text-[#ff9900] border-[#333333]'
            : 'hover:bg-slate-800 text-slate-400 hover:text-white border-slate-800'
        }`}
        title={t.search.close}
        aria-label={t.search.close}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
