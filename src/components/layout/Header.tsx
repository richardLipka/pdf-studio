import React, { useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { createSamplePdfDoc } from '../../utils/file';
import {
  FileUp,
  Download,
  Undo2,
  Redo2,
  FileText,
  ShieldCheck,
  Loader2,
  Sparkles,
  MessageSquare,
} from 'lucide-react';

export const Header: React.FC = () => {
  const { language, setLanguage, t } = useI18n();
  const {
    fileName,
    pages,
    annotations,
    isSaving,
    canUndo,
    canRedo,
    undo,
    redo,
    loadPdfFile,
    loadSamplePdf,
    saveAndDownload,
  } = useDocument();

  const { isNotesPanelOpen, toggleNotesPanel } = useEditor();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadPdfFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadSample = async () => {
    const sampleBuffer = await createSamplePdfDoc(language);
    await loadSamplePdf(sampleBuffer, language);
  };

  const [showSuccessToast, setShowSuccessToast] = React.useState<boolean>(false);

  const handleSaveAndDownload = async () => {
    await saveAndDownload();
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3500);
  };

  const hasDoc = pages.length > 0;
  const notesCount = annotations.filter(
    (a) => a.type === 'note' || a.type === 'text' || a.comment
  ).length;

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none z-30">
      {/* Brand & Document Name */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-bold text-lg">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white">
                {t.app.title}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800/60">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                {t.app.privacyBadge}
              </span>
            </div>
            {hasDoc && (
              <p className="text-xs text-slate-400 truncate max-w-[160px] md:max-w-xs">
                {fileName}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Center Actions: Open, Sample, Undo, Redo */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="application/pdf"
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm"
          title={t.app.openFileDesc}
        >
          <FileUp className="w-4 h-4 text-sky-400" />
          <span className="hidden md:inline">{t.app.openFile}</span>
        </button>

        <button
          onClick={handleLoadSample}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          title={t.app.samplePdf}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden lg:inline">{t.app.samplePdf}</span>
        </button>

        {hasDoc && (
          <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
            <button
              onClick={undo}
              disabled={!canUndo}
              className={`p-1.5 rounded-lg border transition-colors ${
                canUndo
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'text-slate-600 border-transparent cursor-not-allowed'
              }`}
              title={t.app.undo}
            >
              <Undo2 className="w-4 h-4" />
            </button>

            <button
              onClick={redo}
              disabled={!canRedo}
              className={`p-1.5 rounded-lg border transition-colors ${
                canRedo
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'text-slate-600 border-transparent cursor-not-allowed'
              }`}
              title={t.app.redo}
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Right Side: Notes Panel Toggle, Language switcher & Save/Download button */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Notes & Reviews Panel Toggle */}
        {hasDoc && (
          <button
            onClick={toggleNotesPanel}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              isNotesPanelOpen
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={t.notesPanel.togglePanel}
          >
            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">{t.notesPanel.title}</span>
            {notesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/30 text-amber-300 font-bold border border-amber-500/40">
                {notesCount}
              </span>
            )}
          </button>
        )}

        {/* Language Switcher */}
        <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
          <button
            onClick={() => setLanguage('cs')}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-all ${
              language === 'cs'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Čeština"
          >
            CZ
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-1 text-xs font-semibold rounded-md transition-all ${
              language === 'en'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="English"
          >
            EN
          </button>
        </div>

        {/* Save & Download button */}
        {hasDoc && (
          <div className="relative">
            <button
              onClick={handleSaveAndDownload}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-md shadow-sky-500/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.app.saving}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{t.app.savePdf}</span>
                </>
              )}
            </button>

            {/* Success Toast */}
            {showSuccessToast && (
              <div className="absolute right-0 top-11 bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-[11px] font-medium px-3 py-1.5 rounded-lg shadow-xl whitespace-nowrap animate-in fade-in slide-in-from-top-1 duration-200 z-50">
                ✓ {t.app.downloadSuccess}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
