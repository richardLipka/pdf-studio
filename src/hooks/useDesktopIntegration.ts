import { useEffect, useState, useCallback, useRef } from 'react';
import { useDocument } from '../context/DocumentContext';
import { useEditor } from '../context/EditorContext';
import { useTheme, AppTheme } from '../context/ThemeContext';
import { useI18n } from '../i18n/context';
import {
  isDesktopApp,
  desktopOpenFile,
  desktopReadFileDirect,
  desktopSaveDirect,
  desktopSaveFileDialog,
  desktopGetLaunchFilePath,
  getDesktopRecentFiles,
  addDesktopRecentFile,
  clearDesktopRecentFiles,
  getDesktopSettings,
  setDesktopSetting,
  notifyDesktopDocumentState,
  onDesktopMenuAction,
} from '../services/desktopBridge';
import { RecentFileItem } from '../types/electron';

export interface UseDesktopIntegrationResult {
  isDesktop: boolean;
  desktopFilePath: string | null;
  recentFiles: RecentFileItem[];
  openRecentFile: (filePath: string) => Promise<boolean>;
  clearRecent: () => Promise<void>;
  saveCurrentDocument: (skipConfirm?: boolean) => Promise<boolean>;
  saveCurrentDocumentAs: () => Promise<boolean>;
}

export const useDesktopIntegration = (): UseDesktopIntegrationResult => {
  const isDesktop = isDesktopApp();
  const [desktopFilePath, setDesktopFilePath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFileItem[]>([]);

  const {
    fileName,
    canUndo,
    loadPdfBuffer,
    exportPdfBytes,
    undo,
    redo,
    setScale,
    zoomToFitPage,
    zoomToFitWidth,
    setIsSidebarOpen,
    isSidebarOpen,
    pages,
  } = useDocument();

  const {
    rasterSettings,
    setIsLogModalOpen,
    setActiveTool,
    openSignatureModal,
  } = useEditor();

  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useI18n();

  const desktopFilePathRef = useRef<string | null>(desktopFilePath);
  desktopFilePathRef.current = desktopFilePath;
  const initialSettingsLoadedRef = useRef(false);

  // 1. Initial Load: Read recent files and persistent settings from OS AppData
  useEffect(() => {
    if (!isDesktop) return;

    getDesktopRecentFiles().then((list) => {
      setRecentFiles(list);
    });

    getDesktopSettings().then((settings) => {
      if (settings?.theme && ['default', 'minimal', 'lcars'].includes(settings.theme)) {
        setTheme(settings.theme as AppTheme);
      }
      if (settings?.language && ['cs', 'en'].includes(settings.language)) {
        setLanguage(settings.language as 'cs' | 'en');
      }
      initialSettingsLoadedRef.current = true;
    });
  }, [isDesktop, setTheme, setLanguage]);

  // 1b. Sync Language & Theme from Basic App to Desktop Main Process & Menu
  useEffect(() => {
    if (!isDesktop || !initialSettingsLoadedRef.current) return;
    setDesktopSetting('language', language);
  }, [isDesktop, language]);

  useEffect(() => {
    if (!isDesktop || !initialSettingsLoadedRef.current) return;
    setDesktopSetting('theme', theme);
  }, [isDesktop, theme]);

  // 2. Notify Desktop Main Process about dirty/clean document state
  useEffect(() => {
    if (!isDesktop) return;

    notifyDesktopDocumentState({
      hasUnsavedChanges: canUndo,
      filePath: desktopFilePath || undefined,
      fileName,
    });
  }, [isDesktop, canUndo, desktopFilePath, fileName]);

  // 3. Open file by path directly
  const openRecentFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      if (!isDesktop) return false;
      if (desktopFilePathRef.current === filePath && pages.length > 0) {
        return true;
      }
      try {
        const res = await desktopReadFileDirect(filePath);
        if (res && !res.cancelled && res.data) {
          const buffer = (res.data.buffer as ArrayBuffer).slice(
            res.data.byteOffset,
            res.data.byteOffset + res.data.byteLength
          );
          await loadPdfBuffer(res.fileName || 'document.pdf', buffer);
          setDesktopFilePath(filePath);
          await addDesktopRecentFile(filePath, res.fileName);
          const updated = await getDesktopRecentFiles();
          setRecentFiles(updated);
          return true;
        }
      } catch (err) {
        console.error('Failed to open recent desktop file:', err);
      }
      return false;
    },
    [isDesktop, loadPdfBuffer, pages.length]
  );

  // 3b. Initial Load: Open CLI argument file if launched with a parameter
  useEffect(() => {
    if (!isDesktop) return;

    desktopGetLaunchFilePath().then((launchPath) => {
      if (launchPath) {
        openRecentFile(launchPath);
      }
    });
  }, [isDesktop, openRecentFile]);

  // 4. Clear recent files list
  const clearRecent = useCallback(async () => {
    if (!isDesktop) return;
    await clearDesktopRecentFiles();
    setRecentFiles([]);
  }, [isDesktop]);

  // 5. Save Current Document (Direct disk write if filePath known, else Save Dialog)
  const saveCurrentDocument = useCallback(
    async (skipConfirm: boolean = false): Promise<boolean> => {
      if (!isDesktop || pages.length === 0) return false;

      const bytes = await exportPdfBytes(fileName, rasterSettings);
      if (!bytes || bytes.length === 0) return false;

      const currentPath = desktopFilePathRef.current;
      if (currentPath) {
        // Overwrite file directly on disk (prompts user with warning dialog unless skipConfirm)
        const res = await desktopSaveDirect(currentPath, bytes, skipConfirm);
        if (res?.success) {
          notifyDesktopDocumentState({
            hasUnsavedChanges: false,
            filePath: currentPath,
            fileName,
          });
          return true;
        }
        if (res?.cancelled) {
          // User explicitly cancelled the overwrite confirmation dialog
          return false;
        }
      }

      // Fallback to Save As dialog
      const res = await desktopSaveFileDialog(fileName, bytes);
      if (res && !res.cancelled && res.filePath) {
        setDesktopFilePath(res.filePath);
        await addDesktopRecentFile(res.filePath);
        const updated = await getDesktopRecentFiles();
        setRecentFiles(updated);
        notifyDesktopDocumentState({
          hasUnsavedChanges: false,
          filePath: res.filePath,
          fileName,
        });
        return true;
      }
      return false;
    },
    [isDesktop, pages.length, exportPdfBytes, fileName, rasterSettings]
  );

  // 6. Save Current Document As...
  const saveCurrentDocumentAs = useCallback(async (): Promise<boolean> => {
    if (!isDesktop || pages.length === 0) return false;

    const bytes = await exportPdfBytes(fileName, rasterSettings);
    if (!bytes || bytes.length === 0) return false;

    const res = await desktopSaveFileDialog(fileName, bytes);
    if (res && !res.cancelled && res.filePath) {
      setDesktopFilePath(res.filePath);
      await addDesktopRecentFile(res.filePath);
      const updated = await getDesktopRecentFiles();
      setRecentFiles(updated);
      notifyDesktopDocumentState({
        hasUnsavedChanges: false,
        filePath: res.filePath,
        fileName,
      });
      return true;
    }
    return false;
  }, [isDesktop, pages.length, exportPdfBytes, fileName, rasterSettings]);

  // 7. Subscribe to IPC actions sent from Desktop Application Menu
  useEffect(() => {
    if (!isDesktop) return;

    const unsubscribe = onDesktopMenuAction(async (action: string, payload?: any) => {
      switch (action) {
        case 'trigger-open-dialog': {
          const res = await desktopOpenFile();
          if (res && !res.cancelled && res.data) {
            const buffer = (res.data.buffer as ArrayBuffer).slice(
              res.data.byteOffset,
              res.data.byteOffset + res.data.byteLength
            );
            await loadPdfBuffer(res.fileName || 'document.pdf', buffer);
            if (res.filePath) {
              setDesktopFilePath(res.filePath);
              await addDesktopRecentFile(res.filePath, res.fileName);
              const updated = await getDesktopRecentFiles();
              setRecentFiles(updated);
            }
          }
          break;
        }

        case 'open-file-path': {
          if (typeof payload === 'string') {
            await openRecentFile(payload);
          }
          break;
        }

        case 'recent-files-updated': {
          if (Array.isArray(payload)) {
            setRecentFiles(payload);
          } else {
            getDesktopRecentFiles().then(setRecentFiles);
          }
          break;
        }

        case 'trigger-save': {
          await saveCurrentDocument();
          break;
        }

        case 'trigger-save-as': {
          await saveCurrentDocumentAs();
          break;
        }

        case 'trigger-save-and-close': {
          const saved = await saveCurrentDocument(true);
          if (saved && typeof window !== 'undefined') {
            window.close();
          }
          break;
        }

        case 'trigger-undo': {
          undo();
          break;
        }

        case 'trigger-redo': {
          redo();
          break;
        }

        case 'zoom-in': {
          setScale((prev) => Math.min(3.0, prev + 0.15));
          break;
        }

        case 'zoom-out': {
          setScale((prev) => Math.max(0.2, prev - 0.15));
          break;
        }

        case 'zoom-reset': {
          setScale(1.0);
          break;
        }

        case 'fit-page': {
          zoomToFitPage();
          break;
        }

        case 'fit-width': {
          zoomToFitWidth();
          break;
        }

        case 'toggle-sidebar': {
          setIsSidebarOpen(!isSidebarOpen);
          break;
        }

        case 'trigger-cert-sign': {
          openSignatureModal('certificate');
          break;
        }

        case 'show-log-modal': {
          setIsLogModalOpen(true);
          break;
        }

        case 'change-theme': {
          if (payload && ['default', 'minimal', 'lcars'].includes(payload)) {
            setTheme(payload as AppTheme);
            setDesktopSetting('theme', payload);
          }
          break;
        }

        case 'change-lang': {
          if (payload && ['cs', 'en'].includes(payload)) {
            setLanguage(payload as 'cs' | 'en');
            setDesktopSetting('language', payload);
          }
          break;
        }

        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    isDesktop,
    loadPdfBuffer,
    openRecentFile,
    saveCurrentDocument,
    saveCurrentDocumentAs,
    undo,
    redo,
    setScale,
    zoomToFitPage,
    zoomToFitWidth,
    setIsSidebarOpen,
    isSidebarOpen,
    openSignatureModal,
    setActiveTool,
    setIsLogModalOpen,
    setTheme,
    setLanguage,
  ]);

  return {
    isDesktop,
    desktopFilePath,
    recentFiles,
    openRecentFile,
    clearRecent,
    saveCurrentDocument,
    saveCurrentDocumentAs,
  };
};
