import { PdfPageModel } from '../types/document';

export type InsertPosition = 'beginning' | 'after_current' | 'end';

export const rotatePage = (page: PdfPageModel, deltaAngle: number): PdfPageModel => {
  const newRotation = ((page.rotation + deltaAngle) % 360 + 360) % 360;
  return {
    ...page,
    rotation: newRotation,
  };
};

export const reorderPages = (
  pages: PdfPageModel[],
  fromIndex: number,
  toIndex: number
): PdfPageModel[] => {
  const updated = [...pages];
  const [removed] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, removed);
  return updated;
};

export const deletePage = (
  pages: PdfPageModel[],
  pageId: string
): { updatedPages: PdfPageModel[]; nextActiveIndex: number } => {
  const pageIndex = pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return { updatedPages: pages, nextActiveIndex: 0 };

  const updatedPages = pages.filter((p) => p.id !== pageId);
  const nextActiveIndex = Math.max(0, Math.min(pageIndex, updatedPages.length - 1));
  return { updatedPages, nextActiveIndex };
};

export const duplicatePage = (
  pages: PdfPageModel[],
  pageId: string
): PdfPageModel[] => {
  const pageIndex = pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return pages;

  const target = pages[pageIndex];
  const cloned: PdfPageModel = {
    ...target,
    id: `${target.sourceDocId}_page_copy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
  };

  const updated = [...pages];
  updated.splice(pageIndex + 1, 0, cloned);
  return updated;
};

export const createBlankPage = (
  orientation: 'portrait' | 'landscape' = 'portrait'
): PdfPageModel => {
  const isPortrait = orientation === 'portrait';
  const width = isPortrait ? 595.28 : 841.89;
  const height = isPortrait ? 841.89 : 595.28;

  return {
    id: `blank_page_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    originalPageIndex: 0,
    sourceDocId: 'blank',
    sourceType: 'blank',
    rotation: 0,
    width,
    height,
  };
};

export const createImagePage = (
  imageDataUrl: string,
  imgWidth: number,
  imgHeight: number,
  imageBytes?: Uint8Array,
  imageMimeType?: string
): PdfPageModel => {
  // Normalize size to standard A4 ratio if huge, or fit nicely
  let width = imgWidth;
  let height = imgHeight;

  // Max dimension 842pt (A4) for crispness without exploding size
  const maxDim = 842;
  if (width > maxDim || height > maxDim) {
    const ratio = width / height;
    if (width > height) {
      width = maxDim;
      height = maxDim / ratio;
    } else {
      height = maxDim;
      width = maxDim * ratio;
    }
  }

  return {
    id: `img_page_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    originalPageIndex: 0,
    sourceDocId: `img_${Date.now()}`,
    sourceType: 'image',
    imageDataUrl,
    imageBytes,
    imageMimeType,
    rotation: 0,
    width,
    height,
  };
};

export const insertPagesAtPosition = (
  currentPages: PdfPageModel[],
  newPages: PdfPageModel[],
  position: InsertPosition,
  activePageIndex: number
): { pages: PdfPageModel[]; newActiveIndex: number } => {
  const result = [...currentPages];
  let targetIndex = 0;

  switch (position) {
    case 'beginning':
      targetIndex = 0;
      result.unshift(...newPages);
      break;
    case 'after_current':
      targetIndex = Math.min(activePageIndex + 1, result.length);
      result.splice(targetIndex, 0, ...newPages);
      break;
    case 'end':
    default:
      targetIndex = result.length;
      result.push(...newPages);
      break;
  }

  return { pages: result, newActiveIndex: targetIndex };
};
