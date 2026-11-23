# PilsenPDF (P-PDF) — TODO

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

### Performance, Architecture & CI
- [ ] **Modularize remaining oversized source files**: split `pdfExporter.ts` (~1.8k LOC),
      `DocumentContext.tsx` (~1.9k LOC), and `pdfLoader.ts` (~1.7k LOC) into focused domain modules
      (`EditSidePanel`, `TextLayer`, `contentStreamEditor` image helpers, and `pdfMetadataService`
      are already modularized).
- [ ] **Memory peak while scrolling**: decoded images and fonts of the pages passed are released
      only after the idle cleanup; limit the pdf.js caches during long scrolls as well.
- [ ] **End-to-end test of the web edition** in CI (Playwright, Chromium) next to the unit tests.

### Editing & UX
- [ ] **Vector graphics in the edit panel**: paths (lines, table borders, shapes) are not listed or
      selectable as elements, only text and images.
- [ ] **Images in nested forms**: images inside forms that are themselves inside forms are not
      found by the image listing.

### PDF Compatibility
- [ ] **Report the CCITT `/Rows` problem to pdf.js** (6.3–6.5 render such scans blank, older pdf.js
      and other viewers cope); drop `services/pdfRepair.ts` once fixed upstream.
- [ ] **Repair inline CCITT images** too (`BI … /F /CCF … ID … EI` in content streams); the
      repair covers image XObjects only.

## Done recently

- [x] Performance, PWA & CI modernization: Vite 8 Rolldown vendor code-splitting + React.lazy modal/crypto/flattener loading, progressive chunked `Ctrl+F` search, installable offline PWA (`manifest.webmanifest` + `sw.js`), extracted `pdfMetadataService.ts`, and Node 24–native GitHub Actions (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8`)
- [x] Direct Edit UX & modularization: insert new images onto existing PDF pages, canvas rotation handle & numeric angle (`°`), arrow-key micro-nudge (`1 pt` / `Shift` = `10 pt`), smart alignment & snap guides (`Alt` bypass), mixed-style width reflow & text font-size/color controls, atomic batch multi-element move, Czech-layout-safe `Ctrl+Shift+0` 100% zoom shortcut, and extracted `streamImageService`, `snapGuides`, `InlineLineEditor`, `ElementGeometryControls`, `FindReplaceTab`, `FullStreamTab`
- [x] Interactive repositioning and resizing of native PDF images (8 handles, live DPI readout, clip & Form `/BBox` aware) and PDF text areas (drag-to-move, proportional corner scaling, side-handle width reflow, numeric X/Y/W/H inspector controls)
- [x] Library upgrades (React 19, Vite 8, Vitest 5, `pdfjs-dist` 6.5 with direct PDF `/ToUnicode` CMap parsing, `node-forge` 1.4.4, Electron 45) with zero root security advisories
- [x] Unified Edit mode UX (PDF Inspector with Elements / Find & Replace / Stream tabs, floating canvas actions, Visual Rewrite, batch element deletion, undo toasts)
- [x] Multi-line PDF element editing, per-line deletion, and column-layout preservation
- [x] Desktop edition as an additive branch with automatic sync, shared contract and command table
- [x] Damaged scans (CCITT `/Rows`) displayed; viewer memory no longer grows with document length
- [x] Settings backup / restore; desktop settings recovery copy; reload when the file changes on disk
- [x] Navigation panel, status bar and toolbar fit at 800–1440 px
