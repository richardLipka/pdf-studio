import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { Info, X, Check, RotateCcw, FileText, Calendar, Hash, FileCheck, Layers, HardDrive, Tags, Plus, Trash2 } from 'lucide-react';
import {
  CustomMetadataProperty,
  DocumentMetadata,
  DEFAULT_DOCUMENT_METADATA,
  RESERVED_METADATA_KEYS,
} from '../../types/document';

const CUSTOM_SUGGESTIONS = ['Company', 'Category', 'Comments', 'Manager'];

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date -> value of a datetime-local input (local time) */
const toLocalInput = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const fromLocalInput = (value: string): string | undefined => {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

export const MetadataModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { isMetadataModalOpen, setIsMetadataModalOpen } = useEditor();
  const { metadata, setMetadata, fileName, pages, sources } = useDocument();

  const [form, setForm] = useState<DocumentMetadata>(metadata);

  // Sync state when modal opens
  useEffect(() => {
    if (isMetadataModalOpen) {
      setForm(metadata);
    }
  }, [isMetadataModalOpen, metadata]);

  if (!isMetadataModalOpen) return null;

  const handleSave = () => {
    setMetadata({
      ...form,
      customProperties: (form.customProperties || [])
        .filter((p) => p.key.trim() || p.value.trim())
        .map((p) => ({ key: p.key.trim(), value: p.value })),
    });
    setIsMetadataModalOpen(false);
  };

  const handleReset = () => {
    setForm({
      ...DEFAULT_DOCUMENT_METADATA,
      creationDate: form.creationDate,
      modificationDate: form.modificationDate,
      pdfVersion: form.pdfVersion,
      autoModificationDate: true,
      customProperties: [],
    });
  };

  const handleClose = () => {
    setIsMetadataModalOpen(false);
  };

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Calculate file size from sources
  const totalSizeBytes = sources.reduce((acc, s) => acc + (s.arrayBuffer ? s.arrayBuffer.byteLength : 0), 0);
  const formattedFileSize = totalSizeBytes > 0
    ? `${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB (${(totalSizeBytes / 1024).toFixed(0)} KB)`
    : t.metadataModal.notSpecified;

  const inputClass = `w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
    isMinimal
      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
      : isLcars
      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500 [color-scheme:dark]'
  }`;
  // Inputs sharing a row must not stretch to the full width
  const rowInputClass = inputClass.replace('w-full ', '');
  const labelTextClass = isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300';
  const labelClass = `block text-xs font-medium mb-1.5 ${labelTextClass}`;
  const helpClass = `text-[11px] mt-1 ${isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'}`;
  const sectionHeadingClass = `text-xs font-semibold uppercase tracking-wider mb-4 flex items-center gap-2 ${
    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
  }`;
  const valueTextClass = isMinimal ? 'text-neutral-900' : isLcars ? 'text-[#ffcc99]' : 'text-slate-200';

  const customProperties: CustomMetadataProperty[] = form.customProperties || [];
  const updateCustom = (idx: number, patch: Partial<CustomMetadataProperty>) =>
    setForm({ ...form, customProperties: customProperties.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  const removeCustom = (idx: number) =>
    setForm({ ...form, customProperties: customProperties.filter((_, i) => i !== idx) });
  const addCustom = (key: string) => setForm({ ...form, customProperties: [...customProperties, { key, value: '' }] });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 border shadow-2xl overflow-hidden ${
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
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h2
                className={`text-base font-bold tracking-wide ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900] uppercase font-mono' : 'text-white'
                }`}
              >
                {t.metadataModal.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                }`}
              >
                {t.metadataModal.subtitle}
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
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Editable Document Fields Section */}
          <div>
            <h3 className={sectionHeadingClass}>
              <FileText className="w-4 h-4 text-indigo-400" />
              {t.metadataModal.sectionDocInfo}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className={labelClass}>{t.metadataModal.fieldTitle}</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t.metadataModal.fieldTitlePlaceholder}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t.metadataModal.fieldAuthor}</label>
                <input
                  type="text"
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                  placeholder={t.metadataModal.fieldAuthorPlaceholder}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t.metadataModal.fieldSubject}</label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder={t.metadataModal.fieldSubjectPlaceholder}
                  className={inputClass}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>{t.metadataModal.fieldKeywords}</label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder={t.metadataModal.fieldKeywordsPlaceholder}
                  className={inputClass}
                />
                <p className={helpClass}>{t.metadataModal.fieldKeywordsHelp}</p>
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>{t.metadataModal.fieldSource}</label>
                <input
                  type="text"
                  value={form.source || ''}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder={t.metadataModal.fieldSourcePlaceholder}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t.metadataModal.fieldCreator}</label>
                <input
                  type="text"
                  value={form.creator}
                  onChange={(e) => setForm({ ...form, creator: e.target.value })}
                  placeholder={t.metadataModal.fieldCreatorPlaceholder}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t.metadataModal.fieldProducer}</label>
                <input
                  type="text"
                  value={form.producer}
                  onChange={(e) => setForm({ ...form, producer: e.target.value })}
                  placeholder={t.metadataModal.fieldProducerPlaceholder}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t.metadataModal.fieldLanguage}</label>
                <input
                  type="text"
                  value={form.language || ''}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  placeholder={t.metadataModal.fieldLanguagePlaceholder}
                  className={inputClass}
                />
                <p className={helpClass}>{t.metadataModal.fieldLanguageHelp}</p>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div>
            <h3 className={sectionHeadingClass}>
              <Calendar className="w-4 h-4 text-sky-400" />
              {t.metadataModal.sectionDates}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t.metadataModal.fieldCreationDate}</label>
                <input
                  type="datetime-local"
                  step={1}
                  value={toLocalInput(form.creationDate)}
                  onChange={(e) => setForm({ ...form, creationDate: fromLocalInput(e.target.value) })}
                  className={inputClass}
                />
                <p className={helpClass}>{t.metadataModal.fieldDatesHelp}</p>
              </div>
              <div>
                <label className={labelClass}>{t.metadataModal.fieldModDate}</label>
                <input
                  type="datetime-local"
                  step={1}
                  value={toLocalInput(form.modificationDate)}
                  disabled={form.autoModificationDate !== false}
                  onChange={(e) => setForm({ ...form, modificationDate: fromLocalInput(e.target.value) })}
                  className={`${inputClass} disabled:opacity-50`}
                />
                <label className={`flex items-center gap-2 mt-1.5 text-[11px] cursor-pointer select-none ${labelTextClass}`}>
                  <input
                    type="checkbox"
                    checked={form.autoModificationDate !== false}
                    onChange={(e) => setForm({ ...form, autoModificationDate: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  {t.metadataModal.fieldAutoModDate}
                </label>
              </div>
            </div>
          </div>

          {/* Custom properties */}
          <div>
            <h3 className={sectionHeadingClass}>
              <Tags className="w-4 h-4 text-amber-400" />
              {t.metadataModal.sectionCustom}
            </h3>
            <p className={`${helpClass} mb-3`}>{t.metadataModal.customHelp}</p>
            <div className="space-y-2">
              {customProperties.map((prop, idx) => {
                const key = prop.key.trim();
                const reserved = RESERVED_METADATA_KEYS.has(key);
                const duplicate =
                  !reserved && key !== '' && customProperties.some((p, j) => j > idx && p.key.trim() === key);
                return (
                  <div key={idx}>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={prop.key}
                        onChange={(e) => updateCustom(idx, { key: e.target.value })}
                        placeholder={t.metadataModal.customKeyPlaceholder}
                        aria-label={t.metadataModal.customKeyPlaceholder}
                        className={`${rowInputClass} w-2/5 shrink-0`}
                      />
                      <input
                        type="text"
                        value={prop.value}
                        onChange={(e) => updateCustom(idx, { value: e.target.value })}
                        placeholder={t.metadataModal.customValuePlaceholder}
                        aria-label={t.metadataModal.customValuePlaceholder}
                        className={`${rowInputClass} flex-1 min-w-0`}
                      />
                      <button
                        type="button"
                        onClick={() => removeCustom(idx)}
                        className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/15 transition-colors shrink-0"
                        title={t.metadataModal.removeCustom}
                        aria-label={t.metadataModal.removeCustom}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {(reserved || duplicate) && (
                      <p className="text-[11px] text-amber-400 mt-1">
                        {reserved ? t.metadataModal.customReservedKey : t.metadataModal.customDuplicateKey}
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => addCustom('')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${
                    isMinimal
                      ? 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                      : isLcars
                      ? 'border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/20'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.metadataModal.addCustom}
                </button>
                {CUSTOM_SUGGESTIONS.filter((name) => !customProperties.some((p) => p.key.trim() === name)).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => addCustom(name)}
                    className={`px-2 py-1 text-[11px] rounded-lg border border-dashed transition-colors ${
                      isMinimal
                        ? 'border-neutral-300 text-neutral-500 hover:text-neutral-800'
                        : isLcars
                        ? 'border-[#ff9900]/60 text-[#ff9966] hover:text-[#ff9900]'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Read-Only Document Properties Section */}
          <div
            className={`p-4 rounded-xl border ${
              isMinimal
                ? 'bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'bg-[#111111] border-[#ff9900]/40'
                : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <h3 className={`${sectionHeadingClass} !mb-3`}>
              <FileCheck className="w-4 h-4 text-emerald-400" />
              {t.metadataModal.sectionProperties}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-slate-500 block">{t.metadataModal.fieldFileName}:</span>
                  <span className={`font-semibold truncate block ${valueTextClass}`} title={fileName}>
                    {fileName}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldPagesCount}:</span>
                  <span className={`font-semibold ${valueTextClass}`}>
                    {pages.length} {t.metadataModal.pagesUnit}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldFileSize}:</span>
                  <span className={`font-semibold ${valueTextClass}`}>{formattedFileSize}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldPdfVersion}:</span>
                  <span className={`font-semibold ${valueTextClass}`}>{form.pdfVersion || 'PDF 1.7 (ISO 32000-1)'}</span>
                </div>
              </div>
            </div>
            <p className={`${helpClass} mt-3`}>{t.metadataModal.xmpNote}</p>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-t ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/40'
          }`}
        >
          <button
            type="button"
            onClick={handleReset}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl transition-all ${
              isMinimal
                ? 'text-neutral-600 hover:bg-neutral-200/70 border border-neutral-300'
                : isLcars
                ? 'text-[#ff9900] hover:bg-[#ff9900]/20 border border-[#ff9900] uppercase font-mono'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.metadataModal.reset}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                isMinimal
                  ? 'text-neutral-600 hover:text-neutral-900'
                  : isLcars
                  ? 'text-[#ff9900] hover:text-white font-mono uppercase'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.metadataModal.cancel}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition-all shadow-lg ${
                isMinimal
                  ? 'bg-black text-white hover:bg-neutral-800 shadow-neutral-200'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold uppercase hover:bg-[#ffaa22] shadow-[0_0_15px_rgba(255,153,0,0.5)] font-mono'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25'
              }`}
            >
              <Check className="w-4 h-4" />
              {t.metadataModal.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
