import { Point } from '../types/annotations';

/**
 * Geometry of underline / strikethrough markups.
 *
 * A markup is stored as a thin box (top-left origin, displayed page space) plus `textRotation`: the
 * clockwise rotation of the marked text on the displayed page (0 = normal horizontal text, 90 = text
 * running top to bottom after the page was turned clockwise, ...). The line is drawn along the text's
 * bottom edge (underline) or through its middle (strikethrough).
 */

export interface MarkupBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MarkupKind = 'underline' | 'strikethrough';

export const normalizeTextRotation = (rotation: number | undefined): number =>
  ((Math.round((rotation || 0) / 90) * 90) % 360 + 360) % 360;

/** Box corners named in the reading direction of the marked text */
export const getTextQuad = (box: MarkupBox, textRotation?: number) => {
  const tl = { x: box.x, y: box.y };
  const tr = { x: box.x + box.width, y: box.y };
  const bl = { x: box.x, y: box.y + box.height };
  const br = { x: box.x + box.width, y: box.y + box.height };
  switch (normalizeTextRotation(textRotation)) {
    case 90:
      return { topLeft: tr, topRight: br, bottomLeft: tl, bottomRight: bl };
    case 180:
      return { topLeft: br, topRight: bl, bottomLeft: tr, bottomRight: tl };
    case 270:
      return { topLeft: bl, topRight: tl, bottomLeft: br, bottomRight: tr };
    default:
      return { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br };
  }
};

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Start and end of the drawn line, in reading direction */
export const getMarkupLine = (kind: MarkupKind, box: MarkupBox, textRotation?: number): [Point, Point] => {
  const q = getTextQuad(box, textRotation);
  if (kind === 'underline') return [q.bottomLeft, q.bottomRight];
  return [midpoint(q.topLeft, q.bottomLeft), midpoint(q.topRight, q.bottomRight)];
};

/**
 * Inverse of getMarkupLine: the stored box whose markup line is `start`-`end`, given the line
 * thickness (the box's extent across the line).
 */
export const markupBoxFromLine = (
  kind: MarkupKind,
  start: Point,
  end: Point,
  thickness: number,
  textRotation?: number
): MarkupBox => {
  const rotation = normalizeTextRotation(textRotation);
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const length = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const vertical = rotation === 90 || rotation === 270;

  // Offset of the line from the box's leading edge across the line direction
  let across: number;
  if (kind === 'strikethrough') {
    across = thickness / 2;
  } else if (rotation === 0 || rotation === 270) {
    across = thickness; // bottom edge (0°) or right edge (270°)
  } else {
    across = 0; // left edge (90°) or top edge (180°)
  }

  return vertical
    ? { x: minX - across, y: minY, width: thickness, height: length }
    : { x: minX, y: minY - across, width: length, height: thickness };
};

/**
 * Reading-direction rotation of text from two points along its baseline direction, in displayed
 * page space with a top-left origin.
 */
export const textRotationFromDirection = (from: Point, to: Point): number => {
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return normalizeTextRotation(angle);
};

/**
 * Markup line and text rotation for one PDF QuadPoints quadrilateral mapped to displayed page space.
 * The first two points run along the text direction in both corner orders seen in the wild
 * (Acrobat's top-left, top-right, bottom-left, bottom-right and the specification's counter-clockwise
 * order), so the top and bottom edges are told apart geometrically rather than by position.
 */
export const markupLineFromQuad = (
  kind: MarkupKind,
  quad: Point[]
): { start: Point; end: Point; textRotation: number } => {
  const textRotation = textRotationFromDirection(quad[0], quad[1]);
  const rad = (textRotation * Math.PI) / 180;
  const along = { x: Math.round(Math.cos(rad)), y: Math.round(Math.sin(rad)) };
  const down = { x: -along.y, y: along.x };
  const dot = (p: Point, v: Point) => p.x * v.x + p.y * v.y;
  const byDown = [...quad].sort((a, b) => dot(a, down) - dot(b, down));
  const [top, bottom] = [byDown.slice(0, 2), byDown.slice(2)].map((edge) =>
    edge.sort((a, b) => dot(a, along) - dot(b, along))
  );
  if (kind === 'underline') {
    return { start: bottom[0], end: bottom[1], textRotation };
  }
  return { start: midpoint(top[0], bottom[0]), end: midpoint(top[1], bottom[1]), textRotation };
};
