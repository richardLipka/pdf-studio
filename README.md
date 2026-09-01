# PDF Studio (Web PDF Editor) 📄✨

[![Live Demo: GitHub Pages](https://img.shields.io/badge/Live%20Demo-richardlipka.github.io%2Fpdf--studio-blue?style=for-the-badge&logo=githubpages&logoColor=white)](https://richardlipka.github.io/pdf-studio/)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20In--Browser-brightgreen.svg)](#-privacy--security)
[![Languages: CS & EN](https://img.shields.io/badge/i18n-Čeština%20%7C%20English-purple.svg)](#-bilingual-support-i18n)
[![Tests: Vitest](https://img.shields.io/badge/Tests-56%20Passed-success.svg)](#-automated-testing)
[![Themes: 3 Switchable](https://img.shields.io/badge/Themes-Studio%20%7C%20Minimal%20%7C%20LCARS-orange.svg)](#-switchable-themes-url-encoded)

A modern, fast, and privacy-first web application for editing, annotating, signing, and managing PDF documents directly in your browser with **zero server uploads** and **zero database requirements**.

👉 **Live Application**: [https://richardlipka.github.io/pdf-studio/](https://richardlipka.github.io/pdf-studio/)

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

### 2. 🎛️ Dual-Tab Architecture: Review & Document Editing
- **Revize & Anotace (Review Tab)**: Complete annotation toolkit including Object selection, Text selection, Pan hand, Highlighting, Underlines, Strikethroughs, Sticky notes, Text boxes, Vector pen, Geometric shapes, Digital signatures & stamps, High-res image cropper, and Eraser.
- **Editace PDF (Edit Tab)**: Dedicated document modification suite designed for direct structural and stream alterations in PDF files with modular expansion capability.

### 3. ⚡ Direct Content Stream Segment & Page Editor (`streamReplace`)
- **Direct Segment Isolation**: Analyzes, decompresses (`FlateDecode` / `pako`), and isolates specific `BT ... ET` text objects and graphics chunks in `/Contents` streams.
- **Interactive Page Click-to-Edit**: In Edit mode, clicking on any text element on the canvas instantly pre-selects that exact stream segment (`BT ... ET`) in the Stream Editor for direct modification.
- **Segment Selector & Live Previews**: Lists all text blocks on the active page with decoded text previews, font specifications (`/F1 12pt`), coordinates, and character counts.
- **Direct Code Editor & Quick Replacer**: Live monospaced code editor allowing direct byte/operator edits or quick text replacement inside the selected block.
- **Full Page Stream Tab**: Switchable view to inspect or rewrite the entire decompressed page stream at once.
- **Immediate Canvas Re-rendering**: Automatically invalidates `pdfjs-dist` cache and re-renders the modified page canvas in real-time so users immediately verify the visual result.
- **Full 100-Step Undo & Redo**: Deep-cloned binary snapshot tracking ensures `Ctrl + Z` seamlessly reverts content stream edits.
- **Comprehensive Logging**: Every stream edit is tracked with execution duration in milliseconds, data sizes, and detailed diagnostic logs under category `'edit'`.

### 4. 🔍 Text Layer, Text Selection & Clipboard Support
- **Interactive PDF Text Layer**: Built-in PDF text layer extraction allows users to select text naturally with the mouse cursor across all vector PDF pages.
- **Instant Clipboard Copying**: Copy selected text directly to the system clipboard via `Ctrl + C` / `Cmd + C` or one-click floating action button.
- **Text-Snap Highlighting & Markups**: Floating quick-action menu allows one-click conversion of selected text ranges into exact ISO 32000-1 Highlight, Underline, Strikethrough, or Stream Text Replacement.
- **Smart Text Line Alignment**: Automatically snaps drawn highlights, underlines, and strikethroughs to the baseline or center of intersected text lines.

### 5. ✍️ Review & Annotation Suite with Notes Panel
- **Right-Side Notes & Reviews Panel**: Hidable sidebar listing all document notes, review comments, highlights, underlines, and strikethroughs with real-time text search and click-to-navigate.
- **Review Comments on Markups**: Add and edit review comments on underlines, strikethroughs, and highlights with visual badge pins on the canvas.
- **Full Line Width Storage & Display (1pt - 12pt)**:
  - Select from preset line thicknesses (`1pt`, `2pt`, `4pt`, `6pt`, `8pt`, `12pt`) with visual thickness indicators in the Toolbar.
  - **ISO 32000-1 Appearance Streams (`/AP /N`)**: Exported PDFs contain compiled vector Appearance Streams and Border specifications (`/BS << /W width >>`), ensuring line widths and colors are rendered in **every PDF viewer**.
  - **Smart Loading**: Automatically parses line widths from existing PDF annotations.
- **PDF Annotation Extraction**: Automatically imports and renders pre-existing comments, shapes, lines, and annotations from loaded PDF documents.
- **Text Box & Typography**: Freehand text insertion with live font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and immediate color changes.
- **High-Resolution Image Cropper**: Select any rectangular region on any page to crop and copy high-resolution image data directly to your system clipboard.

### 6. 📑 Signature & Stamp Library with JSON Portability
- **3 Signature Modes**: Draw (canvas signature pad), Type (handwriting cursive fonts), and Upload (with automated white-background transparency cleaning).
- **Named Stamp Library**: Save reusable stamps stored in browser `localStorage`.
- **JSON Export & Import**: Download and restore full stamp collections as JSON packages containing Base64-encoded bitmap images.

### 7. 📋 Document Metadata Inspection & Editing
- **Inspect & Edit Properties**: Direct view and real-time editing of standard PDF document metadata (Title, Author, Subject, Keywords, Creator, Producer).
- **Technical File Inspection**: Displays source file size, total page count, creation date, last modification timestamp, and PDF format version.
- **Persistent Export**: All edited metadata is written directly to the exported PDF document trailer info dictionary upon saving.

### 8. ⚙️ Configurable Rasterization & Export Settings
- **Customizable Fallback Parameters**: Full control over fallback rasterization settings (Scale: 1.0×, 1.5×, 2.0×, 3.0×; Format: JPEG with DCTDecode or PNG; JPEG Quality: 75% - 100%).
- **State Persistence**: Saved in browser `localStorage` and indicated dynamically in the StatusBar.

### 9. 🎨 Switchable Themes (URL-Encoded)
- **Studio (Dark)**: Sleek glassmorphic dark design with ambient shadows (`?theme=default`).
- **Minimal (Light)**: Pure white background (`#ffffff`), crisp black lines, zero blue tints, high-contrast monochrome UI (`?theme=minimal`).
- **LCARS (Star Trek: TNG)**: Authentic 24th-century Federation Starfleet interface with iconic LCARS amber, lilac, cyan palette, pill buttons, and condensed typography (`?theme=lcars`).

### 10. ⚡ Flicker-Free 100-Step Undo & Redo
- Deep-cloned, immutable history stack with 100 snapshots tracking annotations, page order, and source document byte buffers.
- `PageCanvas` uses memoized rendering to keep the underlying PDF canvas intact without screen blinking on annotation updates.

### 11. 🔍 Smart Zoom & Viewport Synchronization
- **Dynamic Zoom to Selected Page** (<kbd>Ctrl + 0</kbd>): Calculates exact aspect-ratio scale for the current page to fit the viewport.
- **Fit Width** & **Fit Page**: Adaptive scaling to screen width or full height.

### 12. 📜 Event Log & Diagnostic Protocol Screen
- **Real-Time Operation Tracking**: Captures all loading, saving, rendering, editing, and parsing events with precise timestamps and severity levels (`INFO`, `WARN`, `ERROR`, `SUCCESS`).
- **Buffer Sanitization & Parse Diagnostics**: Automatically strips pre-header/post-EOF noise, captures 7 parse attempts with stack traces, and logs catalog repair actions.
- **Diagnostics Inspection Modal**: Dedicated diagnostic screen with level filtering, live search, JSON/stack trace expandable inspection, and one-click clipboard copying.

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
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | Undo (Zpět) |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo (Znovu) |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selected annotation or trigger page deletion |
| <kbd>Enter</kbd> | Confirm modals & dialogs / Save note |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> | Insert newline in note editor |
| <kbd>Escape</kbd> | Cancel & close modal dialogs |
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
| **Framework & Build** | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) | Fast development and type safety |
| **PDF Rendering** | [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) | Fast in-browser canvas rendering of PDF pages |
| **PDF Manipulation & Export** | [`pdf-lib`](https://pdf-lib.js.org/) | Native vector page preservation, PageTree repair, burning annotations & stamps |
| **Signature Pad** | [`signature_pad`](https://github.com/szimek/signature_pad) | Smooth vector signature capture |
| **Icons** | [`lucide-react`](https://lucide.dev/) | Modern UI icon library |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Responsive glassmorphic, minimal light, and LCARS themes |
| **Unit Testing** | [Vitest](https://vitest.dev/) | Comprehensive unit & integration testing suite |

---

## 🧪 Automated Testing

PDF Studio includes a full automated test suite covering page management, keyboard shortcuts, history stack, color extraction, image cropping, and PDF export:

```bash
# Run all unit tests
npm run test
```

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18+ recommended)
- `npm` or `yarn` / `pnpm`

### Installation & Development

```bash
# Clone repository
git clone https://github.com/richardLipka/pdf-studio.git
cd pdf-studio

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
# Build optimized static bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 👤 Author & Acknowledgments

- **Author**: [Richard Lipka](https://home.zcu.cz/~lipka/) ([lipka@fav.zcu.cz](mailto:lipka@fav.zcu.cz))
- **Institution**: [Faculty of Applied Sciences (FAV), University of West Bohemia](https://www.fav.zcu.cz/cs/)

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

