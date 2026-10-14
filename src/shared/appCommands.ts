/**
 * Application commands and their keyboard shortcuts — the single source of truth for the keyboard
 * handler of the web app, the shortcuts dialog and the native menu of the desktop edition
 * (desktop/electron/menu.ts on the `desktop` branch imports this file).
 *
 * This module must stay free of browser and Node APIs: it is bundled into both the web app and the
 * Electron main process.
 */

export type AppCommandId =
  | 'open'
  | 'save'
  | 'saveAs'
  | 'newDocument'
  | 'closeDocument'
  | 'reopenLast'
  | 'flatten'
  | 'signCertificate'
  | 'metadata'
  | 'undo'
  | 'redo'
  | 'find'
  | 'selectAllPages'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomActual'
  | 'fitPage'
  | 'fitWidth'
  | 'toggleSidebar'
  | 'settings'
  | 'shortcuts'
  | 'eventLog'
  | 'about';

export type ShortcutGroup = 'document' | 'edit' | 'view' | 'navigation';

export interface CommandShortcut {
  command: AppCommandId;
  group: ShortcutGroup;
  /** Electron accelerator shown in (and handled by) the native menu */
  accelerator: string;
  /** Key caps shown in the shortcuts dialog */
  keys: string[];
  /**
   * False for shortcuts browsers reserve (Ctrl+N, Ctrl+W, Ctrl+Shift+T): they only work in the
   * desktop edition, where the native menu receives them.
   */
  web: boolean;
}

export const COMMAND_SHORTCUTS: CommandShortcut[] = [
  { command: 'open', group: 'document', accelerator: 'CmdOrCtrl+O', keys: ['Ctrl', 'O'], web: true },
  { command: 'save', group: 'document', accelerator: 'CmdOrCtrl+S', keys: ['Ctrl', 'S'], web: true },
  { command: 'saveAs', group: 'document', accelerator: 'CmdOrCtrl+Shift+S', keys: ['Ctrl', 'Shift', 'S'], web: true },
  { command: 'newDocument', group: 'document', accelerator: 'CmdOrCtrl+N', keys: ['Ctrl', 'N'], web: false },
  { command: 'closeDocument', group: 'document', accelerator: 'CmdOrCtrl+W', keys: ['Ctrl', 'W'], web: false },
  { command: 'reopenLast', group: 'document', accelerator: 'CmdOrCtrl+Shift+T', keys: ['Ctrl', 'Shift', 'T'], web: false },
  { command: 'flatten', group: 'document', accelerator: 'CmdOrCtrl+E', keys: ['Ctrl', 'E'], web: true },
  { command: 'undo', group: 'edit', accelerator: 'CmdOrCtrl+Z', keys: ['Ctrl', 'Z'], web: true },
  { command: 'redo', group: 'edit', accelerator: 'CmdOrCtrl+Y', keys: ['Ctrl', 'Y'], web: true },
  { command: 'find', group: 'edit', accelerator: 'CmdOrCtrl+F', keys: ['Ctrl', 'F'], web: true },
  { command: 'selectAllPages', group: 'edit', accelerator: 'CmdOrCtrl+A', keys: ['Ctrl', 'A'], web: true },
  { command: 'zoomIn', group: 'view', accelerator: 'CmdOrCtrl+=', keys: ['Ctrl', '+'], web: true },
  { command: 'zoomOut', group: 'view', accelerator: 'CmdOrCtrl+-', keys: ['Ctrl', '-'], web: true },
  { command: 'fitPage', group: 'view', accelerator: 'CmdOrCtrl+0', keys: ['Ctrl', '0'], web: true },
  { command: 'zoomActual', group: 'view', accelerator: 'CmdOrCtrl+1', keys: ['Ctrl', '1'], web: true },
  { command: 'fitWidth', group: 'view', accelerator: 'CmdOrCtrl+2', keys: ['Ctrl', '2'], web: true },
  { command: 'toggleSidebar', group: 'view', accelerator: 'CmdOrCtrl+B', keys: ['Ctrl', 'B'], web: true },
  { command: 'shortcuts', group: 'view', accelerator: 'CmdOrCtrl+/', keys: ['Ctrl', '/'], web: true },
];

/** Keys handled outside the command table (listed in the shortcuts dialog only) */
export interface PlainShortcut {
  id: 'deleteSelected' | 'searchNav' | 'escape' | 'pageNav' | 'rangeKeys' | 'rangeToEdge' | 'rangeClick';
  group: ShortcutGroup;
  keys: string[];
  /** The keys are alternatives (any of them), not a combination */
  alternatives?: boolean;
}

export const PLAIN_SHORTCUTS: PlainShortcut[] = [
  { id: 'deleteSelected', group: 'edit', keys: ['Del'] },
  { id: 'searchNav', group: 'edit', keys: ['Enter', 'Shift+Enter'], alternatives: true },
  { id: 'escape', group: 'edit', keys: ['Esc'] },
  { id: 'pageNav', group: 'navigation', keys: ['↑', '↓', 'PgUp', 'PgDn', 'Home', 'End'], alternatives: true },
  { id: 'rangeKeys', group: 'navigation', keys: ['Shift', '↑ / ↓'] },
  { id: 'rangeToEdge', group: 'navigation', keys: ['Shift', 'Home / End'] },
  { id: 'rangeClick', group: 'navigation', keys: ['Shift', 'Click'] },
];

export const getCommandShortcut = (command: AppCommandId): CommandShortcut | undefined =>
  COMMAND_SHORTCUTS.find((s) => s.command === command);

export const getAccelerator = (command: AppCommandId): string | undefined => getCommandShortcut(command)?.accelerator;

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Physical-key fallback, so shortcuts also work on layouts where the digit row types letters (Czech) */
const codeToKey = (code: string | undefined): string | null => {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (code === 'Equal' || code === 'NumpadAdd') return '=';
  if (code === 'Minus' || code === 'NumpadSubtract') return '-';
  if (code === 'Slash' || code === 'NumpadDivide') return '/';
  return null;
};

const acceleratorParts = (accelerator: string) => {
  const parts = accelerator.split('+');
  const key = (parts.pop() || '').toLowerCase();
  return { key, shift: parts.includes('Shift') };
};

const keyMatches = (pressed: string, wanted: string): boolean => {
  if (pressed === wanted) return true;
  if (wanted === '=') return pressed === '+';
  if (wanted === '-') return pressed === '_';
  return false;
};

/**
 * Finds the command of a keyboard event. `isDesktop` enables the desktop-only shortcuts; in the
 * desktop edition the native menu normally handles them first, this is the fallback.
 */
export const matchCommandShortcut = (e: KeyLike, isDesktop: boolean): AppCommandId | null => {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const typedKey = e.key.toLowerCase();
  // The typed character decides (Ctrl+Z on a QWERTZ keyboard is the key labelled Z); the physical
  // key is only used when the layout types something else there (Ctrl+é for Ctrl+0 in Czech)
  const key = /^[a-z0-9=+\-_/]$/.test(typedKey) ? typedKey : codeToKey(e.code) ?? typedKey;
  for (const shortcut of COMMAND_SHORTCUTS) {
    if (!shortcut.web && !isDesktop) continue;
    const wanted = acceleratorParts(shortcut.accelerator);
    // Ctrl++ and Ctrl+_ need Shift on most layouts, so Shift is not checked for zooming
    const shiftAgnostic = wanted.key === '=' || wanted.key === '-';
    if (!shiftAgnostic && wanted.shift !== e.shiftKey) continue;
    if (keyMatches(key, wanted.key)) return shortcut.command;
  }
  // Redo also as Ctrl+Shift+Z
  if (e.shiftKey && key === 'z') return 'redo';
  return null;
};
