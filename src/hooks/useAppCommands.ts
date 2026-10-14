import { useCallback, useEffect, useRef } from 'react';
import { useDocument } from '../context/DocumentContext';
import { useEditor } from '../context/EditorContext';
import { useFiles } from '../context/FileContext';
import { AppCommandId, matchCommandShortcut } from '../shared/appCommands';
import { onDesktopMessage } from '../services/desktopBridge';

/** Commands that act on the open document and do nothing on the start screen */
const NEEDS_DOCUMENT: ReadonlySet<AppCommandId> = new Set<AppCommandId>([
  'save',
  'saveAs',
  'closeDocument',
  'flatten',
  'signCertificate',
  'metadata',
  'undo',
  'redo',
  'find',
  'selectAllPages',
  'zoomIn',
  'zoomOut',
  'zoomActual',
  'fitPage',
  'fitWidth',
]);

/** Commands that keep their native meaning while typing in a text field */
const TEXT_EDITING: ReadonlySet<AppCommandId> = new Set<AppCommandId>(['undo', 'redo', 'selectAllPages']);

const isTextField = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable ||
    Boolean(el.closest?.('[contenteditable="true"]'))
  );
};

/**
 * Runs application commands from the keyboard (shortcuts of src/shared/appCommands.ts) and from the
 * native menu of the desktop edition. Mounted once in the main workspace.
 */
export const useAppCommands = () => {
  const {
    pages,
    undo,
    redo,
    selectAllPages,
    zoomIn,
    zoomOut,
    zoomActualSize,
    zoomToFitPage,
    zoomToFitWidth,
    toggleSidebar,
  } = useDocument();
  const {
    toggleSearch,
    openSignatureModal,
    setIsFlattenModalOpen,
    setIsMetadataModalOpen,
    setIsSettingsModalOpen,
    setIsShortcutsModalOpen,
    setIsLogModalOpen,
    setIsAboutModalOpen,
  } = useEditor();
  const files = useFiles();

  const hasDoc = pages.length > 0;

  const runCommandRef = useRef<(command: AppCommandId) => void>(() => {});
  runCommandRef.current = (command: AppCommandId) => {
    if (NEEDS_DOCUMENT.has(command) && !hasDoc) return;
    // Text editing commands from the menu go to the focused text field
    if (TEXT_EDITING.has(command) && isTextField(document.activeElement)) {
      document.execCommand(command === 'selectAllPages' ? 'selectAll' : command);
      return;
    }
    switch (command) {
      case 'open':
        void files.openDocument();
        break;
      case 'save':
        files.requestSave(false);
        break;
      case 'saveAs':
        files.requestSave(true);
        break;
      case 'newDocument':
        void files.newDocument();
        break;
      case 'closeDocument':
        files.closeDocument();
        break;
      case 'reopenLast': {
        const last = files.recentFiles.find((f) => f.path !== files.filePath);
        if (last) void files.openPath(last.path);
        break;
      }
      case 'flatten':
        setIsFlattenModalOpen(true);
        break;
      case 'signCertificate':
        openSignatureModal('certificate');
        break;
      case 'metadata':
        setIsMetadataModalOpen(true);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'find':
        toggleSearch();
        break;
      case 'selectAllPages':
        selectAllPages();
        break;
      case 'zoomIn':
        zoomIn();
        break;
      case 'zoomOut':
        zoomOut();
        break;
      case 'zoomActual':
        zoomActualSize();
        break;
      case 'fitPage':
        zoomToFitPage();
        break;
      case 'fitWidth':
        zoomToFitWidth();
        break;
      case 'toggleSidebar':
        toggleSidebar();
        break;
      case 'settings':
        setIsSettingsModalOpen(true);
        break;
      case 'shortcuts':
        setIsShortcutsModalOpen(true);
        break;
      case 'eventLog':
        setIsLogModalOpen(true);
        break;
      case 'about':
        setIsAboutModalOpen(true);
        break;
      case 'backupSettings':
        void files.exportSettingsBackup();
        break;
      case 'restoreSettings':
        void files.importSettingsBackup();
        break;
      case 'showInFolder':
        // Handled by the desktop shell's menu
        break;
    }
  };

  const runCommand = useCallback((command: AppCommandId) => runCommandRef.current(command), []);

  // Keyboard shortcuts. In the desktop edition the page sees the keys first (Windows / Linux): a
  // shortcut handled here is not run a second time by the native menu, which calls preventDefault.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const command = matchCommandShortcut(e, files.isDesktop);
      if (!command) return;
      if (TEXT_EDITING.has(command) && isTextField(e.target as Element | null)) return;
      // Without a document the browser keeps its own zoom keys
      if (!hasDoc && NEEDS_DOCUMENT.has(command) && command.startsWith('zoom')) return;
      if (!hasDoc && (command === 'fitPage' || command === 'fitWidth')) return;
      e.preventDefault();
      runCommandRef.current(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [files.isDesktop, hasDoc]);

  // Native menu of the desktop edition
  useEffect(
    () =>
      onDesktopMessage((message) => {
        if (message.type === 'command') runCommandRef.current(message.command);
      }),
    []
  );

  return runCommand;
};
