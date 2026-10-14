import { app, Menu, MenuItemConstructorOptions, BrowserWindow, dialog } from 'electron';
import { SettingsStore, RecentFileItem } from './settingsStore';

export interface MenuActionEmitter {
  sendAction: (action: string, payload?: any) => void;
}

export const buildAppMenu = (
  mainWindow: BrowserWindow,
  settingsStore: SettingsStore,
  emitter: MenuActionEmitter
): Menu => {
  const isMac = process.platform === 'darwin';
  const recentFiles: RecentFileItem[] = settingsStore.get('recentFiles') || [];
  const lastOpenFile: string | undefined = settingsStore.get('lastOpenFilePath');
  const reopenOnStartup: boolean = settingsStore.get('reopenLastFileOnStartup') ?? true;

  const recentMenuSubmenu: MenuItemConstructorOptions[] =
    recentFiles.length > 0
      ? [
          ...recentFiles.map((file) => ({
            label: `${file.name}  —  ${file.path}`,
            click: () => {
              emitter.sendAction('open-file-path', file.path);
            },
          })),
          { type: 'separator' },
          {
            label: 'Vymazat historii otevřených souborů / Clear Recent',
            click: () => {
              settingsStore.clearRecentFiles();
              // Rebuild menu to reflect cleared state
              const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
              Menu.setApplicationMenu(updatedMenu);
              emitter.sendAction('recent-files-updated', []);
            },
          },
        ]
      : [
          {
            label: 'Žádné nedávné soubory / No recent files',
            enabled: false,
          },
        ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Soubor / File',
      submenu: [
        {
          label: 'Nový prázdný dokument / New Blank',
          accelerator: 'CmdOrCtrl+N',
          click: () => emitter.sendAction('new-blank-document'),
        },
        {
          label: 'Otevřít PDF... / Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => emitter.sendAction('trigger-open-dialog'),
        },
        {
          label: 'Naposledy otevřené / Open Recent',
          submenu: recentMenuSubmenu,
        },
        {
          label: 'Znovu otevřít poslední soubor / Reopen Last Closed',
          accelerator: 'CmdOrCtrl+Shift+T',
          enabled: Boolean(lastOpenFile),
          click: () => {
            if (lastOpenFile) {
              emitter.sendAction('open-file-path', lastOpenFile);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Uložit / Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => emitter.sendAction('trigger-save'),
        },
        {
          label: 'Uložit jako... / Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => emitter.sendAction('trigger-save-as'),
        },
        { type: 'separator' },
        {
          label: 'Zploštit na obrázky... / Export Flattened...',
          click: () => emitter.sendAction('trigger-flatten-export'),
        },
        {
          label: 'Digitálně podepsat certifikátem... / Sign with Certificate...',
          click: () => emitter.sendAction('trigger-cert-sign'),
        },
        { type: 'separator' },
        {
          label: 'Zavřít dokument / Close Document',
          accelerator: 'CmdOrCtrl+W',
          click: () => emitter.sendAction('close-document'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const, label: 'Ukončit / Exit' },
      ],
    },
    {
      label: 'Úpravy / Edit',
      submenu: [
        {
          label: 'Zpět / Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => emitter.sendAction('trigger-undo'),
        },
        {
          label: 'Znovu / Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => emitter.sendAction('trigger-redo'),
        },
        { type: 'separator' },
        { role: 'cut' as const, label: 'Vyjmout / Cut' },
        { role: 'copy' as const, label: 'Kopírovat / Copy' },
        { role: 'paste' as const, label: 'Vložit / Paste' },
        { role: 'selectAll' as const, label: 'Vybrat vše / Select All' },
      ],
    },
    {
      label: 'Zobrazení / View',
      submenu: [
        {
          label: 'Přiblížit / Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => emitter.sendAction('zoom-in'),
        },
        {
          label: 'Oddálit / Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => emitter.sendAction('zoom-out'),
        },
        {
          label: 'Původní velikost / Reset Zoom (100%)',
          accelerator: 'CmdOrCtrl+0',
          click: () => emitter.sendAction('zoom-reset'),
        },
        {
          label: 'Přizpůsobit šířce / Fit Width',
          accelerator: 'CmdOrCtrl+8',
          click: () => emitter.sendAction('fit-width'),
        },
        {
          label: 'Přizpůsobit straně / Fit Page',
          accelerator: 'CmdOrCtrl+9',
          click: () => emitter.sendAction('fit-page'),
        },
        { type: 'separator' },
        {
          label: 'Přepnout postranní panel / Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => emitter.sendAction('toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' as const, label: 'Celá obrazovka / Fullscreen' },
        { role: 'reload' as const, label: 'Obnovit / Reload' },
        { role: 'toggleDevTools' as const, label: 'Vývojářské nástroje / Developer Tools' },
      ],
    },
    {
      label: 'Nastavení / Settings',
      submenu: [
        {
          label: 'Automaticky otevřít poslední soubor při spuštění / Auto-reopen last file',
          type: 'checkbox',
          checked: reopenOnStartup,
          click: (menuItem) => {
            settingsStore.set('reopenLastFileOnStartup', menuItem.checked);
          },
        },
        { type: 'separator' },
        {
          label: 'Vzhled / Theme: Studio (Tmavý / Dark)',
          type: 'radio',
          checked: settingsStore.get('theme') === 'default',
          click: () => emitter.sendAction('change-theme', 'default'),
        },
        {
          label: 'Vzhled / Theme: Minimal (Světlý / Light)',
          type: 'radio',
          checked: settingsStore.get('theme') === 'minimal',
          click: () => emitter.sendAction('change-theme', 'minimal'),
        },
        {
          label: 'Vzhled / Theme: LCARS (Sci-Fi Star Trek)',
          type: 'radio',
          checked: settingsStore.get('theme') === 'lcars',
          click: () => emitter.sendAction('change-theme', 'lcars'),
        },
        { type: 'separator' },
        {
          label: 'Jazyk / Language: Čeština',
          type: 'radio',
          checked: settingsStore.get('language') === 'cs',
          click: () => emitter.sendAction('change-lang', 'cs'),
        },
        {
          label: 'Jazyk / Language: English',
          type: 'radio',
          checked: settingsStore.get('language') === 'en',
          click: () => emitter.sendAction('change-lang', 'en'),
        },
      ],
    },
    {
      label: 'Nápověda / Help',
      submenu: [
        {
          label: 'Klávesové zkratky / Keyboard Shortcuts',
          click: () => emitter.sendAction('show-shortcuts-modal'),
        },
        {
          label: 'Diagnostický protokol / Event Log',
          click: () => emitter.sendAction('show-log-modal'),
        },
        { type: 'separator' },
        {
          label: 'O aplikaci PDF Studio / About PDF Studio',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'O aplikaci PDF Studio',
              message: 'PDF Studio Desktop',
              detail:
                'Verze: 2.0.0 (Desktop Edition)\n' +
                'Autor: Richard Lipka (lipka@fav.zcu.cz)\n' +
                'Fakulta aplikovaných věd, Západočeská univerzita v Plzni\n\n' +
                '100% soukromý, klientský editor, prohlížeč a certifikační nástroj pro PDF dokumenty s podporou ISO 32000-1 a PAdES podpisů.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
};
