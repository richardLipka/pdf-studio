import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findPdfArgument } from '../electron/cli';
import { SettingsStore, sanitizeSettings, samePath } from '../electron/settingsStore';
import { buildMenuTemplate, MenuContext } from '../electron/menu';
import { COMMAND_SHORTCUTS } from '../../src/shared/appCommands';
import { DEFAULT_DESKTOP_SETTINGS, MAX_RECENT_FILES } from '../../src/shared/desktopApi';
import { cs } from '../../src/i18n/cs';
import { en } from '../../src/i18n/en';

// Platform paths (C:\docs on Windows, /docs elsewhere): the shell uses the platform's path rules
const docs = path.resolve('/docs');
const work = path.resolve('/work');
const fileA = path.join(docs, 'a.pdf');
const withSpace = path.join(docs, 'with space.pdf');

describe('Command-line file', () => {
  const existing = new Set([fileA, path.join(work, 'rel.pdf'), withSpace]);
  const options = { cwd: work, isFile: (p: string) => existing.has(p) };

  it('takes the first existing PDF after the executable', () => {
    expect(findPdfArgument(['PDF Studio.exe', fileA], options)).toBe(fileA);
    // development: electron.exe <app folder> <file>
    expect(findPdfArgument(['electron.exe', '.', fileA], options)).toBe(fileA);
    expect(findPdfArgument(['PDF Studio.exe', `"${withSpace}"`], options)).toBe(withSpace);
  });

  it('resolves relative paths against the working directory of the launching process', () => {
    expect(findPdfArgument(['PDF Studio.exe', 'rel.pdf'], options)).toBe(path.join(work, 'rel.pdf'));
  });

  it('ignores switches, other files, missing files and the executable itself', () => {
    expect(findPdfArgument([fileA], options)).toBeNull();
    expect(findPdfArgument(['app.exe', '--allow-file-access-from-files', 'notes.txt', path.join(docs, 'missing.pdf')], options)).toBeNull();
    expect(findPdfArgument(['app.exe', '--inspect', fileA], options)).toBe(fileA);
  });
});

describe('Settings store', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-studio-settings-'));
    file = path.join(dir, 'pdf-studio-settings.json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts from the defaults and persists changes across instances', () => {
    const store = new SettingsStore(file, { ...DEFAULT_DESKTOP_SETTINGS, language: 'en' });
    expect(store.getAll().language).toBe('en');
    expect(store.update({ theme: 'lcars', reopenLastFileOnStartup: false })).toBe(true);
    expect(store.update({ theme: 'lcars' })).toBe(false);

    const reopened = new SettingsStore(file);
    expect(reopened.get('theme')).toBe('lcars');
    expect(reopened.get('reopenLastFileOnStartup')).toBe(false);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('rejects invalid values and survives a corrupt file', () => {
    fs.writeFileSync(file, '{ not json');
    const store = new SettingsStore(file);
    expect(store.getAll()).toEqual(sanitizeSettings({}, DEFAULT_DESKTOP_SETTINGS));
    expect(fs.existsSync(`${file}.corrupt`)).toBe(true);

    store.update({ theme: 'neon' as never, language: 'de' as never, confirmOverwrite: 'yes' as never });
    expect(store.get('theme')).toBe(DEFAULT_DESKTOP_SETTINGS.theme);
    expect(store.get('language')).toBe(DEFAULT_DESKTOP_SETTINGS.language);
    expect(store.get('confirmOverwrite')).toBe(true);

    const sanitized = sanitizeSettings(
      { recentFiles: [{ path: fileA }, { name: 'no path' }, 'junk'], windowBounds: { width: 10, height: 10 } },
      DEFAULT_DESKTOP_SETTINGS
    );
    expect(sanitized.recentFiles).toEqual([{ path: fileA, name: 'a.pdf', lastOpened: 0 }]);
    expect(sanitized.windowBounds).toEqual(DEFAULT_DESKTOP_SETTINGS.windowBounds);
  });

  it('keeps a bounded, de-duplicated recent files list and the last opened file', () => {
    const store = new SettingsStore(file);
    const fileN = (i: number) => path.join(docs, `file${i}.pdf`);
    for (let i = 0; i < MAX_RECENT_FILES + 3; i++) store.addRecentFile(fileN(i), i);
    store.addRecentFile(fileN(5));
    const recent = store.get('recentFiles');
    expect(recent).toHaveLength(MAX_RECENT_FILES);
    expect(recent[0].path).toBe(fileN(5));
    expect(recent[0].name).toBe('file5.pdf');
    expect(recent.filter((f) => f.path === fileN(5))).toHaveLength(1);
    expect(store.get('lastOpenFilePath')).toBe(fileN(5));

    store.removeRecentFile(fileN(5));
    expect(store.get('lastOpenFilePath')).toBe('');
    store.addRecentFile(path.join(docs, 'x.pdf'));
    store.clearRecentFiles();
    expect(store.get('recentFiles')).toEqual([]);
    expect(store.get('lastOpenFilePath')).toBe('');
  });
});

describe('Path comparison', () => {
  it('ignores letter case on Windows and macOS only', () => {
    expect(samePath('C:\\Docs\\A.pdf', 'c:\\docs\\a.pdf', 'win32')).toBe(true);
    expect(samePath('/Users/x/A.pdf', '/users/x/a.pdf', 'darwin')).toBe(true);
    expect(samePath('/home/x/A.pdf', '/home/x/a.pdf', 'linux')).toBe(false);
    expect(samePath('/home/x/a.pdf', '/home/x/a.pdf', 'linux')).toBe(true);
  });
});

describe('Native menu', () => {
  const makeContext = (overrides: Partial<MenuContext> = {}): MenuContext => ({
    strings: cs,
    settings: { ...DEFAULT_DESKTOP_SETTINGS },
    recentFiles: [],
    isMac: false,
    appName: 'PDF Studio',
    command: vi.fn(),
    openPath: vi.fn(),
    clearRecentFiles: vi.fn(),
    updateSettings: vi.fn(),
    openExternal: vi.fn(),
    ...overrides,
  });

  const flatten = (items: any[]): any[] => items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);

  it('offers every command of the shortcut table with the same accelerator and label', () => {
    for (const strings of [cs, en]) {
      const items = flatten(buildMenuTemplate(makeContext({ strings })));
      for (const shortcut of COMMAND_SHORTCUTS) {
        const item = items.find((i) => i.label === strings.commands[shortcut.command]);
        expect(item, shortcut.command).toBeDefined();
        expect(item.accelerator).toBe(shortcut.accelerator);
      }
      const accelerators = items.map((i) => i.accelerator).filter(Boolean);
      expect(new Set(accelerators).size).toBe(accelerators.length);
    }
  });

  it('runs commands, opens recent files and changes settings', () => {
    const ctx = makeContext({
      recentFiles: [{ path: 'C:\\docs\\R&D.pdf', name: 'R&D.pdf', lastOpened: 1 }],
      settings: { ...DEFAULT_DESKTOP_SETTINGS, confirmOverwrite: false, theme: 'minimal' },
    });
    const items = flatten(buildMenuTemplate(ctx));
    items.find((i) => i.label === cs.commands.save).click();
    expect(ctx.command).toHaveBeenCalledWith('save');

    const recent = items.find((i) => i.label === '&1 R&&D.pdf');
    recent.click();
    expect(ctx.openPath).toHaveBeenCalledWith('C:\\docs\\R&D.pdf');
    items.find((i) => i.label === cs.desktopMenu.clearRecent).click();
    expect(ctx.clearRecentFiles).toHaveBeenCalled();

    const overwrite = items.find((i) => i.label === cs.desktopMenu.confirmOverwrite);
    expect(overwrite.checked).toBe(false);
    overwrite.click({ checked: true });
    expect(ctx.updateSettings).toHaveBeenCalledWith({ confirmOverwrite: true });

    const minimal = items.find((i) => i.label === cs.theme.minimal);
    expect(minimal.checked).toBe(true);
    items.find((i) => i.label === 'English').click();
    expect(ctx.updateSettings).toHaveBeenCalledWith({ language: 'en' });
  });

  it('disables "reopen previous" without recent files and shows the empty state', () => {
    const items = flatten(buildMenuTemplate(makeContext()));
    expect(items.find((i) => i.label === cs.commands.reopenLast).enabled).toBe(false);
    expect(items.find((i) => i.label === cs.desktopMenu.noRecent).enabled).toBe(false);
  });
});
