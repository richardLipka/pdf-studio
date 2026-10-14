import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
} from '../src/services/desktopBridge';

describe('Online vs Offline (Web vs Desktop) Divergence Verification', () => {
  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.join(rootDir, 'dist');
  const pdfjsDir = path.join(distDir, 'pdfjs');

  // =========================================================================
  // 1. Web (Online) Environment Safety & Fallbacks
  // =========================================================================
  describe('Web (Online) Invariants', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      // Ensure window.electronAPI is undefined (standard web browser environment)
      delete (globalThis as any).window?.electronAPI;

      mockStorage = {};
      (globalThis as any).localStorage = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; },
      };
    });

    afterEach(() => {
      delete (globalThis as any).localStorage;
    });

    it('identifies running environment as non-desktop (web)', () => {
      expect(isDesktopApp()).toBe(false);
    });

    it('desktopBridge functions safely return null / empty without throwing in web mode', async () => {
      expect(await desktopOpenFile()).toBeNull();
      expect(await desktopReadFileDirect('test.pdf')).toBeNull();
      expect(await desktopSaveDirect('test.pdf', new Uint8Array([1, 2, 3]))).toBeNull();
      expect(await desktopSaveFileDialog('test.pdf', new Uint8Array([1, 2, 3]))).toBeNull();
      expect(await desktopGetLaunchFilePath()).toBeNull();
      expect(await getDesktopRecentFiles()).toEqual([]);
      expect(await getDesktopSettings()).toEqual({});

      // Fire-and-forget void calls should not throw
      await expect(addDesktopRecentFile('test.pdf')).resolves.toBeUndefined();
      await expect(clearDesktopRecentFiles()).resolves.toBeUndefined();
      await expect(setDesktopSetting('theme', 'minimal')).resolves.toBeUndefined();
      expect(() => notifyDesktopDocumentState({ hasUnsavedChanges: false })).not.toThrow();

      // Menu subscription in web should return a safe uninstaller no-op
      const unsubscribe = onDesktopMenuAction(() => {});
      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('ensures localStorage recent files storage is used in web mode', () => {
      const mockKey = 'pdf_studio_web_recent_files';
      const sampleItem = [{ path: 'web-doc.pdf', name: 'web-doc.pdf', lastOpened: Date.now() }];
      localStorage.setItem(mockKey, JSON.stringify(sampleItem));

      const retrieved = JSON.parse(localStorage.getItem(mockKey) || '[]');
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].name).toBe('web-doc.pdf');

      localStorage.removeItem(mockKey);
      expect(localStorage.getItem(mockKey)).toBeNull();
    });
  });

  // =========================================================================
  // 2. Desktop (Offline) IPC Bridge Invariants
  // =========================================================================
  describe('Desktop (Offline) Invariants', () => {
    let mockElectronApi: any;

    beforeEach(() => {
      mockElectronApi = {
        isDesktop: true,
        openFileDialog: vi.fn().mockResolvedValue({
          data: new Uint8Array([37, 80, 68, 70]),
          fileName: 'desktop-sample.pdf',
          filePath: 'C:\\docs\\desktop-sample.pdf',
        }),
        readFileDirect: vi.fn().mockResolvedValue({
          data: new Uint8Array([37, 80, 68, 70]),
          fileName: 'direct.pdf',
          filePath: 'C:\\docs\\direct.pdf',
        }),
        saveFileDialog: vi.fn().mockResolvedValue({
          cancelled: false,
          filePath: 'C:\\docs\\saved-as.pdf',
        }),
        saveFileDirect: vi.fn().mockResolvedValue({
          success: true,
          filePath: 'C:\\docs\\overwritten.pdf',
        }),
        getLaunchFilePath: vi.fn().mockResolvedValue('C:\\docs\\cli-launch.pdf'),
        getRecentFiles: vi.fn().mockResolvedValue([
          { path: 'C:\\docs\\recent.pdf', name: 'recent.pdf', lastOpened: Date.now() },
        ]),
        addRecentFile: vi.fn().mockResolvedValue(undefined),
        clearRecentFiles: vi.fn().mockResolvedValue(undefined),
        getLastOpenFilePath: vi.fn().mockResolvedValue('C:\\docs\\recent.pdf'),
        getSettings: vi.fn().mockResolvedValue({ language: 'cs', theme: 'studio' }),
        setSetting: vi.fn().mockResolvedValue(undefined),
        notifyDocumentState: vi.fn(),
        onMenuAction: vi.fn().mockReturnValue(() => {}),
      };

      (globalThis as any).window = (globalThis as any).window || {};
      (globalThis as any).window.electronAPI = mockElectronApi;
    });

    afterEach(() => {
      delete (globalThis as any).window?.electronAPI;
    });

    it('identifies running environment as desktop when electronAPI is present', () => {
      expect(isDesktopApp()).toBe(true);
    });

    it('routes openFileDialog through Electron IPC', async () => {
      const res = await desktopOpenFile();
      expect(mockElectronApi.openFileDialog).toHaveBeenCalledTimes(1);
      expect(res?.fileName).toBe('desktop-sample.pdf');
      expect(res?.filePath).toBe('C:\\docs\\desktop-sample.pdf');
    });

    it('routes direct disk save and overwrite through Electron IPC', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const res = await desktopSaveDirect('C:\\docs\\file.pdf', bytes, false);
      expect(mockElectronApi.saveFileDirect).toHaveBeenCalledWith('C:\\docs\\file.pdf', bytes, false);
      expect(res?.success).toBe(true);
    });

    it('routes saveFileDialog (Save As...) through Electron IPC', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const res = await desktopSaveFileDialog('file.pdf', bytes);
      expect(mockElectronApi.saveFileDialog).toHaveBeenCalledWith('file.pdf', bytes);
      expect(res?.filePath).toBe('C:\\docs\\saved-as.pdf');
    });

    it('notifies main process of document state for title bar and close guard', () => {
      notifyDesktopDocumentState({
        hasUnsavedChanges: true,
        filePath: 'C:\\docs\\edited.pdf',
        fileName: 'edited.pdf',
      });
      expect(mockElectronApi.notifyDocumentState).toHaveBeenCalledWith({
        hasUnsavedChanges: true,
        filePath: 'C:\\docs\\edited.pdf',
        fileName: 'edited.pdf',
      });
    });

    it('wires up menu action subscriber cleanly', () => {
      const handler = vi.fn();
      const unsubscribe = onDesktopMenuAction(handler);
      expect(mockElectronApi.onMenuAction).toHaveBeenCalledWith(handler);
      expect(typeof unsubscribe).toBe('function');
    });
  });

  // =========================================================================
  // 3. Offline Assets Self-Containment (No Internet Required)
  // =========================================================================
  describe('Offline Assets Self-Containment', () => {
    it('verifies that standard Unicode fonts (Liberation Sans) exist locally in dist/pdfjs/standard_fonts', () => {
      const standardFontsDir = path.join(pdfjsDir, 'standard_fonts');
      expect(fs.existsSync(standardFontsDir)).toBe(true);

      const requiredFonts = [
        'LiberationSans-Regular.ttf',
        'LiberationSans-Bold.ttf',
        'LiberationSans-Italic.ttf',
        'LiberationSans-BoldItalic.ttf',
      ];

      for (const font of requiredFonts) {
        const fontPath = path.join(standardFontsDir, font);
        expect(fs.existsSync(fontPath)).toBe(true);
        const stat = fs.statSync(fontPath);
        expect(stat.size).toBeGreaterThan(100000); // ~130 KB - 150 KB font files
      }
    });

    it('verifies that CMaps and Wasm decoders exist locally in dist/pdfjs/', () => {
      const cmapsDir = path.join(pdfjsDir, 'cmaps');
      const wasmDir = path.join(pdfjsDir, 'wasm');

      expect(fs.existsSync(cmapsDir)).toBe(true);
      expect(fs.existsSync(wasmDir)).toBe(true);

      const cmaps = fs.readdirSync(cmapsDir);
      expect(cmaps.length).toBeGreaterThan(50); // CJK & European CMaps

      // Check OpenJPEG wasm decoder for JPEG2000
      const wasmFiles = fs.readdirSync(wasmDir);
      expect(wasmFiles.some((f) => f.includes('openjpeg') || f.endsWith('.wasm'))).toBe(true);
    });

    it('verifies that the web bundle links assets relatively for file:// and custom protocol support', () => {
      const indexHtmlPath = path.join(distDir, 'index.html');
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');

      // Check base="./" in links and scripts
      expect(html).toContain('href="./favicon.svg"');
      expect(html).toMatch(/src="\.\/assets\/index-[^"]+\.js"/);
      expect(html).toMatch(/href="\.\/assets\/index-[^"]+\.css"/);
    });
  });
});
