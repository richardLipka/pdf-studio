import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface RecentFileItem {
  path: string;
  name: string;
  lastOpened: number;
  size?: number;
}

export interface SignatureStamp {
  id: string;
  title: string;
  imageDataUrl: string;
  createdAt: number;
  width?: number;
  height?: number;
  category?: string;
}

export interface DesktopAppSettings {
  theme?: 'default' | 'minimal' | 'lcars';
  language?: 'cs' | 'en';
  reopenLastFileOnStartup?: boolean;
  lastOpenFilePath?: string;
  recentFiles?: RecentFileItem[];
  stamps?: SignatureStamp[];
  windowBounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
  };
  rasterSettings?: {
    scale: number;
    format: 'image/jpeg' | 'image/png';
    quality: number;
  };
}

const DEFAULT_SETTINGS: DesktopAppSettings = {
  theme: 'default',
  language: 'cs',
  reopenLastFileOnStartup: true,
  lastOpenFilePath: '',
  recentFiles: [],
  stamps: [],
  windowBounds: {
    width: 1400,
    height: 900,
    isMaximized: false,
  },
};

export class SettingsStore {
  private filePath: string;
  private settings: DesktopAppSettings;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'pdf-studio-settings.json');
    this.settings = this.loadSettings();
  }

  private loadSettings(): DesktopAppSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn('[SettingsStore] Failed to load settings, using defaults:', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  public save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsStore] Failed to save settings:', err);
    }
  }

  public get<K extends keyof DesktopAppSettings>(key: K): DesktopAppSettings[K] {
    return this.settings[key];
  }

  public set<K extends keyof DesktopAppSettings>(key: K, value: DesktopAppSettings[K]): void {
    this.settings[key] = value;
    this.save();
  }

  public getAll(): DesktopAppSettings {
    return { ...this.settings };
  }

  public update(partial: Partial<DesktopAppSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.save();
  }

  public addRecentFile(filePath: string, name?: string): RecentFileItem[] {
    if (!filePath || !fs.existsSync(filePath)) return this.settings.recentFiles || [];

    const fileName = name || path.basename(filePath);
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {
      // ignore
    }

    const currentRecent = (this.settings.recentFiles || []).filter(
      (item) => item.path.toLowerCase() !== filePath.toLowerCase()
    );

    const updated: RecentFileItem[] = [
      {
        path: filePath,
        name: fileName,
        lastOpened: Date.now(),
        size: fileSize,
      },
      ...currentRecent,
    ].slice(0, 15); // Keep up to 15 recent files

    this.settings.recentFiles = updated;
    this.settings.lastOpenFilePath = filePath;
    this.save();
    return updated;
  }

  public clearRecentFiles(): void {
    this.settings.recentFiles = [];
    this.save();
  }

  public getStamps(): SignatureStamp[] {
    return this.settings.stamps || [];
  }

  public setStamps(stamps: SignatureStamp[]): void {
    this.settings.stamps = stamps;
    this.save();
  }

  public addStamp(stamp: SignatureStamp): SignatureStamp[] {
    const list = (this.settings.stamps || []).filter((s) => s.id !== stamp.id);
    list.unshift(stamp);
    this.settings.stamps = list;
    this.save();
    return list;
  }

  public removeStamp(stampId: string): SignatureStamp[] {
    const list = (this.settings.stamps || []).filter((s) => s.id !== stampId);
    this.settings.stamps = list;
    this.save();
    return list;
  }
}
