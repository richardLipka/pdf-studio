# PDF Studio (Web PDF Editor)

A client-side, privacy-first web application for editing, annotating, signing, and managing PDF documents directly in the browser without any backend or database requirements.

Supported Languages: **Czech (Čeština)** & **English (English)**.

---

## 🚀 Key Features

1. **Page Management & Multi-Selection**:
   - **Multi-Selection**: Select pages via Click, `Ctrl + Click`, `Shift + Click`, `Shift + PageUp/PageDown`, `Shift + Home/End`, or Arrow keys (`↑`/`↓`/`←`/`→` + `Shift`), or `Ctrl + A`.
   - **Batch Operations**: Delete and rotate multiple selected pages simultaneously with confirmation dialog displaying exact page count.
   - **Add Pages**: Insert pages from other PDF documents or images (PNG, JPEG, WebP) with full drag-and-drop.
   - **Blank Pages**: Insert blank A4 sheets in Portrait or Landscape orientation.
   - **Reordering**: Drag-and-drop thumbnail grid reordering.
   - **Rotation**: Rotate individual or selected pages by 90° increments.

2. **Triple-Tab Interface & Unified Right Dock**:
   - **Revize (Review Tab)**: Complete annotation toolkit including Object selection, Text selection, Pan hand, Highlighting, Underlines, Strikethroughs, Sticky notes, Text boxes, Vector pen, Geometric shapes suite (Rectangle, Ellipse, Line), High-res image cropper, and Eraser.
   - **Editace (Edit Tab)**: Dedicated document modification suite designed for direct structural and stream alterations in PDF files: Visual Rewrite (Whiteout + Overlay), Content Stream Editor, and Remove Elements (permanent removal of text blocks & images).
   - **Podpis (Sign Tab)**: Dedicated signing & certification workspace: Visual signature pad (Draw/Type/Upload), Reusable stamp library with live counter, and direct Cryptographic PAdES / PKCS#7 signing conforming to ISO 32000-1.
   - **Unified Right Dock**: Automatically switches and maintains mutual exclusivity between the `NotesPanel` (Review & Sign tabs) and the `EditSidePanel` (Edit tab), providing a clean, uncluttered workspace.

3. **Geometric Shapes Suite (ISO 32000-1 `/Square`, `/Circle`, `/Line`)**:
   - **Drawing Tools**: Draw Rectangles, Ellipses, and Straight Lines with live SVG drag previews.
   - **Dynamic Morphing**: Select existing shapes and dynamically switch their subtype between Rectangle, Ellipse, and Line without recreating them.
   - **Styling Controls**: Adjustable stroke widths (1pt - 12pt), curated stroke color palette, and optional background fill colors with instant transparency toggle.
   - **Native PDF Conformance**: Generates ISO 32000-1 compliant Appearance Streams (`/AP /N`) and Border dictionaries (`/BS /W`), guaranteeing exact rendering in all external PDF viewers.

4. **Direct Content Stream Segment & Page Editor**:
   - **Segment Isolation & Inspection**: Decodes and isolates specific `BT ... ET` text objects and graphics chunks in `/Contents` streams.
   - **Interactive Click-to-Edit**: In Edit mode, clicking on any text element on the canvas instantly focuses and selects that specific stream segment in the Stream Editor.
   - **Direct Code Editor & Quick Replacer**: Live monospaced code editor allowing direct byte/operator edits or quick text replacement inside the selected block, plus a Full Page Stream tab.
   - **Cascading Double-Replacement Prevention**: Isolates and masks `[...] TJ` kerning arrays first so nested word substitutions (e.g. `test` → `testing`) never produce corrupted duplicates (`testinging`).
   - **Immediate Canvas Re-rendering**: Automatically invalidates `pdfjs-dist` cache and re-renders the modified page canvas in real-time.
   - **Full 100-Step Undo & Redo**: Deep-cloned binary snapshot tracking ensures `Ctrl + Z` seamlessly reverts content stream edits.
   - **Logging**: Captures duration in ms, stream sizes, and detailed error logs under `'edit'` category.

5. **Document Review & Annotation Suite**:
   - **Interactive PDF Text Layer & Selection**: Built-in text layer allows natural mouse selection, native clipboard copying (`Ctrl + C`), and floating quick-actions for instant highlighting, underlining, crossing out, or stream replacing selected text.
   - **Right-Side Notes & Reviews Panel**: Hidable side panel listing all document notes, review comments, highlights, underlines, and strikethroughs with full-text instant search and direct click navigation.
   - **Comments on Markups**: Attach review comments and notes to underlines, strikethroughs, and highlights with visual indicator badges on canvas.
   - **Full Line Width Storage & Display (1pt - 12pt)**: Complete support for line thicknesses (1, 2, 4, 6, 8, 12 pt) with ISO 32000-1 Appearance Streams (`/AP /N`) and Border dictionaries (`/BS /W`).
   - **PDF Annotation Extraction**: Automatically parses and loads existing comments, sticky notes, shapes, lines, and text markups from imported PDF files via `pdfjs-dist`.
   - **Text Markups & Smart Text Line Alignment**: Highlight, Underline, Strikethrough (Crossing text) with customizable colors and line widths. Automatically detects text lines when drawn across text, snapping underlines under letters/baseline and strikethroughs across the center of letters.
   - **Text Insertion & Typography**: Add custom text boxes with immediate font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and instant color changes.
   - **High-Resolution Image Cropper**: Crop rectangular regions directly from pages to the system clipboard in high quality.
   - **Eraser**: Delete individual annotations.

6. **ISO 32000-1 Conformance for Saving Unchanged Pages**:
   - **Encrypted Source Protection (ISO 32000-1 Section 7.6)**: Detects documents protected with Standard Security (`/Encrypt`). Prevents copying raw encrypted ciphertext into unencrypted output files (which causes `"Unknown compression method in flate stream"` and blank pages in readers) by automatically routing encrypted pages to high-resolution vector-rendered preservation.
   - **Structural Annotation Preservation (ISO 32000-1 Section 12.5)**: Selectively filters out stale review markups while preserving non-conflicting `/Link` annotations (hyperlinks, TOC navigation) and `/Widget` annotations across all unchanged pages.
   - **Inherited Attributes Resolution (ISO 32000-1 Section 7.7.3.4)**: Automatically resolves inherited `/Resources`, `/MediaBox`, and `/CropBox` definitions from parent `/Pages` tree nodes onto copied leaf pages so fonts and dimensions are never lost.
   - **Document Outlines Preservation (ISO 32000-1 Section 12.3.3)**: Preserves existing bookmark hierarchies (`/Outlines`) from the primary source document.

7. **Digital Signatures, Certificates & Stamp Library (PAdES / PKCS#7)**:
   - **Visual Draw**: Canvas signature pad with touch, mouse, and stylus support.
   - **Upload**: Upload signature/stamp image with background transparency cleaning.
   - **Type**: Generate signature using handwriting-style cursive script fonts.
   - **Named Stamp Library**: Save multiple reusable stamps in browser `localStorage`.
   - **JSON Portability**: Download and restore full stamp collections as JSON packages containing Base64-encoded bitmap images.
   - **Cryptographic PAdES / PKCS#7 Signing (Certificate Tab)**:
     - Direct in-browser cryptographic signing conforming to ISO 32000-1 (`/Filter /Adobe.PPKLite`, `/SubFilter /adbe.pkcs7.detached`).
     - Import `.p12` / `.pfx` software certificates with password decryption and certificate chain parsing.
     - Built-in in-memory 2048-bit RSA key pair & X.509 self-signed test certificate generator with immediate `.p12` export.
     - Automatic `/ByteRange` SHA-256 calculation and ASN.1 PKCS#7 detached signature injection.
     - Optional visual verification badge with signer CN, date, time, and custom reason/location.

8. **Document Metadata Inspection & Editing**:
   - **Properties**: Read and edit Title, Author, Subject, Keywords, Creator, and Producer directly in the browser.
   - **Technical File Inspection**: View source file size, total page count, creation date, modification timestamp, and PDF format version.
   - **Persistence**: Writes metadata directly to the exported PDF document trailer information dictionary.

9. **Configurable Rasterization & Export Settings**:
   - **Customizable Fallback Parameters**: Full user control over fallback rasterization settings whenever a page cannot be directly vector-copied:
     - Resolution/Scale: `1.0×` (72 DPI), `1.5×` (108 DPI), `2.0×` (144 DPI - default), `3.0×` (216 DPI - high-res print).
     - Image Format: `JPEG` (recommended with DCTDecode compression for scans/comics) or `PNG` (lossless).
     - JPEG Quality: Configurable slider and presets (75%, 85%, 90% default, 95%, 100%).
   - **Persistent Storage**: Saved in `localStorage` and indicated dynamically in StatusBar.

10. **Switchable URL-Encoded Themes**:
   - **Studio (Dark)**: Modern dark glassmorphic interface (`?theme=default`).
   - **Minimal (Light)**: Pure white background, clean black lines, monochrome aesthetic (`?theme=minimal`).
   - **LCARS (Star Trek: TNG)**: 24th-century LCARS interface with amber, lilac, cyan palette and pill buttons (`?theme=lcars`).

11. **Prioritized Lazy Page Rendering & Canvas Error Recovery**:
   - **Prioritized Lazy Rendering Queue**: For large documents (> 5 pages), renders the first 5 pages and active viewport pages with highest priority without blocking CPU/GPU.
   - **Dynamic Viewport Priority Elevation**: `IntersectionObserver` elevates offscreen pages to the front of the queue (`VIEWPORT` priority) when scrolled into view.
   - **WebWorker Resource Cleanup**: Calls `pdfPage.cleanup()` across all renderers and annotation parsers to release operator lists and decoded bitmaps immediately.
   - **Concurrent Load Deduplication**: In-flight `getCachedPdfDocument` tasks are deduplicated via shared loading promises.
   - **Interactive Canvas Failure Recovery**: If a page fails to render, a non-blocking error overlay provides a clear description and an interactive "Zkusit znovu / Retry" button that cleanly resets state and re-enqueues render.

12. **Event Log & Diagnostic Protocol Screen**:
   - **Safe Detail Serialization**: `safeSerializeDetails` prevents OOM by replacing large binary buffers (`Uint8Array`, `ArrayBuffer`) with metadata summaries, safely catches circular references (`WeakSet`), serializes `BigInt`, and unwinds nested `Error.cause` chains.
   - **Listener Isolation**: All event subscribers are protected with per-listener `try/catch` blocks.
   - **Log Exports**: One-click download of all logs via `exportAsJson()` and `exportAsText()`.
   - **Status Indicators**: Dynamic badge counters in Header and StatusBar indicating warning/error totals.

13. **Interactive PDF Form Filling & Dual Save Mode (AcroForms)**:
   - **Interactive Visual Form Layer**: Automatically parses and detects form widgets (Text fields, Multiline text areas, Checkboxes, Radio buttons, Dropdowns, Option lists) from imported PDF documents via `pdfjs-dist`.
   - **Real-Time Canvas Interaction**: Allows direct in-place typing, selecting, and toggling of form fields on the canvas with full zoom scaling and theme integration.
   - **Full Czech Unicode & Diacritics Support**: Seamless handling of Czech characters (`ěščřžýáíéůúťďň ĚŠČŘŽÝÁÍÉŮÚŤĎŇ`) encoded as UTF-16BE hex strings with `/NeedAppearances true` ISO 32000-1 conformance.
   - **Dual Export Prompt & Modality**: Prompts user to choose between **Interactive AcroForm** (editable fields) and **Flattened PDF** (permanently burned for official archival).

14. **100% Client-Side Privacy & Native Page Preservation**:
   - Zero file upload to servers. All operations happen in-memory via Web Workers and Web APIs.
   - Native vector streams, fonts, and image compressions are preserved on export without unnecessary rasterization.

---

## 🛠 Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Build & Bundler** | [Vite](https://vitejs.dev/) + React 18 + TypeScript | Fast development, strong type safety, and component ecosystem |
| **PDF Manipulation** | [`pdf-lib`](https://pdf-lib.js.org/) | Merging, splitting, modifying pages, PageTree repair, drawing annotations & signatures onto PDF |
| **PDF Rendering** | [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) | Fast canvas rendering of pages, viewport calculation |
| **Signature Pad** | [`signature_pad`](https://github.com/szimek/signature_pad) | Smooth vector signature capture |
| **Icons** | [`lucide-react`](https://lucide.dev/) | Clean, modern UI icons |
| **Styling** | Modern Tailwind CSS | Sleek, responsive, dark glassmorphic, light minimal, and LCARS design |
| **i18n** | Type-safe React Context | Full dictionary translations for CS & EN |
| **Testing** | [Vitest](https://vitest.dev/) | Comprehensive automated unit & integration testing (26 test files, 133 tests) |

---

## 📁 Project Structure

```text
pdf-editor/
├── public/
│   ├── favicon.svg
│   └── fonts/              # Custom cursive fonts for typed signatures
├── src/
│   ├── assets/             # Static assets & sample files
│   ├── components/
│   │   ├── common/         # Dropzone, Toast, Icons
│   │   ├── layout/         # Header, Toolbar, Sidebar, StatusBar, NotesPanel, EditSidePanel
│   │   ├── modals/         # SignatureModal, AddPageModal, ConfirmModal, LogModal, SettingsModal, MetadataModal
│   │   └── viewer/         # PdfViewer, PageCanvas, TextLayer, AnnotationLayer
│   ├── context/
│   │   ├── DocumentContext.tsx  # Document state, pages, selection, undo/redo history, zoom
│   │   ├── EditorContext.tsx    # Active tool, stroke color, font size, stamps library, modal states, raster settings
│   │   └── ThemeContext.tsx     # Dynamic URL-encoded themes (studio, minimal, lcars)
│   ├── i18n/
│   │   ├── cs.ts           # Czech translations
│   │   ├── en.ts           # English translations
│   │   └── context.tsx     # i18n Provider and translation hooks
│   ├── services/
│   │   ├── logger.ts       # Structured logging, safe serialization, event subscription & issue counters
│   │   ├── pdfExporter.ts  # Generates final PDF using pdf-lib (burns annotations/signatures/shapes)
│   │   ├── pdfLoader.ts    # Parses and renders PDFs via pdfjs-dist with WebWorker memory cleanup
│   │   ├── renderQueue.ts  # Prioritized lazy rendering queue for viewport & large files
│   │   ├── contentStreamEditor.ts # Direct stream parser, token replacer, and structural segment tree
│   │   ├── formService.ts  # AcroForm detection, widget mapping, and value persistence
│   │   └── pageManager.ts  # Adds, deletes, reorders, and rotates pages
│   ├── types/
│   │   ├── annotations.ts  # Types for highlights, notes, lines, shapes, signatures
│   │   ├── document.ts     # Document and page data models
│   │   ├── i18n.ts         # Translation schema
│   │   └── stamp.ts        # Stamp data model & JSON export schema
│   ├── utils/
│   │   ├── coordinate.ts   # Screen-to-PDF coordinate mapping
│   │   ├── file.ts         # File drag/drop, reading and background cleaning helpers
│   │   └── textSnap.ts     # Smart text line detection & baseline snapping
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── tests/                  # Automated Vitest test suite (133 tests)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── LICENSE                 # MIT License
├── README.md
└── GEMINI.md
```

---

## 🧑‍💻 Development Guide

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run automated tests
npm run test

# Build for production
npm run build
```

---

## 👤 Author & Acknowledgments

- **Author**: [Richard Lipka](https://home.zcu.cz/~lipka/) ([lipka@fav.zcu.cz](mailto:lipka@fav.zcu.cz))
- **Institution**: [Faculty of Applied Sciences (FAV), University of West Bohemia](https://www.fav.zcu.cz/cs/)
