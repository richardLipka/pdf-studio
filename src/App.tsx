import React, { useEffect } from 'react';
import { I18nProvider } from './i18n/context';
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
import { SignatureModal } from './components/modals/SignatureModal';
import { AddPageModal } from './components/modals/AddPageModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { LogModal } from './components/modals/LogModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { MetadataModal } from './components/modals/MetadataModal';
import { ExportFormModal } from './components/modals/ExportFormModal';

const MainWorkspace: React.FC = () => {
  const { theme } = useTheme();
  const { pages, selectedPageIds, selectedAnnotationId } = useDocument();
  const {
    setIsDeleteConfirmModalOpen,
    setDeleteTargetPageId,
    setDeleteMode,
  } = useEditor();

  const hasDoc = pages.length > 0;

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger deletion shortcuts if user is typing inside an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Delete key: delete selected annotation or selected page
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId) {
          // Handled within Viewer
          return;
        }

        if (selectedPageIds.length > 0) {
          if (selectedPageIds.length === 1) {
            setDeleteTargetPageId(selectedPageIds[0]);
            setDeleteMode('single');
          } else {
            setDeleteMode('multiple');
          }
          setIsDeleteConfirmModalOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, selectedPageIds, pages.length, setDeleteTargetPageId, setDeleteMode, setIsDeleteConfirmModalOpen]);

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
            <PdfViewer />
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

      {/* Modals */}
      <SignatureModal />
      <AddPageModal />
      <ConfirmModal />
      <LogModal />
      <SettingsModal />
      <MetadataModal />
      <ExportFormModal />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <I18nProvider>
        <DocumentProvider>
          <EditorProvider>
            <MainWorkspace />
          </EditorProvider>
        </DocumentProvider>
      </I18nProvider>
    </ThemeProvider>
  );
};

export default App;
