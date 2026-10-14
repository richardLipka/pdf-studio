# PDF Studio (Web & Desktop PDF Editor) 📄✨

[![Live Demo: Web](https://img.shields.io/badge/Live%20Web-richardlipka.github.io%2Fpdf--studio-blue?style=for-the-badge&logo=githubpages&logoColor=white)](https://richardlipka.github.io/pdf-studio/)
[![Download Desktop: Windows](https://img.shields.io/badge/Download-Windows%20(.exe)-blueviolet?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/richardLipka/pdf-studio/releases)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20In--Browser-brightgreen.svg)](#-privacy--security)
[![Languages: CS & EN](https://img.shields.io/badge/i18n-Čeština%20%7C%20English-purple.svg)](#-bilingual-support-i18n)
[![Tests: Vitest](https://img.shields.io/badge/Tests-242%20Passed-success.svg)](#-automated-testing)
[![Themes: 3 Switchable](https://img.shields.io/badge/Themes-Studio%20%7C%20Minimal%20%7C%20LCARS-orange.svg)](#-switchable-themes-url-encoded)

A modern, fast, and privacy-first application for editing, annotating, signing, and managing PDF documents directly on your machine with **zero server uploads**, **zero telemetry**, and **zero database requirements**. Available both as a zero-install **web application** and a native **Windows desktop application**.

---

## 📥 Download & Access

### 💻 Windows Desktop Edition
Pre-built binaries are published under [**GitHub Releases**](https://github.com/richardLipka/pdf-studio/releases) with every tagged version:

- **Installer (Recommended)**: `PDF Studio-Setup-<version>.exe`
  - Installs to local user directory (no administrator rights required).
  - Creates Start Menu and Desktop shortcuts with standard Windows uninstaller.
- **Portable Executable**: `PDF Studio-Portable-<version>.exe`
  - Standalone single executable, zero installation required.
  - Run directly from any folder or USB flash drive without touching system directories.
- **Portable ZIP**: `PDF Studio-win-x64-<version>.zip`
  - Unpacked standalone folder containing `PDF Studio.exe` and runtime assets.

> **Desktop-Exclusive Advantages:**
> - **Direct Disk Overwrite**: Pressing `Ctrl + S` directly updates the file on your disk without browser save/download prompts (includes overwrite protection warning).
> - **Command-Line & File Association**: Launch files directly from the command line (`"PDF Studio.exe" my_doc.pdf`) or right-click *Open With*.
> - **Persistent Preferences & Signatures**: Saves language, theme, and reusable signatures across app restarts directly in OS AppData.
> - **Native Application Menus**: Fully localized menu bar in Czech and English.

### 🌐 Web Edition
- **Instant Web Access**: [https://richardlipka.github.io/pdf-studio/](https://richardlipka.github.io/pdf-studio/) (Hosted on GitHub Pages)
- **Offline / Self-Hosted Web Bundle**: Download `pdf-studio-web.zip` from [GitHub Releases](https://github.com/richardLipka/pdf-studio/releases) and host on your own internal intranet or local static server.

---

## 🚀 Key Features

### 1. 🗂️ Advanced Page Management & Multi-Selection
- **Multi-Page Selection**:
  - `Click`: Focus and select page.
  - `Ctrl + Click` / `Cmd + Click`: Toggle individual pages into/out of selection.
  - `Shift + Click`: Select continuous range between pages.
  - `Shift + PageDown` / `Shift + PageUp`: Select all pages to document end or beginning.
  - `Shift + Home` / `Shift + End`: Select from active page to start or end of document.
  - `ArrowDown` / `ArrowUp` (with or without `Shift`): Navigate or multi-select pages with keyboard.
  - `Ctrl + A`: Select all pages.
- **Batch Operations**:
  - Delete selected pages in batch with confirmation dialog showing exact count of affected pages.
  - Rotate selected pages (90° clockwise / counter-clockwise).
  - Drag-and-drop thumbnail grid reordering.
- **Add New Pages**:
  - Merge pages from other PDF files via drag-and-drop.
  - Insert image files (PNG, JPG, WebP) as full pages.
  - Insert blank A4 sheets in Portrait or Landscape orientation.
  - Configurable insertion targets (*At beginning*, *After current page*, *At end*).

### 2. 🎛️ Triple-Tab Interface & Unified Right Dock
- **Revize & Anotace (Review Tab)**: Complete annotation toolkit including Object selection, Text selection, Pan hand, Highlighting, Underlines, Strikethroughs, Sticky notes, Text boxes, Vector pen, Geometric shapes suite (Rectangle, Ellipse, Line), Digital signatures & stamps, High-res image cropper, and Eraser.
- **Editace PDF (Edit Tab)**: Dedicated document modification suite designed for direct structural and stream alterations in PDF files: Visual Rewrite (Whiteout + Overlay), Content Stream Editor, and Element Removal.
- **Podpis & Certifikáty (Sign Tab)**: Dedicated signing & certification workspace: Visual signature pad (Draw/Type/Upload), Reusable stamp library with live counter, and direct Cryptographic PAdES / PKCS#7 digital signing.
- **Unified Right Dock**: Automatically switches and maintains mutual exclusivity between the `NotesPanel` (Review & Sign tabs) and the `EditSidePanel` (Edit tab), providing a clean, uncluttered workspace.

### 3. 📐 Geometric Shapes Suite (ISO 32000-1 `/Square`, `/Circle`, `/Line`)
- **Interactive Shape Drawing**: Draw Rectangles, Ellipses, and Straight Lines with live SVG drag previews.
- **Dynamic Morphing**: Select existing shapes and dynamically switch their subtype between Rectangle, Ellipse, and Line without recreating them.
- **Styling Controls**: Adjustable stroke widths (1pt - 12pt), curated stroke color palette, and optional background fill colors with instant transparency toggle.
- **ISO 32000-1 Conformance**: Generates native Appearance Streams (`/AP /N`) and Border dictionaries (`/BS /W`), guaranteeing identical visual rendering across all external PDF viewers.

### 4. ⚡ Direct Content Stream Segment & Page Editor (`streamReplace`)
- **Direct Segment Isolation**: Analyzes, decompresses (`FlateDecode` / `pako`), and isolates specific `BT ... ET` text objects and graphics chunks in `/Contents` streams.
- **Exact Page Text Model**: Every text-showing operator (`Tj`, `TJ`, `'`, `"`) of the page and its Form XObjects is tokenized and matched one-to-one with the glyphs decoded by pdf.js, so each `BT ... ET` object knows its real Unicode text, font, character codes and exact box — also for subset / CID (`Identity-H`) fonts whose text is not readable in the stream code.
- **Interactive Page Click-to-Edit**: In Edit mode, clicking on any text element on the canvas pre-selects the text object drawn under the cursor; the trash badge on a highlighted block deletes it with a single click.
- **Segment Selector & Live Previews**: Lists all text blocks on the active page with decoded text previews, font specifications (`/F1 12pt`), coordinates, and character counts.
- **Block Text Rewrite**: Type the new text of the selected block and it is written at the same position, size and colour. It is encoded with the original font's own codes when the font has all needed glyphs, otherwise a substitute font (standard or embedded Liberation) is added for that block only. Multi-line text keeps the line spacing.
- **Inline Line Editing**: Double-click any text on the page in Edit mode to rewrite just that line in place (Enter saves, Esc cancels). Only the line's text-showing operators change; positioning and state operators stay, so the other lines of the same text object do not move.
- **Readable Stream Code**: The stream editor shows string operands as `«decoded text»` instead of font codes (hex glyph ids of CID fonts, re-encoded simple fonts). Changed strings are re-encoded with the font selected at that point; untouched strings keep their original bytes.
- **Wider Character Set**: Rewrites can use every character in the font's full ToUnicode table (composite and non-embedded fonts), not just the characters already on the page.
- **Stale-Selection Protection**: Deletions and rewrites verify that the block still has the content that was selected (positional ids shift after every removal), so a click never removes a different element.
- **Direct Code Editor**: Live monospaced code editor allowing direct byte/operator edits inside the selected block.
- **Full Page Stream Tab**: Switchable view to inspect or rewrite the entire decompressed page stream at once.
- **Immediate Canvas Re-rendering**: Automatically invalidates `pdfjs-dist` cache and re-renders the modified page canvas in real-time.
- **Full 100-Step Undo & Redo**: Deep-cloned binary snapshot tracking ensures `Ctrl + Z` seamlessly reverts content stream edits.

### 5. 🛡️ ISO 32000-1 Conformance for Saving Unchanged Pages
- **Encrypted Source Protection (Section 7.6)**: Detects source documents protected with Standard Security (`/Encrypt`). Prevents copying raw encrypted ciphertext into unencrypted output files (which causes `"Unknown compression method in flate stream"` and blank pages in external readers) by automatically routing encrypted pages to high-resolution vector-rendered preservation.
- **Structural Annotation Preservation (Section 12.5)**: Selectively filters out stale review markups while preserving non-conflicting `/Link` annotations (hyperlinks, TOC navigation) and `/Widget` annotations across all unchanged pages.
- **Inherited Attributes Resolution (Section 7.7.3.4)**: Automatically resolves inherited `/Resources`, `/MediaBox`, and `/CropBox` definitions from parent `/Pages` tree nodes onto copied leaf pages so fonts and dimensions are never lost.
- **Document Outlines Preservation (Section 12.3.3)**: Preserves existing bookmark hierarchies (`/Outlines`) from the primary source document.

### 6. 🔍 Text Layer, Text Selection & Clipboard Support
- **Interactive PDF Text Layer**: Built-in PDF text layer extraction allows users to select text naturally with the mouse cursor across all vector PDF pages.
- **Instant Clipboard Copying**: Copy selected text directly to the system clipboard via `Ctrl + C` / `Cmd + C` or one-click floating action button.
- **Text-Snap Highlighting & Markups**: Floating quick-action menu allows one-click conversion of selected text ranges into exact ISO 32000-1 Highlight, Underline, Strikethrough, or Stream Text Replacement.
- **Smart Text Line Alignment**: Automatically snaps drawn highlights, underlines, and strikethroughs to the baseline or center of intersected text lines.

### 7. ✍️ Review & Annotation Suite with Notes Panel
- **Right-Side Notes & Reviews Panel**: Hidable sidebar listing all document notes, review comments, highlights, underlines, and strikethroughs with real-time text search and click-to-navigate.
- **Review Comments on Markups**: Add and edit review comments on underlines, strikethroughs, and highlights with visual badge pins on the canvas.
- **Full Line Width Storage & Display (1pt - 12pt)**:
  - Select from preset line thicknesses (`1pt`, `2pt`, `4pt`, `6pt`, `8pt`, `12pt`) with visual thickness indicators in the Toolbar.
  - **ISO 32000-1 Appearance Streams (`/AP /N`)**: Exported PDFs contain compiled vector Appearance Streams and Border specifications (`/BS << /W width >>`), ensuring line widths and colors are rendered in **every PDF viewer**.
- **PDF Annotation Extraction**: Automatically imports and renders pre-existing comments, shapes, lines, and annotations from loaded PDF documents.
- **Text Box & Typography**: Freehand text insertion with live font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and immediate color changes.
- **High-Resolution Image Cropper**: Select any rectangular region on any page to crop and copy high-resolution image data directly to your system clipboard.

### 8. 📑 Digital Signatures, Certificates & Stamp Library (PAdES / PKCS#7)
- **3 Signature Modes**: Draw (canvas signature pad), Type (handwriting cursive fonts), and Upload (with automated white-background transparency cleaning).
- **Named Stamp Library**: Save reusable stamps stored in browser `localStorage`.
- **JSON Export & Import**: Download and restore full stamp collections as JSON packages containing Base64-encoded bitmap images.
- **Cryptographic PAdES / PKCS#7 Signing**: Conforms to ISO 32000-1 detached signatures (`/adbe.pkcs7.detached`) with PKCS#12 / PFX certificate import, in-memory RSA key pair generator, SHA-256 byte-range hashing, and visual verification badges.

### 9. 📋 Document Metadata Inspection & Editing
- **Inspect & Edit Properties**: Title, Author, Subject, Keywords, Creator, Producer, Source and document language (`/Lang`).
- **Editable Dates**: Creation date and modification date (or "set to the time of saving", the default).
- **Custom Properties**: Any further entries of the information dictionary (Company, Category, Comments...), read from the source and editable.
- **Technical File Inspection**: Displays source file size, total page count and PDF format version.
- **Persistent Export**: Metadata is written to the information dictionary and to a matching XMP packet (`dc:source`, `xmp:CreateDate`...), so XMP-first viewers such as Acrobat show the same values.

### 10. 🖨️ Flatten to Images ("As Scanned")
- **One Image per Page**: The finished document (annotations, signatures and filled forms burned in) is rendered page by page and saved as a new image-only PDF — no selectable text, layers or form fields, like a scanned copy.
- **Options**: 100–300 DPI, colour / grayscale / black & white, JPEG quality, and an optional scanned look (paper tone, light noise, slight tilt). Metadata is carried over.

### 11. ⚙️ Configurable Rasterization & Export Settings
- **Customizable Fallback Parameters**: Full control over fallback rasterization settings (Scale: 1.0×, 1.5×, 2.0×, 3.0×; Format: JPEG with DCTDecode or PNG; JPEG Quality: 75% - 100%).
- **State Persistence**: Saved in browser `localStorage` and indicated dynamically in the StatusBar.

### 12. 🎨 Switchable Themes (URL-Encoded)
- **Studio (Dark)**: Sleek glassmorphic dark design with ambient shadows (`?theme=default`).
- **Minimal (Light)**: Pure white background (`#ffffff`), crisp black lines, zero blue tints, high-contrast monochrome UI (`?theme=minimal`).
- **LCARS (Star Trek: TNG)**: Authentic 24th-century Federation Starfleet interface with iconic LCARS amber, lilac, cyan palette, pill buttons, and condensed typography (`?theme=lcars`).

### 13. ⚡ Prioritized Lazy Page Rendering & Canvas Error Recovery
- **Prioritized Lazy Rendering Queue**: For large documents (> 5 pages), renders the first 5 pages and active viewport pages with highest priority without blocking CPU/GPU.
- **Dynamic Viewport Priority Elevation**: `IntersectionObserver` elevates offscreen pages to the front of the queue (`VIEWPORT` priority) when scrolled into view.
- **WebWorker Resource Cleanup**: Calls `pdfPage.cleanup()` across all renderers and annotation parsers to release operator lists and decoded bitmaps immediately.
- **Interactive Canvas Failure Recovery**: If a page fails to render, a non-blocking error overlay provides a clear description and an interactive "Zkusit znovu / Retry" button that cleanly resets state and re-enqueues render.

### 14. 📜 Event Log & Diagnostic Protocol Screen
- **Safe Detail Serialization**: `safeSerializeDetails` prevents OOM by replacing large binary buffers (`Uint8Array`, `ArrayBuffer`) with metadata summaries, safely catches circular references (`WeakSet`), serializes `BigInt`, and unwinds nested `Error.cause` chains.
- **Listener Isolation**: All event subscribers are protected with per-listener `try/catch` blocks.
- **Log Exports**: One-click download of all logs via `exportAsJson()` and `exportAsText()`.
- **Status Indicators**: Dynamic badge counters in Header and StatusBar indicating warning/error totals.

### 15. 📝 Interactive PDF Form Filling & Dual Save Mode (AcroForms)
- **Interactive Visual Form Layer**: Automatically parses and detects form widgets (Text fields, Multiline text areas, Checkboxes, Radio buttons, Dropdowns, Option lists) from imported PDF documents via `pdfjs-dist`.
- **Real-Time Canvas Interaction**: Direct in-place typing, selecting, and toggling of form fields on the canvas with full zoom scaling and theme integration.
- **Full Czech Unicode & Diacritics Support**: Seamless handling of Czech characters (`ěščřžýáíéůúťďň ĚŠČŘŽÝÁÍÉŮÚŤĎŇ`) encoded as UTF-16BE hex strings with `/NeedAppearances true` ISO 32000-1 conformance.
- **Dual Export Prompt & Modality**: Prompts user to choose between **Interactive AcroForm** (editable fields) and **Flattened PDF** (permanently burned for official archival).

### 16. 🖼️ Bitmap Graphics Suite & Image Manipulation (ISO 32000-1 XObjects & Scans)
- **Deep Image Inspection**: Discovers, isolates, and renders raster images (XObjects, inline images, full-page scans) directly in `EditSidePanel` and on canvas.
- **Compound 2D Affine Matrix Computation**: Compounds chained `cm` transformation matrices across `q ... Q` blocks to calculate exact physical positions $(X, Y)$ and dimensions in points.
- **DPI & Format Detection**: Calculates exact DPI ($\text{DPI} = \frac{\text{pixelWidth}}{\text{ptWidth}} \times 72$), identifies `/Filter` encodings (JPEG, PNG/Flate, JBIG2, CCITT Fax TIFF), and flags full-page scans ($\ge 82\ \%$ page coverage).
- **Core Operations**: In-place image replacement (preserves matrix geometry in `/Contents`), 1-click lossless PNG export via hardware-rendered canvas crop, and atomic deletion with 100-step Undo/Redo binary snapshots. Deleting an image removes exactly its invocation (token-based), never text or graphics drawn before it in the same graphics group; a selected image or text block can also be deleted with the Delete key. Every painted image is its own element — images repeated on a page, inline images and images inside the page's forms are listed and deleted one placement at a time.
- **Floating Canvas Quick Actions**: Floating toolbar anchored to selected images with resolution, DPI badges, and instant Download / Replace / Delete buttons.

### 17. 🌳 Semantic Document Tree, Hierarchical Nesting & Segmented Filtering
- **Vertical $Y$ Interleaving**: Images and text blocks are naturally ordered according to vertical position $Y$ into collapsible H1 and H2 document sections.
- **Segmented Filter Pills**: Interactive filters in `EditSidePanel` (**Vše** / **Text** / **Obrázky**) with live element count badges.
- **Clean Block Extraction**: Eliminates phantom whitespace blocks (`[( )] TJ`) and table column runaway merging.
- **Page-Scoped Edit Panel**: The panel lists exactly the elements of the active page (the page you scroll to, or click a block on); selections and highlights never carry over to another page, and overlays are shown only in the Edit tab.
- **Overlapping Elements**: Any element, including one covered by another, can be selected from the panel; it is raised above the others and scrolled into view.
- **Smallest-Area-First Stacking**: Guarantees 100% clickability and hit-testing for nested and overlapping blocks on the canvas.

### 18. 📑 Document Outlines & Collapsible Sidebar Navigation
- **Hierarchical Bookmarks Tree**: Automatically parses and resolves PDF document outline trees (`/Outlines`) with multi-level nesting, expansion toggles, and direct click page navigation.
- **Collapsible Sidebar Rail**: Left sidebar can be completely collapsed down to a compact 48px rail view via header button (`PanelLeft`) or sidebar toggle, maximizing screen real estate for editing.
- **Tabbed Sidebar Navigation**: Instantly toggle between **Stránky (Thumbnails)** and **Obsah (Outlines)** with responsive badge counters and empty-state indicators.

### 19. 🔍 Global In-Document Search & Canvas Highlights (`Ctrl + F`)
- **High-Performance Document Search**: Scans character streams and bounding boxes across all document pages via `pdfSearchService.ts`.
- **Search Controls & Filters**: Floating modal toolbar draggable with input debounce, match index counter (`X z Y`), case-sensitive (`Aa`), and whole-word (`\b`) match toggles.
- **Navigation & Shortcuts**: Smooth cycling with `Enter` (next match), `Shift + Enter` (previous match), and `Esc` (dismiss).
- **Canvas Visual Overlays**: Non-destructive search highlight overlays rendered directly over `TextLayer.tsx` with active-match focus rings and full support for Studio (dark), Minimal (light), and LCARS themes.

---

## 🔒 Privacy & Security

PDF Studio processes all documents **100% locally in your browser memory**:
- ❌ **No backend server required.**
- ❌ **No files are ever uploaded or transmitted across the internet.**
- ❌ **No telemetry or tracking of document contents.**
- ✅ **Completely offline capable.**

---

## 🌐 Bilingual Support (i18n)

Full localization available in **Czech (Čeština)** and **English (English)** with instant toggle:
- Complete UI translations in [`src/i18n/cs.ts`](src/i18n/cs.ts) and [`src/i18n/en.ts`](src/i18n/en.ts).
- Dynamically switches all tooltips, dialogs, button labels, and notifications without reloading.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | Open in-document search (Hledat v dokumentu) |
| <kbd>Enter</kbd> / <kbd>Shift</kbd> + <kbd>Enter</kbd> | Next / Previous search match (when search bar is active) |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | Undo (Zpět) |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo (Znovu) |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selected annotation or trigger page deletion |
| <kbd>Enter</kbd> | Confirm modals & dialogs / Save note |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> | Insert newline in note editor |
| <kbd>Escape</kbd> | Close search bar / Cancel & close modal dialogs |
| <kbd>↓</kbd> / <kbd>→</kbd> | Next page (scrolling viewport) |
| <kbd>↑</kbd> / <kbd>←</kbd> | Previous page (scrolling viewport) |
| <kbd>Shift</kbd> + <kbd>↓</kbd> / <kbd>→</kbd> | Expand page selection downwards |
| <kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>←</kbd> | Expand page selection upwards |
| <kbd>Shift</kbd> + <kbd>PageDown</kbd> / <kbd>Shift</kbd> + <kbd>End</kbd> | Select from active page to end of document |
| <kbd>Shift</kbd> + <kbd>PageUp</kbd> / <kbd>Shift</kbd> + <kbd>Home</kbd> | Select from active page to start of document |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | Select all pages |
| <kbd>Ctrl</kbd> + <kbd>0</kbd> | Zoom to fit selected page |
| <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>=</kbd> | Zoom in |
| <kbd>Ctrl</kbd> + <kbd>-</kbd> | Zoom out |

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework & Build** | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) | Fast development and strict type safety |
| **Desktop Runtime** | [Electron 44](https://www.electronjs.org/) + [electron-builder](https://www.electron.build/) | Cross-platform desktop runtime, AppData persistence, and binary packaging |
| **PDF Rendering** | [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) | Fast in-browser and desktop canvas rendering of PDF pages |
| **PDF Manipulation & Export** | [`pdf-lib`](https://pdf-lib.js.org/) | Native vector page preservation, PageTree repair, burning annotations, signatures & shapes |
| **Signature Pad** | [`signature_pad`](https://github.com/szimek/signature_pad) | Smooth vector signature capture with pressure sensitivity |
| **Typography & Subsetting** | [`fontkit`](https://github.com/foliojs/fontkit) | Font glyph parsing, Unicode diacritics mapping, and font subsetting |
| **Icons** | [`lucide-react`](https://lucide.dev/) | Modern UI icon library |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Responsive glassmorphic, minimal light, and LCARS themes |
| **Automated Testing** | [Vitest](https://vitest.dev/) | Comprehensive automated test suite (39 test files, 242 tests) |

---

## 🧪 Automated Testing

PDF Studio includes a comprehensive automated test suite covering page management, keyboard shortcuts, history stack, color extraction, image cropping, stream replacement, document outlines, full-text search, the page text model and block text rewriting, geometric shapes, and PDF export:

```bash
# Run all unit and integration tests
npm test
```

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 22.13+ or 24 (required by `pdfjs-dist` 6)
- `npm` or `yarn` / `pnpm`

### Installation & Development

```bash
# Clone repository
git clone https://github.com/richardLipka/pdf-studio.git
cd pdf-studio

# Install dependencies
npm install

# Start local web development server
npm run dev

# Start desktop app in development mode (with hot-reload)
npm run electron:dev

# Run automated Vitest test suite (40 test files, 262 tests)
npm test

# Run local build & asset content visibility test suite
npm run test:assets
```

Open [http://localhost:3000](http://localhost:3000) for the web version, or the desktop window will launch automatically.

---

## 🔨 Building & Packaging

### Web Version Build

```bash
# Build optimized static web bundle (outputs to dist/)
npm run build

# Preview production build locally
npm run preview
```

### Windows Desktop Binaries (Local Build)

```bash
# Build full Windows release (NSIS Installer + Portable Exe + ZIP Archive)
npm run electron:dist

# Build only standalone portable executable
npm run electron:dist:portable

# Build only NSIS setup installer
npm run electron:dist:nsis

# Build unpacked folder for rapid testing without packaging
npm run electron:pack
```

All generated binaries are located in the `release/` directory:
- `release/PDF Studio-Setup-2.0.0.exe` (Installer)
- `release/PDF Studio-Portable-2.0.0.exe` (Single standalone executable)
- `release/PDF Studio-win-x64-2.0.0.zip` (Portable ZIP archive)

---

## 🚀 Publishing Releases (Desktop & Web Dual Release)

PDF Studio is configured with automated GitHub Actions CI/CD ([`.github/workflows/release.yml`](.github/workflows/release.yml)) for publishing both web and desktop versions:

### Automated GitHub Release via Git Tag

To publish a new version:

```bash
# 1. Update version in package.json (e.g. 2.0.0)
# 2. Commit and tag the release
git tag v2.0.0
git push origin v2.0.0
```

### What Happens Automatically on Tag Push:

1. **Web Release Job** (Ubuntu):
   - Runs full Vitest test suite (`npm test`).
   - Builds production web assets (`npm run build`).
   - Packages `pdf-studio-web.zip` for offline self-hosting.
   - Deploys live web app to **GitHub Pages** ([https://richardlipka.github.io/pdf-studio/](https://richardlipka.github.io/pdf-studio/)).
2. **Windows Desktop Release Job** (Windows):
   - Compiles desktop scripts and web assets (`npm run electron:build`).
   - Packages `PDF Studio-Setup-*.exe`, `PDF Studio-Portable-*.exe`, and `PDF Studio-win-x64-*.zip`.
3. **GitHub Release Publishing Job**:
   - Creates a new [**GitHub Release**](https://github.com/richardLipka/pdf-studio/releases) under tag `v2.0.0`.
   - Attaches all Windows desktop binaries and the offline `pdf-studio-web.zip`.
   - Generates automated release notes from commit history.

You can also trigger a release manually anytime from GitHub under the **Actions** tab by choosing **Release & Publish (Desktop & Web)** → **Run workflow**.

---

## 👤 Author & Acknowledgments

- **Author**: [Richard Lipka](https://home.zcu.cz/~lipka/) ([lipka@fav.zcu.cz](mailto:lipka@fav.zcu.cz))
- **Institution**: [Faculty of Applied Sciences (FAV), University of West Bohemia](https://www.fav.zcu.cz/cs/)
- **Repository**: [https://github.com/richardLipka/pdf-studio](https://github.com/richardLipka/pdf-studio)
