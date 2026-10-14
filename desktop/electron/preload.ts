import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/desktopApi';
import type { DesktopMessage, ElectronAPI } from '../../src/shared/desktopApi';

/*
 * Exposes window.electronAPI (src/shared/desktopApi.ts) to the web app. The renderer runs sandboxed
 * with context isolation: it has no Node access, only these calls.
 */

const api: ElectronAPI = {
  isDesktop: true,
  platform: process.platform,
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.openFile),
  readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.readFile, filePath),
  saveFile: (filePath, data, skipConfirm) => ipcRenderer.invoke(IPC_CHANNELS.saveFile, filePath, data, skipConfirm === true),
  saveFileAs: (defaultFileName, data) => ipcRenderer.invoke(IPC_CHANNELS.saveFileAs, defaultFileName, data),
  saveTextFile: (defaultFileName, content) => ipcRenderer.invoke(IPC_CHANNELS.saveTextFile, defaultFileName, content),
  openTextFile: () => ipcRenderer.invoke(IPC_CHANNELS.openTextFile),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getLaunchFile: () => ipcRenderer.invoke(IPC_CHANNELS.getLaunchFile),
  getRecentFiles: () => ipcRenderer.invoke(IPC_CHANNELS.getRecentFiles),
  clearRecentFiles: () => ipcRenderer.invoke(IPC_CHANNELS.clearRecentFiles),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  notifyDocumentState: (state) => ipcRenderer.send(IPC_CHANNELS.documentState, state),
  confirmSaveBeforeClose: (saved) => ipcRenderer.send(IPC_CHANNELS.saveBeforeCloseDone, saved),
  onMessage: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: DesktopMessage) => listener(message);
    ipcRenderer.on(IPC_CHANNELS.message, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.message, handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
