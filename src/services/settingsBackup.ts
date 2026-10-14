import { RasterizationSettings } from '../types/document';
import { SignatureStamp } from '../types/stamp';

/**
 * Settings backup file of both editions: language, theme, rasterization settings, saved signatures
 * and stamps, and (desktop edition) its startup / overwrite options. Restoring replaces the
 * settings and merges the signatures, so nothing in the current library is lost.
 * The stamp library export of the signature dialog (StampExportPackage) is accepted as well.
 */

export const BACKUP_FORMAT = 'pdf-studio-backup';
export const BACKUP_VERSION = 1;

export type BackupLanguage = 'cs' | 'en';
export type BackupTheme = 'default' | 'minimal' | 'lcars';

export interface BackupSettings {
  language?: BackupLanguage;
  theme?: BackupTheme;
  rasterSettings?: RasterizationSettings;
  /** Desktop edition only */
  reopenLastFileOnStartup?: boolean;
  /** Desktop edition only */
  confirmOverwrite?: boolean;
}

export interface SettingsBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: { name: 'PDF Studio'; version: string; edition: 'web' | 'desktop' };
  settings: BackupSettings;
  signatures: SignatureStamp[];
}

export type BackupParseError = 'invalid-json' | 'not-a-backup' | 'newer-version';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const RASTER_SCALES = [1, 1.5, 2, 3];

export const sanitizeRasterSettings = (value: unknown): RasterizationSettings | undefined => {
  if (!isRecord(value)) return undefined;
  const { scale, format, jpegQuality } = value;
  if (typeof scale !== 'number' || !RASTER_SCALES.includes(scale)) return undefined;
  if (format !== 'image/jpeg' && format !== 'image/png') return undefined;
  if (typeof jpegQuality !== 'number' || jpegQuality < 0.5 || jpegQuality > 1) return undefined;
  return { scale, format, jpegQuality };
};

export const sanitizeSignatures = (value: unknown): SignatureStamp[] =>
  (Array.isArray(value) ? value : [])
    .filter(
      (s): s is SignatureStamp =>
        isRecord(s) && typeof s.id === 'string' && s.id.length > 0 && typeof s.imageDataUrl === 'string' && s.imageDataUrl.startsWith('data:image/')
    )
    .map((s) => ({
      id: s.id,
      title: typeof s.title === 'string' ? s.title : '',
      imageDataUrl: s.imageDataUrl,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      ...(typeof s.width === 'number' ? { width: s.width } : {}),
      ...(typeof s.height === 'number' ? { height: s.height } : {}),
      ...(typeof s.category === 'string' ? { category: s.category } : {}),
    }));

export const createSettingsBackup = (input: {
  appVersion: string;
  edition: 'web' | 'desktop';
  settings: BackupSettings;
  signatures: SignatureStamp[];
  now?: Date;
}): SettingsBackup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  createdAt: (input.now ?? new Date()).toISOString(),
  app: { name: 'PDF Studio', version: input.appVersion, edition: input.edition },
  settings: input.settings,
  signatures: input.signatures,
});

export const parseSettingsBackup = (text: string): { backup: SettingsBackup } | { error: BackupParseError } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'invalid-json' };
  }
  if (!isRecord(raw)) return { error: 'not-a-backup' };

  // Stamp library export of the signature dialog
  if (raw.app === 'PDF Studio' && Array.isArray(raw.stamps) && raw.format === undefined) {
    return {
      backup: createSettingsBackup({
        appVersion: typeof raw.version === 'string' ? raw.version : '',
        edition: 'web',
        settings: {},
        signatures: sanitizeSignatures(raw.stamps),
        now: typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt)) ? new Date(raw.exportedAt) : undefined,
      }),
    };
  }

  if (raw.format !== BACKUP_FORMAT) return { error: 'not-a-backup' };
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) return { error: 'newer-version' };

  const settingsIn = isRecord(raw.settings) ? raw.settings : {};
  const settings: BackupSettings = {};
  if (settingsIn.language === 'cs' || settingsIn.language === 'en') settings.language = settingsIn.language;
  if (settingsIn.theme === 'default' || settingsIn.theme === 'minimal' || settingsIn.theme === 'lcars') settings.theme = settingsIn.theme;
  const raster = sanitizeRasterSettings(settingsIn.rasterSettings);
  if (raster) settings.rasterSettings = raster;
  if (typeof settingsIn.reopenLastFileOnStartup === 'boolean') settings.reopenLastFileOnStartup = settingsIn.reopenLastFileOnStartup;
  if (typeof settingsIn.confirmOverwrite === 'boolean') settings.confirmOverwrite = settingsIn.confirmOverwrite;

  const app = isRecord(raw.app) ? raw.app : {};
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: raw.version,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      app: {
        name: 'PDF Studio',
        version: typeof app.version === 'string' ? app.version : '',
        edition: app.edition === 'desktop' ? 'desktop' : 'web',
      },
      settings,
      signatures: sanitizeSignatures(raw.signatures),
    },
  };
};

/** Current signatures plus those from the backup; a backup entry replaces one with the same id */
export const mergeSignatures = (current: SignatureStamp[], restored: SignatureStamp[]): SignatureStamp[] => {
  const restoredById = new Map(restored.map((s) => [s.id, s]));
  const merged = current.map((s) => restoredById.get(s.id) ?? s);
  const known = new Set(current.map((s) => s.id));
  return [...merged, ...restored.filter((s) => !known.has(s.id))];
};

export const backupFileName = (now = new Date()) => `pdf-studio-settings-${now.toISOString().slice(0, 10)}.json`;
