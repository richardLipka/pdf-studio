export interface FileDataResult {
  cancelled: boolean;
  filePath?: string;
  fileName?: string;
  data?: Uint8Array;
  error?: string;
}

export interface RecentFileItem {
  path: string;
  name: string;
  lastOpened: number;
  size?: number;
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
  getRecentFiles: () => Promise<RecentFileItem[]>;
  addRecentFile: (filePath: string, name?: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  getLastOpenFilePath: () => Promise<string | null>;

  // Desktop App Settings
  getSettings: () => Promise<any>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<void>;
  getSignatures: () => Promise<any[]>;
  saveSignatures: (stamps: any[]) => Promise<void>;

  // Document State Notification
  notifyDocumentState: (state: { hasUnsavedChanges: boolean; filePath?: string; fileName?: string }) => void;

  // IPC Menu Action Listener
  onMenuAction: (callback: (action: string, payload?: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
