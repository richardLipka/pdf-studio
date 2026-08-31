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

2. **Document Review & Annotation Suite**:
   - **Right-Side Notes & Reviews Panel**: Hidable side panel listing all document notes, review comments, highlights, underlines, and strikethroughs with full-text instant search and direct click navigation.
   - **Comments on Markups**: Attach review comments and notes to underlines, strikethroughs, and highlights with visual indicator badges on canvas.
   - **PDF Annotation Extraction**: Automatically parses and loads existing comments, sticky notes, and text markups from imported PDF files via `pdfjs-dist`.
   - **Text Markups**: Highlight, Underline, Strikethrough (Crossing text).
   - **Text Insertion & Typography**: Add custom text boxes with immediate font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and instant color changes.
   - **Freehand Drawing & Pen**: Pen tool with color palette and stroke width adjustment.
   - **High-Resolution Image Cropper**: Crop rectangular regions directly from pages to the system clipboard in high quality.
   - **Eraser**: Delete individual annotations.

3. **Digital Signatures & Stamp Library**:
   - **Draw**: Canvas signature pad with touch, mouse, and stylus support.
   - **Upload**: Upload signature/stamp image with background transparency cleaning.
   - **Type**: Generate signature using handwriting-style cursive script fonts.
   - **Named Stamp Library**: Save multiple reusable stamps in browser `localStorage`.
   - **JSON Portability**: Download and restore full stamp collections as JSON packages containing Base64-encoded bitmap images.

4. **Switchable URL-Encoded Themes**:
   - **Studio (Dark)**: Modern dark glassmorphic interface (`?theme=default`).
   - **Minimal (Light)**: Pure white background, clean black lines, monochrome aesthetic (`?theme=minimal`).
   - **LCARS (Star Trek: TNG)**: 24th-century LCARS interface with amber, lilac, cyan palette and pill buttons (`?theme=lcars`).

5. **Flicker-Free 100-Step Undo/Redo**:
   - Deep-cloned immutable history stack (100 snapshots) tracking all page modifications, markups, rotations, and annotations.
   - Memoized canvas rendering without full-screen blinking during history steps.
   - Atomic history snapshots captured on mouse release (`onMouseUp`).

6. **Smart Zoom & Viewport Synchronization**:
   - **Zoom to Selected Page** (`Ctrl + 0` / *"Na vybranou"* button).
   - **Fit Width** and **Fit Page** auto-scaling.
   - Automatic smooth scrolling to centered active page in main viewer and sidebar.

7. **100% Client-Side Privacy & Native Page Preservation**:
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
| **Testing** | [Vitest](https://vitest.dev/) | Comprehensive unit & integration testing (31 tests) |

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
│   │   ├── modals/         # SignatureModal, AddPageModal, ConfirmModal
│   │   └── viewer/         # PdfViewer, PageCanvas, AnnotationLayer
│   ├── context/
│   │   ├── DocumentContext.tsx  # Document state, pages, selection, undo/redo history, zoom
│   │   ├── EditorContext.tsx    # Active tool, stroke color, font size, stamps library
│   │   └── ThemeContext.tsx     # Dynamic URL-encoded themes (studio, minimal, lcars)
│   ├── i18n/
│   │   ├── cs.ts           # Czech translations
│   │   ├── en.ts           # English translations
│   │   └── context.tsx     # i18n Provider and translation hooks
│   ├── services/
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
│   │   └── file.ts         # File drag/drop, reading and background cleaning helpers
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

