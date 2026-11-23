import React, { useState, useEffect } from 'react';
import { Lock, Unlock, RotateCw, Palette } from 'lucide-react';
import type { TranslationSchema } from '../../../types/i18n';
import type { PdfRect } from '../../../services/pdfElementTransform';

export interface ElementGeometryControlsProps {
  kind: 'text' | 'image';
  origRect: PdfRect;
  /** Current effective font size in pt (text blocks only) */
  initialFontSizePt?: number;
  isMinimal: boolean;
  isLcars: boolean;
  isSaving: boolean;
  isDisabled: boolean;
  inputClass: string;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  t: TranslationSchema;
  onApplyTransform: (rect: PdfRect, rotationDeg: number) => Promise<void>;
  onApplyReflow?: (newWidthPt: number, deltaPdfX: number, deltaPdfY: number) => Promise<void>;
  onApplyTextStyle?: (style: { fontSizePt?: number; hexColor?: string }) => Promise<void>;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

const QUICK_TEXT_COLORS = ['#000000', '#1e293b', '#dc2626', '#1d4ed8', '#15803d', '#7c3aed'];

export const ElementGeometryControls: React.FC<ElementGeometryControlsProps> = ({
  kind,
  origRect,
  initialFontSizePt,
  isMinimal,
  isLcars,
  isSaving,
  isDisabled,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  t,
  onApplyTransform,
  onApplyReflow,
  onApplyTextStyle,
}) => {
  const [draft, setDraft] = useState({
    x: fmt(origRect.x),
    y: fmt(origRect.y),
    w: fmt(origRect.width),
    h: fmt(origRect.height),
    angle: '0',
  });
  const [lockAspect, setLockAspect] = useState(true);
  const [textMode, setTextMode] = useState<'scale' | 'reflow'>('scale');
  const [fontSizeDraft, setFontSizeDraft] = useState(
    initialFontSizePt ? String(Math.round(initialFontSizePt * 10) / 10) : '12'
  );
  const [colorDraft, setColorDraft] = useState('#000000');

  useEffect(() => {
    setDraft({
      x: fmt(origRect.x),
      y: fmt(origRect.y),
      w: fmt(origRect.width),
      h: fmt(origRect.height),
      angle: '0',
    });
  }, [origRect.x, origRect.y, origRect.width, origRect.height]);

  useEffect(() => {
    if (initialFontSizePt && Number.isFinite(initialFontSizePt)) {
      setFontSizeDraft(String(Math.round(initialFontSizePt * 10) / 10));
    }
  }, [initialFontSizePt]);

  const handleFieldChange = (field: 'x' | 'y' | 'w' | 'h' | 'angle', raw: string) => {
    setDraft((prev) => {
      const next = { ...prev, [field]: raw };
      const shouldLock = lockAspect && (kind === 'image' || textMode === 'scale');
      if (shouldLock && origRect.width > 0 && origRect.height > 0 && (field === 'w' || field === 'h')) {
        const val = parseFloat(raw);
        if (Number.isFinite(val) && val > 0) {
          const aspect = origRect.width / origRect.height;
          if (field === 'w') next.h = fmt(val / aspect);
          else next.w = fmt(val * aspect);
        }
      }
      return next;
    });
  };

  const applyGeometry = async () => {
    if (isSaving || isDisabled) return;
    const x = parseFloat(draft.x);
    const y = parseFloat(draft.y);
    const w = parseFloat(draft.w);
    const h = parseFloat(draft.h);
    const angle = parseFloat(draft.angle) || 0;
    if (![x, y, w, h].every((v) => Number.isFinite(v)) || w < 2 || h < 2) return;

    if (kind === 'text' && textMode === 'reflow' && onApplyReflow) {
      await onApplyReflow(w, x - origRect.x, y - origRect.y);
      return;
    }
    await onApplyTransform({ x, y, width: w, height: h }, angle);
    setDraft((prev) => ({ ...prev, angle: '0' }));
  };

  const applyFontSize = async () => {
    if (!onApplyTextStyle || isSaving || isDisabled) return;
    const size = parseFloat(fontSizeDraft);
    if (!Number.isFinite(size) || size < 4 || size > 240) return;
    await onApplyTextStyle({ fontSizePt: size });
  };

  const applyColor = async (hex: string) => {
    setColorDraft(hex);
    if (!onApplyTextStyle || isSaving || isDisabled) return;
    await onApplyTextStyle({ hexColor: hex });
  };

  return (
    <div
      className={`pt-2 border-t space-y-2 ${
        isMinimal ? 'border-neutral-200' : isLcars ? 'border-[#333333]' : 'border-slate-800'
      }`}
    >
      {/* Header + Scale/Reflow or Aspect Lock */}
      <div className="flex items-center justify-between gap-1.5">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide ${
            isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ffcc00]' : 'text-slate-400'
          }`}
        >
          {t.editPanel.positionSizeTitle}
        </span>

        {kind === 'text' ? (
          <div
            className={`inline-flex items-center p-0.5 border ${
              isMinimal
                ? 'rounded bg-neutral-200/70 border-neutral-300'
                : isLcars
                ? 'rounded-full bg-black border-[#ff9900]'
                : 'rounded bg-slate-900 border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => setTextMode('scale')}
              className={`px-1.5 py-0.5 text-[10px] font-semibold transition-all ${
                textMode === 'scale'
                  ? isMinimal
                    ? 'rounded bg-white text-black shadow-xs'
                    : isLcars
                    ? 'rounded-full bg-[#ff9900] text-black font-bold'
                    : 'rounded bg-indigo-600 text-white'
                  : isMinimal
                  ? 'text-neutral-600'
                  : isLcars
                  ? 'text-[#ff9966]'
                  : 'text-slate-400'
              }`}
            >
              {t.editPanel.textResizeModeScale}
            </button>
            <button
              type="button"
              onClick={() => setTextMode('reflow')}
              className={`px-1.5 py-0.5 text-[10px] font-semibold transition-all ${
                textMode === 'reflow'
                  ? isMinimal
                    ? 'rounded bg-white text-black shadow-xs'
                    : isLcars
                    ? 'rounded-full bg-[#ff9900] text-black font-bold'
                    : 'rounded bg-sky-600 text-white'
                  : isMinimal
                  ? 'text-neutral-600'
                  : isLcars
                  ? 'text-[#ff9966]'
                  : 'text-slate-400'
              }`}
            >
              {t.editPanel.textResizeModeReflow}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLockAspect((p) => !p)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${secondaryBtnClass}`}
            title={lockAspect ? t.editPanel.unlockAspectRatio : t.editPanel.lockAspectRatio}
          >
            {lockAspect ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>

      {/* X, Y, W, H, Angle inputs */}
      <div className="grid grid-cols-5 gap-1">
        {(
          [
            { k: 'x' as const, label: t.editPanel.posXLabel, disabled: false },
            { k: 'y' as const, label: t.editPanel.posYLabel, disabled: kind === 'text' && textMode === 'reflow' },
            { k: 'w' as const, label: t.editPanel.widthLabel, disabled: false },
            { k: 'h' as const, label: t.editPanel.heightLabel, disabled: kind === 'text' && textMode === 'reflow' },
            { k: 'angle' as const, label: t.editPanel.angleLabel, disabled: kind === 'text' && textMode === 'reflow' },
          ] as const
        ).map(({ k, label, disabled }) => (
          <label key={k} className="block">
            <span className="text-[9px] font-mono opacity-60 block mb-0.5 truncate">{label}</span>
            <input
              type="number"
              step={k === 'angle' ? '5' : '1'}
              value={draft[k]}
              disabled={isSaving || isDisabled || disabled}
              onChange={(e) => handleFieldChange(k, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void applyGeometry();
                }
              }}
              className={`w-full px-1 py-0.5 text-[11px] font-mono rounded border outline-none disabled:opacity-40 ${inputClass}`}
            />
          </label>
        ))}
      </div>

      {/* Aspect lock / hint + Apply button */}
      <div className="flex items-center justify-between gap-1.5">
        {kind === 'text' && textMode === 'scale' ? (
          <button
            type="button"
            onClick={() => setLockAspect((p) => !p)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${secondaryBtnClass}`}
            title={lockAspect ? t.editPanel.unlockAspectRatio : t.editPanel.lockAspectRatio}
          >
            {lockAspect ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{lockAspect ? t.editPanel.lockAspectRatio : t.editPanel.unlockAspectRatio}</span>
          </button>
        ) : kind === 'text' ? (
          <span className="text-[10px] opacity-65 truncate">{t.editPanel.sideResizeReflowHint}</span>
        ) : (
          <span className="text-[10px] opacity-60 flex items-center gap-1 truncate">
            <RotateCw className="w-2.5 h-2.5 shrink-0" />
            <span>{t.editPanel.nudgeHint}</span>
          </span>
        )}
        <button
          type="button"
          disabled={isSaving || isDisabled}
          onClick={() => void applyGeometry()}
          className={`px-2.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-45 shrink-0 ${primaryBtnClass}`}
        >
          {t.editPanel.applyGeometryBtn}
        </button>
      </div>

      {/* Text Styling Row: Font Size (pt) & Text Color Swatches (Text blocks only) */}
      {kind === 'text' && onApplyTextStyle && (
        <div
          className={`pt-1.5 border-t flex items-center justify-between gap-2 flex-wrap ${
            isMinimal ? 'border-neutral-200/80' : isLcars ? 'border-[#222]' : 'border-slate-800/80'
          }`}
        >
          <div className="flex items-center gap-1">
            <span className="text-[10px] opacity-70">{t.editPanel.fontSizeLabel}:</span>
            <input
              type="number"
              min="4"
              max="240"
              step="1"
              value={fontSizeDraft}
              disabled={isSaving || isDisabled}
              onChange={(e) => setFontSizeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void applyFontSize();
                }
              }}
              onBlur={() => {
                if (
                  initialFontSizePt &&
                  Math.abs((parseFloat(fontSizeDraft) || 0) - initialFontSizePt) > 0.25
                ) {
                  void applyFontSize();
                }
              }}
              className={`w-14 px-1.5 py-0.5 text-[11px] font-mono rounded border outline-none ${inputClass}`}
            />
          </div>

          <div className="flex items-center gap-1">
            <Palette className="w-3 h-3 opacity-60" />
            {QUICK_TEXT_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                disabled={isSaving || isDisabled}
                onClick={() => void applyColor(hex)}
                style={{ backgroundColor: hex }}
                className="w-3.5 h-3.5 rounded-full border border-white/40 hover:scale-125 transition-transform disabled:opacity-40"
                title={`${t.editPanel.textColorLabel}: ${hex}`}
                aria-label={`${t.editPanel.textColorLabel}: ${hex}`}
              />
            ))}
            <input
              type="color"
              value={colorDraft}
              disabled={isSaving || isDisabled}
              onChange={(e) => void applyColor(e.target.value)}
              title={t.editPanel.textColorLabel}
              className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
            />
          </div>
        </div>
      )}
    </div>
  );
};
