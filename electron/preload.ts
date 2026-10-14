import { contextBridge, ipcRenderer } from 'electron';

export interface FileDataResult {
  cancelled: boolean;
  filePath?: string;
  fileName?: string;
  data?: Uint8Array;
  error?: string;
}

export interface ElectronAPI {
  isDesktop: boolean;
  platform: string;

  // Native File Dialogs & Direct Disk Access
  openFileDialog: () => Promise<FileDataResult>;
  saveFileDialog: (defaultFileName: string, data: Uint8Array) => Promise<{ cancelled: boolean; filePath?: string; error?: string }>;
  saveFileDirect: (filePath: string, data: Uint8Array, skipConfirm?: boolean) => Promise<{ success: boolean; cancelled?: boolean; filePath?: string; error?: string }>;
  readFileDirect: (filePath: string) => Promise<FileDataResult>;
  getLaunchFilePath: () => Promise<string | null>;

  // Recent Files & Last File
  getRecentFiles: () => Promise<Array<{ path: string; name: string; lastOpened: number; size?: number }>>;
  addRecentFile: (filePath: string, name?: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  getLastOpenFilePath: () => Promise<string | null>;

  // Desktop App Settings
  getSettings: () => Promise<any>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<void>;
  getSignatures: () => Promise<any[]>;
  saveSignatures: (stamps: any[]) => Promise<void>;

  // Document State Notification (e.g. for window title & close guard)
  notifyDocumentState: (state: { hasUnsavedChanges: boolean; filePath?: string; fileName?: string }) => void;

  // IPC Menu Action Listener
  onMenuAction: (callback: (action: string, payload?: any) => void) => () => void;
}

const electronAPI: ElectronAPI = {
  isDesktop: true,
  platform: process.platform,

  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultFileName: string, data: Uint8Array) =>
    ipcRenderer.invoke('dialog:saveFile', defaultFileName, data),
  saveFileDirect: (filePath: string, data: Uint8Array, skipConfirm?: boolean) =>
    ipcRenderer.invoke('file:saveDirect', filePath, data, skipConfirm),
  readFileDirect: (filePath: string) => ipcRenderer.invoke('file:readDirect', filePath),
  getLaunchFilePath: () => ipcRenderer.invoke('app:getLaunchFile'),

  getRecentFiles: () => ipcRenderer.invoke('recent:get'),
  addRecentFile: (filePath: string, name?: string) =>
    ipcRenderer.invoke('recent:add', filePath, name),
  clearRecentFiles: () => ipcRenderer.invoke('recent:clear'),
  getLastOpenFilePath: () => ipcRenderer.invoke('recent:getLastOpened'),

  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  getSignatures: () => ipcRenderer.invoke('stamps:get'),
  saveSignatures: (stamps: any[]) => ipcRenderer.invoke('stamps:save', stamps),

  notifyDocumentState: (state) => ipcRenderer.send('document:stateChanged', state),

  onMenuAction: (callback) => {
    const handler = (_event: any, action: string, payload: any) => {
      callback(action, payload);
    };
    ipcRenderer.on('menu:action', handler);
    return () => {
      ipcRenderer.removeListener('menu:action', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
