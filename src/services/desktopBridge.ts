/**
 * Access to the desktop shell (Electron, `desktop` branch). In the browser `window.electronAPI` does
 * not exist and every helper is a harmless no-op, so the web app and the desktop edition share all
 * of their code; see src/shared/desktopApi.ts for the contract.
 */
import type { DesktopMessage, ElectronAPI } from '../shared/desktopApi';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** The desktop API, or null in the browser */
export const getDesktopApi = (): ElectronAPI | null =>
  typeof window !== 'undefined' && window.electronAPI?.isDesktop ? window.electronAPI : null;

/** True inside the desktop edition */
export const isDesktopApp = (): boolean => getDesktopApi() !== null;

/** Disk path of a File from a file input or drag & drop; null in the browser or when it has none */
export const getDesktopFilePath = (file: File): string | null => {
  const api = getDesktopApi();
  if (!api) return null;
  try {
    return api.getPathForFile(file) || null;
  } catch {
    return null;
  }
};

/** Subscribes to messages from the desktop shell (menu commands, files to open...) */
export const onDesktopMessage = (listener: (message: DesktopMessage) => void): (() => void) => {
  const api = getDesktopApi();
  return api ? api.onMessage(listener) : () => {};
};

/** Copies the bytes of an IPC result into a standalone ArrayBuffer */
export const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
