import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SettingsStore } from './settingsStore';
import { buildAppMenu } from './menu';

// Resolve directory path safely across CJS and ESM
const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

let mainWindow: BrowserWindow | null = null;
let settingsStore: SettingsStore;
let currentDocumentState = {
  hasUnsavedChanges: false,
  filePath: '',
  fileName: '',
};

// Guard single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function updateApplicationMenu() {
  if (!mainWindow) return;
  const menu = buildAppMenu(mainWindow, settingsStore, {
    sendAction: (action, payload) => {
      mainWindow?.webContents.send('menu:action', action, payload);
    },
  });
  Menu.setApplicationMenu(menu);
}

function updateWindowTitle() {
  if (!mainWindow) return;
  const baseTitle = 'PDF Studio';
  const fileName = currentDocumentState.fileName || (currentDocumentState.filePath ? path.basename(currentDocumentState.filePath) : '');
  const dirtyPrefix = currentDocumentState.hasUnsavedChanges ? '● ' : '';
  
  if (fileName) {
    mainWindow.setTitle(`${dirtyPrefix}${fileName} - ${baseTitle}`);
  } else {
    mainWindow.setTitle(baseTitle);
  }
}

async function createWindow() {
  settingsStore = new SettingsStore();
  const savedBounds = settingsStore.get('windowBounds') || { width: 1400, height: 900 };

  mainWindow = new BrowserWindow({
    x: savedBounds.x,
    y: savedBounds.y,
    width: savedBounds.width || 1400,
    height: savedBounds.height || 900,
    minWidth: 800,
    minHeight: 600,
    title: 'PDF Studio',
    backgroundColor: '#0f172a', // Matches Studio theme background
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  if (savedBounds.isMaximized) {
    mainWindow.maximize();
  }

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (!mainWindow) return;
    const isMaximized = mainWindow.isMaximized();
    if (!isMaximized) {
      const bounds = mainWindow.getBounds();
      settingsStore.set('windowBounds', { ...bounds, isMaximized: false });
    } else {
      const current = settingsStore.get('windowBounds') || { width: 1400, height: 900 };
      settingsStore.set('windowBounds', { ...current, isMaximized: true });
    }
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Set native menu
  updateApplicationMenu();

  // Close confirmation if unsaved changes exist
  mainWindow.on('close', (e) => {
    if (currentDocumentState.hasUnsavedChanges) {
      const isEn = settingsStore.get('language') === 'en';
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: isEn
          ? ['Save & Close', 'Discard Changes', 'Cancel']
          : ['Uložit a zavřít', 'Zahodit změny', 'Zrušit'],
        defaultId: 0,
        cancelId: 2,
        title: isEn ? 'Unsaved Changes' : 'Neuložené změny',
        message: isEn ? 'You have unsaved changes in this document.' : 'Máte neuložené změny v dokumentu.',
        detail: isEn ? 'Do you want to save the document before exiting?' : 'Chcete dokument před ukončením uložit?',
      });

      if (choice === 0) {
        // Trigger save and prevent immediate close; renderer will signal when done
        e.preventDefault();
        mainWindow?.webContents.send('menu:action', 'trigger-save-and-close');
        return;
      } else if (choice === 2) {
        // Cancel close
        e.preventDefault();
        return;
      }
      // If choice === 1 (discard), allow closing
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Determine URL to load
  const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL);
  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(currentDir, '../dist/index.html');
    await mainWindow.loadFile(indexPath);
  }

  // Check if launched with a file argument (e.g. double-click on PDF in Windows Explorer)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const fileArg = args.find((arg) => arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg));
  if (fileArg) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('menu:action', 'open-file-path', path.resolve(fileArg));
    });
  } else if (settingsStore.get('reopenLastFileOnStartup')) {
    const lastFile = settingsStore.get('lastOpenFilePath');
    if (lastFile && fs.existsSync(lastFile)) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('menu:action', 'open-file-path', lastFile);
      });
    }
  }
}

// Second instance launches: focus window and open passed file
app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    const fileArg = commandLine.find((arg) => arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg));
    if (fileArg) {
      mainWindow.webContents.send('menu:action', 'open-file-path', path.resolve(fileArg));
    }
  }
});

// macOS open-file event
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('menu:action', 'open-file-path', filePath);
  }
});

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  // 1. Open File Dialog
  ipcMain.handle('dialog:openFile', async () => {
    if (!mainWindow) return { cancelled: true };
    const isEn = settingsStore.get('language') === 'en';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: isEn ? 'Open PDF Document' : 'Otevřít PDF dokument',
      filters: [
        { name: isEn ? 'PDF Documents (*.pdf)' : 'Dokumenty PDF (*.pdf)', extensions: ['pdf'] },
        { name: isEn ? 'All Files (*.*)' : 'Všechny soubory (*.*)', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }

    const filePath = result.filePaths[0];
    try {
      const data = await fs.promises.readFile(filePath);
      const fileName = path.basename(filePath);
      settingsStore.addRecentFile(filePath, fileName);
      updateApplicationMenu();

      return {
        cancelled: false,
        filePath,
        fileName,
        data: new Uint8Array(data),
      };
    } catch (err: any) {
      return { cancelled: true, error: err?.message || String(err) };
    }
  });

  // 2. Direct File Read
  ipcMain.handle('file:readDirect', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      const isEn = settingsStore.get('language') === 'en';
      return { cancelled: true, error: isEn ? 'File not found' : 'Soubor neexistuje' };
    }
    try {
      const data = await fs.promises.readFile(filePath);
      const fileName = path.basename(filePath);
      settingsStore.addRecentFile(filePath, fileName);
      updateApplicationMenu();

      return {
        cancelled: false,
        filePath,
        fileName,
        data: new Uint8Array(data),
      };
    } catch (err: any) {
      return { cancelled: true, error: err?.message || String(err) };
    }
  });

  // 3. Save File Dialog (Save As)
  ipcMain.handle('dialog:saveFile', async (_event, defaultFileName: string, data: Uint8Array) => {
    if (!mainWindow) return { cancelled: true };
    const isEn = settingsStore.get('language') === 'en';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: isEn ? 'Save PDF Document' : 'Uložit PDF dokument',
      defaultPath: defaultFileName || 'document.pdf',
      filters: [
        { name: isEn ? 'PDF Documents (*.pdf)' : 'Dokumenty PDF (*.pdf)', extensions: ['pdf'] },
        { name: isEn ? 'All Files (*.*)' : 'Všechny soubory (*.*)', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    try {
      await fs.promises.writeFile(result.filePath, Buffer.from(data));
      settingsStore.addRecentFile(result.filePath, path.basename(result.filePath));
      updateApplicationMenu();
      return { cancelled: false, filePath: result.filePath };
    } catch (err: any) {
      return { cancelled: true, error: err?.message || String(err) };
    }
  });

  // 4. Save File Direct (Overwrite existing disk file without prompt)
  ipcMain.handle('file:saveDirect', async (_event, filePath: string, data: Uint8Array) => {
    if (!filePath) {
      return { success: false, error: 'Cesta k souboru nebyla zadána / Path missing' };
    }
    try {
      await fs.promises.writeFile(filePath, Buffer.from(data));
      settingsStore.addRecentFile(filePath, path.basename(filePath));
      updateApplicationMenu();
      return { success: true, filePath };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // 5. Recent Files Handlers
  ipcMain.handle('recent:get', () => {
    return settingsStore.get('recentFiles') || [];
  });

  ipcMain.handle('recent:add', (_event, filePath: string, name?: string) => {
    const list = settingsStore.addRecentFile(filePath, name);
    updateApplicationMenu();
    return list;
  });

  ipcMain.handle('recent:clear', () => {
    settingsStore.clearRecentFiles();
    updateApplicationMenu();
  });

  ipcMain.handle('recent:getLastOpened', () => {
    return settingsStore.get('lastOpenFilePath') || null;
  });

  // 6. Settings Handlers
  ipcMain.handle('settings:getAll', () => {
    return settingsStore.getAll();
  });

  ipcMain.handle('settings:get', (_event, key: any) => {
    return settingsStore.get(key);
  });

  ipcMain.handle('settings:set', (_event, key: any, value: any) => {
    settingsStore.set(key, value);
    updateApplicationMenu();
  });

  // 7. Document State Changed Notification
  ipcMain.on('document:stateChanged', (_event, state) => {
    currentDocumentState = { ...currentDocumentState, ...state };
    updateWindowTitle();
  });
}
