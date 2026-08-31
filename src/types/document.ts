export interface PageDimensions {
  width: number;
  height: number;
  rotation: number; // 0, 90, 180, 270
}

export interface PdfPageModel {
  id: string;             // unique id for tracking across reorders
  originalPageIndex: number; // 0-based index in original source or created page
  sourceDocId: string;    // 'main' or uuid of merged file / image
  sourceType: 'pdf' | 'image' | 'blank';
  imageDataUrl?: string;  // if source is image or blank
  rotation: number;       // page rotation in degrees (0, 90, 180, 270)
  width: number;          // unscaled point width (e.g. 595.28 for A4)
  height: number;         // unscaled point height (e.g. 841.89 for A4)
}

export interface DocumentState {
  fileName: string;
  fileSize: number;
  totalPages: number;
  pages: PdfPageModel[];
  activePageIndex: number;
  pdfArrayBuffer: ArrayBuffer | null;
  modifiedSinceSave: boolean;
}

export interface SourceDocument {
  id: string;
  name: string;
  arrayBuffer: ArrayBuffer;
}
