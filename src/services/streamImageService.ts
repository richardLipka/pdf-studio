import { tokenizeContentStream } from './pdfContentTokenizer';
import type { StreamPartLayout } from './contentStreamEditor';

/**
 * Low-level PDF content-stream image placement discovery and surgical removal helpers.
 * Extracted from contentStreamEditor.ts to keep stream walking modular and free of pdf-lib coupling.
 */

// Operators that put something on the page; a q ... Q group containing any of them besides the
// image being removed must stay (only the image invocation goes)
const PAINTING_OPERATORS = new Set([
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'BT', 'INLINE', 'Do', 'd0', 'd1',
]);

export type WalkMatrix = [number, number, number, number, number, number];

export interface WalkOperation {
  operator: string;
  operands: { type: string; raw: string }[];
  start: number;
  end: number;
  operatorStart: number;
}

/** Content stream operations with each inline image (BI ... ID data EI) merged into one INLINE op */
export function walkOperations(stream: string, from = 0, to = stream.length): WalkOperation[] {
  const ops = tokenizeContentStream(stream, from, to) as WalkOperation[];
  const merged: WalkOperation[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.operator === 'BI' && ops[i + 1]?.operator === 'ID') {
      const data = ops[i + 1];
      merged.push({
        operator: 'INLINE',
        operands: data.operands,
        start: op.start,
        end: data.end,
        operatorStart: op.operatorStart,
      });
      i++;
    } else {
      merged.push(op);
    }
  }
  return merged;
}

/** Resource name of a /Name operand, with #xx escapes decoded */
export const decodeNameOperand = (raw: string | undefined): string | null => {
  if (!raw || !raw.startsWith('/')) return null;
  return raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
};

export const multiplyWalkMatrix = (m1: WalkMatrix, m2: WalkMatrix): WalkMatrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/**
 * Removes the operations selected by `isTarget` from a content stream. When a target sits in a
 * q ... Q group that only sets it up (cm, gs, clipping...), the whole group goes; otherwise just
 * the operation, so nothing else drawn on the page is lost. `occurrence` counts invocations of the
 * same XObject name (Do) or inline images (INLINE) in stream order.
 */
function removeTargetOperations(
  stream: string,
  isTarget: (op: WalkOperation, name: string | null, occurrence: number) => boolean
): { stream: string; removed: number } {
  interface Frame {
    start: number;
    hasOther: boolean;
    targets: { start: number; end: number }[];
  }
  const root: Frame = { start: -1, hasOther: true, targets: [] };
  const stack: Frame[] = [root];
  const ranges: { start: number; end: number }[] = [];
  const doCounts = new Map<string, number>();
  let inlineCount = 0;
  let removed = 0;

  for (const op of walkOperations(stream)) {
    const top = stack[stack.length - 1];
    if (op.operator === 'q') {
      stack.push({ start: op.operatorStart, hasOther: false, targets: [] });
      continue;
    }
    if (op.operator === 'Q') {
      if (stack.length === 1) continue; // unbalanced Q
      const frame = stack.pop()!;
      const parent = stack[stack.length - 1];
      if (frame.targets.length > 0 && !frame.hasOther) {
        ranges.push({ start: frame.start, end: op.end });
      } else {
        ranges.push(...frame.targets);
        if (frame.hasOther) parent.hasOther = true;
      }
      removed += frame.targets.length;
      continue;
    }
    let name: string | null = null;
    let occurrence = -1;
    if (op.operator === 'Do') {
      name = decodeNameOperand(op.operands[0]?.raw);
      if (name !== null) {
        occurrence = doCounts.get(name) ?? 0;
        doCounts.set(name, occurrence + 1);
      }
    } else if (op.operator === 'INLINE') {
      occurrence = inlineCount++;
    }
    if ((op.operator === 'Do' || op.operator === 'INLINE') && isTarget(op, name, occurrence)) {
      top.targets.push({ start: op.start, end: op.end });
    } else if (PAINTING_OPERATORS.has(op.operator)) {
      top.hasOther = true;
    }
  }
  // Groups left open at the end of the stream, and the top level: remove the invocations only
  for (const frame of stack) {
    ranges.push(...frame.targets);
    removed += frame.targets.length;
  }

  ranges.sort((a, b) => b.start - a.start);
  let out = stream;
  for (const range of ranges) {
    out = out.substring(0, range.start) + out.substring(range.end);
  }
  return { stream: out, removed };
}

/**
 * Removes invocations of the named XObject (`/Name Do`): all of them, or only the given
 * occurrence (0-based, in stream order) when one placement of a repeated image is deleted.
 */
export function removeXObjectInvocations(
  stream: string,
  name: string,
  occurrence?: number
): { stream: string; removed: number } {
  const cleanName = name.replace(/^\//, '');
  return removeTargetOperations(
    stream,
    (op, opName, opOccurrence) =>
      op.operator === 'Do' && opName === cleanName && (occurrence === undefined || opOccurrence === occurrence)
  );
}

/** Removes one inline image (BI ... ID ... EI), counted in stream order */
export function removeInlineImage(stream: string, occurrence: number): { stream: string; removed: number } {
  return removeTargetOperations(stream, (op, _name, opOccurrence) => op.operator === 'INLINE' && opOccurrence === occurrence);
}

/** Number of `/Name Do` invocations in a content stream */
export function countXObjectInvocations(stream: string, name: string): number {
  const cleanName = name.replace(/^\//, '');
  return walkOperations(stream).filter((op) => op.operator === 'Do' && decodeNameOperand(op.operands[0]?.raw) === cleanName)
    .length;
}

/** One place where an image is painted on the page */
export interface ImagePlacement {
  /** `img:<name>:<occurrence>` for image XObjects, `inline:<occurrence>` for inline images */
  id: string;
  kind: 'xobject' | 'inline';
  /** Resource name (image XObjects) */
  name: string;
  /** Index among invocations of the same name / among inline images, in stream order */
  occurrence: number;
  partIndex: number;
  /** Range of the painting operation in the composed stream */
  start: number;
  end: number;
  /** Image space (unit square) -> page user space */
  matrix: WalkMatrix;
  /** [minX, minY, maxX, maxY] in page user space */
  bbox: [number, number, number, number];
  /** Inline image dictionary entries (W, H, BPC, CS, F...) */
  inlineParams?: Record<string, string>;
}

export type XObjectResolution =
  | { kind: 'image' }
  | { kind: 'form'; partIndex?: number; matrix: WalkMatrix }
  | null;

/**
 * Finds every painted image of a page in the composed stream (page contents followed by its Form
 * XObjects): image XObjects and inline images, with the transformation in effect, descending into
 * the page's forms where they are invoked. Each invocation gets its own id, so repeated images can
 * be listed, selected and deleted one by one.
 */
export function findImagePlacements(
  streamText: string,
  layout: StreamPartLayout[],
  resolveXObject: (partIndex: number, name: string) => XObjectResolution
): ImagePlacement[] {
  const opsByPart: WalkOperation[][] = layout.map((part) => walkOperations(streamText, part.start, part.end));

  // Occurrence numbers in stream text order, as the removal functions count them
  const occurrenceAt = new Map<number, number>();
  const doCounts = new Map<string, number>();
  let inlineCount = 0;
  opsByPart
    .flat()
    .sort((a, b) => a.start - b.start)
    .forEach((op) => {
      if (op.operator === 'Do') {
        const name = decodeNameOperand(op.operands[0]?.raw);
        if (name === null) return;
        const n = doCounts.get(name) ?? 0;
        doCounts.set(name, n + 1);
        occurrenceAt.set(op.start, n);
      } else if (op.operator === 'INLINE') {
        occurrenceAt.set(op.start, inlineCount++);
      }
    });

  const placements: ImagePlacement[] = [];
  const usedIds = new Map<string, number>();
  const pushPlacement = (placement: Omit<ImagePlacement, 'bbox'>) => {
    const m = placement.matrix;
    const xs = [m[4], m[0] + m[4], m[0] + m[2] + m[4], m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[1] + m[3] + m[5], m[3] + m[5]];
    // A form painted twice paints its images twice from the same operation
    const seen = usedIds.get(placement.id) ?? 0;
    usedIds.set(placement.id, seen + 1);
    placements.push({
      ...placement,
      id: seen === 0 ? placement.id : `${placement.id}@${seen}`,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  };

  const walk = (ops: WalkOperation[], partIndex: number, initial: WalkMatrix, depth: number) => {
    let ctm = initial;
    const stack: WalkMatrix[] = [];
    for (const op of ops) {
      if (op.operator === 'q') {
        stack.push(ctm);
      } else if (op.operator === 'Q') {
        if (stack.length > 0) ctm = stack.pop()!;
      } else if (op.operator === 'cm') {
        const nums = op.operands.map((o) => Number(o.raw));
        if (nums.length === 6 && nums.every((n) => Number.isFinite(n))) ctm = multiplyWalkMatrix(ctm, nums as WalkMatrix);
      } else if (op.operator === 'Do') {
        const name = decodeNameOperand(op.operands[0]?.raw);
        if (name === null) continue;
        const resolved = resolveXObject(partIndex, name);
        if (resolved?.kind === 'image') {
          const occurrence = occurrenceAt.get(op.start) ?? 0;
          pushPlacement({
            id: `img:${name}:${occurrence}`,
            kind: 'xobject',
            name,
            occurrence,
            partIndex,
            start: op.start,
            end: op.end,
            matrix: ctm,
          });
        } else if (resolved?.kind === 'form' && resolved.partIndex !== undefined && depth < 4) {
          walk(
            opsByPart[resolved.partIndex] || [],
            resolved.partIndex,
            multiplyWalkMatrix(ctm, resolved.matrix),
            depth + 1
          );
        }
      } else if (op.operator === 'INLINE') {
        const occurrence = occurrenceAt.get(op.start) ?? 0;
        const params: Record<string, string> = {};
        for (let i = 0; i + 1 < op.operands.length; i += 2) {
          const key = decodeNameOperand(op.operands[i].raw);
          if (key) params[key] = op.operands[i + 1].raw.replace(/^\//, '');
        }
        pushPlacement({
          id: `inline:${occurrence}`,
          kind: 'inline',
          name: '',
          occurrence,
          partIndex,
          start: op.start,
          end: op.end,
          matrix: ctm,
          inlineParams: params,
        });
      }
    }
  };

  // Page content streams run in sequence; forms are walked where the page invokes them
  const pageOps = layout.flatMap((part, idx) => (part.kind === 'page' ? opsByPart[idx] : []));
  const firstPagePart = Math.max(0, layout.findIndex((part) => part.kind === 'page'));
  walk(pageOps, firstPagePart, [1, 0, 0, 1, 0, 0], 0);
  return placements;
}
