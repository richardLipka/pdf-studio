import { PdfPageModel } from '../types/document';
import { Annotation, Point } from '../types/annotations';

export type InsertPosition = 'beginning' | 'after_current' | 'end';

const normalizeQuarterTurn = (angle: number): number => ((Math.round(angle / 90) * 90) % 360 + 360) % 360;

// width/height always describe the page as displayed (after rotation), so a quarter turn swaps them.
export const rotatePage = (page: PdfPageModel, deltaAngle: number): PdfPageModel => {
  const newRotation = ((page.rotation + deltaAngle) % 360 + 360) % 360;
  const swapsAxes = normalizeQuarterTurn(deltaAngle) % 180 !== 0;
  return {
    ...page,
    rotation: newRotation,
    width: swapsAxes ? page.height : page.width,
    height: swapsAxes ? page.width : page.height,
  };
};

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Maps a point of a page (displayed dimensions pageWidth x pageHeight, top-left origin) to where
 * the same content point is displayed after rotating the page clockwise by deltaAngle.
 */
export const rotatePointWithPage = (p: Point, pageWidth: number, pageHeight: number, deltaAngle: number): Point => {
  const turn = normalizeQuarterTurn(deltaAngle);
  if (turn === 90) return { x: pageHeight - p.y, y: p.x };
  if (turn === 180) return { x: pageWidth - p.x, y: pageHeight - p.y };
  if (turn === 270) return { x: p.y, y: pageWidth - p.x };
  return p;
};

export const rotateBoxWithPage = (box: Box, pageWidth: number, pageHeight: number, deltaAngle: number): Box => {
  const a = rotatePointWithPage({ x: box.x, y: box.y }, pageWidth, pageHeight, deltaAngle);
  const b = rotatePointWithPage({ x: box.x + box.width, y: box.y + box.height }, pageWidth, pageHeight, deltaAngle);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
};

/**
 * Moves an annotation together with the page content when the page is rotated clockwise by
 * deltaAngle. pageWidth/pageHeight are the displayed page dimensions before the rotation.
 */
export const rotateAnnotationWithPage = (
  ann: Annotation,
  pageWidth: number,
  pageHeight: number,
  deltaAngle: number
): Annotation => {
  const turn = normalizeQuarterTurn(deltaAngle);
  if (turn === 0) return ann;

  const mapPoint = (p: Point): Point => rotatePointWithPage(p, pageWidth, pageHeight, turn);
  const mapBox = (x: number, y: number, width: number, height: number) =>
    rotateBoxWithPage({ x, y, width, height }, pageWidth, pageHeight, turn);

  // Keeps the element's size and upright orientation, only moves its centre with the content
  const mapCenter = (): Pick<Annotation, 'x' | 'y'> => {
    const c = mapPoint({ x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 });
    return { x: c.x - ann.width / 2, y: c.y - ann.height / 2 };
  };

  switch (ann.type) {
    case 'drawing': {
      const points = ann.points.map(mapPoint);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        ...ann,
        points,
        x: minX,
        y: minY,
        width: Math.max(10, Math.max(...xs) - minX),
        height: Math.max(10, Math.max(...ys) - minY),
      };
    }
    case 'shape': {
      if (ann.shapeType === 'line') {
        const start = mapPoint({ x: ann.x, y: ann.y });
        const end = mapPoint(ann.endPoint || { x: ann.x + ann.width, y: ann.y + ann.height });
        return { ...ann, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y, endPoint: end };
      }
      return { ...ann, ...mapBox(ann.x, ann.y, ann.width, ann.height) };
    }
    case 'highlight': {
      return {
        ...ann,
        ...mapBox(ann.x, ann.y, ann.width, ann.height),
        rects: ann.rects?.map((r) => mapBox(r.x, r.y, r.width, r.height)),
      };
    }
    case 'whiteout':
      return { ...ann, ...mapBox(ann.x, ann.y, ann.width, ann.height) };
    case 'underline':
    case 'strikethrough':
      // The marked text turns with the page, so the line switches to the matching edge of the box
      return {
        ...ann,
        ...mapBox(ann.x, ann.y, ann.width, ann.height),
        textRotation: ((ann.textRotation || 0) + turn) % 360,
      };
    default:
      return { ...ann, ...mapCenter() };
  }
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
