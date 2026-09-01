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
  imageDataUrl?: string;  // for viewport preview
  imageBytes?: Uint8Array; // original binary image bytes to preserve original compression
  imageMimeType?: string;  // original mime type e.g. 'image/jpeg', 'image/png'
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

export interface RasterizationSettings {
  scale: number; // e.g. 1.0, 1.5, 2.0, 3.0 (default 2.0)
  format: 'image/jpeg' | 'image/png'; // default 'image/jpeg'
  jpegQuality: number; // 0.50 to 1.00 (default 0.90)
}

export const DEFAULT_RASTERIZATION_SETTINGS: RasterizationSettings = {
  scale: 2.0,
  format: 'image/jpeg',
  jpegQuality: 0.90,
};
