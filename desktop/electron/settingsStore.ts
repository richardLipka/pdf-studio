import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopRasterSettings,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopWindowBounds,
  MAX_RECENT_FILES,
  RecentFileItem,
} from '../../src/shared/desktopApi';

const THEMES = ['default', 'minimal', 'lcars'] as const;

/** Paths are case-insensitive on Windows and (by default) macOS, case-sensitive elsewhere */
export const samePath = (a: string, b: string, platform: string = process.platform): boolean =>
  platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
const LANGUAGES = ['cs', 'en'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeRecent = (value: unknown): RecentFileItem[] =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is RecentFileItem => isRecord(item) && typeof item.path === 'string' && item.path.length > 0)
    .map((item) => ({
      path: item.path,
      name: typeof item.name === 'string' && item.name ? item.name : path.basename(item.path),
      lastOpened: typeof item.lastOpened === 'number' ? item.lastOpened : 0,
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
    }))
    .slice(0, MAX_RECENT_FILES);

const sanitizeBounds = (value: unknown, fallback: DesktopWindowBounds): DesktopWindowBounds => {
  if (!isRecord(value)) return fallback;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
  const width = num(value.width);
  const height = num(value.height);
  if (!width || !height || width < 400 || height < 300) return fallback;
  return { x: num(value.x), y: num(value.y), width, height, isMaximized: value.isMaximized === true };
};

const RASTER_SCALES = [1, 1.5, 2, 3];

const sanitizeRaster = (value: unknown): DesktopRasterSettings | null => {
  if (!isRecord(value)) return null;
  const { scale, format, jpegQuality } = value;
  if (typeof scale !== 'number' || !RASTER_SCALES.includes(scale)) return null;
  if (format !== 'image/jpeg' && format !== 'image/png') return null;
  if (typeof jpegQuality !== 'number' || jpegQuality < 0.5 || jpegQuality > 1) return null;
  return { scale, format, jpegQuality };
};

/** Turns whatever is in the settings file into valid settings (unknown keys dropped, bad values defaulted) */
export const sanitizeSettings = (raw: unknown, defaults: DesktopSettings): DesktopSettings => {
  const source = isRecord(raw) ? raw : {};
  return {
    theme: THEMES.includes(source.theme as never) ? (source.theme as DesktopSettings['theme']) : defaults.theme,
    language: LANGUAGES.includes(source.language as never) ? (source.language as DesktopSettings['language']) : defaults.language,
    reopenLastFileOnStartup:
      typeof source.reopenLastFileOnStartup === 'boolean' ? source.reopenLastFileOnStartup : defaults.reopenLastFileOnStartup,
    confirmOverwrite: typeof source.confirmOverwrite === 'boolean' ? source.confirmOverwrite : defaults.confirmOverwrite,
    lastOpenFilePath: typeof source.lastOpenFilePath === 'string' ? source.lastOpenFilePath : defaults.lastOpenFilePath,
    recentFiles: sanitizeRecent(source.recentFiles),
    stamps: Array.isArray(source.stamps) ? source.stamps : defaults.stamps,
    rasterSettings: sanitizeRaster(source.rasterSettings) ?? defaults.rasterSettings,
    windowBounds: sanitizeBounds(source.windowBounds, defaults.windowBounds),
  };
};

/**
 * Settings of the desktop edition in a JSON file (pdf-studio-settings.json in the user data folder,
 * next to the executable for the portable build). Writes are atomic, so a crash never leaves a
 * truncated file behind, and every successful start keeps a copy of the file as it was
 * (pdf-studio-settings.json.bak): when the settings file is unreadable, that last working version
 * is used instead of the defaults. Pure Node: no Electron imports, so it is unit-tested directly.
 */
export class SettingsStore {
  private settings: DesktopSettings;
  /** Where the settings came from on startup (logged by the main process) */
  readonly loadedFrom: 'file' | 'backup' | 'defaults';

  constructor(
    private readonly filePath: string,
    private readonly defaults: DesktopSettings = DEFAULT_DESKTOP_SETTINGS
  ) {
    const { settings, from } = this.load();
    this.settings = settings;
    this.loadedFrom = from;
    if (from === 'file') {
      // Last working version for the next start
      this.copyQuietly(this.filePath, this.backupPath);
    } else if (from === 'backup') {
      this.save();
    }
  }

  get backupPath(): string {
    return `${this.filePath}.bak`;
  }

  private copyQuietly(from: string, to: string) {
    try {
      fs.copyFileSync(from, to);
    } catch {
      // ignore
    }
  }

  private readJson(file: string): unknown | undefined {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      // unreadable
    }
    return undefined;
  }

  private load(): { settings: DesktopSettings; from: 'file' | 'backup' | 'defaults' } {
    const main = this.readJson(this.filePath);
    if (main !== undefined) return { settings: sanitizeSettings(main, this.defaults), from: 'file' };
    if (fs.existsSync(this.filePath)) {
      console.warn('[settings] Settings file is unreadable, trying the last working copy');
      // Keep the unreadable file for inspection instead of overwriting it silently
      this.copyQuietly(this.filePath, `${this.filePath}.corrupt`);
    }
    const backup = this.readJson(this.backupPath);
    if (backup !== undefined) return { settings: sanitizeSettings(backup, this.defaults), from: 'backup' };
    return { settings: sanitizeSettings({}, this.defaults), from: 'defaults' };
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[settings] Cannot save settings:', err);
    }
  }

  getAll(): DesktopSettings {
    return { ...this.settings, recentFiles: [...this.settings.recentFiles], windowBounds: { ...this.settings.windowBounds } };
  }

  get<K extends keyof DesktopSettings>(key: K): DesktopSettings[K] {
    return this.settings[key];
  }

  /** Applies a patch from the web app; returns true when anything changed */
  update(patch: DesktopSettingsPatch): boolean {
    const next = sanitizeSettings({ ...this.settings, ...patch }, this.defaults);
    const changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    if (changed) {
      this.settings = next;
      this.save();
    }
    return changed;
  }

  setWindowBounds(bounds: DesktopWindowBounds): void {
    this.settings.windowBounds = sanitizeBounds(bounds, this.settings.windowBounds);
    this.save();
  }

  /** Moves the file to the top of the recent files and remembers it as the last opened document */
  addRecentFile(filePath: string, size?: number): RecentFileItem[] {
    const item: RecentFileItem = {
      path: filePath,
      name: path.basename(filePath),
      lastOpened: Date.now(),
      ...(typeof size === 'number' ? { size } : {}),
    };
    this.settings.recentFiles = [item, ...this.settings.recentFiles.filter((f) => !samePath(f.path, filePath))].slice(
      0,
      MAX_RECENT_FILES
    );
    this.settings.lastOpenFilePath = filePath;
    this.save();
    return this.settings.recentFiles;
  }

  removeRecentFile(filePath: string): RecentFileItem[] {
    this.settings.recentFiles = this.settings.recentFiles.filter((f) => !samePath(f.path, filePath));
    if (samePath(this.settings.lastOpenFilePath, filePath)) this.settings.lastOpenFilePath = '';
    this.save();
    return this.settings.recentFiles;
  }

  /** Clears the history, including the document reopened on startup */
  clearRecentFiles(): RecentFileItem[] {
    this.settings.recentFiles = [];
    this.settings.lastOpenFilePath = '';
    this.save();
    return this.settings.recentFiles;
  }
}
