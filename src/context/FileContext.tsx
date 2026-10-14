import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useDocument } from './DocumentContext';
import { useEditor } from './EditorContext';
import { useTheme, AppTheme } from './ThemeContext';
import { useI18n } from '../i18n/context';
import { FormExportMode } from '../types/form';
import { SignatureStamp } from '../types/stamp';
import { RecentFileItem } from '../shared/desktopApi';
import { getDesktopApi, getDesktopFilePath, onDesktopMessage, toArrayBuffer } from '../services/desktopBridge';
import { logger } from '../services/logger';
import { createSamplePdfDoc } from '../utils/file';

/**
 * Opening and saving documents, shared by the web app and the desktop edition:
 * - web: file input / drag & drop to open, browser download to save;
 * - desktop: native dialogs, Save writes the opened file in place, recent files, the window title and
 *   the unsaved-changes guard of the shell, and the shell's persistent settings (theme, language,
 *   signatures).
 * Everything desktop-specific is skipped when window.electronAPI is missing (the browser).
 */

export interface FileNotice {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

interface SaveOptions {
  /** Desktop: always ask for the file name (web: same as save) */
  saveAs?: boolean;
  formExportMode?: FormExportMode;
  /** Desktop: overwrite without the confirmation dialog (closing with "Save") */
  skipConfirm?: boolean;
}

interface FileContextType {
  isDesktop: boolean;
  /** Disk path of the opened document (desktop edition only) */
  filePath: string | null;
  recentFiles: RecentFileItem[];
  notice: FileNotice | null;
  /** Shows the open dialog (web: the browser's file picker) */
  openDocument: () => Promise<void>;
  /** Opens a picked or dropped file */
  openFile: (file: File) => Promise<boolean>;
  /** Opens the built-in sample document */
  openSample: () => Promise<void>;
  /** Desktop: opens a file by its path (recent files, command line) */
  openPath: (filePath: string, options?: { skipDiscardCheck?: boolean }) => Promise<boolean>;
  /** Save / Save As as the user asked for it: asks for the form export mode first when the document has form fields */
  requestSave: (saveAs?: boolean) => void;
  /** Saves (web: downloads) the document, returns false when it failed or was cancelled */
  saveDocument: (options?: SaveOptions) => Promise<boolean>;
  /** Save As remembered while the form export dialog is open */
  pendingSaveAs: boolean;
  newDocument: () => Promise<void>;
  closeDocument: () => void;
  clearRecentFiles: () => Promise<void>;
  showNotice: (kind: FileNotice['kind'], text: string) => void;
}

const FileContext = createContext<FileContextType | null>(null);

const baseName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

export const FileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const api = getDesktopApi();
  const isDesktop = api !== null;
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const {
    fileName,
    setFileName,
    pages,
    isDirty,
    markSaved,
    metadata,
    hasFormFields,
    loadPdfFile,
    loadPdfBuffer,
    loadSamplePdf,
    exportPdfBytes,
    saveAndDownload,
    createNewBlankDocument,
    closeDocument: closeDocumentState,
  } = useDocument();
  const { rasterSettings, stamps, setStamps, setIsExportFormModalOpen } = useEditor();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFileItem[]>([]);
  const [notice, setNotice] = useState<FileNotice | null>(null);
  const [pendingSaveAs, setPendingSaveAs] = useState(false);

  // Latest values for callbacks that outlive a render (IPC listeners, async flows)
  const latest = useRef({ isDirty, filePath, fileName, t, language, theme, setLanguage, setTheme });
  latest.current = { isDirty, filePath, fileName, t, language, theme, setLanguage, setTheme };

  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((kind: FileNotice['kind'], text: string) => {
    setNotice({ id: Date.now(), kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), kind === 'error' ? 5000 : 3500);
  }, []);

  /** Asks before unsaved changes are thrown away; true when it is fine to continue */
  const confirmDiscard = useCallback(() => {
    if (!latest.current.isDirty) return true;
    return window.confirm(latest.current.t.files.discardChanges);
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------------------------

  const openPath = useCallback(
    async (path: string, options?: { skipDiscardCheck?: boolean }): Promise<boolean> => {
      const desktop = getDesktopApi();
      if (!desktop) return false;
      if (!options?.skipDiscardCheck && !confirmDiscard()) return false;
      const result = await desktop.readFile(path);
      if (result.cancelled || !result.data) {
        showNotice('error', latest.current.t.files.openFailed.replace('{name}', baseName(path)));
        if (result.error) logger.error('load', `Soubor "${path}" nelze přečíst: ${result.error}`);
        return false;
      }
      try {
        await loadPdfBuffer(result.fileName || baseName(path), toArrayBuffer(result.data));
        setFilePath(result.filePath || path);
        return true;
      } catch {
        showNotice('error', latest.current.t.notifications.errorLoadingPdf);
        return false;
      }
    },
    [confirmDiscard, loadPdfBuffer, showNotice]
  );

  const openFile = useCallback(
    async (file: File): Promise<boolean> => {
      // Files from disk keep their path in the desktop edition, so Save writes them back in place
      const path = getDesktopFilePath(file);
      if (path) return openPath(path);
      if (!confirmDiscard()) return false;
      try {
        await loadPdfFile(file);
        setFilePath(null);
        return true;
      } catch {
        showNotice('error', latest.current.t.notifications.errorLoadingPdf);
        return false;
      }
    },
    [confirmDiscard, loadPdfFile, openPath, showNotice]
  );

  const openDocument = useCallback(async () => {
    const desktop = getDesktopApi();
    if (desktop) {
      if (!confirmDiscard()) return;
      const result = await desktop.openFile();
      if (result.cancelled || !result.data) {
        if (result.error) showNotice('error', latest.current.t.files.openFailed.replace('{name}', result.fileName || ''));
        return;
      }
      try {
        await loadPdfBuffer(result.fileName || 'document.pdf', toArrayBuffer(result.data));
        setFilePath(result.filePath || null);
      } catch {
        showNotice('error', latest.current.t.notifications.errorLoadingPdf);
      }
      return;
    }
    // Browser: a detached file input; keyboard and click events both allow opening the picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void openFile(file);
    };
    input.click();
  }, [confirmDiscard, loadPdfBuffer, openFile, showNotice]);

  const openSample = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const lang = latest.current.language;
      await loadSamplePdf(await createSamplePdfDoc(lang), lang);
      // The sample is not a file on disk: Save must not overwrite the previously opened file
      setFilePath(null);
    } catch {
      showNotice('error', latest.current.t.notifications.errorLoadingPdf);
    }
  }, [confirmDiscard, loadSamplePdf, showNotice]);

  // ---------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------

  const saveDocument = useCallback(
    async (options: SaveOptions = {}): Promise<boolean> => {
      if (pages.length === 0) return false;
      const strings = latest.current.t;
      const desktop = getDesktopApi();
      if (!desktop) {
        const ok = await saveAndDownload(undefined, rasterSettings, metadata, options.formExportMode);
        if (ok) showNotice('success', strings.app.downloadSuccess);
        else showNotice('error', strings.files.saveFailed);
        return ok;
      }

      const bytes = await exportPdfBytes(rasterSettings, metadata, options.formExportMode);
      if (!bytes) {
        showNotice('error', strings.files.saveFailed);
        return false;
      }
      const currentPath = latest.current.filePath;
      const currentName = latest.current.fileName;
      const result =
        currentPath && !options.saveAs
          ? await desktop.saveFile(currentPath, bytes, options.skipConfirm)
          : await desktop.saveFileAs(
              currentPath || (/\.pdf$/i.test(currentName) ? currentName : `${currentName || 'document'}.pdf`),
              bytes
            );
      if (result.cancelled) return false;
      if (result.error || !result.filePath) {
        showNotice('error', `${strings.files.saveFailed}${result.error ? `: ${result.error}` : ''}`);
        logger.error('save', `Uložení souboru selhalo: ${result.error || 'neznámá chyba'}`);
        return false;
      }
      setFilePath(result.filePath);
      setFileName(baseName(result.filePath));
      markSaved();
      showNotice('success', strings.files.savedToDisk.replace('{name}', baseName(result.filePath)));
      logger.success('save', `Dokument uložen do souboru "${result.filePath}"`);
      return true;
    },
    [pages.length, saveAndDownload, rasterSettings, metadata, exportPdfBytes, setFileName, markSaved, showNotice]
  );

  const requestSave = useCallback(
    (saveAs = false) => {
      if (pages.length === 0) return;
      if (hasFormFields) {
        // ExportFormModal asks for interactive / flattened form fields and then calls saveDocument
        setPendingSaveAs(saveAs);
        setIsExportFormModalOpen(true);
        return;
      }
      void saveDocument({ saveAs });
    },
    [pages.length, hasFormFields, saveDocument, setIsExportFormModalOpen]
  );

  // ---------------------------------------------------------------------------------------------
  // New / close / recent files
  // ---------------------------------------------------------------------------------------------

  const newDocument = useCallback(async () => {
    if (!confirmDiscard()) return;
    await createNewBlankDocument(latest.current.t.files.newDocumentName);
    setFilePath(null);
  }, [confirmDiscard, createNewBlankDocument]);

  const closeDocument = useCallback(() => {
    if (!confirmDiscard()) return;
    closeDocumentState();
    setFilePath(null);
  }, [confirmDiscard, closeDocumentState]);

  const clearRecentFiles = useCallback(async () => {
    const desktop = getDesktopApi();
    if (!desktop) return;
    setRecentFiles(await desktop.clearRecentFiles());
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Desktop shell synchronisation
  // ---------------------------------------------------------------------------------------------

  // Settings and recent files from the shell, then the file the app was started with
  const settingsLoadedRef = useRef(false);
  const latestStamps = useRef(stamps);
  latestStamps.current = stamps;
  useEffect(() => {
    const desktop = getDesktopApi();
    if (!desktop) return;
    let cancelled = false;
    (async () => {
      const [settings, recent] = await Promise.all([desktop.getSettings(), desktop.getRecentFiles()]);
      if (cancelled) return;
      setRecentFiles(recent);
      if (settings.theme !== latest.current.theme) latest.current.setTheme(settings.theme as AppTheme);
      if (settings.language !== latest.current.language) latest.current.setLanguage(settings.language);
      const savedStamps = (Array.isArray(settings.stamps) ? settings.stamps : []) as SignatureStamp[];
      if (savedStamps.length === 0 && latestStamps.current.length > 0) {
        // First start of the desktop edition: keep the library from localStorage in the shell too
        void desktop.updateSettings({ stamps: latestStamps.current });
      } else if (savedStamps.length > 0) {
        // Union of the shell's library and the one in localStorage, the shell's entries win
        setStamps((current) => {
          const byId = new Map<string, SignatureStamp>();
          current.forEach((s) => byId.set(s.id, s));
          savedStamps.forEach((s) => byId.set(s.id, s));
          return Array.from(byId.values());
        });
      }
      settingsLoadedRef.current = true;
      // Command line / "Open with" file, or the last document when the user enabled reopening it
      const launchFile = await desktop.getLaunchFile();
      if (launchFile && !cancelled) await openPath(launchFile, { skipDiscardCheck: true });
    })().catch((err) => logger.error('system', `Načtení nastavení desktopové aplikace selhalo: ${err?.message || err}`));
    return () => {
      cancelled = true;
    };
    // Runs once; openPath and the setters are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In-app changes of theme, language and signatures are stored by the shell (and drive its menu)
  useEffect(() => {
    if (settingsLoadedRef.current) void getDesktopApi()?.updateSettings({ theme, language });
  }, [theme, language]);

  useEffect(() => {
    if (settingsLoadedRef.current) void getDesktopApi()?.updateSettings({ stamps });
  }, [stamps]);

  // Window title, dirty marker and the close guard of the shell
  useEffect(() => {
    getDesktopApi()?.notifyDocumentState({
      hasUnsavedChanges: isDirty,
      filePath,
      fileName: pages.length > 0 ? fileName : '',
    });
  }, [isDirty, filePath, fileName, pages.length]);

  // Messages from the shell that concern files (menu commands are handled by useAppCommands)
  useEffect(() => {
    return onDesktopMessage((message) => {
      switch (message.type) {
        case 'open-path':
          void openPath(message.path);
          break;
        case 'recent-files':
          setRecentFiles(message.files);
          break;
        case 'settings':
          if (message.settings.theme !== latest.current.theme) latest.current.setTheme(message.settings.theme as AppTheme);
          if (message.settings.language !== latest.current.language) latest.current.setLanguage(message.settings.language);
          break;
        case 'save-before-close':
          void saveDocument({ skipConfirm: true }).then((saved) => getDesktopApi()?.confirmSaveBeforeClose(saved));
          break;
        default:
          break;
      }
    });
  }, [openPath, saveDocument]);

  // Browser: warn before leaving the page with unsaved changes (the desktop shell asks on close itself)
  useEffect(() => {
    if (isDesktop || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDesktop, isDirty]);

  const value: FileContextType = {
    isDesktop,
    filePath,
    recentFiles,
    notice,
    openDocument,
    openFile,
    openSample,
    openPath,
    requestSave,
    saveDocument,
    pendingSaveAs,
    newDocument,
    closeDocument,
    clearRecentFiles,
    showNotice,
  };

  return <FileContext.Provider value={value}>{children}</FileContext.Provider>;
};

export const useFiles = (): FileContextType => {
  const context = useContext(FileContext);
  if (!context) throw new Error('useFiles must be used within FileProvider');
  return context;
};
