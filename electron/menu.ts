import { app, Menu, MenuItemConstructorOptions, BrowserWindow, dialog } from 'electron';
import { SettingsStore, RecentFileItem } from './settingsStore';

export interface MenuActionEmitter {
  sendAction: (action: string, payload?: any) => void;
}

interface MenuLocale {
  file: {
    menu: string;
    newBlank: string;
    open: string;
    openRecent: string;
    clearRecent: string;
    noRecent: string;
    reopenLast: string;
    save: string;
    saveAs: string;
    exportFlattened: string;
    signWithCert: string;
    closeDoc: string;
    exit: string;
  };
  edit: {
    menu: string;
    undo: string;
    redo: string;
    cut: string;
    copy: string;
    paste: string;
    selectAll: string;
  };
  view: {
    menu: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
    fitWidth: string;
    fitPage: string;
    toggleSidebar: string;
    fullscreen: string;
    reload: string;
    devTools: string;
  };
  settings: {
    menu: string;
    autoReopen: string;
    themeStudio: string;
    themeMinimal: string;
    themeLcars: string;
    langCs: string;
    langEn: string;
  };
  help: {
    menu: string;
    shortcuts: string;
    eventLog: string;
    about: string;
    aboutTitle: string;
    aboutHeading: string;
    aboutDetail: string;
  };
}

const locales: Record<'cs' | 'en', MenuLocale> = {
  cs: {
    file: {
      menu: 'Soubor',
      newBlank: 'Nový prázdný dokument',
      open: 'Otevřít PDF...',
      openRecent: 'Naposledy otevřené',
      clearRecent: 'Vymazat historii otevřených souborů',
      noRecent: 'Žádné nedávné soubory',
      reopenLast: 'Znovu otevřít poslední soubor',
      save: 'Uložit',
      saveAs: 'Uložit jako...',
      exportFlattened: 'Zploštit na obrázky (pro tisk / archiv)...',
      signWithCert: 'Digitálně podepsat certifikátem...',
      closeDoc: 'Zavřít dokument',
      exit: 'Ukončit',
    },
    edit: {
      menu: 'Úpravy',
      undo: 'Zpět',
      redo: 'Znovu',
      cut: 'Vyjmout',
      copy: 'Kopírovat',
      paste: 'Vložit',
      selectAll: 'Vybrat vše',
    },
    view: {
      menu: 'Zobrazení',
      zoomIn: 'Přiblížit',
      zoomOut: 'Oddálit',
      zoomReset: 'Původní velikost (100 %)',
      fitWidth: 'Přizpůsobit šířce',
      fitPage: 'Přizpůsobit straně',
      toggleSidebar: 'Přepnout postranní panel',
      fullscreen: 'Celá obrazovka',
      reload: 'Obnovit',
      devTools: 'Vývojářské nástroje',
    },
    settings: {
      menu: 'Nastavení',
      autoReopen: 'Automaticky otevřít poslední soubor při spuštění',
      themeStudio: 'Vzhled: Studio (Tmavý)',
      themeMinimal: 'Vzhled: Minimal (Světlý)',
      themeLcars: 'Vzhled: LCARS (Sci-Fi)',
      langCs: 'Jazyk: Čeština',
      langEn: 'Jazyk: English',
    },
    help: {
      menu: 'Nápověda',
      shortcuts: 'Klávesové zkratky',
      eventLog: 'Diagnostický protokol',
      about: 'O aplikaci PDF Studio',
      aboutTitle: 'O aplikaci PDF Studio',
      aboutHeading: 'PDF Studio Desktop',
      aboutDetail:
        'Verze: 2.0.0 (Desktopová edice)\n' +
        'Autor: Richard Lipka (lipka@fav.zcu.cz)\n' +
        'Fakulta aplikovaných věd, Západočeská univerzita v Plzni\n\n' +
        '100% soukromý, klientský editor, prohlížeč a certifikační nástroj pro PDF dokumenty s podporou ISO 32000-1 a PAdES podpisů.',
    },
  },
  en: {
    file: {
      menu: 'File',
      newBlank: 'New Blank Document',
      open: 'Open PDF...',
      openRecent: 'Open Recent',
      clearRecent: 'Clear Recent Files',
      noRecent: 'No Recent Files',
      reopenLast: 'Reopen Last Closed File',
      save: 'Save',
      saveAs: 'Save As...',
      exportFlattened: 'Export Flattened to Images (Print / Archive)...',
      signWithCert: 'Digitally Sign with Certificate...',
      closeDoc: 'Close Document',
      exit: 'Exit',
    },
    edit: {
      menu: 'Edit',
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      selectAll: 'Select All',
    },
    view: {
      menu: 'View',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      zoomReset: 'Reset Zoom (100%)',
      fitWidth: 'Fit to Width',
      fitPage: 'Fit to Page',
      toggleSidebar: 'Toggle Sidebar',
      fullscreen: 'Toggle Full Screen',
      reload: 'Reload',
      devTools: 'Developer Tools',
    },
    settings: {
      menu: 'Settings',
      autoReopen: 'Auto-reopen last file on startup',
      themeStudio: 'Theme: Studio (Dark)',
      themeMinimal: 'Theme: Minimal (Light)',
      themeLcars: 'Theme: LCARS (Sci-Fi)',
      langCs: 'Language: Čeština',
      langEn: 'Language: English',
    },
    help: {
      menu: 'Help',
      shortcuts: 'Keyboard Shortcuts',
      eventLog: 'Event Log & Diagnostics',
      about: 'About PDF Studio',
      aboutTitle: 'About PDF Studio',
      aboutHeading: 'PDF Studio Desktop',
      aboutDetail:
        'Version: 2.0.0 (Desktop Edition)\n' +
        'Author: Richard Lipka (lipka@fav.zcu.cz)\n' +
        'Faculty of Applied Sciences, University of West Bohemia\n\n' +
        '100% private, client-side PDF editor, viewer and certification suite conforming to ISO 32000-1 and PAdES signatures.',
    },
  },
};

export const buildAppMenu = (
  mainWindow: BrowserWindow,
  settingsStore: SettingsStore,
  emitter: MenuActionEmitter
): Menu => {
  const isMac = process.platform === 'darwin';
  const currentLang: 'cs' | 'en' = settingsStore.get('language') === 'en' ? 'en' : 'cs';
  const loc = locales[currentLang];

  const recentFiles: RecentFileItem[] = settingsStore.get('recentFiles') || [];
  const lastOpenFile: string | undefined = settingsStore.get('lastOpenFilePath');
  const reopenOnStartup: boolean = settingsStore.get('reopenLastFileOnStartup') ?? true;
  const currentTheme = settingsStore.get('theme') || 'default';

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
            label: loc.file.clearRecent,
            click: () => {
              settingsStore.clearRecentFiles();
              const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
              Menu.setApplicationMenu(updatedMenu);
              emitter.sendAction('recent-files-updated', []);
            },
          },
        ]
      : [
          {
            label: loc.file.noRecent,
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
      label: loc.file.menu,
      submenu: [
        {
          label: loc.file.newBlank,
          accelerator: 'CmdOrCtrl+N',
          click: () => emitter.sendAction('new-blank-document'),
        },
        {
          label: loc.file.open,
          accelerator: 'CmdOrCtrl+O',
          click: () => emitter.sendAction('trigger-open-dialog'),
        },
        {
          label: loc.file.openRecent,
          submenu: recentMenuSubmenu,
        },
        {
          label: loc.file.reopenLast,
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
          label: loc.file.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => emitter.sendAction('trigger-save'),
        },
        {
          label: loc.file.saveAs,
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => emitter.sendAction('trigger-save-as'),
        },
        { type: 'separator' },
        {
          label: loc.file.exportFlattened,
          click: () => emitter.sendAction('trigger-flatten-export'),
        },
        {
          label: loc.file.signWithCert,
          click: () => emitter.sendAction('trigger-cert-sign'),
        },
        { type: 'separator' },
        {
          label: loc.file.closeDoc,
          accelerator: 'CmdOrCtrl+W',
          click: () => emitter.sendAction('close-document'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const, label: loc.file.exit },
      ],
    },
    {
      label: loc.edit.menu,
      submenu: [
        {
          label: loc.edit.undo,
          accelerator: 'CmdOrCtrl+Z',
          click: () => emitter.sendAction('trigger-undo'),
        },
        {
          label: loc.edit.redo,
          accelerator: 'CmdOrCtrl+Y',
          click: () => emitter.sendAction('trigger-redo'),
        },
        { type: 'separator' },
        { role: 'cut' as const, label: loc.edit.cut },
        { role: 'copy' as const, label: loc.edit.copy },
        { role: 'paste' as const, label: loc.edit.paste },
        { role: 'selectAll' as const, label: loc.edit.selectAll },
      ],
    },
    {
      label: loc.view.menu,
      submenu: [
        {
          label: loc.view.zoomIn,
          accelerator: 'CmdOrCtrl+Plus',
          click: () => emitter.sendAction('zoom-in'),
        },
        {
          label: loc.view.zoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => emitter.sendAction('zoom-out'),
        },
        {
          label: loc.view.zoomReset,
          accelerator: 'CmdOrCtrl+0',
          click: () => emitter.sendAction('zoom-reset'),
        },
        {
          label: loc.view.fitWidth,
          accelerator: 'CmdOrCtrl+8',
          click: () => emitter.sendAction('fit-width'),
        },
        {
          label: loc.view.fitPage,
          accelerator: 'CmdOrCtrl+9',
          click: () => emitter.sendAction('fit-page'),
        },
        { type: 'separator' },
        {
          label: loc.view.toggleSidebar,
          accelerator: 'CmdOrCtrl+B',
          click: () => emitter.sendAction('toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' as const, label: loc.view.fullscreen },
        { role: 'reload' as const, label: loc.view.reload },
        { role: 'toggleDevTools' as const, label: loc.view.devTools },
      ],
    },
    {
      label: loc.settings.menu,
      submenu: [
        {
          label: loc.settings.autoReopen,
          type: 'checkbox',
          checked: reopenOnStartup,
          click: (menuItem) => {
            settingsStore.set('reopenLastFileOnStartup', menuItem.checked);
          },
        },
        { type: 'separator' },
        {
          label: loc.settings.themeStudio,
          type: 'radio',
          checked: currentTheme === 'default',
          click: () => {
            settingsStore.set('theme', 'default');
            const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
            Menu.setApplicationMenu(updatedMenu);
            emitter.sendAction('change-theme', 'default');
          },
        },
        {
          label: loc.settings.themeMinimal,
          type: 'radio',
          checked: currentTheme === 'minimal',
          click: () => {
            settingsStore.set('theme', 'minimal');
            const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
            Menu.setApplicationMenu(updatedMenu);
            emitter.sendAction('change-theme', 'minimal');
          },
        },
        {
          label: loc.settings.themeLcars,
          type: 'radio',
          checked: currentTheme === 'lcars',
          click: () => {
            settingsStore.set('theme', 'lcars');
            const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
            Menu.setApplicationMenu(updatedMenu);
            emitter.sendAction('change-theme', 'lcars');
          },
        },
        { type: 'separator' },
        {
          label: loc.settings.langCs,
          type: 'radio',
          checked: currentLang === 'cs',
          click: () => {
            settingsStore.set('language', 'cs');
            const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
            Menu.setApplicationMenu(updatedMenu);
            emitter.sendAction('change-lang', 'cs');
          },
        },
        {
          label: loc.settings.langEn,
          type: 'radio',
          checked: currentLang === 'en',
          click: () => {
            settingsStore.set('language', 'en');
            const updatedMenu = buildAppMenu(mainWindow, settingsStore, emitter);
            Menu.setApplicationMenu(updatedMenu);
            emitter.sendAction('change-lang', 'en');
          },
        },
      ],
    },
    {
      label: loc.help.menu,
      submenu: [
        {
          label: loc.help.shortcuts,
          click: () => emitter.sendAction('show-shortcuts-modal'),
        },
        {
          label: loc.help.eventLog,
          click: () => emitter.sendAction('show-log-modal'),
        },
        { type: 'separator' },
        {
          label: loc.help.about,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: loc.help.aboutTitle,
              message: loc.help.aboutHeading,
              detail: loc.help.aboutDetail,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
};
