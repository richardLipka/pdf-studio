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

2. **Dual-Tab Interface: Review vs Edit**:
   - **Revize (Review Tab)**: Complete annotation toolkit including Object selection, Text selection, Pan hand, Highlighting, Underlines, Strikethroughs, Sticky notes, Text boxes, Vector pen, Geometric shapes, Digital signatures & stamps, High-res image cropper, and Eraser.
   - **Editace (Edit Tab)**: Dedicated document modification suite designed for direct structural and stream alterations in PDF files with modular expansion capability.

3. **Direct Content Stream Segment & Page Editor**:
   - **Segment Isolation & Inspection**: Decodes and isolates specific `BT ... ET` text objects and graphics chunks in `/Contents` streams.
   - **Interactive Click-to-Edit**: In Edit mode, clicking on any text element on the canvas instantly focuses and selects that specific stream segment in the Stream Editor.
   - **Direct Code Editor & Quick Replacer**: Live monospaced code editor allowing direct byte/operator edits or quick text replacement inside the selected block, plus a Full Page Stream tab.
   - **Immediate Canvas Re-rendering**: Automatically invalidates `pdfjs-dist` cache and re-renders the modified page canvas in real-time.
   - **Full 100-Step Undo & Redo**: Deep-cloned binary snapshot tracking ensures `Ctrl + Z` seamlessly reverts content stream edits.
   - **Logging**: Captures duration in ms, stream sizes, and detailed error logs under `'edit'` category.

4. **Document Review & Annotation Suite**:
   - **Interactive PDF Text Layer & Selection**: Built-in text layer allows natural mouse selection, native clipboard copying (`Ctrl + C`), and floating quick-actions for instant highlighting, underlining, crossing out, or stream replacing selected text.
   - **Right-Side Notes & Reviews Panel**: Hidable side panel listing all document notes, review comments, highlights, underlines, and strikethroughs with full-text instant search and direct click navigation.
   - **Comments on Markups**: Attach review comments and notes to underlines, strikethroughs, and highlights with visual indicator badges on canvas.
   - **Full Line Width Storage & Display (1pt - 12pt)**: Complete support for line thicknesses (1, 2, 4, 6, 8, 12 pt) with ISO 32000-1 Appearance Streams (`/AP /N`) and Border dictionaries (`/BS /W`) ensuring exact line width rendering across all PDF readers.
   - **PDF Annotation Extraction**: Automatically parses and loads existing comments, sticky notes, shapes, lines, and text markups from imported PDF files via `pdfjs-dist`.
   - **Text Markups & Smart Text Line Alignment**: Highlight, Underline, Strikethrough (Crossing text) with customizable colors and line widths. Automatically detects text lines when drawn across text, snapping underlines under letters/baseline and strikethroughs across the center of letters.
   - **Text Insertion & Typography**: Add custom text boxes with immediate font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and instant color changes.
   - **Freehand Drawing & Shapes**: Pen tool, lines, rectangles, and ellipses with color palette and stroke width adjustment.
   - **High-Resolution Image Cropper**: Crop rectangular regions directly from pages to the system clipboard in high quality.
   - **Eraser**: Delete individual annotations.

5. **Digital Signatures & Stamp Library**:
   - **Draw**: Canvas signature pad with touch, mouse, and stylus support.
   - **Upload**: Upload signature/stamp image with background transparency cleaning.
   - **Type**: Generate signature using handwriting-style cursive script fonts.
   - **Named Stamp Library**: Save multiple reusable stamps in browser `localStorage`.
   - **JSON Portability**: Download and restore full stamp collections as JSON packages containing Base64-encoded bitmap images.

6. **Document Metadata Inspection & Editing**:
   - **Properties**: Read and edit Title, Author, Subject, Keywords, Creator, and Producer directly in the browser.
   - **Technical File Inspection**: View source file size, total page count, creation date, modification timestamp, and PDF format version.
   - **Persistence**: Writes metadata directly to the exported PDF document trailer information dictionary.

7. **Configurable Rasterization & Export Settings**:
   - **Customizable Fallback Parameters**: Full user control over fallback rasterization settings whenever a page cannot be directly vector-copied:
     - Resolution/Scale: `1.0×` (72 DPI), `1.5×` (108 DPI), `2.0×` (144 DPI - default), `3.0×` (216 DPI - high-res print).
     - Image Format: `JPEG` (recommended with DCTDecode compression for scans/comics) or `PNG` (lossless).
     - JPEG Quality: Configurable slider and presets (75%, 85%, 90% default, 95%, 100%).
   - **Persistent Storage**: Saved in `localStorage` and indicated dynamically in StatusBar.

8. **Switchable URL-Encoded Themes**:
   - **Studio (Dark)**: Modern dark glassmorphic interface (`?theme=default`).
   - **Minimal (Light)**: Pure white background, clean black lines, monochrome aesthetic (`?theme=minimal`).
   - **LCARS (Star Trek: TNG)**: 24th-century LCARS interface with amber, lilac, cyan palette and pill buttons (`?theme=lcars`).

9. **Flicker-Free 100-Step Undo/Redo**:
   - Deep-cloned immutable history stack (100 snapshots) tracking all page modifications, markups, rotations, and annotations.
   - Memoized canvas rendering without full-screen blinking during history steps.
   - Atomic history snapshots captured on mouse release (`onMouseUp`).

10. **Smart Zoom & Viewport Synchronization**:
   - **Zoom to Selected Page** (`Ctrl + 0` / *"Na vybranou"* button).
   - **Fit Width** and **Fit Page** auto-scaling.
   - Automatic smooth scrolling to centered active page in main viewer and sidebar.

11. **Event Log & Diagnostic Protocol Screen**:
   - **Real-Time Operation Tracking**: Captures all loading, saving, rendering, editing, and system events with timestamps and severity levels (`INFO`, `WARN`, `ERROR`, `SUCCESS`).
   - **Comprehensive PDF-Lib Diagnostics & Sanitization**: Strips pre-header/post-EOF noise, captures 7 parse attempts with stack traces, and catalog/PageTree repair tracking.
   - **Rasterization Fallback Reason, Impact & JPEG Transformation Tracking**: Captures specific reasons, image dimensions, scale factors, data sizes, and JPEG/PNG transformation parameters whenever fallback rasterization is triggered.
   - **Diagnostics & Error Inspection**: Dedicated diagnostic modal with level filtering, instant search, JSON/stack trace expandable blocks, and one-click clipboard copying.
   - **Status Indicators**: Dynamic badge counters in Header and StatusBar indicating warning/error totals.

12. **100% Client-Side Privacy & Native Page Preservation**:
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
| **Testing** | [Vitest](https://vitest.dev/) | Comprehensive unit & integration testing (56 tests) |

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
│   │   ├── layout/         # Header, Toolbar, Sidebar, StatusBar, NotesPanel
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
│   │   ├── logger.ts       # Structured logging, event subscription & issue counters
│   │   ├── pdfExporter.ts  # Generates final PDF using pdf-lib (burns annotations/signatures)
│   │   ├── pdfLoader.ts    # Parses and renders PDFs via pdfjs-dist
│   │   └── pageManager.ts  # Adds, deletes, reorders, and rotates pages
│   ├── types/
│   │   ├── annotations.ts  # Types for highlights, notes, lines, signatures
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
├── tests/                  # Automated Vitest test suite
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

