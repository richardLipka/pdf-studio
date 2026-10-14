import { RecentFileItem, FileDataResult } from '../types/electron';

/**
 * Returns true if running inside the Electron Desktop application
 */
export const isDesktopApp = (): boolean => {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isDesktop);
};

/**
 * Triggers native OS file open dialog
 */
export const desktopOpenFile = async (): Promise<FileDataResult | null> => {
  if (!isDesktopApp() || !window.electronAPI) return null;
  return await window.electronAPI.openFileDialog();
};

/**
 * Reads a file directly from local disk
 */
export const desktopReadFileDirect = async (filePath: string): Promise<FileDataResult | null> => {
  if (!isDesktopApp() || !window.electronAPI) return null;
  return await window.electronAPI.readFileDirect(filePath);
};

/**
 * Triggers native OS save dialog (Save As...)
 */
export const desktopSaveFileDialog = async (
  defaultFileName: string,
  data: Uint8Array
): Promise<{ cancelled: boolean; filePath?: string; error?: string } | null> => {
  if (!isDesktopApp() || !window.electronAPI) return null;
  return await window.electronAPI.saveFileDialog(defaultFileName, data);
};

/**
 * Directly writes PDF bytes to the existing disk file (Quick Save)
 */
export const desktopSaveDirect = async (
  filePath: string,
  data: Uint8Array
): Promise<{ success: boolean; filePath?: string; error?: string } | null> => {
  if (!isDesktopApp() || !window.electronAPI) return null;
  return await window.electronAPI.saveFileDirect(filePath, data);
};

/**
 * Retrieves the list of recently opened files
 */
export const getDesktopRecentFiles = async (): Promise<RecentFileItem[]> => {
  if (!isDesktopApp() || !window.electronAPI) return [];
  return await window.electronAPI.getRecentFiles();
};

/**
 * Adds or bumps a file in the recent files list
 */
export const addDesktopRecentFile = async (filePath: string, name?: string): Promise<void> => {
  if (!isDesktopApp() || !window.electronAPI) return;
  await window.electronAPI.addRecentFile(filePath, name);
};

/**
 * Clears the recent files list
 */
export const clearDesktopRecentFiles = async (): Promise<void> => {
  if (!isDesktopApp() || !window.electronAPI) return;
  await window.electronAPI.clearRecentFiles();
};

/**
 * Retrieves the path of the last opened document
 */
export const getDesktopLastOpenFile = async (): Promise<string | null> => {
  if (!isDesktopApp() || !window.electronAPI) return null;
  return await window.electronAPI.getLastOpenFilePath();
};

/**
 * Reads all desktop application settings from OS AppData
 */
export const getDesktopSettings = async (): Promise<Record<string, any>> => {
  if (!isDesktopApp() || !window.electronAPI) return {};
  return await window.electronAPI.getSettings();
};

/**
 * Updates a specific desktop setting in OS AppData
 */
export const setDesktopSetting = async (key: string, value: any): Promise<void> => {
  if (!isDesktopApp() || !window.electronAPI) return;
  await window.electronAPI.setSetting(key, value);
};

/**
 * Notifies the desktop main process about document state (for title bar dirty indicator and close guard)
 */
export const notifyDesktopDocumentState = (state: {
  hasUnsavedChanges: boolean;
  filePath?: string;
  fileName?: string;
}): void => {
  if (!isDesktopApp() || !window.electronAPI) return;
  window.electronAPI.notifyDocumentState(state);
};

/**
 * Subscribes to desktop native application menu actions
 */
export const onDesktopMenuAction = (
  callback: (action: string, payload?: any) => void
): (() => void) => {
  if (!isDesktopApp() || !window.electronAPI) {
    return () => {};
  }
  return window.electronAPI.onMenuAction(callback);
};
