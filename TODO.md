# PDF Studio — TODO

Open work for both editions. Shared items are done on `master` and reach the desktop edition
through the automatic sync; desktop-only items live in `desktop/` on the `desktop` branch.

## Desktop edition

- [ ] **Code signing** of the Windows installer and executables (SmartScreen warns about unsigned
      apps); needs a certificate, then `CSC_LINK` / `CSC_KEY_PASSWORD` secrets in `release.yml`.
- [ ] **Auto-update** from GitHub Releases (`electron-updater`): check on start, download in the
      background, install on quit; respect the portable build (no self-update there).
- [ ] **Autosave and crash recovery**: keep a recovery copy of a document with unsaved changes in the
      user data folder and offer it after a crash (export is costly for large files, so only after
      a period of inactivity).
- [ ] **Printing** (`Ctrl+P`): print the exported document, not the app window (hidden window with
      the PDF, or the system viewer).
- [ ] **macOS and Linux packages** (`dmg`, `AppImage` / `deb`); the shell is already platform-aware.
- [ ] **Several documents**: tabs or one window per document (single-instance currently replaces
      the open document after the unsaved-changes check).
- [ ] **Content Security Policy** for the renderer: serve the app from a custom `app://` protocol so
      a CSP header can be set (removes the Electron security warning in development builds).
- [ ] **Run the desktop end-to-end test in CI** (`npm run e2e` on `windows-latest` in `release.yml`
      before packaging).

## Both editions

- [ ] **Report the CCITT `/Rows` problem to pdf.js** (6.3/6.4 render such scans blank, older pdf.js
      and other viewers cope); drop `services/pdfRepair.ts` once fixed upstream.
- [ ] **Repair inline CCITT images** too (`BI … /F /CCF … ID … EI` in content streams); the
      repair covers image XObjects only.
- [ ] **Search in very long documents**: search all pages in the background in chunks and show
      results as they arrive (currently one pass over every page before the first result).
- [ ] **Memory peak while scrolling**: decoded images and fonts of the pages passed are released
      only after the idle cleanup; limit the pdf.js caches during long scrolls as well.
- [ ] **Offline web bundle from a folder**: browsers do not run module scripts from `file://`; a
      service worker (installable PWA) would make the hosted web edition usable offline.
- [ ] **End-to-end test of the web edition** in CI (Playwright, Chromium) next to the unit tests.
- [ ] **Shortcut for 100 % zoom on Czech keyboards**: `Ctrl+1` types `+` on the Czech layout
      (zoom in); offer an alternative (e.g. `Ctrl+Shift+0`).
- [ ] **Vector graphics in the edit panel**: paths (lines, table borders, shapes) are not listed or
      selectable as elements, only text and images.
- [ ] **Images in nested forms**: images inside forms that are themselves inside forms are not
      found by the image listing.

## Done recently

- [x] Desktop edition as an additive branch with automatic sync, shared contract and command table
- [x] Damaged scans (CCITT `/Rows`) displayed; viewer memory no longer grows with document length
- [x] Settings backup / restore; desktop settings recovery copy; reload when the file changes on disk
- [x] Navigation panel, status bar and toolbar fit at 800–1440 px
