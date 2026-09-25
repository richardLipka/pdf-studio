import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useDocument } from '../../context/DocumentContext';
import { ScanLine, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  DEFAULT_FLATTEN_OPTIONS,
  estimateFlattenedSize,
  FlattenColorMode,
  FlattenOptions,
} from '../../services/pdfFlattener';

interface FlattenModalProps {
  open: boolean;
  onClose: () => void;
}

const DPI_CHOICES = [100, 150, 200, 300];

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const FlattenModal: React.FC<FlattenModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { pages, isSaving, flattenAndDownload } = useDocument();
  const [options, setOptions] = useState<FlattenOptions>(DEFAULT_FLATTEN_OPTIONS);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<'done' | 'failed' | null>(null);
  const [running, setRunning] = useState(false);

  const estimate = useMemo(
    () => estimateFlattenedSize(pages.map((p) => ({ width: p.width, height: p.height })), options),
    [pages, options]
  );

  if (!open) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';
  const t2 = t.flattenModal;

  const handleStart = async () => {
    setRunning(true);
    setResult(null);
    setProgress(null);
    const ok = await flattenAndDownload(options, (done, total) => setProgress({ done, total }));
    setRunning(false);
    setResult(ok ? 'done' : 'failed');
  };

  const handleClose = () => {
    if (running) return;
    setResult(null);
    setProgress(null);
    onClose();
  };

  const panelClass = isMinimal
    ? 'rounded-2xl bg-white border-neutral-200 text-neutral-900'
    : isLcars
    ? 'rounded-2xl bg-black border-2 border-[#ff9900] text-[#ff9900] shadow-[0_0_25px_rgba(255,153,0,0.4)]'
    : 'rounded-2xl bg-slate-900 border-slate-700/80 text-white';
  const labelClass = `block text-xs font-semibold mb-2 ${
    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono uppercase' : 'text-slate-300'
  }`;
  const helpClass = `text-[11px] mt-1 ${isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`;
  const choiceClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
      active
        ? isMinimal
          ? 'bg-black text-white border-black'
          : isLcars
          ? 'bg-[#ff9900] text-black border-[#ff9900]'
          : 'bg-indigo-600 text-white border-indigo-500'
        : isMinimal
        ? 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
        : isLcars
        ? 'border-[#ff9900]/60 text-[#ff9900] hover:bg-[#ff9900]/15'
        : 'border-slate-700 text-slate-300 hover:bg-slate-800'
    }`;
  const colorModes: { value: FlattenColorMode; label: string }[] = [
    { value: 'color', label: t2.colorColor },
    { value: 'grayscale', label: t2.colorGray },
    { value: 'bw', label: t2.colorBw },
  ];
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  // Rendered at the document root: ancestors with backdrop filters would otherwise confine a fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="flatten-modal-title"
        className={`w-full max-w-lg max-h-[92vh] flex flex-col border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${panelClass}`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isMinimal ? 'border-neutral-200 bg-neutral-50/80' : isLcars ? 'border-[#ff9900]/40' : 'border-slate-800 bg-slate-950/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                isMinimal
                  ? 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                  : isLcars
                  ? 'bg-[#ff9900] text-black'
                  : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
              }`}
            >
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h2 id="flatten-modal-title" className="text-base font-bold">
                {t2.title}
              </h2>
              <p className={helpClass}>{t2.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={running}
            className="p-2 rounded-xl hover:bg-slate-500/15 disabled:opacity-40"
            aria-label={t2.cancel}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <span className={labelClass}>{t2.resolution}</span>
            <div className="flex flex-wrap gap-2">
              {DPI_CHOICES.map((dpi) => (
                <button
                  key={dpi}
                  type="button"
                  disabled={running}
                  onClick={() => setOptions((prev) => ({ ...prev, dpi }))}
                  className={choiceClass(options.dpi === dpi)}
                  aria-pressed={options.dpi === dpi}
                >
                  {dpi} DPI
                </button>
              ))}
            </div>
            <p className={helpClass}>{t2.resolutionHelp}</p>
          </div>

          <div>
            <span className={labelClass}>{t2.colorMode}</span>
            <div className="flex flex-wrap gap-2">
              {colorModes.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  disabled={running}
                  onClick={() => setOptions((prev) => ({ ...prev, colorMode: mode.value }))}
                  className={choiceClass(options.colorMode === mode.value)}
                  aria-pressed={options.colorMode === mode.value}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {options.colorMode !== 'bw' && (
            <div>
              <label className={labelClass} htmlFor="flatten-quality">
                {t2.quality}: {Math.round(options.jpegQuality * 100)} %
              </label>
              <input
                id="flatten-quality"
                type="range"
                min={50}
                max={100}
                step={5}
                disabled={running}
                value={Math.round(options.jpegQuality * 100)}
                onChange={(e) => setOptions((prev) => ({ ...prev, jpegQuality: Number(e.target.value) / 100 }))}
                className="w-full accent-indigo-500"
              />
            </div>
          )}

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={options.scanEffect}
              disabled={running}
              onChange={(e) => setOptions((prev) => ({ ...prev, scanEffect: e.target.checked }))}
              className="mt-0.5 accent-indigo-500"
            />
            <span>
              <span className="text-sm font-semibold">{t2.scanEffect}</span>
              <span className={`block ${helpClass}`}>{t2.scanEffectHelp}</span>
            </span>
          </label>

          <div
            className={`flex gap-2 p-3 rounded-xl text-xs border ${
              isMinimal
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : isLcars
                ? 'border-[#ffcc00]/50 text-[#ffcc00]'
                : 'bg-amber-950/40 border-amber-700/40 text-amber-200'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t2.warning}</span>
          </div>

          <p className={helpClass}>
            {t2.estimate}: ≈ {formatSize(estimate)} ({pages.length} × {options.dpi} DPI)
          </p>

          {(running || progress) && (
            <div aria-live="polite">
              <div className={`h-2 rounded-full overflow-hidden ${isMinimal ? 'bg-neutral-200' : 'bg-slate-800'}`}>
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className={helpClass}>
                {progress
                  ? t2.progress.replace('{current}', String(Math.min(progress.done + 1, progress.total))).replace('{total}', String(progress.total))
                  : t2.preparing}
              </p>
            </div>
          )}
          {result === 'done' && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400" role="status">
              <CheckCircle2 className="w-4 h-4" /> {t2.done}
            </p>
          )}
          {result === 'failed' && (
            <p className="flex items-center gap-1.5 text-xs text-rose-400" role="alert">
              <AlertTriangle className="w-4 h-4" /> {t2.failed}
            </p>
          )}
        </div>

        <div
          className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${
            isMinimal ? 'border-neutral-200 bg-neutral-50/80' : isLcars ? 'border-[#ff9900]/40' : 'border-slate-800 bg-slate-950/40'
          }`}
        >
          <button
            type="button"
            onClick={handleClose}
            disabled={running}
            className="px-4 py-2 text-sm font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
          >
            {t2.cancel}
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={running || isSaving || pages.length === 0}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 ${
              isMinimal
                ? 'bg-black text-white hover:bg-neutral-800'
                : isLcars
                ? 'bg-[#ff9900] text-black hover:bg-[#ffaa22] uppercase font-mono'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
            }`}
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
            {t2.start}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
