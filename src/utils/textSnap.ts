export interface TextLineBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  text?: string;
}

export interface DragBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Finds all text lines from the DOM textLayer that intersect with a drawn box in PDF coordinates.
 * Returns array of line bounds in PDF coordinates, or empty array if no text intersects.
 */
export function findIntersectedTextLines(
  pageContainer: HTMLElement | null,
  dragBox: DragBox,
  scale: number
): TextLineBounds[] {
  if (!pageContainer || scale <= 0) return [];

  // Find the textLayer element inside or next to pageContainer
  const textLayer = pageContainer.classList.contains('textLayer')
    ? pageContainer
    : pageContainer.querySelector('.textLayer');

  if (!textLayer) return [];

  const textSpans = Array.from(textLayer.querySelectorAll('span'));
  if (textSpans.length === 0) return [];

  const pageRect = pageContainer.getBoundingClientRect();
  const boxX1 = dragBox.x;
  const boxY1 = dragBox.y;
  const boxX2 = dragBox.x + dragBox.width;
  const boxY2 = dragBox.y + dragBox.height;

  interface SpanItem {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    centerY: number;
  }

  const intersectedSpans: SpanItem[] = [];

  for (const span of textSpans) {
    const spanRect = span.getBoundingClientRect();
    if (spanRect.width <= 1 || spanRect.height <= 1) continue;

    // Convert span coordinates to PDF point coordinates
    const spanX = (spanRect.left - pageRect.left) / scale;
    const spanY = (spanRect.top - pageRect.top) / scale;
    const spanW = spanRect.width / scale;
    const spanH = spanRect.height / scale;

    const spanX2 = spanX + spanW;
    const spanY2 = spanY + spanH;

    // Check overlap with drag box
    const overlapX = Math.max(0, Math.min(boxX2, spanX2) - Math.max(boxX1, spanX));
    const overlapY = Math.max(0, Math.min(boxY2, spanY2) - Math.max(boxY1, spanY));

    // Must have meaningful overlap (at least 3pt horizontally and vertically, or 30% overlap)
    if (overlapX >= 3 && overlapY >= 3) {
      intersectedSpans.push({
        x: spanX,
        y: spanY,
        w: spanW,
        h: spanH,
        text: span.textContent || '',
        centerY: spanY + spanH / 2,
      });
    }
  }

  if (intersectedSpans.length === 0) {
    return [];
  }

  // Sort spans top-to-bottom, then left-to-right
  intersectedSpans.sort((a, b) => {
    if (Math.abs(a.centerY - b.centerY) > 4) {
      return a.centerY - b.centerY;
    }
    return a.x - b.x;
  });

  // Group spans that belong to the same visual line (vertical centers within 5pt)
  const lineGroups: SpanItem[][] = [];
  for (const span of intersectedSpans) {
    let matchedGroup = lineGroups.find((group) => {
      const groupAvgCenterY =
        group.reduce((acc, s) => acc + s.centerY, 0) / group.length;
      const groupAvgHeight =
        group.reduce((acc, s) => acc + s.h, 0) / group.length;
      return Math.abs(span.centerY - groupAvgCenterY) < Math.max(5, groupAvgHeight * 0.4);
    });

    if (matchedGroup) {
      matchedGroup.push(span);
    } else {
      lineGroups.push([span]);
    }
  }

  // Convert each line group to a clamped line bounding box
  const lines: TextLineBounds[] = lineGroups.map((group) => {
    const rawMinX = Math.min(...group.map((s) => s.x));
    const rawMaxX = Math.max(...group.map((s) => s.x + s.w));
    const rawMinY = Math.min(...group.map((s) => s.y));
    const rawMaxY = Math.max(...group.map((s) => s.y + s.h));

    // Clamp horizontal span to the user's dragged region
    const clampedX = Math.max(boxX1, rawMinX);
    const clampedMaxX = Math.min(boxX2, rawMaxX);
    const clampedWidth = Math.max(6, clampedMaxX - clampedX);

    return {
      x: clampedX,
      y: rawMinY,
      width: clampedWidth,
      height: rawMaxY - rawMinY,
      top: rawMinY,
      bottom: rawMaxY,
      text: group.map((s) => s.text).join(''),
    };
  });

  return lines;
}

export interface VisualTextBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  type?: 'text' | 'image';
  segmentIds?: string[];
  imageName?: string;
  pixelWidth?: number;
  pixelHeight?: number;
}

/**
 * Extracts all visual text lines/blocks from a rendered page's textLayer with exact bounding boxes in PDF points.
 */
export function extractPageTextBlocks(
  pageContainer: HTMLElement | null,
  scale: number
): VisualTextBlock[] {
  if (!pageContainer || scale <= 0) return [];

  const textLayer = pageContainer.classList.contains('textLayer')
    ? pageContainer
    : pageContainer.querySelector('.textLayer');

  if (!textLayer) return [];

  const textSpans = Array.from(textLayer.querySelectorAll('span'));
  if (textSpans.length === 0) return [];

  const containerRect = pageContainer.getBoundingClientRect();
  interface SpanEntry {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    centerY: number;
  }

  const spanItems: SpanEntry[] = [];

  for (const span of textSpans) {
    const r = span.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const text = (span.textContent || '').trim();
    if (!text) continue;

    const x = (r.left - containerRect.left) / scale;
    const y = (r.top - containerRect.top) / scale;
    const w = r.width / scale;
    const h = r.height / scale;

    spanItems.push({
      x,
      y,
      w,
      h,
      text,
      centerY: y + h / 2,
    });
  }

  if (spanItems.length === 0) return [];

  // Sort top-to-bottom, left-to-right
  spanItems.sort((a, b) => {
    if (Math.abs(a.centerY - b.centerY) > 4) {
      return a.centerY - b.centerY;
    }
    return a.x - b.x;
  });

  // Group into visual lines (centers within 5pt or 40% height)
  const lineGroups: SpanEntry[][] = [];
  for (const span of spanItems) {
    let matchedGroup = lineGroups.find((group) => {
      const avgCenterY = group.reduce((sum, s) => sum + s.centerY, 0) / group.length;
      const avgH = group.reduce((sum, s) => sum + s.h, 0) / group.length;
      return Math.abs(span.centerY - avgCenterY) < Math.max(5, avgH * 0.4);
    });

    if (matchedGroup) {
      matchedGroup.push(span);
    } else {
      lineGroups.push([span]);
    }
  }

  return lineGroups.map((group, idx) => {
    group.sort((a, b) => a.x - b.x);
    const minX = Math.min(...group.map((s) => s.x));
    const maxX = Math.max(...group.map((s) => s.x + s.w));
    const minY = Math.min(...group.map((s) => s.y));
    const maxY = Math.max(...group.map((s) => s.y + s.h));
    const text = group.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

    return {
      id: `block_vis_${idx + 1}`,
      x: Math.max(0, minX - 2),
      y: Math.max(0, minY - 1),
      width: Math.max(10, maxX - minX + 4),
      height: Math.max(8, maxY - minY + 2),
      text,
    };
  });
}

