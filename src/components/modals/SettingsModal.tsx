import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { Sliders, X, RotateCcw, Check, Sparkles, Image, Cpu } from 'lucide-react';
import { RasterizationSettings, DEFAULT_RASTERIZATION_SETTINGS } from '../../types/document';

export const SettingsModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { isSettingsModalOpen, setIsSettingsModalOpen, rasterSettings, setRasterSettings, resetRasterSettings } = useEditor();

  const [tempSettings, setTempSettings] = useState<RasterizationSettings>(rasterSettings);

  // Sync temp settings whenever modal opens
  useEffect(() => {
    if (isSettingsModalOpen) {
      setTempSettings(rasterSettings);
    }
  }, [isSettingsModalOpen, rasterSettings]);

  if (!isSettingsModalOpen) return null;

  const handleSave = () => {
    setRasterSettings(tempSettings);
    setIsSettingsModalOpen(false);
  };

  const handleReset = () => {
    setTempSettings(DEFAULT_RASTERIZATION_SETTINGS);
    resetRasterSettings();
  };

  const handleClose = () => {
    setIsSettingsModalOpen(false);
  };

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full max-w-xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 border shadow-2xl overflow-hidden ${
          isMinimal
            ? 'rounded-2xl bg-white border-neutral-200 text-neutral-900'
            : isLcars
            ? 'rounded-2xl bg-black border-2 border-[#ff9900] shadow-[0_0_25px_rgba(255,153,0,0.4)] text-[#ff9900]'
            : 'rounded-2xl bg-slate-900 border-slate-700/80 text-white'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl flex items-center justify-center ${
                isMinimal
                  ? 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
              }`}
            >
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2
                className={`text-base font-bold tracking-wide ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900] uppercase font-mono' : 'text-white'
                }`}
              >
                {t.settings.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                }`}
              >
                {t.settings.subtitle}
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className={`p-2 rounded-xl transition-all ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#ff9900]/20 text-[#ff9900]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={t.settings.cancel}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section: Rasterization Info */}
          <div
            className={`p-4 rounded-xl border flex gap-3.5 items-start ${
              isMinimal
                ? 'bg-neutral-50 border-neutral-200 text-neutral-700'
                : isLcars
                ? 'bg-[#1a1400] border-[#ff9900]/30 text-[#ff9966]'
                : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
            }`}
          >
            <Cpu className="w-5 h-5 mt-0.5 shrink-0 text-sky-400" />
            <div className="space-y-1 text-xs leading-relaxed">
              <span className="font-semibold block text-sm text-foreground">
                {t.settings.rasterizationSection}
              </span>
              <p>{t.settings.rasterizationDesc}</p>
            </div>
          </div>

          {/* Option 1: Format */}
          <div className="space-y-3">
            <label
              className={`text-xs font-bold uppercase tracking-wider block ${
                isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
              }`}
            >
              {t.settings.formatLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* JPEG Option */}
              <button
                type="button"
                onClick={() => setTempSettings((prev) => ({ ...prev, format: 'image/jpeg' }))}
                className={`p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                  tempSettings.format === 'image/jpeg'
                    ? isMinimal
                      ? 'bg-sky-50 border-sky-500 shadow-sm ring-1 ring-sky-500'
                      : isLcars
                      ? 'bg-[#332200] border-[#ff9900] ring-1 ring-[#ff9900]'
                      : 'bg-sky-500/10 border-sky-500/80 ring-1 ring-sky-500/50 shadow-[0_0_15px_rgba(2,132,199,0.2)]'
                    : isMinimal
                    ? 'bg-white border-neutral-200 hover:border-neutral-300'
                    : isLcars
                    ? 'bg-black border-[#ff9900]/30 hover:border-[#ff9900]/60'
                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-sm flex items-center gap-2">
                    <Image className="w-4 h-4 text-sky-400" />
                    {t.settings.formatJpeg}
                  </span>
                  {tempSettings.format === 'image/jpeg' && (
                    <span className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <p className={`text-xs leading-normal ${isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`}>
                  {t.settings.formatJpegDesc}
                </p>
              </button>

              {/* PNG Option */}
              <button
                type="button"
                onClick={() => setTempSettings((prev) => ({ ...prev, format: 'image/png' }))}
                className={`p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                  tempSettings.format === 'image/png'
                    ? isMinimal
                      ? 'bg-sky-50 border-sky-500 shadow-sm ring-1 ring-sky-500'
                      : isLcars
                      ? 'bg-[#332200] border-[#ff9900] ring-1 ring-[#ff9900]'
                      : 'bg-sky-500/10 border-sky-500/80 ring-1 ring-sky-500/50 shadow-[0_0_15px_rgba(2,132,199,0.2)]'
                    : isMinimal
                    ? 'bg-white border-neutral-200 hover:border-neutral-300'
                    : isLcars
                    ? 'bg-black border-[#ff9900]/30 hover:border-[#ff9900]/60'
                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    {t.settings.formatPng}
                  </span>
                  {tempSettings.format === 'image/png' && (
                    <span className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <p className={`text-xs leading-normal ${isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`}>
                  {t.settings.formatPngDesc}
                </p>
              </button>
            </div>
          </div>

          {/* Option 2: Resolution / Scale */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label
                className={`text-xs font-bold uppercase tracking-wider block ${
                  isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
                }`}
              >
                {t.settings.scaleLabel}
              </label>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                  isMinimal
                    ? 'bg-sky-100 text-sky-800'
                    : isLcars
                    ? 'bg-[#ff9900] text-black font-mono font-bold'
                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                }`}
              >
                {tempSettings.scale.toFixed(1)}× ({Math.round(tempSettings.scale * 72)} DPI)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { scale: 1.0, label: '1.0× (72 DPI)', tag: 'Fast' },
                { scale: 1.5, label: '1.5× (108 DPI)', tag: 'Medium' },
                { scale: 2.0, label: '2.0× (144 DPI)', tag: 'Default' },
                { scale: 3.0, label: '3.0× (216 DPI)', tag: 'Print' },
              ].map((opt) => (
                <button
                  key={opt.scale}
                  type="button"
                  onClick={() => setTempSettings((prev) => ({ ...prev, scale: opt.scale }))}
                  className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                    tempSettings.scale === opt.scale
                      ? isMinimal
                        ? 'bg-sky-50 border-sky-500 shadow-sm font-semibold'
                        : isLcars
                        ? 'bg-[#ff9900] text-black font-bold font-mono'
                        : 'bg-sky-500/20 border-sky-500 text-white font-semibold shadow-[0_0_10px_rgba(2,132,199,0.3)]'
                      : isMinimal
                      ? 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                      : isLcars
                      ? 'bg-black border-[#ff9900]/30 text-[#ff9900] hover:bg-[#1a1400]'
                      : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-sm font-bold">{opt.scale.toFixed(1)}×</span>
                  <span className="text-[10px] opacity-75">{Math.round(opt.scale * 72)} DPI</span>
                </button>
              ))}
            </div>
          </div>

          {/* Option 3: JPEG Quality (only if JPEG selected) */}
          {tempSettings.format === 'image/jpeg' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <label
                    className={`text-xs font-bold uppercase tracking-wider block ${
                      isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
                    }`}
                  >
                    {t.settings.jpegQualityLabel}
                  </label>
                  <p className={`text-xs ${isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`}>
                    {t.settings.jpegQualityDesc}
                  </p>
                </div>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded-xl ${
                    isMinimal
                      ? 'bg-neutral-100 text-black border border-neutral-200'
                      : isLcars
                      ? 'bg-[#ff9900] text-black font-mono'
                      : 'bg-slate-800 text-sky-400 border border-slate-700'
                  }`}
                >
                  {Math.round(tempSettings.jpegQuality * 100)} %
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min="0.50"
                max="1.00"
                step="0.05"
                value={tempSettings.jpegQuality}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    jpegQuality: parseFloat(e.target.value),
                  }))
                }
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-700 accent-sky-500"
              />

              {/* Quick Presets */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {[
                  { q: 0.75, label: '75 %' },
                  { q: 0.85, label: '85 %' },
                  { q: 0.90, label: '90 % (Výchozí)' },
                  { q: 0.95, label: '95 %' },
                  { q: 1.00, label: '100 %' },
                ].map((p) => (
                  <button
                    key={p.q}
                    type="button"
                    onClick={() => setTempSettings((prev) => ({ ...prev, jpegQuality: p.q }))}
                    className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all ${
                      Math.abs(tempSettings.jpegQuality - p.q) < 0.01
                        ? isMinimal
                          ? 'bg-sky-50 border-sky-500 font-bold text-sky-700'
                          : isLcars
                          ? 'bg-[#ff9900] text-black font-bold font-mono'
                          : 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : isMinimal
                        ? 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                        : isLcars
                        ? 'bg-black border-[#ff9900]/30 text-[#ff9966] hover:bg-[#1a1400]'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-t ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          {/* Left: Reset Defaults */}
          <button
            type="button"
            onClick={handleReset}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isMinimal
                ? 'text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900'
                : isLcars
                ? 'text-[#ff9966] hover:bg-[#ff9900]/20 font-mono'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            {t.settings.resetDefaults}
          </button>

          {/* Right: Cancel + Save */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                isMinimal
                  ? 'text-neutral-600 hover:bg-neutral-100'
                  : isLcars
                  ? 'text-[#ff9966] hover:bg-[#ff9900]/20 font-mono'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {t.settings.cancel}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition-all ${
                isMinimal
                  ? 'bg-black text-white hover:bg-neutral-800'
                  : isLcars
                  ? 'bg-[#ff9900] text-black hover:bg-[#ffaa22] font-mono uppercase tracking-wider'
                  : 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white hover:from-sky-400 hover:to-indigo-500 shadow-sky-500/20'
              }`}
            >
              <Check className="w-4 h-4" />
              {t.settings.saveClose}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
