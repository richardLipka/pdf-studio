import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  COMMAND_SHORTCUTS,
  PLAIN_SHORTCUTS,
  matchCommandShortcut,
  getAccelerator,
  AppCommandId,
} from '../src/shared/appCommands';
import { DEFAULT_DESKTOP_SETTINGS, IPC_CHANNELS, ElectronAPI } from '../src/shared/desktopApi';
import { getDesktopApi, isDesktopApp, getDesktopFilePath, onDesktopMessage, toArrayBuffer } from '../src/services/desktopBridge';
import { resolveOutlineTarget } from '../src/utils/outlineTargets';
import { cs } from '../src/i18n/cs';
import { en } from '../src/i18n/en';
import { PdfPageModel } from '../src/types/document';

const key = (k: string, code: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: mods.ctrl ?? true,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe('Application commands and shortcuts (shared by web, shortcuts dialog and desktop menu)', () => {
  it('maps the documented shortcuts to commands', () => {
    expect(matchCommandShortcut(key('o', 'KeyO'), false)).toBe('open');
    expect(matchCommandShortcut(key('s', 'KeyS'), false)).toBe('save');
    expect(matchCommandShortcut(key('S', 'KeyS', { shift: true }), false)).toBe('saveAs');
    expect(matchCommandShortcut(key('f', 'KeyF'), false)).toBe('find');
    expect(matchCommandShortcut(key('e', 'KeyE'), false)).toBe('flatten');
    expect(matchCommandShortcut(key('z', 'KeyZ'), false)).toBe('undo');
    expect(matchCommandShortcut(key('y', 'KeyY'), false)).toBe('redo');
    expect(matchCommandShortcut(key('Z', 'KeyZ', { shift: true }), false)).toBe('redo');
    expect(matchCommandShortcut(key('a', 'KeyA'), false)).toBe('selectAllPages');
    expect(matchCommandShortcut(key('0', 'Digit0'), false)).toBe('fitPage');
    expect(matchCommandShortcut(key('1', 'Digit1'), false)).toBe('zoomActual');
    expect(matchCommandShortcut(key('2', 'Digit2'), false)).toBe('fitWidth');
    expect(matchCommandShortcut(key('b', 'KeyB'), false)).toBe('toggleSidebar');
    expect(matchCommandShortcut(key('/', 'Slash'), false)).toBe('shortcuts');
    // Cmd on macOS
    expect(matchCommandShortcut(key('s', 'KeyS', { ctrl: false, meta: true }), false)).toBe('save');
  });

  it('zooms with Ctrl + / Ctrl = / Ctrl - whether or not Shift is needed for the key', () => {
    expect(matchCommandShortcut(key('=', 'Equal'), false)).toBe('zoomIn');
    expect(matchCommandShortcut(key('+', 'Equal', { shift: true }), false)).toBe('zoomIn');
    expect(matchCommandShortcut(key('+', 'NumpadAdd'), false)).toBe('zoomIn');
    expect(matchCommandShortcut(key('-', 'Minus'), false)).toBe('zoomOut');
    expect(matchCommandShortcut(key('_', 'Minus', { shift: true }), false)).toBe('zoomOut');
  });

  it('keeps browser-reserved shortcuts for the desktop edition only', () => {
    expect(matchCommandShortcut(key('n', 'KeyN'), false)).toBeNull();
    expect(matchCommandShortcut(key('w', 'KeyW'), false)).toBeNull();
    expect(matchCommandShortcut(key('T', 'KeyT', { shift: true }), false)).toBeNull();
    expect(matchCommandShortcut(key('n', 'KeyN'), true)).toBe('newDocument');
    expect(matchCommandShortcut(key('w', 'KeyW'), true)).toBe('closeDocument');
    expect(matchCommandShortcut(key('T', 'KeyT', { shift: true }), true)).toBe('reopenLast');
  });

  it('follows the typed character on QWERTZ layouts and the physical key where the layout types something else', () => {
    // Czech QWERTZ: the key labelled Z sits where QWERTY has Y
    expect(matchCommandShortcut(key('z', 'KeyY'), false)).toBe('undo');
    expect(matchCommandShortcut(key('y', 'KeyZ'), false)).toBe('redo');
    // Czech digit row types accented letters: Ctrl + é is Ctrl + 0
    expect(matchCommandShortcut(key('é', 'Digit0'), false)).toBe('fitPage');
  });

  it('ignores plain keys and Alt combinations', () => {
    expect(matchCommandShortcut(key('s', 'KeyS', { ctrl: false }), false)).toBeNull();
    expect(matchCommandShortcut(key('s', 'KeyS', { alt: true }), false)).toBeNull();
    expect(matchCommandShortcut(key('q', 'KeyQ'), false)).toBeNull();
  });

  it('has unique accelerators, every command named in both languages and the dialog texts for plain keys', () => {
    const accelerators = COMMAND_SHORTCUTS.map((s) => s.accelerator);
    expect(new Set(accelerators).size).toBe(accelerators.length);
    for (const { command } of COMMAND_SHORTCUTS) {
      expect(cs.commands[command]).toBeTruthy();
      expect(en.commands[command]).toBeTruthy();
    }
    for (const plain of PLAIN_SHORTCUTS) {
      expect(cs.shortcutsModal[plain.id]).toBeTruthy();
      expect(en.shortcutsModal[plain.id]).toBeTruthy();
    }
    // Each accelerator is matched back to its own command (the menu and the keyboard agree)
    for (const shortcut of COMMAND_SHORTCUTS) {
      const parts = shortcut.accelerator.split('+');
      const last = parts[parts.length - 1].toLowerCase();
      const event = key(last, last.length === 1 && /[a-z]/.test(last) ? `Key${last.toUpperCase()}` : '', {
        shift: parts.includes('Shift'),
      });
      expect(matchCommandShortcut(event, true)).toBe(shortcut.command as AppCommandId);
    }
    expect(getAccelerator('save')).toBe('CmdOrCtrl+S');
  });
});

describe('Desktop bridge', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('is inert in the browser: no API, no file paths, no-op subscriptions', () => {
    (globalThis as any).window = {};
    expect(getDesktopApi()).toBeNull();
    expect(isDesktopApp()).toBe(false);
    expect(getDesktopFilePath({ name: 'a.pdf' } as File)).toBeNull();
    const unsubscribe = onDesktopMessage(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it('uses window.electronAPI in the desktop edition', () => {
    const listeners: Array<(m: any) => void> = [];
    const api: Partial<ElectronAPI> = {
      isDesktop: true,
      getPathForFile: vi.fn().mockReturnValue('C:\\docs\\a.pdf'),
      onMessage: vi.fn((listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      }),
    };
    (globalThis as any).window = { electronAPI: api };
    expect(isDesktopApp()).toBe(true);
    expect(getDesktopFilePath({ name: 'a.pdf' } as File)).toBe('C:\\docs\\a.pdf');

    const received: any[] = [];
    const unsubscribe = onDesktopMessage((m) => received.push(m));
    listeners.forEach((l) => l({ type: 'command', command: 'save' }));
    expect(received).toEqual([{ type: 'command', command: 'save' }]);
    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  it('treats a File without a disk path (or a failing lookup) as path-less', () => {
    (globalThis as any).window = {
      electronAPI: {
        isDesktop: true,
        getPathForFile: () => {
          throw new Error('not a disk file');
        },
      },
    };
    expect(getDesktopFilePath({ name: 'x.pdf' } as File)).toBeNull();
  });

  it('copies IPC bytes into a standalone ArrayBuffer', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    const buffer = toArrayBuffer(view);
    expect(buffer.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
  });

  it('has distinct IPC channels and sensible default settings', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
    expect(DEFAULT_DESKTOP_SETTINGS.confirmOverwrite).toBe(true);
    expect(DEFAULT_DESKTOP_SETTINGS.recentFiles).toEqual([]);
  });
});

describe('Outline targets after page edits', () => {
  const page = (id: string, originalPageIndex: number, sourceDocId = 'main', sourceType: PdfPageModel['sourceType'] = 'pdf') =>
    ({ id, originalPageIndex, sourceDocId, sourceType, rotation: 0, width: 100, height: 100 }) as PdfPageModel;

  it('finds the page of the opened file wherever it moved', () => {
    const pages = [page('p0', 0), page('p1', 1), page('p2', 2)];
    expect(resolveOutlineTarget(pages, 'main', 2)).toBe(2);
    // Reordered: page 3 of the file is now first
    expect(resolveOutlineTarget([pages[2], pages[0], pages[1]], 'main', 2)).toBe(0);
    // A blank page and a page of another PDF inserted before it
    expect(resolveOutlineTarget([page('b', 0, 'blank', 'blank'), page('x', 2, 'other'), ...pages], 'main', 2)).toBe(4);
  });

  it('reports deleted pages and unresolved destinations as -1', () => {
    const pages = [page('p0', 0), page('p2', 2)];
    expect(resolveOutlineTarget(pages, 'main', 1)).toBe(-1);
    expect(resolveOutlineTarget(pages, 'main', null)).toBe(-1);
    expect(resolveOutlineTarget(pages, undefined, 0)).toBe(-1);
  });
});
