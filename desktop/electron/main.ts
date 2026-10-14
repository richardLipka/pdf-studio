import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cs } from '../../src/i18n/cs';
import { en } from '../../src/i18n/en';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopDocumentState,
  DesktopMessage,
  DesktopSettingsPatch,
  FileOpenResult,
  FileSaveResult,
  IPC_CHANNELS,
  TextFileOpenResult,
} from '../../src/shared/desktopApi';
import { findPdfArgument } from './cli';
import { buildMenuTemplate } from './menu';
import { SettingsStore } from './settingsStore';

/*
 * Main process of the desktop edition. The window shows the web app (../dist built into build/web)
 * and this process gives it what a browser cannot: native open/save dialogs, saving the opened file
 * in place, recent files, the command-line file, persistent settings and a native menu.
 */

const isFile = (filePath: string) => fs.statSync(filePath).isFile();

// The portable build keeps its settings next to the executable instead of in AppData
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PDF Studio Data'));
}

const devServerUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const webIndex = path.join(__dirname, 'web', 'index.html');

let mainWindow: BrowserWindow | null = null;
let store: SettingsStore;
let launchFile: string | null = findPdfArgument(process.argv, { cwd: process.cwd(), isFile });
let launchFileServed = false;
let documentState: DesktopDocumentState = { hasUnsavedChanges: false, filePath: null, fileName: '' };
let allowClose = false;

const strings = () => (store?.get('language') === 'en' ? en : cs);

const send = (message: DesktopMessage) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.message, message);
};

const refreshMenu = () => {
  const template = buildMenuTemplate({
    strings: strings(),
    settings: store.getAll(),
    recentFiles: store.get('recentFiles'),
    isMac: process.platform === 'darwin',
    appName: app.getName(),
    command: (command) => send({ type: 'command', command }),
    openPath: (filePath) => send({ type: 'open-path', path: filePath }),
    openedFilePath: documentState.filePath,
    showInFolder: () => {
      if (documentState.filePath) shell.showItemInFolder(documentState.filePath);
    },
    clearRecentFiles: () => {
      send({ type: 'recent-files', files: store.clearRecentFiles() });
      app.clearRecentDocuments();
      refreshMenu();
    },
    updateSettings: (patch) => {
      store.update(patch);
      refreshMenu();
      send({ type: 'settings', settings: store.getAll() });
    },
    openExternal: (url) => void shell.openExternal(url),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const recentFilesChanged = () => {
  send({ type: 'recent-files', files: store.get('recentFiles') });
  refreshMenu();
};

const updateWindowTitle = () => {
  if (!mainWindow) return;
  const name = documentState.fileName || (documentState.filePath ? path.basename(documentState.filePath) : '');
  mainWindow.setTitle(name ? `${documentState.hasUnsavedChanges ? '● ' : ''}${name} — PDF Studio` : 'PDF Studio');
  // Windows / macOS "modified" indicators
  mainWindow.setDocumentEdited?.(documentState.hasUnsavedChanges);
};

// ---------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------

const pdfFilters = () => [
  { name: strings().desktopMenu.pdfFilter, extensions: ['pdf'] },
  { name: strings().desktopMenu.allFilesFilter, extensions: ['*'] },
];

const defaultDirectory = () => {
  const last = store.get('lastOpenFilePath');
  return last ? path.dirname(last) : app.getPath('documents');
};

const readPdf = async (filePath: string): Promise<FileOpenResult> => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error(strings().desktopMenu.fileNotFound), { code: 'ENOENT' });
    const data = await fs.promises.readFile(filePath);
    store.addRecentFile(filePath, stat.size);
    app.addRecentDocument(filePath);
    rememberFileVersion(filePath, stat);
    recentFilesChanged();
    return {
      cancelled: false,
      filePath,
      fileName: path.basename(filePath),
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // A recent file that was moved or deleted: drop it from the list
      store.removeRecentFile(filePath);
      recentFilesChanged();
      return { cancelled: true, filePath, fileName: path.basename(filePath), error: strings().desktopMenu.fileNotFound };
    }
    return { cancelled: true, filePath, fileName: path.basename(filePath), error: err?.message || String(err) };
  }
};

/** Writes next to the target and renames, so a failed write never destroys the original file */
const writeFileAtomic = async (filePath: string, data: Uint8Array) => {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
};

const writePdf = async (filePath: string, data: Uint8Array): Promise<FileSaveResult> => {
  try {
    await writeFileAtomic(filePath, data);
    rememberFileVersion(filePath, await fs.promises.stat(filePath));
    store.addRecentFile(filePath, data.byteLength);
    app.addRecentDocument(filePath);
    recentFilesChanged();
    return { cancelled: false, filePath };
  } catch (err: any) {
    return { cancelled: false, filePath, error: err?.message || String(err) };
  }
};

// ---------------------------------------------------------------------------------------------------
// The opened file changed on disk (another program saved it): the web app offers to reload it
// ---------------------------------------------------------------------------------------------------

const WATCH_INTERVAL_MS = 2000;
let watchedPath: string | null = null;
// Size and modification time of the version the app last read or wrote, per path
const knownVersions = new Map<string, { size: number; mtimeMs: number }>();

function rememberFileVersion(filePath: string, stat: fs.Stats) {
  knownVersions.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs });
}

const onWatchedFileChange = (current: fs.Stats) => {
  const filePath = watchedPath;
  if (!filePath || current.mtimeMs === 0) return; // deleted or not there (yet): nothing to reload
  const known = knownVersions.get(filePath);
  if (known && known.size === current.size && known.mtimeMs === current.mtimeMs) return; // our own write
  rememberFileVersion(filePath, current);
  send({ type: 'file-changed', path: filePath });
};

const watchOpenedFile = (filePath: string | null) => {
  if (filePath === watchedPath) return;
  if (watchedPath) fs.unwatchFile(watchedPath, onWatchedFileChange);
  watchedPath = filePath;
  if (filePath) fs.watchFile(filePath, { interval: WATCH_INTERVAL_MS, persistent: false }, onWatchedFileChange);
};

const TEXT_FILE_LIMIT = 64 * 1024 * 1024;

const assertString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
};

const assertBytes = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array)) throw new Error('Invalid file data');
  return value;
};

const registerIpcHandlers = () => {
  ipcMain.handle(IPC_CHANNELS.openFile, async (): Promise<FileOpenResult> => {
    if (!mainWindow) return { cancelled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: strings().desktopMenu.openDialogTitle,
      defaultPath: defaultDirectory(),
      filters: pdfFilters(),
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return readPdf(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.readFile, (_event, filePath: unknown) => readPdf(assertString(filePath, 'path')));

  ipcMain.handle(
    IPC_CHANNELS.saveFile,
    async (_event, filePath: unknown, data: unknown, skipConfirm?: unknown): Promise<FileSaveResult> => {
      const target = assertString(filePath, 'path');
      const bytes = assertBytes(data);
      if (mainWindow && store.get('confirmOverwrite') && skipConfirm !== true && fs.existsSync(target)) {
        const m = strings().desktopMenu;
        const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [m.overwrite, m.cancel],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: m.overwriteTitle,
          message: m.overwriteMessage.replace('{name}', path.basename(target)),
          detail: m.overwriteDetail.replace('{path}', target),
          checkboxLabel: m.dontAskAgain,
          checkboxChecked: false,
        });
        if (response !== 0) return { cancelled: true };
        if (checkboxChecked) {
          store.update({ confirmOverwrite: false });
          refreshMenu();
        }
      }
      return writePdf(target, bytes);
    }
  );

  ipcMain.handle(IPC_CHANNELS.saveFileAs, async (_event, defaultName: unknown, data: unknown): Promise<FileSaveResult> => {
    const bytes = assertBytes(data);
    if (!mainWindow) return { cancelled: true };
    const suggested = typeof defaultName === 'string' && defaultName ? defaultName : 'document.pdf';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: strings().desktopMenu.saveDialogTitle,
      defaultPath: path.isAbsolute(suggested) ? suggested : path.join(defaultDirectory(), suggested),
      filters: pdfFilters(),
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    return writePdf(result.filePath, bytes);
  });

  // Settings backups (JSON)
  ipcMain.handle(IPC_CHANNELS.saveTextFile, async (_event, defaultName: unknown, content: unknown): Promise<FileSaveResult> => {
    if (!mainWindow) return { cancelled: true };
    if (typeof content !== 'string') throw new Error('Invalid file content');
    const suggested = typeof defaultName === 'string' && defaultName ? path.basename(defaultName) : 'pdf-studio-settings.json';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: strings().commands.backupSettings.replace(/…$/, ''),
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    try {
      await writeFileAtomic(result.filePath, new TextEncoder().encode(content));
      return { cancelled: false, filePath: result.filePath };
    } catch (err: any) {
      return { cancelled: false, filePath: result.filePath, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.openTextFile, async (): Promise<TextFileOpenResult> => {
    if (!mainWindow) return { cancelled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: strings().commands.restoreSettings.replace(/…$/, ''),
      defaultPath: app.getPath('documents'),
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: strings().desktopMenu.allFilesFilter, extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const filePath = result.filePaths[0];
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > TEXT_FILE_LIMIT) return { cancelled: false, filePath, error: 'File too large' };
      return { cancelled: false, filePath, content: await fs.promises.readFile(filePath, 'utf-8') };
    } catch (err: any) {
      return { cancelled: false, filePath, error: err?.message || String(err) };
    }
  });

  // The command-line file (once), otherwise the last document when reopening it is enabled
  ipcMain.handle(IPC_CHANNELS.getLaunchFile, () => {
    if (launchFileServed) return null;
    launchFileServed = true;
    if (launchFile) return launchFile;
    const last = store.get('lastOpenFilePath');
    if (store.get('reopenLastFileOnStartup') && last && fs.existsSync(last)) return last;
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.getRecentFiles, () => store.get('recentFiles'));

  ipcMain.handle(IPC_CHANNELS.clearRecentFiles, () => {
    const files = store.clearRecentFiles();
    refreshMenu();
    return files;
  });

  ipcMain.handle(IPC_CHANNELS.getSettings, () => store.getAll());

  ipcMain.handle(IPC_CHANNELS.updateSettings, (_event, patch: DesktopSettingsPatch) => {
    if (store.update(patch ?? {})) refreshMenu();
    return store.getAll();
  });

  ipcMain.on(IPC_CHANNELS.documentState, (_event, state: DesktopDocumentState) => {
    const previousPath = documentState.filePath;
    documentState = {
      hasUnsavedChanges: Boolean(state?.hasUnsavedChanges),
      filePath: typeof state?.filePath === 'string' ? state.filePath : null,
      fileName: typeof state?.fileName === 'string' ? state.fileName : '',
    };
    updateWindowTitle();
    if (documentState.filePath !== previousPath) {
      watchOpenedFile(documentState.filePath);
      refreshMenu(); // "Show in folder"
    }
  });

  ipcMain.on(IPC_CHANNELS.saveBeforeCloseDone, (_event, saved: unknown) => {
    if (saved === true && mainWindow) {
      allowClose = true;
      mainWindow.close();
    }
  });
};

// ---------------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------------

/** Saved bounds, without a position that is no longer on any display */
const initialBounds = () => {
  const saved = store.get('windowBounds') || DEFAULT_DESKTOP_SETTINGS.windowBounds;
  if (saved.x === undefined || saved.y === undefined) return { width: saved.width, height: saved.height };
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    return saved.x! < a.x + a.width - 100 && saved.x! + saved.width > a.x + 100 && saved.y! >= a.y - 10 && saved.y! < a.y + a.height - 100;
  });
  return visible ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: saved.width, height: saved.height };
};

const sameUrl = (a: string, b: string) => decodeURI(a).toLowerCase() === decodeURI(b).toLowerCase();
const isAppUrl = (url: string) =>
  devServerUrl
    ? url.startsWith(devServerUrl)
    : /^file:/i.test(url) && sameUrl(url.split(/[?#]/)[0], pathToFileURL(webIndex).href);

const createWindow = async () => {
  const bounds = initialBounds();
  const iconPath = path.join(__dirname, 'icon.png');
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: 'PDF Studio',
    backgroundColor: '#0f172a',
    show: false,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const win = mainWindow;
  if (store.get('windowBounds').isMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  let boundsTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    store.setWindowBounds({ ...(maximized ? store.get('windowBounds') : win.getBounds()), isMaximized: maximized });
  };
  const saveBoundsSoon = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  win.on('resize', saveBoundsSoon);
  win.on('move', saveBoundsSoon);

  // The title shows the document, not the page's <title>
  win.on('page-title-updated', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveBounds();
    if (allowClose || !documentState.hasUnsavedChanges) return;
    event.preventDefault();
    const m = strings().desktopMenu;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [m.saveAndClose, m.discard, m.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: m.unsavedTitle,
      message: m.unsavedMessage,
      detail: m.unsavedDetail,
    });
    if (choice === 0) {
      // The web app saves (asking for a file name if needed) and answers with saveBeforeCloseDone
      send({ type: 'save-before-close' });
    } else if (choice === 1) {
      allowClose = true;
      win.close();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // Links open in the system browser; the window itself never navigates away from the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const target = url || (event as unknown as { url?: string }).url || '';
    if (isAppUrl(target)) return;
    event.preventDefault();
    if (/^file:/i.test(target) && /\.pdf$/i.test(target.split(/[?#]/)[0])) {
      // A PDF dropped outside the drop zone: open it in the app instead of Chromium's viewer
      send({ type: 'open-path', path: fileURLToPath(target) });
    } else if (/^(https?|mailto):/i.test(target)) {
      void shell.openExternal(target);
    }
  });

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(webIndex);
  }
};

// ---------------------------------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // Another window is running: it receives our command line through 'second-instance'
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const filePath = findPdfArgument(argv, { cwd: workingDirectory, isFile });
    if (filePath) send({ type: 'open-path', path: filePath });
  });

  // macOS: files opened from Finder / the Dock
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) send({ type: 'open-path', path: filePath });
    else launchFile = filePath;
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('cz.zcu.fav.pdfstudio');
    const locale = app.getLocale().toLowerCase();
    store = new SettingsStore(path.join(app.getPath('userData'), 'pdf-studio-settings.json'), {
      ...DEFAULT_DESKTOP_SETTINGS,
      language: locale.startsWith('cs') || locale.startsWith('sk') ? 'cs' : 'en',
    });
    if (store.loadedFrom === 'backup') {
      console.warn('[settings] The settings file was unreadable; restored the last working copy');
    }
    registerIpcHandlers();
    refreshMenu();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    watchOpenedFile(null);
    if (process.platform !== 'darwin') app.quit();
  });
}
