import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { logger, LogEntry } from '../../services/logger';
import {
  X,
  Copy,
  Check,
  Trash2,
  Search,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Clock,
} from 'lucide-react';

export const LogModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { isLogModalOpen, setIsLogModalOpen } = useEditor();

  const [logs, setLogs] = useState<LogEntry[]>(() => logger.getLogs());
  const [activeFilter, setActiveFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = logger.subscribe((newLogs) => {
      setLogs(newLogs);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isLogModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsLogModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLogModalOpen, setIsLogModalOpen]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const counts = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let info = 0;
    for (const log of logs) {
      if (log.level === 'error') errors++;
      else if (log.level === 'warn') warns++;
      else info++;
    }
    return { all: logs.length, error: errors, warn: warns, info };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (activeFilter === 'error' && log.level !== 'error') return false;
      if (activeFilter === 'warn' && log.level !== 'warn') return false;
      if (activeFilter === 'info' && (log.level === 'error' || log.level === 'warn')) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = log.title.toLowerCase().includes(q);
        const matchCategory = log.category.toLowerCase().includes(q);
        const matchDetails = log.details?.toLowerCase().includes(q);
        return matchTitle || matchCategory || matchDetails;
      }
      return true;
    });
  }, [logs, activeFilter, searchQuery]);

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => {
        const time = new Date(l.timestamp).toISOString();
        let out = `[${time}] [${l.level.toUpperCase()}] [${l.category.toUpperCase()}] ${l.title}`;
        if (l.details) {
          out += `\nDetails: ${l.details}`;
        }
        return out;
      })
      .join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClearLogs = () => {
    logger.clear();
    setLogs([]);
    setExpandedLogIds(new Set());
  };

  if (!isLogModalOpen) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const formatTimestamp = (date: Date) => {
    const d = new Date(date);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'load':
        return t.logModal.categoryLoad;
      case 'save':
        return t.logModal.categorySave;
      case 'render':
        return t.logModal.categoryRender;
      default:
        return t.logModal.categorySystem;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn select-none">
      <div
        className={`w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border transition-colors ${
          isMinimal
            ? 'bg-white border-neutral-300 text-black'
            : isLcars
            ? 'bg-black border-[#ff9900] text-[#ff9900]'
            : 'bg-slate-900 border-slate-700 text-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b flex items-center justify-between ${
            isMinimal
              ? 'bg-neutral-50 border-neutral-200'
              : isLcars
              ? 'bg-[#111111] border-[#ff9900]'
              : 'bg-slate-800/80 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                isMinimal
                  ? 'bg-black text-white'
                  : isLcars
                  ? 'bg-[#ff9900] text-black rounded-full'
                  : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
              }`}
            >
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold tracking-wide">{t.logModal.title}</h2>
                {counts.error > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    {counts.error} {t.logModal.tabErrors.toLowerCase()}
                  </span>
                )}
                {counts.warn > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {counts.warn} {t.logModal.tabWarnings.toLowerCase()}
                  </span>
                )}
              </div>
              <p
                className={`text-xs mt-0.5 ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#99ccff]' : 'text-slate-400'
                }`}
              >
                {t.logModal.subtitle}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsLogModalOpen(false)}
            className={`p-2 rounded-xl transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-200 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#ff9900]/20 text-[#ff9900]'
                : 'hover:bg-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Zavřít (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div
          className={`px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
            isMinimal
              ? 'bg-white border-neutral-200'
              : isLcars
              ? 'bg-black border-[#ff9900]'
              : 'bg-slate-900 border-slate-800'
          }`}
        >
          {/* Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/10 dark:bg-slate-800/60 border border-slate-700/30">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                activeFilter === 'all'
                  ? isMinimal
                    ? 'bg-black text-white shadow-sm'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-bold'
                    : 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : isMinimal
                  ? 'text-neutral-600 hover:bg-neutral-200'
                  : isLcars
                  ? 'text-[#ff9900] hover:bg-[#222]'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              {t.logModal.tabAll} ({counts.all})
            </button>

            <button
              onClick={() => setActiveFilter('error')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                activeFilter === 'error'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 font-bold'
                  : 'text-rose-400 hover:bg-rose-500/10'
              }`}
            >
              {t.logModal.tabErrors} ({counts.error})
            </button>

            <button
              onClick={() => setActiveFilter('warn')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                activeFilter === 'warn'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 font-bold'
                  : 'text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              {t.logModal.tabWarnings} ({counts.warn})
            </button>

            <button
              onClick={() => setActiveFilter('info')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                activeFilter === 'info'
                  ? isMinimal
                    ? 'bg-black text-white shadow-sm'
                    : isLcars
                    ? 'bg-[#99ccff] text-black font-bold'
                    : 'bg-slate-700 text-white font-bold'
                  : isMinimal
                  ? 'text-neutral-600 hover:bg-neutral-200'
                  : isLcars
                  ? 'text-[#99ccff] hover:bg-[#222]'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              {t.logModal.tabInfo} ({counts.info})
            </button>
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.logModal.searchPlaceholder}
                className={`pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-all w-44 sm:w-56 ${
                  isMinimal
                    ? 'bg-neutral-50 border-neutral-300 focus:border-black text-black'
                    : isLcars
                    ? 'bg-[#111] border-[#ff9900] text-[#ff9900] focus:border-[#ffff66]'
                    : 'bg-slate-800 border-slate-700 focus:border-sky-500 text-white'
                }`}
              />
            </div>

            <button
              onClick={handleCopyLogs}
              disabled={logs.length === 0}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl border flex items-center gap-1.5 transition-all disabled:opacity-30 ${
                isMinimal
                  ? 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-black'
                  : isLcars
                  ? 'bg-[#222] hover:bg-[#ff9900] hover:text-black border-[#ff9900] text-[#ff9900]'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title={t.logModal.copyLogs}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t.logModal.copied : t.logModal.copyLogs}</span>
            </button>

            <button
              onClick={handleClearLogs}
              disabled={logs.length === 0}
              className={`p-1.5 text-xs rounded-xl border transition-all disabled:opacity-30 ${
                isMinimal
                  ? 'hover:bg-rose-50 text-rose-600 border-neutral-200'
                  : isLcars
                  ? 'hover:bg-rose-900/30 text-rose-400 border-[#ff9900]'
                  : 'hover:bg-rose-500/20 text-rose-400 border-slate-700'
              }`}
              title={t.logModal.clearLogs}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Logs List Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 max-h-[55vh] min-h-[220px] font-sans text-xs">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <CheckCircle2
                className={`w-12 h-12 mb-3 opacity-30 ${
                  isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]' : 'text-slate-500'
                }`}
              />
              <h3 className="font-semibold text-sm">{t.logModal.emptyTitle}</h3>
              <p
                className={`text-xs mt-1 max-w-sm ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#99ccff]' : 'text-slate-400'
                }`}
              >
                {t.logModal.emptyDesc}
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogIds.has(log.id);
              const isError = log.level === 'error';
              const isWarn = log.level === 'warn';
              const isSuccess = log.level === 'success';

              return (
                <div
                  key={log.id}
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isMinimal
                      ? isError
                        ? 'bg-rose-50/70 border-rose-300'
                        : isWarn
                        ? 'bg-amber-50/70 border-amber-300'
                        : 'bg-neutral-50 border-neutral-200'
                      : isLcars
                      ? isError
                        ? 'bg-rose-950/40 border-rose-500'
                        : isWarn
                        ? 'bg-amber-950/40 border-amber-500'
                        : 'bg-[#111] border-[#333]'
                      : isError
                      ? 'bg-rose-950/30 border-rose-800/60'
                      : isWarn
                      ? 'bg-amber-950/30 border-amber-800/60'
                      : 'bg-slate-800/50 border-slate-700/60'
                  }`}
                >
                  <div
                    onClick={() => log.details && toggleExpand(log.id)}
                    className={`px-4 py-2.5 flex items-start gap-3 select-text ${
                      log.details ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5' : ''
                    }`}
                  >
                    {/* Level Icon */}
                    <div className="mt-0.5 shrink-0">
                      {isError ? (
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                      ) : isWarn ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      ) : isSuccess ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Info className="w-4 h-4 text-sky-400" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        {/* Level badge */}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isError
                              ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400'
                              : isWarn
                              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                              : isSuccess
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                          }`}
                        >
                          {log.level}
                        </span>

                        {/* Category badge */}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isMinimal
                              ? 'bg-neutral-200 text-neutral-700'
                              : isLcars
                              ? 'bg-[#222] text-[#99ccff]'
                              : 'bg-slate-700/70 text-slate-300'
                          }`}
                        >
                          {getCategoryLabel(log.category)}
                        </span>

                        {/* Timestamp */}
                        <span
                          className={`text-[11px] font-mono flex items-center gap-1 ${
                            isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#ff9900]/70' : 'text-slate-400'
                          }`}
                        >
                          <Clock className="w-3 h-3 opacity-60" />
                          {formatTimestamp(log.timestamp)}
                        </span>
                      </div>

                      <p className="font-semibold text-xs leading-relaxed text-inherit">{log.title}</p>
                    </div>

                    {/* Expand toggle */}
                    {log.details && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(log.id);
                        }}
                        className="mt-0.5 text-xs opacity-60 hover:opacity-100 transition-opacity p-0.5"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    )}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && log.details && (
                    <div
                      className={`px-4 py-3 border-t font-mono text-[11px] select-text overflow-x-auto whitespace-pre-wrap ${
                        isMinimal
                          ? 'bg-neutral-100/90 border-neutral-200 text-neutral-800'
                          : isLcars
                          ? 'bg-black border-[#ff9900]/50 text-[#ffff66]'
                          : 'bg-slate-950/70 border-slate-700/60 text-slate-300'
                      }`}
                    >
                      {log.details}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-3 border-t flex items-center justify-between text-xs ${
            isMinimal
              ? 'bg-neutral-50 border-neutral-200 text-neutral-500'
              : isLcars
              ? 'bg-[#111] border-[#ff9900] text-[#99ccff]'
              : 'bg-slate-800/80 border-slate-700 text-slate-400'
          }`}
        >
          <span>
            {logs.length} {t.logModal.tabAll.toLowerCase()}
          </span>

          <button
            onClick={() => setIsLogModalOpen(false)}
            className={`px-4 py-1.5 rounded-xl font-medium transition-all ${
              isMinimal
                ? 'bg-black text-white hover:bg-neutral-800'
                : isLcars
                ? 'bg-[#ff9900] text-black font-bold hover:bg-[#ffaa22]'
                : 'bg-sky-600 text-white hover:bg-sky-500 shadow-md shadow-sky-600/30'
            }`}
          >
            {t.confirmModal.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};
