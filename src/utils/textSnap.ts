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
