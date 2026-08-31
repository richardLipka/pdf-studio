import { Point } from '../types/annotations';

/**
 * Convert mouse coordinates on canvas to PDF points (unscaled coordinate system)
 */
export const screenToPdfPoint = (
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  scale: number,
  rotation: number = 0,
  pdfWidth: number = 595,
  pdfHeight: number = 842
): Point => {
  const pixelX = clientX - canvasRect.left;
  const pixelY = clientY - canvasRect.top;

  // Unscale from zoom factor
  const unscaledX = pixelX / scale;
  const unscaledY = pixelY / scale;

  // Adjust for page rotation if necessary
  switch (rotation % 360) {
    case 90:
      return {
        x: unscaledY,
        y: pdfHeight - unscaledX,
      };
    case 180:
      return {
        x: pdfWidth - unscaledX,
        y: pdfHeight - unscaledY,
      };
    case 270:
      return {
        x: pdfWidth - unscaledY,
        y: unscaledX,
      };
    default:
      return {
        x: unscaledX,
        y: unscaledY,
      };
  }
};

/**
 * Convert PDF point back to screen/canvas pixel coordinates for rendering overlays
 */
export const pdfToScreenPoint = (
  pdfX: number,
  pdfY: number,
  scale: number
): Point => {
  return {
    x: pdfX * scale,
    y: pdfY * scale,
  };
};

/**
 * Format bytes to human readable KB/MB
 */
export const formatBytes = (bytes: number, decimals: number = 1): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};
