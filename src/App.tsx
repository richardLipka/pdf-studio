import React, { useEffect } from 'react';
import { I18nProvider } from './i18n/context';
import { DocumentProvider, useDocument } from './context/DocumentContext';
import { EditorProvider, useEditor } from './context/EditorContext';
import { Header } from './components/layout/Header';
import { Toolbar } from './components/layout/Toolbar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { NotesPanel } from './components/layout/NotesPanel';
import { PdfViewer } from './components/viewer/PdfViewer';
import { Dropzone } from './components/common/Dropzone';
import { SignatureModal } from './components/modals/SignatureModal';
import { AddPageModal } from './components/modals/AddPageModal';
import { ConfirmModal } from './components/modals/ConfirmModal';

const MainWorkspace: React.FC = () => {
  const { pages, selectedPageIds, selectedAnnotationId } = useDocument();
  const {
    setIsDeleteConfirmModalOpen,
    setDeleteTargetPageId,
    setDeleteMode,
  } = useEditor();

  const hasDoc = pages.length > 0;

  // Handle Delete / Backspace key to initiate page deletion when no annotation is active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.tagName === 'INPUT' ||
        (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // If an annotation is selected, it's deleted by DocumentContext.
        // If NO annotation is selected and pages are selected:
        if (!selectedAnnotationId && selectedPageIds.length > 0 && pages.length > 1) {
          e.preventDefault();
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950">
      {/* Top Header */}
      <Header />

      {hasDoc ? (
        <>
          {/* Secondary Action Toolbar */}
          <Toolbar />

          {/* Core Body: Left Sidebar + Main PDF Canvas + Right Notes Panel */}
          <div className="flex-1 flex overflow-hidden relative">
            <Sidebar />
            <PdfViewer />
            <NotesPanel />
          </div>

          {/* Bottom Status Bar */}
          <StatusBar />
        </>
      ) : (
        /* Empty State Dropzone */
        <Dropzone />
      )}

      {/* Modals */}
      <SignatureModal />
      <AddPageModal />
      <ConfirmModal />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <DocumentProvider>
        <EditorProvider>
          <MainWorkspace />
        </EditorProvider>
      </DocumentProvider>
    </I18nProvider>
  );
};

export default App;
