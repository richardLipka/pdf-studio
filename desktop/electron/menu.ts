import type { MenuItemConstructorOptions } from 'electron';
import { AppCommandId, getAccelerator } from '../../src/shared/appCommands';
import { DesktopSettings, DesktopSettingsPatch, RecentFileItem } from '../../src/shared/desktopApi';
import type { TranslationSchema } from '../../src/types/i18n';

export const REPOSITORY_URL = 'https://github.com/richardLipka/pdf-studio';

export interface MenuContext {
  strings: TranslationSchema;
  settings: DesktopSettings;
  recentFiles: RecentFileItem[];
  isMac: boolean;
  appName: string;
  /** Runs an application command in the web app */
  command: (command: AppCommandId) => void;
  openPath: (filePath: string) => void;
  /** Disk path of the opened document (enables "Show in folder") */
  openedFilePath: string | null;
  showInFolder: () => void;
  clearRecentFiles: () => void;
  updateSettings: (patch: DesktopSettingsPatch) => void;
  openExternal: (url: string) => void;
}

/**
 * The native menu. Labels come from the web app's translations and accelerators from the shared
 * command table, so the menu, the keyboard and the shortcuts dialog always agree. Pure function of
 * its context (unit-tested without Electron); main.ts turns it into a Menu.
 */
export const buildMenuTemplate = (ctx: MenuContext): MenuItemConstructorOptions[] => {
  const { strings: t, settings } = ctx;
  const m = t.desktopMenu;

  /** A menu item running an application command, with the accelerator from the command table */
  const item = (command: AppCommandId): MenuItemConstructorOptions => ({
    label: t.commands[command],
    accelerator: getAccelerator(command),
    click: () => ctx.command(command),
  });

  const recentSubmenu: MenuItemConstructorOptions[] =
    ctx.recentFiles.length > 0
      ? [
          ...ctx.recentFiles.map((file, index) => ({
            // "&" would turn the next letter into a mnemonic on Windows
            label: `${index < 9 ? `&${index + 1} ` : ''}${file.name.replace(/&/g, '&&')}`,
            toolTip: file.path,
            sublabel: file.path,
            click: () => ctx.openPath(file.path),
          })),
          { type: 'separator' },
          { label: m.clearRecent, click: () => ctx.clearRecentFiles() },
        ]
      : [{ label: m.noRecent, enabled: false }];

  const themes: Array<[DesktopSettings['theme'], string]> = [
    ['default', t.theme.studio],
    ['minimal', t.theme.minimal],
    ['lcars', t.theme.lcars],
  ];
  const languages: Array<[DesktopSettings['language'], string]> = [
    ['cs', 'Čeština'],
    ['en', 'English'],
  ];

  const template: MenuItemConstructorOptions[] = [];
  if (ctx.isMac) {
    template.push({
      label: ctx.appName,
      submenu: [
        { label: t.commands.about, click: () => ctx.command('about') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: m.file,
      submenu: [
        item('newDocument'),
        item('open'),
        { label: m.openRecent, submenu: recentSubmenu },
        { ...item('reopenLast'), enabled: ctx.recentFiles.length > 0 },
        { type: 'separator' },
        item('save'),
        item('saveAs'),
        { type: 'separator' },
        item('flatten'),
        item('signCertificate'),
        item('metadata'),
        { type: 'separator' },
        { label: t.commands.showInFolder, enabled: Boolean(ctx.openedFilePath), click: () => ctx.showInFolder() },
        item('closeDocument'),
        { type: 'separator' },
        ctx.isMac ? { role: 'close' } : { role: 'quit', label: m.exit },
      ],
    },
    {
      label: m.edit,
      submenu: [
        item('undo'),
        item('redo'),
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        item('selectAllPages'),
        { type: 'separator' },
        item('find'),
      ],
    },
    {
      label: m.view,
      submenu: [
        item('zoomIn'),
        item('zoomOut'),
        item('zoomActual'),
        item('fitPage'),
        item('fitWidth'),
        { type: 'separator' },
        item('toggleSidebar'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen },
        { role: 'reload', label: m.reload },
        { role: 'toggleDevTools', label: m.devTools },
      ],
    },
    {
      label: m.settings,
      submenu: [
        {
          label: m.autoReopen,
          type: 'checkbox',
          checked: settings.reopenLastFileOnStartup,
          click: (menuItem) => ctx.updateSettings({ reopenLastFileOnStartup: menuItem.checked }),
        },
        {
          label: m.confirmOverwrite,
          type: 'checkbox',
          checked: settings.confirmOverwrite,
          click: (menuItem) => ctx.updateSettings({ confirmOverwrite: menuItem.checked }),
        },
        item('settings'),
        { type: 'separator' },
        item('backupSettings'),
        item('restoreSettings'),
        { type: 'separator' },
        {
          label: m.theme,
          submenu: themes.map(([value, label]) => ({
            label,
            type: 'radio' as const,
            checked: settings.theme === value,
            click: () => ctx.updateSettings({ theme: value }),
          })),
        },
        {
          label: m.language,
          submenu: languages.map(([value, label]) => ({
            label,
            type: 'radio' as const,
            checked: settings.language === value,
            click: () => ctx.updateSettings({ language: value }),
          })),
        },
      ],
    },
    {
      label: m.help,
      submenu: [
        item('shortcuts'),
        item('eventLog'),
        { type: 'separator' },
        { label: m.github, click: () => ctx.openExternal(REPOSITORY_URL) },
        ...(ctx.isMac ? [] : [{ label: t.commands.about, click: () => ctx.command('about') }]),
      ],
    }
  );
  return template;
};
