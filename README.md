# PDF Studio (Web PDF Editor) 📄✨

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20In--Browser-brightgreen.svg)](#-privacy--security)
[![Languages: CS & EN](https://img.shields.io/badge/i18n-Čeština%20%7C%20English-purple.svg)](#-bilingual-support)

A modern, fast, and privacy-first web application for editing, annotating, signing, and managing PDF documents directly in your browser with **zero server uploads** and **zero database requirements**.

---

## 🚀 Key Features

### 1. 🗂️ Advanced Page Management & Multi-Selection
- **Multi-Page Selection**:
  - `Click`: Focus and select page.
  - `Ctrl + Click` / `Cmd + Click`: Toggle individual pages into/out of selection.
  - `Shift + Click`: Select continuous range between pages.
  - `Shift + PageDown` / `Shift + PageUp`: Select all pages to document end or beginning.
  - `ArrowDown` / `ArrowUp` (with or without `Shift`): Navigate or multi-select pages with keyboard.
  - `Ctrl + A`: Select all pages.
- **Batch Operations**:
  - Delete selected pages in batch with confirmation.
  - Rotate selected pages (90° clockwise / counter-clockwise).
  - Drag-and-drop thumbnail reordering.
- **Add New Pages**:
  - Merge pages from other PDF files via drag-and-drop.
  - Insert image files (PNG, JPG, WebP) as full pages.
  - Insert blank A4 sheets in Portrait or Landscape orientation.
  - Configurable insertion targets (*At beginning*, *After current page*, *At end*).

### 2. ✍️ Review & Annotation Suite with Notes Panel
- **Right-Side Notes & Reviews Panel**: Hidable sidebar listing all document notes, review comments, highlights, underlines, and strikethroughs with real-time text search and click-to-navigate.
- **Review Comments on Markups**: Add and edit review comments on underlines, strikethroughs, and highlights with visual badge pins on the canvas.
- **PDF Annotation Extraction**: Automatically imports and renders pre-existing comments and annotations from loaded PDF documents.
- **Text Box & Typography**: Freehand text insertion with live font family selection (Inter, Caveat, Dancing Script, Courier, Times New Roman, Georgia, Arial), custom font sizes, and immediate color changes.
- **Highlight, Underline & Strikethrough**: Live drawing feedback with instant color palette selection.
- **Sticky Notes**: Clickable review pins with expanding notes and author timestamps.
- **Freehand Pen**: Smooth vector drawing tool with configurable stroke width and color palette.
- **Eraser**: One-click removal of individual annotations.

### 3. 📑 Signature & Stamp Library with JSON Portability
- **3 Signature Modes**:
  - **Draw**: Canvas signature pad with touch, stylus, and mouse smoothing.
  - **Type**: Generate script signatures with elegant cursive handwriting fonts.
  - **Upload**: Upload signature image with automatic white-background transparency cleaning.
- **Named Stamp Library**:
  - Save reusable stamps (e.g., *"Schváleno / Approved"*, *"Zaplaceno / Paid"*, *"Podpis Novák"*).
  - Stored in browser `localStorage`.
- **JSON Export & Import**:
  - **Export JSON**: Download your entire stamp library into a portable JSON package with Base64-encoded bitmap images.
  - **Import JSON**: Upload and restore stamps on any device or browser with schema validation.

### 4. ⚡ Flicker-Free 100-Step Undo & Redo
- Deep-cloned, immutable history stack with 100 snapshots.
- `PageCanvas` uses memoized rendering to keep the underlying PDF canvas intact without screen blinking on annotation updates.
- Atomic history snapshots captured on mouse release (`onMouseUp`) for smooth dragging/resizing.

### 5. 🔍 Smart Zoom & Viewport Synchronization
- **Dynamic Zoom to Selected Page** (<kbd>Ctrl + 0</kbd>): Calculates exact aspect-ratio scale for the current page to fit the viewport.
- **Fit Width** & **Fit Page**: Adaptive scaling to screen width or full height.
- **Auto-Scrolling**: Selecting any page in the sidebar or via arrow keys immediately scrolls the main viewport and thumbnail bar to center on that page.

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
| <kbd>↓</kbd> / <kbd>→</kbd> | Next page (scrolling viewport) |
| <kbd>↑</kbd> / <kbd>←</kbd> | Previous page (scrolling viewport) |
| <kbd>Shift</kbd> + <kbd>↓</kbd> / <kbd>→</kbd> | Expand page selection downwards |
| <kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>←</kbd> | Expand page selection upwards |
| <kbd>Shift</kbd> + <kbd>PageDown</kbd> | Select from active page to end of document |
| <kbd>Shift</kbd> + <kbd>PageUp</kbd> | Select from active page to start of document |
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
| **PDF Manipulation & Export** | [`pdf-lib`](https://pdf-lib.js.org/) | Vector PDF generation, burning annotations & stamps into final PDF |
| **Signature Pad** | [`signature_pad`](https://github.com/szimek/signature_pad) | Smooth vector signature capture |
| **Icons** | [`lucide-react`](https://lucide.dev/) | Modern UI icon library |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Modern dark glassmorphic interface |

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18+ recommended)
- `npm` or `yarn` / `pnpm`

### Installation & Development

```bash
# Clone repository
git clone https://github.com/yourusername/pdf-studio.git
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

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
