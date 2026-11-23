import React, { Suspense, lazy, useEffect } from 'react';
import { I18nProvider, useI18n } from './i18n/context';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { DocumentProvider, useDocument } from './context/DocumentContext';
import { EditorProvider, useEditor } from './context/EditorContext';
import { Header } from './components/layout/Header';
import { Toolbar } from './components/layout/Toolbar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { NotesPanel } from './components/layout/NotesPanel';
import { EditSidePanel } from './components/layout/EditSidePanel';
import { PdfViewer } from './components/viewer/PdfViewer';
import { Dropzone } from './components/common/Dropzone';
import { SearchBar } from './components/viewer/SearchBar';
import { FileProvider } from './context/FileContext';
import { useAppCommands } from './hooks/useAppCommands';
import { shouldAllowGlobalPageDelete } from './utils/editModeState';
import { CheckCircle2, AlertCircle, RotateCcw, X } from 'lucide-react';

// On-demand lazy modals: keeps heavy dependencies (node-forge, signature_pad, pdfFlattener, etc.)
// out of the initial entry bundle until a user actually opens the modal.
const SignatureModal = lazy(() =>
  import('./components/modals/SignatureModal').then((m) => ({ default: m.SignatureModal }))
);
const AddPageModal = lazy(() =>
  import('./components/modals/AddPageModal').then((m) => ({ default: m.AddPageModal }))
);
const ConfirmModal = lazy(() =>
  import('./components/modals/ConfirmModal').then((m) => ({ default: m.ConfirmModal }))
);
const LogModal = lazy(() =>
  import('./components/modals/LogModal').then((m) => ({ default: m.LogModal }))
);
const SettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const MetadataModal = lazy(() =>
  import('./components/modals/MetadataModal').then((m) => ({ default: m.MetadataModal }))
);
const ExportFormModal = lazy(() =>
  import('./components/modals/ExportFormModal').then((m) => ({ default: m.ExportFormModal }))
);
const FlattenModal = lazy(() =>
  import('./components/modals/FlattenModal').then((m) => ({ default: m.FlattenModal }))
);
const AboutModal = lazy(() =>
  import('./components/modals/AboutModal').then((m) => ({ default: m.AboutModal }))
);
const ShortcutsModal = lazy(() =>
  import('./components/modals/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal }))
);

const MainWorkspace: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { pages, selectedPageIds, selectedAnnotationId, canUndo, undo } = useDocument();
  const {
    activeTab,
    editNotice,
    clearEditNotice,
    setIsDeleteConfirmModalOpen,
    setDeleteTargetPageId,
    setDeleteMode,
    isSignatureModalOpen,
    isAddPageModalOpen,
    isDeleteConfirmModalOpen,
    isLogModalOpen,
    isSettingsModalOpen,
    isMetadataModalOpen,
    isExportFormModalOpen,
    isFlattenModalOpen,
    isAboutModalOpen,
    isShortcutsModalOpen,
  } = useEditor();

  const hasDoc = pages.length > 0;
  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Ctrl/Cmd shortcuts and the native menu of the desktop edition
  useAppCommands();

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Already handled, e.g. the edit panel or canvas deleted the selected PDF element
      if (e.defaultPrevented) return;

      // Do not trigger deletion shortcuts if user is typing inside an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Delete key: delete selected page only when NOT in Edit mode and no annotation is selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!shouldAllowGlobalPageDelete(activeTab, selectedAnnotationId, selectedPageIds.length)) {
          return;
        }

        if (selectedPageIds.length === 1) {
          setDeleteTargetPageId(selectedPageIds[0]);
          setDeleteMode('single');
        } else {
          setDeleteMode('multiple');
        }
        setIsDeleteConfirmModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, selectedAnnotationId, selectedPageIds, pages.length, setDeleteTargetPageId, setDeleteMode, setIsDeleteConfirmModalOpen]);

  const bgClass =
    theme === 'minimal'
      ? 'bg-white text-black'
      : theme === 'lcars'
      ? 'bg-black text-amber-500'
      : 'bg-slate-950 text-slate-100';

  return (
    <div className={`app-root theme-${theme} flex flex-col h-screen w-screen overflow-hidden ${bgClass} transition-colors duration-150`}>
      {/* Top Header */}
      <Header />

      {hasDoc ? (
        <>
          {/* Secondary Action Toolbar */}
          <Toolbar />

          {/* Core Body: Left Thumbnail Sidebar + Center PDF Canvas + Right Docked Panels */}
          <div className="flex-1 flex overflow-hidden relative">
            <Sidebar />
            {/* The search bar and edit notice toast float over the page view only, never over the side panels */}
            <div className="flex-1 min-w-0 flex relative">
              <PdfViewer />
              <SearchBar />
              {editNotice && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium shadow-2xl border backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                    editNotice.type === 'success'
                      ? isMinimal
                        ? 'rounded-lg bg-white border-neutral-300 text-neutral-900 shadow-lg'
                        : isLcars
                        ? 'rounded-full bg-black border-2 border-[#ff9900] text-[#ffff66]'
                        : 'rounded-xl bg-slate-900/95 border-emerald-500/50 text-emerald-100 ring-1 ring-emerald-500/20'
                      : isMinimal
                      ? 'rounded-lg bg-rose-50 border-rose-300 text-rose-800 shadow-lg'
                      : isLcars
                      ? 'rounded-full bg-black border-2 border-[#ff3333] text-[#ff6666]'
                      : 'rounded-xl bg-rose-950/95 border-rose-500/60 text-rose-100 ring-1 ring-rose-500/30'
                  }`}
                >
                  {editNotice.type === 'success' ? (
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        isMinimal ? 'text-emerald-600' : isLcars ? 'text-[#ffcc00]' : 'text-emerald-400'
                      }`}
                    />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span className="max-w-md">{editNotice.text}</span>
                  {editNotice.canUndo && canUndo && (
                    <button
                      type="button"
                      onClick={() => {
                        undo();
                        clearEditNotice();
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                        isMinimal
                          ? 'rounded bg-black text-white hover:bg-neutral-800'
                          : isLcars
                          ? 'rounded-full bg-[#ff9900] text-black hover:bg-[#ffcc00] font-bold uppercase'
                          : 'rounded-md bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t.editPanel.undoAction}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearEditNotice}
                    className={`p-0.5 rounded transition-colors ${
                      isMinimal
                        ? 'text-neutral-500 hover:text-black hover:bg-neutral-200'
                        : isLcars
                        ? 'text-[#ff9966] hover:text-[#ffff66]'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title={t.editPanel.dismissNotice}
                    aria-label={t.editPanel.dismissNotice}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <NotesPanel />
            <EditSidePanel />
          </div>
        </>
      ) : (
        /* Empty State Dropzone */
        <Dropzone />
      )}

      {/* Bottom Status Bar (Always present on all pages including first page) */}
      <StatusBar />

      {/* Lazy-Loaded Modals (mounted only when opened) */}
      <Suspense fallback={null}>
        {isSignatureModalOpen && <SignatureModal />}
        {isAddPageModalOpen && <AddPageModal />}
        {isDeleteConfirmModalOpen && <ConfirmModal />}
        {isLogModalOpen && <LogModal />}
        {isSettingsModalOpen && <SettingsModal />}
        {isMetadataModalOpen && <MetadataModal />}
        {isExportFormModalOpen && <ExportFormModal />}
        {isFlattenModalOpen && <FlattenModal />}
        {isAboutModalOpen && <AboutModal />}
        {isShortcutsModalOpen && <ShortcutsModal />}
      </Suspense>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <I18nProvider>
        <DocumentProvider>
          <EditorProvider>
            <FileProvider>
              <MainWorkspace />
            </FileProvider>
          </EditorProvider>
        </DocumentProvider>
      </I18nProvider>
    </ThemeProvider>
  );
};

export default App;
