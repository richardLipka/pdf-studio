import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { Info, X, Check, RotateCcw, FileText, Calendar, Hash, FileCheck, Layers, HardDrive } from 'lucide-react';
import { DocumentMetadata, DEFAULT_DOCUMENT_METADATA } from '../../types/document';

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
    setMetadata(form);
    setIsMetadataModalOpen(false);
  };

  const handleReset = () => {
    setForm({
      ...DEFAULT_DOCUMENT_METADATA,
      creationDate: form.creationDate,
      modificationDate: form.modificationDate,
      pdfVersion: form.pdfVersion,
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

  // Format dates
  const formatDate = (isoString?: string) => {
    if (!isoString) return t.metadataModal.notSpecified;
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleString();
    } catch {
      return isoString;
    }
  };

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
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-4 flex items-center gap-2 ${
                isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
              }`}
            >
              <FileText className="w-4 h-4 text-indigo-400" />
              {t.metadataModal.sectionDocInfo}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Title */}
              <div className="md:col-span-2">
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldTitle}
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t.metadataModal.fieldTitlePlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Author */}
              <div>
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldAuthor}
                </label>
                <input
                  type="text"
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                  placeholder={t.metadataModal.fieldAuthorPlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Subject */}
              <div>
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldSubject}
                </label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder={t.metadataModal.fieldSubjectPlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Keywords */}
              <div className="md:col-span-2">
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldKeywords}
                </label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder={t.metadataModal.fieldKeywordsPlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
                <p className="text-[11px] text-slate-400 mt-1">{t.metadataModal.fieldKeywordsHelp}</p>
              </div>

              {/* Creator */}
              <div>
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldCreator}
                </label>
                <input
                  type="text"
                  value={form.creator}
                  onChange={(e) => setForm({ ...form, creator: e.target.value })}
                  placeholder={t.metadataModal.fieldCreatorPlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Producer */}
              <div>
                <label
                  className={`block text-xs font-medium mb-1.5 ${
                    isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900]' : 'text-slate-300'
                  }`}
                >
                  {t.metadataModal.fieldProducer}
                </label>
                <input
                  type="text"
                  value={form.producer}
                  onChange={(e) => setForm({ ...form, producer: e.target.value })}
                  placeholder={t.metadataModal.fieldProducerPlaceholder}
                  className={`w-full px-3.5 py-2 text-sm rounded-xl border transition-colors outline-none focus:ring-2 ${
                    isMinimal
                      ? 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:ring-neutral-400 focus:border-neutral-400'
                      : isLcars
                      ? 'bg-black border-[#ff9900] text-[#ff9900] font-mono focus:ring-[#ff9900]/50'
                      : 'bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
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
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 ${
                isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#ff9900] font-mono' : 'text-slate-300'
              }`}
            >
              <FileCheck className="w-4 h-4 text-emerald-400" />
              {t.metadataModal.sectionProperties}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {/* File Name */}
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-slate-500 block">Soubor:</span>
                  <span className="font-semibold truncate block text-slate-200" title={fileName}>
                    {fileName}
                  </span>
                </div>
              </div>

              {/* Total Pages */}
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldPagesCount}:</span>
                  <span className="font-semibold text-slate-200">{pages.length} stran</span>
                </div>
              </div>

              {/* File Size */}
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldFileSize}:</span>
                  <span className="font-semibold text-slate-200">{formattedFileSize}</span>
                </div>
              </div>

              {/* Creation Date */}
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldCreationDate}:</span>
                  <span className="font-semibold text-slate-200">{formatDate(form.creationDate)}</span>
                </div>
              </div>

              {/* Modification Date */}
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldModDate}:</span>
                  <span className="font-semibold text-slate-200">{formatDate(form.modificationDate)}</span>
                </div>
              </div>

              {/* PDF Version */}
              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <span className="text-slate-500 block">{t.metadataModal.fieldPdfVersion}:</span>
                  <span className="font-semibold text-slate-200">{form.pdfVersion || 'PDF 1.7 (ISO 32000-1)'}</span>
                </div>
              </div>
            </div>
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
