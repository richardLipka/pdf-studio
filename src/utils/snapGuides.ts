/**
 * Smart alignment & snapping guide geometry for canvas drag-to-move and resize interactions.
 * All coordinates are in unscaled display page points (top-left origin).
 */

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  /** Coordinate along `axis` (X for vertical line, Y for horizontal line) */
  position: number;
  /** Visual span start along the perpendicular axis */
  start: number;
  /** Visual span end along the perpendicular axis */
  end: number;
  kind: 'page-center' | 'page-margin' | 'sibling';
}

export interface SnapResult {
  rect: Rect2D;
  guides: SnapGuide[];
}

interface CandidateLine {
  position: number;
  spanStart: number;
  spanEnd: number;
  kind: SnapGuide['kind'];
}

const STANDARD_MARGINS = [36, 72];

function collectCandidates(
  pageW: number,
  pageH: number,
  siblings: Rect2D[]
): { xCandidates: CandidateLine[]; yCandidates: CandidateLine[] } {
  const xCandidates: CandidateLine[] = [
    { position: pageW / 2, spanStart: 0, spanEnd: pageH, kind: 'page-center' },
  ];
  const yCandidates: CandidateLine[] = [
    { position: pageH / 2, spanStart: 0, spanEnd: pageW, kind: 'page-center' },
  ];

  for (const m of STANDARD_MARGINS) {
    if (m < pageW / 2 - 10) {
      xCandidates.push({ position: m, spanStart: 0, spanEnd: pageH, kind: 'page-margin' });
      xCandidates.push({ position: pageW - m, spanStart: 0, spanEnd: pageH, kind: 'page-margin' });
    }
    if (m < pageH / 2 - 10) {
      yCandidates.push({ position: m, spanStart: 0, spanEnd: pageW, kind: 'page-margin' });
      yCandidates.push({ position: pageH - m, spanStart: 0, spanEnd: pageW, kind: 'page-margin' });
    }
  }

  for (const s of siblings) {
    if (s.width <= 0 || s.height <= 0) continue;
    const sRight = s.x + s.width;
    const sBottom = s.y + s.height;
    const sCx = s.x + s.width / 2;
    const sCy = s.y + s.height / 2;
    xCandidates.push(
      { position: s.x, spanStart: s.y, spanEnd: sBottom, kind: 'sibling' },
      { position: sCx, spanStart: s.y, spanEnd: sBottom, kind: 'sibling' },
      { position: sRight, spanStart: s.y, spanEnd: sBottom, kind: 'sibling' }
    );
    yCandidates.push(
      { position: s.y, spanStart: s.x, spanEnd: sRight, kind: 'sibling' },
      { position: sCy, spanStart: s.x, spanEnd: sRight, kind: 'sibling' },
      { position: sBottom, spanStart: s.x, spanEnd: sRight, kind: 'sibling' }
    );
  }

  return { xCandidates, yCandidates };
}

/**
 * Snaps a moving rectangle to page centerlines, standard margins, and sibling element edges/centers.
 */
export function computeSnapMove(
  rect: Rect2D,
  pageW: number,
  pageH: number,
  siblings: Rect2D[],
  threshold = 5
): SnapResult {
  const { xCandidates, yCandidates } = collectCandidates(pageW, pageH, siblings);
  const guides: SnapGuide[] = [];
  let snappedX = rect.x;
  let snappedY = rect.y;

  // X axis: test left, centerX, right edges of moving box
  const boxXAnchors = [
    { offset: 0, value: rect.x },
    { offset: rect.width / 2, value: rect.x + rect.width / 2 },
    { offset: rect.width, value: rect.x + rect.width },
  ];
  let bestXDist = threshold + 0.001;
  let bestXCand: CandidateLine | null = null;
  let bestXOffset = 0;

  for (const anchor of boxXAnchors) {
    for (const cand of xCandidates) {
      const dist = Math.abs(anchor.value - cand.position);
      if (dist < bestXDist) {
        bestXDist = dist;
        bestXCand = cand;
        bestXOffset = anchor.offset;
      }
    }
  }
  if (bestXCand) {
    snappedX = bestXCand.position - bestXOffset;
    guides.push({
      axis: 'x',
      position: bestXCand.position,
      start: Math.min(bestXCand.spanStart, rect.y),
      end: Math.max(bestXCand.spanEnd, rect.y + rect.height),
      kind: bestXCand.kind,
    });
  }

  // Y axis: test top, centerY, bottom edges of moving box
  const boxYAnchors = [
    { offset: 0, value: rect.y },
    { offset: rect.height / 2, value: rect.y + rect.height / 2 },
    { offset: rect.height, value: rect.y + rect.height },
  ];
  let bestYDist = threshold + 0.001;
  let bestYCand: CandidateLine | null = null;
  let bestYOffset = 0;

  for (const anchor of boxYAnchors) {
    for (const cand of yCandidates) {
      const dist = Math.abs(anchor.value - cand.position);
      if (dist < bestYDist) {
        bestYDist = dist;
        bestYCand = cand;
        bestYOffset = anchor.offset;
      }
    }
  }
  if (bestYCand) {
    snappedY = bestYCand.position - bestYOffset;
    guides.push({
      axis: 'y',
      position: bestYCand.position,
      start: Math.min(bestYCand.spanStart, snappedX),
      end: Math.max(bestYCand.spanEnd, snappedX + rect.width),
      kind: bestYCand.kind,
    });
  }

  return {
    rect: { x: snappedX, y: snappedY, width: rect.width, height: rect.height },
    guides,
  };
}

/**
 * Snaps the actively dragged edges of a resized rectangle to page margins, centerlines, and siblings.
 */
export function computeSnapResize(
  rect: Rect2D,
  handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  pageW: number,
  pageH: number,
  siblings: Rect2D[],
  minW: number,
  minH: number,
  threshold = 5
): SnapResult {
  const { xCandidates, yCandidates } = collectCandidates(pageW, pageH, siblings);
  const guides: SnapGuide[] = [];
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  const snapEdgeX = (edgeVal: number): CandidateLine | null => {
    let best: CandidateLine | null = null;
    let bestDist = threshold + 0.001;
    for (const cand of xCandidates) {
      const d = Math.abs(edgeVal - cand.position);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
    return best;
  };

  const snapEdgeY = (edgeVal: number): CandidateLine | null => {
    let best: CandidateLine | null = null;
    let bestDist = threshold + 0.001;
    for (const cand of yCandidates) {
      const d = Math.abs(edgeVal - cand.position);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
    return best;
  };

  if (handle.includes('w')) {
    const c = snapEdgeX(left);
    if (c && right - c.position >= minW) {
      left = c.position;
      guides.push({ axis: 'x', position: c.position, start: Math.min(c.spanStart, top), end: Math.max(c.spanEnd, bottom), kind: c.kind });
    }
  } else if (handle.includes('e')) {
    const c = snapEdgeX(right);
    if (c && c.position - left >= minW) {
      right = c.position;
      guides.push({ axis: 'x', position: c.position, start: Math.min(c.spanStart, top), end: Math.max(c.spanEnd, bottom), kind: c.kind });
    }
  }

  if (handle.includes('n')) {
    const c = snapEdgeY(top);
    if (c && bottom - c.position >= minH) {
      top = c.position;
      guides.push({ axis: 'y', position: c.position, start: Math.min(c.spanStart, left), end: Math.max(c.spanEnd, right), kind: c.kind });
    }
  } else if (handle.includes('s')) {
    const c = snapEdgeY(bottom);
    if (c && c.position - top >= minH) {
      bottom = c.position;
      guides.push({ axis: 'y', position: c.position, start: Math.min(c.spanStart, left), end: Math.max(c.spanEnd, right), kind: c.kind });
    }
  }

  return {
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    guides,
  };
}
