import React, { useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
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
  Palette,
  Sun,
  Rocket,
  ScrollText,
  Sliders,
  Info,
} from 'lucide-react';
import { logger } from '../../services/logger';

export const Header: React.FC = () => {
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
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

  const {
    isNotesPanelOpen,
    toggleNotesPanel,
    isLogModalOpen,
    toggleLogModal,
    isSettingsModalOpen,
    toggleSettingsModal,
    isMetadataModalOpen,
    toggleMetadataModal,
    rasterSettings,
  } = useEditor();

  const [issueCount, setIssueCount] = React.useState<{ warns: number; errors: number; totalIssues: number }>({
    warns: 0,
    errors: 0,
    totalIssues: 0,
  });

  React.useEffect(() => {
    return logger.subscribe(() => {
      setIssueCount(logger.getWarningAndErrorCount());
    });
  }, []);

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
  const [showErrorToast, setShowErrorToast] = React.useState<boolean>(false);

  const handleSaveAndDownload = async () => {
    if (pages.length === 0) return;
    const success = await saveAndDownload(undefined, rasterSettings);
    if (success) {
      setShowSuccessToast(true);
      setShowErrorToast(false);
      setTimeout(() => setShowSuccessToast(false), 3500);
    } else {
      setShowErrorToast(true);
      setShowSuccessToast(false);
      setTimeout(() => setShowErrorToast(false), 4000);
    }
  };

  const hasDoc = pages.length > 0;
  const notesCount = annotations.filter(
    (a) => a.type === 'note' || a.type === 'text' || a.comment
  ).length;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <header
      className={`h-16 border-b px-4 flex items-center justify-between select-none z-30 transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-black'
          : isLcars
          ? 'bg-black border-[#ff9900] text-[#ff9900]'
          : 'bg-slate-900 border-slate-800 text-white'
      }`}
    >
      {/* Brand & Document Name */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-9 h-9 flex items-center justify-center font-bold text-lg ${
              isMinimal
                ? 'rounded-md bg-black text-white'
                : isLcars
                ? 'rounded-full bg-[#ff9900] text-black'
                : 'rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 shadow-lg shadow-sky-500/20 text-white'
            }`}
          >
            <FileText className={`w-5 h-5 ${isLcars ? 'text-black' : 'text-white'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`font-bold text-base tracking-tight ${
                  isMinimal ? 'text-black font-semibold' : isLcars ? 'text-[#ff9900] uppercase' : 'text-white'
                }`}
              >
                {t.app.title}
              </span>
              <span
                className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 ${
                  isMinimal
                    ? 'rounded-md bg-neutral-100 text-neutral-800 border border-neutral-300'
                    : isLcars
                    ? 'rounded-full bg-black text-[#99ccff] border border-[#99ccff] uppercase'
                    : 'rounded-full bg-sky-950 text-sky-400 border border-sky-800/60'
                }`}
              >
                <ShieldCheck
                  className={`w-3 h-3 ${
                    isMinimal ? 'text-black' : isLcars ? 'text-[#99ccff]' : 'text-emerald-400'
                  }`}
                />
                {t.app.privacyBadge}
              </span>
            </div>
            {hasDoc && (
              <button
                type="button"
                onClick={toggleMetadataModal}
                className={`text-xs truncate max-w-[160px] md:max-w-xs flex items-center gap-1 group text-left transition-colors ${
                  isMinimal ? 'text-neutral-500 hover:text-black' : isLcars ? 'text-[#cc99cc] hover:text-[#ff9900]' : 'text-slate-400 hover:text-sky-300'
                }`}
                title={t.metadataModal.buttonTooltip}
              >
                <span className="truncate">{fileName}</span>
                <Info className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
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
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            isMinimal
              ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300 shadow-none'
              : isLcars
              ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9900] border border-[#ff9900]'
              : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-sm'
          }`}
          title={t.app.openFileDesc}
        >
          <FileUp
            className={`w-4 h-4 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-sky-400'
            }`}
          />
          <span className="hidden md:inline">{t.app.openFile}</span>
        </button>

        <button
          onClick={handleLoadSample}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            isMinimal
              ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300'
              : isLcars
              ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9966] border border-[#ff9966]'
              : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
          title={t.app.samplePdf}
        >
          <Sparkles
            className={`w-3.5 h-3.5 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9966]' : 'text-amber-400'
            }`}
          />
          <span className="hidden lg:inline">{t.app.samplePdf}</span>
        </button>

        {hasDoc && (
          <div
            className={`flex items-center gap-1 border-l pl-2 ${
              isMinimal ? 'border-neutral-200' : isLcars ? 'border-[#333333]' : 'border-slate-800'
            }`}
          >
            <button
              onClick={undo}
              disabled={!canUndo}
              className={`p-1.5 border transition-colors ${
                isMinimal
                  ? canUndo
                    ? 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                    : 'rounded-md text-neutral-300 border-transparent cursor-not-allowed'
                  : isLcars
                  ? canUndo
                    ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
                    : 'rounded-full text-[#444444] border-transparent cursor-not-allowed'
                  : canUndo
                  ? 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'rounded-lg text-slate-600 border-transparent cursor-not-allowed'
              }`}
              title={t.app.undo}
            >
              <Undo2 className="w-4 h-4" />
            </button>

            <button
              onClick={redo}
              disabled={!canRedo}
              className={`p-1.5 border transition-colors ${
                isMinimal
                  ? canRedo
                    ? 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                    : 'rounded-md text-neutral-300 border-transparent cursor-not-allowed'
                  : isLcars
                  ? canRedo
                    ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
                    : 'rounded-full text-[#444444] border-transparent cursor-not-allowed'
                  : canRedo
                  ? 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'rounded-lg text-slate-600 border-transparent cursor-not-allowed'
              }`}
              title={t.app.redo}
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Right Side: Notes Panel Toggle, Theme Switcher, Language switcher & Save/Download button */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Notes & Reviews Panel Toggle */}
        {hasDoc && (
          <button
            onClick={toggleNotesPanel}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-all ${
              isMinimal
                ? isNotesPanelOpen
                  ? 'rounded-md bg-black text-white border-black'
                  : 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                : isLcars
                ? isNotesPanelOpen
                  ? 'rounded-full bg-[#ff9900] text-black border-[#ff9900]'
                  : 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
                : isNotesPanelOpen
                ? 'rounded-lg bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={t.notesPanel.togglePanel}
          >
            <MessageSquare
              className={`w-3.5 h-3.5 ${
                isMinimal
                  ? isNotesPanelOpen ? 'text-white' : 'text-black'
                  : isLcars
                  ? isNotesPanelOpen ? 'text-black' : 'text-[#ff9900]'
                  : 'text-amber-400'
              }`}
            />
            <span className="hidden md:inline">{t.notesPanel.title}</span>
            {notesCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isMinimal
                    ? isNotesPanelOpen ? 'bg-white text-black' : 'bg-neutral-200 text-black'
                    : isLcars
                    ? 'bg-black text-[#ff9900] border border-[#ff9900]'
                    : 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                }`}
              >
                {notesCount}
              </span>
            )}
          </button>
        )}

        {/* Diagnostic Log Button */}
        <button
          onClick={toggleLogModal}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-all ${
            isMinimal
              ? isLogModalOpen
                ? 'rounded-md bg-black text-white border-black'
                : 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
              : isLcars
              ? isLogModalOpen
                ? 'rounded-full bg-[#99ccff] text-black border-[#99ccff]'
                : 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#99ccff] border-[#ff9900]'
              : isLogModalOpen
              ? 'rounded-lg bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm'
              : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
          }`}
          title={t.logModal.buttonTooltip}
        >
          <ScrollText className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t.logModal.title}</span>
          {(issueCount.warns > 0 || issueCount.errors > 0) && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                issueCount.errors > 0
                  ? 'bg-rose-500 text-white animate-pulse'
                  : 'bg-amber-500 text-slate-950 font-bold'
              }`}
            >
              {issueCount.totalIssues}
            </span>
          )}
        </button>

        {/* Document Metadata Button */}
        {hasDoc && (
          <button
            onClick={toggleMetadataModal}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-all ${
              isMinimal
                ? isMetadataModalOpen
                  ? 'rounded-md bg-black text-white border-black'
                  : 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
                : isLcars
                ? isMetadataModalOpen
                  ? 'rounded-full bg-[#cc99cc] text-black border-[#cc99cc]'
                  : 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#cc99cc] border-[#ff9900]'
                : isMetadataModalOpen
                ? 'rounded-lg bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm'
                : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={t.metadataModal.buttonTooltip}
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.metadataModal.title}</span>
          </button>
        )}

        {/* Settings Button */}
        <button
          onClick={toggleSettingsModal}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-all ${
            isMinimal
              ? isSettingsModalOpen
                ? 'rounded-md bg-black text-white border-black'
                : 'rounded-md bg-white hover:bg-neutral-100 text-black border-neutral-300'
              : isLcars
              ? isSettingsModalOpen
                ? 'rounded-full bg-[#ff9900] text-black border-[#ff9900]'
                : 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9900] border-[#ff9900]'
              : isSettingsModalOpen
              ? 'rounded-lg bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm'
              : 'rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
          }`}
          title={t.settings.title}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t.settings.title}</span>
        </button>

        {/* Theme Switcher */}
        <div
          className={`flex items-center p-0.5 border ${
            isMinimal
              ? 'rounded-md bg-neutral-100 border-neutral-300'
              : isLcars
              ? 'rounded-full bg-black border-[#ff9900]'
              : 'rounded-lg bg-slate-800 border-slate-700'
          }`}
          title={t.theme.title}
        >
          <button
            onClick={() => setTheme('default')}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-all ${
              theme === 'default'
                ? isMinimal
                  ? 'rounded bg-black text-white'
                  : 'rounded-md bg-sky-600 text-white shadow-sm'
                : isMinimal
                ? 'rounded text-neutral-600 hover:text-black'
                : isLcars
                ? 'rounded-full text-[#777777] hover:text-[#ff9900]'
                : 'rounded-md text-slate-400 hover:text-slate-200'
            }`}
            title={t.theme.studio}
          >
            <Palette className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Studio</span>
          </button>

          <button
            onClick={() => setTheme('minimal')}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-all ${
              theme === 'minimal'
                ? isMinimal
                  ? 'rounded bg-black text-white shadow-sm'
                  : 'rounded-md bg-zinc-700 text-white shadow-sm'
                : isMinimal
                ? 'rounded text-neutral-600 hover:text-black'
                : isLcars
                ? 'rounded-full text-[#777777] hover:text-[#ff9900]'
                : 'rounded-md text-slate-400 hover:text-slate-200'
            }`}
            title={t.theme.minimal}
          >
            <Sun className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Minimal</span>
          </button>

          <button
            onClick={() => setTheme('lcars')}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-all ${
              theme === 'lcars'
                ? isLcars
                  ? 'rounded-full bg-[#ff9900] text-black font-bold shadow-sm'
                  : 'rounded-md bg-amber-500 text-slate-950 font-bold shadow-sm'
                : isMinimal
                ? 'rounded text-neutral-600 hover:text-black'
                : isLcars
                ? 'rounded-full text-[#777777] hover:text-[#ff9900]'
                : 'rounded-md text-slate-400 hover:text-slate-200'
            }`}
            title={t.theme.lcars}
          >
            <Rocket className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">LCARS</span>
          </button>
        </div>

        {/* Language Switcher */}
        <div
          className={`flex items-center p-0.5 border ${
            isMinimal
              ? 'rounded-md bg-neutral-100 border-neutral-300'
              : isLcars
              ? 'rounded-full bg-black border-[#ff9900]'
              : 'rounded-lg bg-slate-800 border-slate-700'
          }`}
        >
          <button
            onClick={() => setLanguage('cs')}
            className={`px-2 py-1 text-xs font-semibold transition-all ${
              language === 'cs'
                ? isMinimal
                  ? 'rounded bg-black text-white shadow-sm'
                  : isLcars
                  ? 'rounded-full bg-[#ff9900] text-black font-bold'
                  : 'rounded-md bg-sky-600 text-white shadow-sm'
                : isMinimal
                ? 'rounded text-neutral-600 hover:text-black'
                : isLcars
                ? 'rounded-full text-[#777777] hover:text-[#ff9900]'
                : 'rounded-md text-slate-400 hover:text-slate-200'
            }`}
            title="Čeština"
          >
            CZ
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-1 text-xs font-semibold transition-all ${
              language === 'en'
                ? isMinimal
                  ? 'rounded bg-black text-white shadow-sm'
                  : isLcars
                  ? 'rounded-full bg-[#ff9900] text-black font-bold'
                  : 'rounded-md bg-sky-600 text-white shadow-sm'
                : isMinimal
                ? 'rounded text-neutral-600 hover:text-black'
                : isLcars
                ? 'rounded-full text-[#777777] hover:text-[#ff9900]'
                : 'rounded-md text-slate-400 hover:text-slate-200'
            }`}
            title="English"
          >
            EN
          </button>
        </div>

        {/* Save & Download button */}
        <div className="relative">
          <button
            onClick={handleSaveAndDownload}
            disabled={isSaving || !hasDoc}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold active:scale-[0.98] transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
              isMinimal
                ? 'rounded-md bg-black hover:bg-neutral-800 text-white border border-black shadow-none'
                : isLcars
                ? 'rounded-full bg-[#ff9900] hover:bg-[#ffcc00] text-black uppercase font-bold border-2 border-[#ff9900]'
                : 'rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-md shadow-sky-500/20'
            }`}
            title={!hasDoc ? (language === 'cs' ? 'Nejprve otevřete dokument' : 'Open a document first') : t.app.savePdf}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-inherit" />
                <span className="text-inherit">{t.app.saving}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-inherit" />
                <span className="text-inherit">{t.app.savePdf}</span>
              </>
            )}
          </button>

          {/* Success Toast */}
          {showSuccessToast && (
            <div
              className={`absolute right-0 top-11 text-[11px] font-medium px-3 py-1.5 rounded-lg whitespace-nowrap animate-in fade-in slide-in-from-top-1 duration-200 z-50 ${
                isMinimal
                  ? 'bg-black text-white border border-black shadow-md'
                  : isLcars
                  ? 'bg-black text-[#99ccff] border border-[#99ccff] shadow-lg'
                  : 'bg-emerald-950 border border-emerald-500/50 text-emerald-300 shadow-xl'
              }`}
            >
              ✓ {t.app.downloadSuccess}
            </div>
          )}

          {/* Error Toast */}
          {showErrorToast && (
            <div
              className={`absolute right-0 top-11 text-[11px] font-medium px-3 py-1.5 rounded-lg whitespace-nowrap animate-in fade-in slide-in-from-top-1 duration-200 z-50 ${
                isMinimal
                  ? 'bg-red-600 text-white border border-red-700 shadow-md'
                  : isLcars
                  ? 'bg-black text-[#cc3333] border border-[#cc3333] shadow-lg'
                  : 'bg-rose-950 border border-rose-500/50 text-rose-300 shadow-xl'
              }`}
            >
              ✕ {language === 'cs' ? 'Chyba při stahování souboru' : 'Failed to download PDF'}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
