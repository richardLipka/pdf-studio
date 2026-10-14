/**
 * Contract between the web app and the Electron shell of the desktop edition.
 *
 * The web app (this repository's `master` branch) only talks to the desktop shell through
 * `window.electronAPI`, which the preload script of the `desktop` branch (desktop/electron/preload.ts)
 * implements against these types. The desktop build type-checks against this file, so a change here
 * that the shell does not follow fails the desktop build instead of breaking at runtime.
 *
 * This module must stay free of browser and Node APIs (types and plain constants only).
 */
import type { AppCommandId } from './appCommands';

export type DesktopTheme = 'default' | 'minimal' | 'lcars';
export type DesktopLanguage = 'cs' | 'en';

export interface RecentFileItem {
  path: string;
  name: string;
  lastOpened: number;
  size?: number;
}

export interface FileOpenResult {
  cancelled: boolean;
  filePath?: string;
  fileName?: string;
  data?: Uint8Array;
  error?: string;
}

export interface FileSaveResult {
  /** True when the user cancelled the save dialog or the overwrite confirmation */
  cancelled: boolean;
  filePath?: string;
  error?: string;
}

export interface DesktopRasterSettings {
  scale: number;
  format: 'image/jpeg' | 'image/png';
  jpegQuality: number;
}

export interface TextFileOpenResult {
  cancelled: boolean;
  filePath?: string;
  content?: string;
  error?: string;
}

export interface DesktopWindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

/** Settings persisted by the desktop shell (pdf-studio-settings.json in the user data folder) */
export interface DesktopSettings {
  theme: DesktopTheme;
  language: DesktopLanguage;
  /** Open the last document again when the app starts without a file argument */
  reopenLastFileOnStartup: boolean;
  /** Ask before Save overwrites the opened file */
  confirmOverwrite: boolean;
  lastOpenFilePath: string;
  recentFiles: RecentFileItem[];
  /** Saved signatures and stamps (same objects as the web app keeps in localStorage) */
  stamps: unknown[];
  /** Fallback rasterization settings of the export (null: the web app's defaults) */
  rasterSettings: DesktopRasterSettings | null;
  windowBounds: DesktopWindowBounds;
}

/** The settings the web app may change; window bounds and recent files are managed by the shell */
export type DesktopSettingsPatch = Partial<
  Pick<DesktopSettings, 'theme' | 'language' | 'reopenLastFileOnStartup' | 'confirmOverwrite' | 'stamps' | 'rasterSettings'>
>;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  theme: 'default',
  language: 'cs',
  reopenLastFileOnStartup: true,
  confirmOverwrite: true,
  lastOpenFilePath: '',
  recentFiles: [],
  stamps: [],
  rasterSettings: null,
  windowBounds: { width: 1400, height: 900, isMaximized: false },
};

export const MAX_RECENT_FILES = 15;

export interface DesktopDocumentState {
  hasUnsavedChanges: boolean;
  filePath: string | null;
  fileName: string;
}

/** Messages the shell sends to the web app; menu items send the command they stand for */
export type DesktopMessage =
  | { type: 'command'; command: AppCommandId }
  | { type: 'open-path'; path: string }
  | { type: 'recent-files'; files: RecentFileItem[] }
  | { type: 'settings'; settings: DesktopSettings }
  | { type: 'save-before-close' }
  /** The opened file was changed on disk by another program */
  | { type: 'file-changed'; path: string };

export interface ElectronAPI {
  isDesktop: true;
  platform: string;
  /** Native open dialog; the file is read and added to the recent files */
  openFile: () => Promise<FileOpenResult>;
  /** Reads a file by path (recent files, command line, dropped files) */
  readFile: (filePath: string) => Promise<FileOpenResult>;
  /** Writes the opened file in place (asks first when confirmOverwrite is on, unless skipConfirm) */
  saveFile: (filePath: string, data: Uint8Array, skipConfirm?: boolean) => Promise<FileSaveResult>;
  /** Native save dialog, then writes the file */
  saveFileAs: (defaultFileName: string, data: Uint8Array) => Promise<FileSaveResult>;
  /** Native save dialog for a text file (settings backup), then writes it */
  saveTextFile: (defaultFileName: string, content: string) => Promise<FileSaveResult>;
  /** Native open dialog for a text file (settings backup) */
  openTextFile: () => Promise<TextFileOpenResult>;
  /** Disk path of a File from a file input or drag & drop ('' when it has none) */
  getPathForFile: (file: File) => string;
  /** File the app was started with (command line, "Open with"); returned only once */
  getLaunchFile: () => Promise<string | null>;
  getRecentFiles: () => Promise<RecentFileItem[]>;
  clearRecentFiles: () => Promise<RecentFileItem[]>;
  getSettings: () => Promise<DesktopSettings>;
  updateSettings: (patch: DesktopSettingsPatch) => Promise<DesktopSettings>;
  /** Window title, dirty marker and the unsaved-changes guard when closing */
  notifyDocumentState: (state: DesktopDocumentState) => void;
  /** Tells the shell the save requested by 'save-before-close' finished, so it can close (or not) */
  confirmSaveBeforeClose: (saved: boolean) => void;
  onMessage: (listener: (message: DesktopMessage) => void) => () => void;
}

/** IPC channel names shared by the preload script and the main process */
export const IPC_CHANNELS = {
  openFile: 'pdf-studio:open-file',
  readFile: 'pdf-studio:read-file',
  saveFile: 'pdf-studio:save-file',
  saveFileAs: 'pdf-studio:save-file-as',
  saveTextFile: 'pdf-studio:save-text-file',
  openTextFile: 'pdf-studio:open-text-file',
  getLaunchFile: 'pdf-studio:get-launch-file',
  getRecentFiles: 'pdf-studio:get-recent-files',
  clearRecentFiles: 'pdf-studio:clear-recent-files',
  getSettings: 'pdf-studio:get-settings',
  updateSettings: 'pdf-studio:update-settings',
  documentState: 'pdf-studio:document-state',
  saveBeforeCloseDone: 'pdf-studio:save-before-close-done',
  message: 'pdf-studio:message',
} as const;
