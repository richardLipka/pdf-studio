# PDF Studio — desktop edition

The desktop edition is the web app from the repository root running in an Electron window. This
folder holds only the shell around it; everything you see in the window is the same code that runs
on <https://richardlipka.github.io/pdf-studio/>.

What the shell adds to the web app:

| Feature | How |
| :--- | :--- |
| Native open / save dialogs | `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S` and the File menu |
| Save writes the opened file in place | atomic write (temporary file + rename); asks before overwriting, with *Do not ask again* (Settings → *Ask before overwriting files*) |
| Unsaved changes guard | `●` in the window title; closing asks *Save & close / Discard / Cancel* |
| Recent files | File → *Open recent*, the start screen, `Ctrl+Shift+T` reopens the previous file |
| Command line and "Open with" | `"PDF Studio.exe" document.pdf`; a second launch passes the file to the running window |
| Persistent settings | language, theme, rasterization settings, signatures/stamps, window size, *Reopen last file on startup*, *Ask before overwriting files* — saved automatically |
| Settings backup | Settings → *Back Up Settings & Signatures…* / *Restore Settings from Backup…* (JSON; same format as the web edition's settings dialog) |
| Files changed elsewhere | the opened file is polled every 2 s; when another program saves it, the app offers to load the new version (its own saves do not trigger this) |
| Windows integration | recent files in the taskbar jump list, File → *Show in Folder*, PDFs dropped anywhere on the window open |
| Native menu | localized (Czech / English), labels from `src/i18n`, shortcuts from `src/shared/appCommands.ts` |

Settings are stored in `pdf-studio-settings.json` in the user data folder
(`%APPDATA%\PDF Studio` on Windows). The portable executable keeps them in a `PDF Studio Data`
folder next to itself. Every start that reads the file successfully copies it to
`pdf-studio-settings.json.bak`; if the settings file is ever damaged, that last working copy is used
(the damaged file is kept as `.corrupt`) instead of starting from the defaults.

## How the two editions stay compatible

```
master   ── web app + everything shared (src/, tests/, vite build, Pages deployment)
desktop  ── master + desktop/ (this folder) + .github/workflows/release.yml
```

* The web app talks to the shell only through `window.electronAPI`, defined in
  [`src/shared/desktopApi.ts`](../src/shared/desktopApi.ts). In a browser the object does not exist and
  every desktop code path is skipped, so all application code lives on `master`.
* The `desktop` branch never changes files that exist on `master`; it only adds this folder and the
  release workflow. Merging `master` into `desktop` therefore never conflicts. The
  [`sync-desktop`](../.github/workflows/sync-desktop.yml) workflow does it automatically after every
  push to `master`, after checking that the desktop shell still type-checks and the tests pass.
* The shell compiles against the shared contract, translations and command table, so a change on
  `master` that the shell would not follow fails the sync instead of breaking the app.
* The version number comes from the root `package.json` (`scripts/package.mjs`).

To bring updates over by hand: `git checkout desktop && git merge master`.

## Development

Run everything from this folder; the root dependencies must be installed too (`npm ci` in the root).

```bash
npm ci                 # Electron, electron-builder, esbuild, playwright-core
npm run dev            # vite dev server of the web app (hot reload) inside the Electron window
npm run build          # web app + main/preload bundles into desktop/build
npm start              # run desktop/build (after npm run build)
npm run typecheck      # Electron shell + shared contract
npm test               # unit tests of the shell (also part of the root npm test)
npm run e2e            # end-to-end run with real files and a temporary profile (after npm run build):
                       # command line, outline after page edits, Save / Save As / save on close,
                       # restart with reopened file and settings, menu, Ctrl+O, recent files,
                       # damaged scan display, settings file + backup / restore, reload after an
                       # external change, Show in Folder, external links
npm run audit          # local build / private PDF corpus audit (src/assets/testfiles)
```

## Packaging

```bash
npm run pack           # unpacked app in release/win-unpacked (quick check; npm run e2e -- --packaged)
npm run dist           # installer, portable executable and zip in release/
npm run dist:nsis      # only the installer (also :portable, :zip)
```

Files in `release/`: `PDF-Studio-Setup-<version>.exe`, `PDF-Studio-Portable-<version>.exe` and
`PDF-Studio-<version>-win-x64.zip`. A version tag on the `desktop` branch
(`git tag v2.0.0 && git push origin v2.0.0`) builds them in GitHub Actions and publishes a release
together with the offline web bundle.

The window icon comes from `resources/icon.png`, rendered from `public/favicon.svg` by
`npx electron scripts/make-icon.cjs`.

## Layout

| Path | Purpose |
| :--- | :--- |
| `electron/main.ts` | main process: window, IPC handlers, file I/O, close guard, single instance |
| `electron/preload.ts` | `window.electronAPI` for the sandboxed renderer |
| `electron/menu.ts` | native menu template (pure function, unit-tested) |
| `electron/settingsStore.ts` | settings file with validation and atomic writes |
| `electron/cli.ts` | PDF file from the command line |
| `scripts/` | build, dev, packaging and icon scripts |
| `tests/shell.test.ts` | unit tests of the shell |
| `e2e/desktop.e2e.mjs` | end-to-end test (Playwright driving Electron) |
