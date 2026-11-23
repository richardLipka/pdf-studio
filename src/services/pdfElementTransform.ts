import {
  ParseSpeeds,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from 'pdf-lib';
import {
  findImagePlacements,
  getPageContentStream,
  safeGetPageResources,
  StreamPartLayout,
  writePageStreamText,
} from './contentStreamEditor';
import { ContentOperation, tokenizeContentStream } from './pdfContentTokenizer';
import { buildTextObject, encodeForRun, formatNumber } from './pdfTextEditor';
import { measureLineLeading, PageTextModel, TextBlock } from './pdfTextModel';
import { PdfFontProvider } from './pdfFonts';
import { logger } from './logger';

export type PdfMatrix = [number, number, number, number, number, number];

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementTransformResult {
  updatedPdfBytes: ArrayBuffer;
  updatedStream?: string;
  fontSubstituted?: boolean;
  lineCount?: number;
  error?: string;
}

const IDENTITY: PdfMatrix = [1, 0, 0, 1, 0, 0];
const XFORM_MARKER = '% pilsenpdf:xform';

// Painting operators used to determine whether a q ... Q scope exclusively contains our target(s)
const PAINTING_OPERATORS = new Set([
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'BT', 'INLINE', 'Do', 'd0', 'd1',
]);

// State-modifying operators inside BT ... ET that persist to subsequent text objects outside the block
const PERSISTENT_STATE_OPERATORS = new Set([
  'Tf', 'Tc', 'Tw', 'Tz', 'TL', 'Tr', 'Ts',
  'rg', 'RG', 'g', 'G', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'gs',
]);

/** Column-vector matrix product matching PDF CTM concatenation (`ctm * cm`) */
export function multiplyMatrix(m1: PdfMatrix, m2: PdfMatrix): PdfMatrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function invertMatrix(m: PdfMatrix): PdfMatrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function applyMatrix(m: PdfMatrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Converts a display-space box (top-left origin, scale 1.0) into PDF user space using pdf.js viewport.transform */
export function displayRectToPdfRect(rect: PdfRect, viewportTransform: PdfMatrix): PdfRect {
  const inv = invertMatrix(viewportTransform);
  if (!inv) return { ...rect };
  const corners = [
    applyMatrix(inv, rect.x, rect.y),
    applyMatrix(inv, rect.x + rect.width, rect.y),
    applyMatrix(inv, rect.x + rect.width, rect.y + rect.height),
    applyMatrix(inv, rect.x, rect.y + rect.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Converts a PDF user-space box (bottom-left origin) into display space using pdf.js viewport.transform */
export function pdfRectToDisplayRect(rect: PdfRect, viewportTransform: PdfMatrix): PdfRect {
  const corners = [
    applyMatrix(viewportTransform, rect.x, rect.y),
    applyMatrix(viewportTransform, rect.x + rect.width, rect.y),
    applyMatrix(viewportTransform, rect.x + rect.width, rect.y + rect.height),
    applyMatrix(viewportTransform, rect.x, rect.y + rect.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Page-space affine transform mapping `oldRect` -> `newRect` (PDF user space) */
export function computeBoxTransformMatrix(oldRect: PdfRect, newRect: PdfRect): PdfMatrix {
  const sx = oldRect.width > 1e-4 ? newRect.width / oldRect.width : 1;
  const sy = oldRect.height > 1e-4 ? newRect.height / oldRect.height : 1;
  const tx = newRect.x - sx * oldRect.x;
  const ty = newRect.y - sy * oldRect.y;
  return [sx, 0, 0, sy, tx, ty];
}

const formatMatrix = (m: PdfMatrix): string =>
  m.map((v) => {
    const clean = Math.abs(v) < 1e-9 ? 0 : v;
    return formatNumber(Number(clean.toFixed(6)));
  }).join(' ');

const toExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

interface MergedOp {
  operator: string;
  operands: { type: string; raw: string }[];
  start: number;
  end: number;
  operatorStart: number;
}

function mergeInlineOps(stream: string, from: number, to: number): MergedOp[] {
  const ops = tokenizeContentStream(stream, from, to) as MergedOp[];
  const merged: MergedOp[] = [];
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

const decodeNameOperand = (raw: string | undefined): string | null => {
  if (!raw || !raw.startsWith('/')) return null;
  return raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
};

const parseSixNumbers = (op: MergedOp): PdfMatrix | null => {
  if (op.operands.length < 6) return null;
  const nums = op.operands.slice(-6).map((o) => Number(o.raw));
  return nums.every((n) => Number.isFinite(n)) ? (nums as PdfMatrix) : null;
};

/**
 * Finds the CTM in effect when a Form XObject is invoked from the page stream (including its own /Matrix).
 * Returns IDENTITY for the page stream itself.
 */
function findPartInitialCtm(
  pdfDoc: PDFDocument,
  pageIndex: number,
  streamText: string,
  layout: StreamPartLayout[],
  partIndex: number
): PdfMatrix {
  const part = layout[partIndex];
  if (!part || part.kind !== 'form' || !part.name) return IDENTITY;

  const page = pdfDoc.getPage(pageIndex);
  const context = page.node.context;
  const resources = safeGetPageResources(page.node);
  const xObjects = resources?.lookup(PDFName.of('XObject'));
  let formMatrix: PdfMatrix = IDENTITY;
  if (xObjects instanceof PDFDict) {
    const formObj = context.lookup(xObjects.get(PDFName.of(part.name)));
    const dict =
      formObj instanceof PDFDict ? formObj : (formObj as any)?.dict instanceof PDFDict ? (formObj as any).dict : undefined;
    const matrixArr = dict?.lookup(PDFName.of('Matrix'));
    if (matrixArr instanceof PDFArray) {
      const nums = matrixArr.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
      if (nums.length === 6 && nums.every((n) => Number.isFinite(n))) {
        formMatrix = nums as PdfMatrix;
      }
    }
  }

  // Walk page stream parts to find the first `/FormName Do` invocation CTM
  let ctm: PdfMatrix = IDENTITY;
  const stack: PdfMatrix[] = [];
  for (const p of layout) {
    if (p.kind !== 'page') continue;
    for (const op of mergeInlineOps(streamText, p.start, p.end)) {
      if (op.operator === 'q') {
        stack.push(ctm);
      } else if (op.operator === 'Q') {
        if (stack.length > 0) ctm = stack.pop()!;
      } else if (op.operator === 'cm') {
        const m = parseSixNumbers(op);
        if (m) ctm = multiplyMatrix(ctm, m);
      } else if (op.operator === 'Do') {
        if (decodeNameOperand(op.operands[0]?.raw) === part.name) {
          return multiplyMatrix(ctm, formMatrix);
        }
      }
    }
  }
  return formMatrix;
}

interface WrapperAction {
  /** Replace an existing `q % pilsenpdf:xform` cm matrix in place (no wrapper nesting!) */
  kind: 'replace-cm' | 'wrap-range';
  start: number;
  end: number;
  outerCtm: PdfMatrix;
  prevMatrix?: PdfMatrix;
  /** True when wrapping an already-isolated q ... Q frame (no trailing state replay needed) */
  isExclusiveFrame: boolean;
}

/**
 * Determines the safest splice action to apply a page-space transform to target range(s) in one stream part:
 * - If all target(s) are exclusively enclosed in an existing `q % pilsenpdf:xform` wrapper, updates its `cm` in place.
 * - Else if exclusively enclosed in a `q ... Q` frame (e.g. holding a `re W n` clip path), wraps that whole frame.
 * - Else wraps each target range directly with its local CTM.
 */
function resolveWrapperActions(
  streamText: string,
  partStart: number,
  partEnd: number,
  initialCtm: PdfMatrix,
  targets: Array<{ start: number; end: number }>
): WrapperAction[] {
  const ops = mergeInlineOps(streamText, partStart, partEnd);

  interface Frame {
    start: number;
    end: number;
    outerCtm: PdfMatrix;
    hasOther: boolean;
    matchedIndices: Set<number>;
    isXform: boolean;
    firstOpSeen: boolean;
    xformCmOp: { start: number; end: number; matrix: PdfMatrix } | null;
  }

  const targetCtm = new Map<number, PdfMatrix>();
  const stack: Frame[] = [];
  let ctm: PdfMatrix = initialCtm;
  let inBT = false;

  const findTargetIdx = (opStart: number, opEnd: number): number => {
    for (let i = 0; i < targets.length; i++) {
      if (opStart >= targets[i].start && opEnd <= targets[i].end) return i;
    }
    return -1;
  };

  let bestAllTargetsFrame: Frame | null = null;
  const bestSingleTargetFrame = new Map<number, Frame>();

  for (const op of ops) {
    if (op.operator === 'BT') {
      inBT = true;
      const tIdx = findTargetIdx(op.operatorStart, op.end);
      if (tIdx >= 0) {
        if (!targetCtm.has(tIdx)) targetCtm.set(tIdx, ctm);
        if (stack.length > 0) stack[stack.length - 1].matchedIndices.add(tIdx);
      } else {
        if (stack.length > 0) stack[stack.length - 1].hasOther = true;
      }
      if (stack.length > 0) stack[stack.length - 1].firstOpSeen = true;
      continue;
    }
    if (op.operator === 'ET') {
      inBT = false;
      continue;
    }
    if (inBT) continue;

    if (op.operator === 'q') {
      const afterQ = streamText.slice(op.end, Math.min(partEnd, op.end + 48));
      const isXform = /^[ \t]*% pilsenpdf:xform(?:\r?\n|$)/.test(afterQ);
      stack.push({
        start: op.operatorStart,
        end: -1,
        outerCtm: ctm,
        hasOther: false,
        matchedIndices: new Set<number>(),
        isXform,
        firstOpSeen: false,
        xformCmOp: null,
      });
      continue;
    }

    if (op.operator === 'Q') {
      if (stack.length === 0) continue;
      const frame = stack.pop()!;
      frame.end = op.end;
      ctm = frame.outerCtm;

      if (!frame.hasOther && frame.matchedIndices.size === targets.length) {
        bestAllTargetsFrame = frame;
      } else if (!frame.hasOther && frame.matchedIndices.size === 1) {
        const onlyIdx = Array.from(frame.matchedIndices)[0];
        bestSingleTargetFrame.set(onlyIdx, frame);
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (frame.hasOther) parent.hasOther = true;
        frame.matchedIndices.forEach((idx) => parent.matchedIndices.add(idx));
        parent.firstOpSeen = true;
      }
      continue;
    }

    const top = stack[stack.length - 1];
    if (op.operator === 'cm') {
      const m = parseSixNumbers(op);
      if (m) {
        if (top && top.isXform && !top.firstOpSeen) {
          top.xformCmOp = { start: op.start, end: op.end, matrix: m };
        }
        ctm = multiplyMatrix(ctm, m);
      }
      if (top) top.firstOpSeen = true;
      continue;
    }

    const tIdx = findTargetIdx(op.start, op.end);
    if (tIdx >= 0) {
      if (!targetCtm.has(tIdx)) targetCtm.set(tIdx, ctm);
      if (top) {
        top.matchedIndices.add(tIdx);
        top.firstOpSeen = true;
      }
    } else if (PAINTING_OPERATORS.has(op.operator)) {
      if (top) {
        top.hasOther = true;
        top.firstOpSeen = true;
      }
    } else if (top) {
      top.firstOpSeen = true;
    }
  }

  // Case 1: One exclusive q ... Q frame encloses ALL target ranges
  if (bestAllTargetsFrame) {
    if (bestAllTargetsFrame.isXform && bestAllTargetsFrame.xformCmOp) {
      return [
        {
          kind: 'replace-cm',
          start: bestAllTargetsFrame.xformCmOp.start,
          end: bestAllTargetsFrame.xformCmOp.end,
          outerCtm: bestAllTargetsFrame.outerCtm,
          prevMatrix: bestAllTargetsFrame.xformCmOp.matrix,
          isExclusiveFrame: true,
        },
      ];
    }
    return [
      {
        kind: 'wrap-range',
        start: bestAllTargetsFrame.start,
        end: bestAllTargetsFrame.end,
        outerCtm: bestAllTargetsFrame.outerCtm,
        isExclusiveFrame: true,
      },
    ];
  }

  // Case 2: Handle each target individually
  return targets.map((t, idx) => {
    const frame = bestSingleTargetFrame.get(idx);
    if (frame) {
      if (frame.isXform && frame.xformCmOp) {
        return {
          kind: 'replace-cm',
          start: frame.xformCmOp.start,
          end: frame.xformCmOp.end,
          outerCtm: frame.outerCtm,
          prevMatrix: frame.xformCmOp.matrix,
          isExclusiveFrame: true,
        };
      }
      return {
        kind: 'wrap-range',
        start: frame.start,
        end: frame.end,
        outerCtm: frame.outerCtm,
        isExclusiveFrame: true,
      };
    }
    return {
      kind: 'wrap-range',
      start: t.start,
      end: t.end,
      outerCtm: targetCtm.get(idx) ?? initialCtm,
      isExclusiveFrame: false,
    };
  });
}

/** Collects persistent graphics/text state ops inside a BT ... ET block so they can be replayed after Q */
function collectTrailingStateOps(streamText: string, start: number, end: number): string {
  const ops = tokenizeContentStream(streamText, start, end) as ContentOperation[];
  const replay = ops
    .filter((op) => PERSISTENT_STATE_OPERATORS.has(op.operator))
    .map((op) => streamText.substring(op.start, op.end));
  return replay.length > 0 ? `\n${replay.join('\n')}` : '';
}

/**
 * Expands a page-local Form XObject's /BBox to include `newPdfRect` (transformed into the Form's local space)
 * so moved or enlarged elements inside a Form XObject are never clipped.
 */
function expandFormXObjectBBox(
  pdfDoc: PDFDocument,
  pageIndex: number,
  formName: string,
  formInitialCtm: PdfMatrix,
  newPdfRect: PdfRect
): void {
  const page = pdfDoc.getPage(pageIndex);
  const resources = safeGetPageResources(page.node);
  const xObjects = resources?.lookup(PDFName.of('XObject'));
  if (!(xObjects instanceof PDFDict)) return;
  const formObj = pdfDoc.context.lookup(xObjects.get(PDFName.of(formName)));
  if (!(formObj instanceof PDFRawStream)) return;

  const inv = invertMatrix(formInitialCtm);
  if (!inv) return;

  const localCorners = [
    applyMatrix(inv, newPdfRect.x, newPdfRect.y),
    applyMatrix(inv, newPdfRect.x + newPdfRect.width, newPdfRect.y),
    applyMatrix(inv, newPdfRect.x + newPdfRect.width, newPdfRect.y + newPdfRect.height),
    applyMatrix(inv, newPdfRect.x, newPdfRect.y + newPdfRect.height),
  ];
  const minX = Math.min(...localCorners.map((c) => c[0])) - 2;
  const minY = Math.min(...localCorners.map((c) => c[1])) - 2;
  const maxX = Math.max(...localCorners.map((c) => c[0])) + 2;
  const maxY = Math.max(...localCorners.map((c) => c[1])) + 2;

  const bboxArr = formObj.dict.lookup(PDFName.of('BBox'));
  let cur = [minX, minY, maxX, maxY];
  if (bboxArr instanceof PDFArray && bboxArr.size() >= 4) {
    const nums = bboxArr.asArray().slice(0, 4).map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
    if (nums.every((n) => Number.isFinite(n))) {
      cur = [
        Math.min(nums[0], nums[2], minX),
        Math.min(nums[1], nums[3], minY),
        Math.max(nums[0], nums[2], maxX),
        Math.max(nums[1], nums[3], maxY),
      ];
    }
  }
  formObj.dict.set(PDFName.of('BBox'), pdfDoc.context.obj(cur));
}

/**
 * Applies a page-space affine transform to target range(s) within one stream part, collapsing
 * repeated transforms into an existing `q % pilsenpdf:xform` wrapper when present.
 */
function applyTransformSplices(
  streamText: string,
  partStart: number,
  partEnd: number,
  initialCtm: PdfMatrix,
  targets: Array<{ start: number; end: number }>,
  pageTransform: PdfMatrix,
  replayTextState: boolean
): string {
  const actions = resolveWrapperActions(streamText, partStart, partEnd, initialCtm, targets);
  // Apply from end to start so earlier offsets remain valid
  const sorted = [...actions].sort((a, b) => b.start - a.start);
  let out = streamText;

  for (const action of sorted) {
    const invOuter = invertMatrix(action.outerCtm);
    if (!invOuter) continue;
    const deltaLocal = multiplyMatrix(invOuter, multiplyMatrix(pageTransform, action.outerCtm));

    if (action.kind === 'replace-cm' && action.prevMatrix) {
      const nextMatrix = multiplyMatrix(deltaLocal, action.prevMatrix);
      out = out.substring(0, action.start) + `${formatMatrix(nextMatrix)} cm` + out.substring(action.end);
    } else {
      const inner = out.substring(action.start, action.end);
      const trailingReplay =
        replayTextState && !action.isExclusiveFrame
          ? collectTrailingStateOps(out, action.start, action.end)
          : '';
      const wrapped = `q ${XFORM_MARKER}\n${formatMatrix(deltaLocal)} cm\n${inner}\nQ${trailingReplay}`;
      out = out.substring(0, action.start) + wrapped + out.substring(action.end);
    }
  }

  return out;
}

/**
 * Repositions and/or resizes a single embedded image placement (`img:<name>:<occ>` or `inline:<occ>`)
 * on a PDF page. Handles XObjects, repeated XObjects, clipped images (`W n`), inline images, and
 * images inside Form XObjects without modifying any other page.
 */
export async function transformImageOnPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  placementId: string,
  newPdfRect: PdfRect
): Promise<ElementTransformResult> {
  if (newPdfRect.width < 2 || newPdfRect.height < 2) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Neplatné rozměry obrázku.' };
  }

  try {
    const { streamText, layout, error: streamErr } = await getPageContentStream(pdfDocBytes, pageIndex);
    if (streamErr || !streamText || !layout) {
      return { updatedPdfBytes: pdfDocBytes, error: streamErr || 'Obsah stránky nelze načíst.' };
    }

    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
      return { updatedPdfBytes: pdfDocBytes, error: `Neplatný index stránky ${pageIndex + 1}` };
    }

    const page = pdfDoc.getPage(pageIndex);
    const context = page.node.context;
    const pageResources = safeGetPageResources(page.node);
    const xObjectsOf = (resources: unknown): PDFDict | undefined => {
      const dict = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : undefined;
      return dict instanceof PDFDict ? dict : undefined;
    };
    const streamDict = (obj: unknown): PDFDict | undefined =>
      obj instanceof PDFDict ? obj : (obj as any)?.dict instanceof PDFDict ? (obj as any).dict : undefined;
    const pageXObjects = xObjectsOf(pageResources);
    const partXObjects = layout.map((part) => {
      if (part.kind !== 'form' || !part.name || !pageXObjects) return pageXObjects;
      const formDict = streamDict(context.lookup(pageXObjects.get(PDFName.of(part.name))));
      return xObjectsOf(formDict?.lookup(PDFName.of('Resources'))) || pageXObjects;
    });

    const placements = findImagePlacements(streamText, layout, (partIndex, name) => {
      const dict = streamDict(context.lookup(partXObjects[partIndex]?.get(PDFName.of(name))));
      if (!dict) return null;
      const subtype = dict.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Image') return { kind: 'image' };
      if (subtype === '/Form') {
        const matrixArr = dict.lookup(PDFName.of('Matrix'));
        const nums =
          matrixArr instanceof PDFArray
            ? matrixArr.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN))
            : [];
        const matrix = (nums.length === 6 && nums.every((n) => Number.isFinite(n))
          ? nums
          : IDENTITY) as PdfMatrix;
        const formPart =
          layout[partIndex]?.kind === 'page' ? layout.findIndex((p) => p.kind === 'form' && p.name === name) : -1;
        return { kind: 'form', partIndex: formPart >= 0 ? formPart : undefined, matrix };
      }
      return null;
    });

    const placement = placements.find((p) => p.id === placementId);
    if (!placement) {
      return { updatedPdfBytes: pdfDocBytes, error: 'Obrázek nebyl na stránce nalezen. Vyberte ho znovu.' };
    }

    const oldRect: PdfRect = {
      x: placement.bbox[0],
      y: placement.bbox[1],
      width: placement.bbox[2] - placement.bbox[0],
      height: placement.bbox[3] - placement.bbox[1],
    };
    if (oldRect.width < 1e-4 || oldRect.height < 1e-4) {
      return { updatedPdfBytes: pdfDocBytes, error: 'Obrázek má nulové rozměry.' };
    }

    // Skip no-op transform
    if (
      Math.abs(oldRect.x - newPdfRect.x) < 0.05 &&
      Math.abs(oldRect.y - newPdfRect.y) < 0.05 &&
      Math.abs(oldRect.width - newPdfRect.width) < 0.05 &&
      Math.abs(oldRect.height - newPdfRect.height) < 0.05
    ) {
      return { updatedPdfBytes: pdfDocBytes, updatedStream: streamText };
    }

    const part = layout[placement.partIndex];
    const partInitialCtm = findPartInitialCtm(pdfDoc, pageIndex, streamText, layout, placement.partIndex);
    const pageTransform = computeBoxTransformMatrix(oldRect, newPdfRect);

    const modifiedStream = applyTransformSplices(
      streamText,
      part.start,
      part.end,
      partInitialCtm,
      [{ start: placement.start, end: placement.end }],
      pageTransform,
      false
    );

    const updatedStream = writePageStreamText(pdfDoc, page, modifiedStream);

    // If the image lives inside a Form XObject, expand the page-local cloned Form's /BBox
    if (part.kind === 'form' && part.name) {
      expandFormXObjectBBox(pdfDoc, pageIndex, part.name, partInitialCtm, newPdfRect);
    }

    const saved = await pdfDoc.save({ objectsPerTick: 500 });
    logger.success('edit', `Obrázek ${placementId} na straně ${pageIndex + 1} byl upraven`, {
      placementId,
      oldRect,
      newPdfRect,
    });
    return {
      updatedPdfBytes: toExactArrayBuffer(saved),
      updatedStream,
    };
  } catch (err: any) {
    logger.error('edit', `Úprava polohy/rozměru obrázku ${placementId} selhala: ${err?.message || err}`);
    return { updatedPdfBytes: pdfDocBytes, error: err?.message || String(err) };
  }
}

/**
 * Repositions and/or scales one or more PDF text blocks (`BT ... ET`) atomically in page user space.
 * Preserves subset CID fonts, colors, multi-line layouts, and inherited text state for subsequent blocks.
 */
export async function transformTextBlocksOnPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  model: PageTextModel,
  segmentIds: string[],
  oldPdfRect: PdfRect,
  newPdfRect: PdfRect
): Promise<ElementTransformResult> {
  if (!model.aligned || segmentIds.length === 0) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Textový blok nelze na stránce spolehlivě určit.' };
  }
  if (oldPdfRect.width < 1e-4 || oldPdfRect.height < 1e-4 || newPdfRect.width < 2 || newPdfRect.height < 2) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Neplatné rozměry textového bloku.' };
  }

  // Skip no-op transform
  if (
    Math.abs(oldPdfRect.x - newPdfRect.x) < 0.05 &&
    Math.abs(oldPdfRect.y - newPdfRect.y) < 0.05 &&
    Math.abs(oldPdfRect.width - newPdfRect.width) < 0.05 &&
    Math.abs(oldPdfRect.height - newPdfRect.height) < 0.05
  ) {
    return { updatedPdfBytes: pdfDocBytes, updatedStream: model.streamText };
  }

  const blocks = segmentIds
    .map((id) => model.blocksById.get(id))
    .filter((b): b is TextBlock => Boolean(b && b.runs.length > 0));
  if (blocks.length === 0) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Textový blok nebyl na stránce nalezen.' };
  }

  const current = await getPageContentStream(pdfDocBytes, pageIndex);
  if (current.error || !current.layout || current.streamText !== model.streamText) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Obsah stránky se mezitím změnil. Vyberte blok znovu.' };
  }

  try {
    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });
    const page = pdfDoc.getPage(pageIndex);
    const pageTransform = computeBoxTransformMatrix(oldPdfRect, newPdfRect);

    // Group targets by stream partIndex (page vs Form XObject), process later parts first
    const byPart = new Map<number, TextBlock[]>();
    for (const blk of blocks) {
      const pIdx = blk.runs[0].partIndex;
      const list = byPart.get(pIdx) ?? [];
      list.push(blk);
      byPart.set(pIdx, list);
    }

    const sortedPartIndices = Array.from(byPart.keys()).sort((a, b) => b - a);
    let modifiedStream = model.streamText;
    const touchedForms: Array<{ name: string; initialCtm: PdfMatrix }> = [];

    for (const partIdx of sortedPartIndices) {
      const part = current.layout[partIdx];
      if (!part) continue;
      const partBlocks = byPart.get(partIdx)!;
      const initialCtm = findPartInitialCtm(pdfDoc, pageIndex, model.streamText, current.layout, partIdx);
      const targets = partBlocks.map((b) => ({ start: b.startIndex, end: b.endIndex }));
      modifiedStream = applyTransformSplices(
        modifiedStream,
        part.start,
        part.end,
        initialCtm,
        targets,
        pageTransform,
        true
      );
      if (part.kind === 'form' && part.name) {
        touchedForms.push({ name: part.name, initialCtm });
      }
    }

    const updatedStream = writePageStreamText(pdfDoc, page, modifiedStream);
    for (const tf of touchedForms) {
      expandFormXObjectBBox(pdfDoc, pageIndex, tf.name, tf.initialCtm, newPdfRect);
    }

    const saved = await pdfDoc.save({ objectsPerTick: 500 });
    logger.success('edit', `Textový blok ${segmentIds.join(', ')} na straně ${pageIndex + 1} byl upraven`, {
      segmentIds,
      oldPdfRect,
      newPdfRect,
    });
    return {
      updatedPdfBytes: toExactArrayBuffer(saved),
      updatedStream,
    };
  } catch (err: any) {
    logger.error('edit', `Úprava polohy/rozměru textového bloku selhala: ${err?.message || err}`);
    return { updatedPdfBytes: pdfDocBytes, error: err?.message || String(err) };
  }
}

/** Relative proportional character weight for estimating original-font word widths calibrated to pdf.js bbox */
function charWeight(ch: string): number {
  if (ch === ' ') return 0.5;
  if (/[ilI1.,:;'|!jtf]/.test(ch)) return 0.52;
  if (/[mwMW@]/.test(ch)) return 1.48;
  if (/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(ch)) return 1.18;
  return 1.0;
}

function stringWeight(text: string): number {
  let w = 0;
  for (const ch of Array.from(text)) w += charWeight(ch);
  return w;
}

/** Wraps paragraph strings into lines fitting `maxWidthPt` using the provided width estimator */
export function wrapParagraphsToWidth(
  paragraphs: string[],
  maxWidthPt: number,
  measureWidth: (text: string) => number
): string[] {
  const result: string[] = [];
  const limit = Math.max(12, maxWidthPt);

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      result.push('');
      continue;
    }
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      if (measureWidth(candidate) <= limit) {
        currentLine = candidate;
      } else {
        result.push(currentLine);
        currentLine = words[i];
      }
    }
    result.push(currentLine);
  }
  return result.length > 0 ? result : [''];
}

/**
 * Reflows the text of a PDF text block (or visual group of blocks) to fit a new target width in points,
 * wrapping words onto multiple lines (or unwrapping into fewer lines) while preserving font, size, color,
 * leading, and top-left anchor. Optionally shifts the left anchor by `(deltaXPt, deltaYPt)` in PDF user space.
 */
export async function reflowTextBlocksOnPage(
  pdfDocBytes: ArrayBuffer,
  pageIndex: number,
  model: PageTextModel,
  segmentIds: string[],
  newWidthPt: number,
  deltaXPt = 0,
  deltaYPt = 0
): Promise<ElementTransformResult> {
  if (!model.aligned || segmentIds.length === 0) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Textový blok nelze na stránce spolehlivě určit.' };
  }

  const blocks = segmentIds
    .map((id) => model.blocksById.get(id))
    .filter((b): b is TextBlock => Boolean(b && b.runs.length > 0))
    .sort((a, b) => a.startIndex - b.startIndex);
  if (blocks.length === 0) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Textový blok nebyl na stránce nalezen.' };
  }

  const primaryBlock = blocks[0];
  const firstRun = primaryBlock.runs[0];
  const effectiveEm = Math.max(4, firstRun.emSize || Math.abs(firstRun.fontSize) || 12);
  const clampedWidth = Math.max(effectiveEm * 2, newWidthPt);

  const current = await getPageContentStream(pdfDocBytes, pageIndex);
  if (current.error || !current.layout || current.streamText !== model.streamText) {
    return { updatedPdfBytes: pdfDocBytes, error: 'Obsah stránky se mezitím změnil. Vyberte blok znovu.' };
  }

  try {
    // 1. Extract logical paragraphs while keeping genuine paragraph breaks (large vertical gaps)
    const allLines = blocks.flatMap((b) => b.lines);
    const measuredLeading = measureLineLeading(primaryBlock);
    const lineHeightEst =
      allLines.length > 1
        ? Math.max(
            effectiveEm * 0.9,
            Math.abs(allLines[1].bbox.y - allLines[0].bbox.y) || effectiveEm * 1.2
          )
        : effectiveEm * 1.2;

    const paragraphs: string[] = [];
    let currentParaParts: string[] = [];
    for (let i = 0; i < allLines.length; i++) {
      const ln = allLines[i];
      const txt = ln.text.trim();
      if (!txt) continue;
      if (i > 0 && currentParaParts.length > 0) {
        const prev = allLines[i - 1];
        const gap = ln.bbox.y - prev.bbox.y;
        if (gap > lineHeightEst * 1.65) {
          paragraphs.push(currentParaParts.join(' '));
          currentParaParts = [txt];
          continue;
        }
      }
      currentParaParts.push(txt);
    }
    if (currentParaParts.length > 0) paragraphs.push(currentParaParts.join(' '));
    if (paragraphs.length === 0) {
      return { updatedPdfBytes: pdfDocBytes, error: 'Textový blok neobsahuje žádný text k zalamování.' };
    }

    // 2. Calibrate character-width estimator from the block's actual rendered line widths
    let measuredWidthSum = 0;
    let weightSum = 0;
    for (const ln of allLines) {
      const w = stringWeight(ln.text.trim());
      if (w > 0 && ln.bbox.width > 1) {
        measuredWidthSum += ln.bbox.width;
        weightSum += w;
      }
    }
    const unitWidthPt = weightSum > 0 ? measuredWidthSum / weightSum : effectiveEm * 0.52;

    const pdfDoc = await PDFDocument.load(pdfDocBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fast,
    });
    const fontProvider = new PdfFontProvider(pdfDoc);

    // Probe encoding first on the joined text to see whether original font or a substitute PDFFont will be used
    const probeLines = wrapParagraphsToWidth(paragraphs, clampedWidth, (s) => stringWeight(s) * unitWidthPt);
    const encodedProbe = await encodeForRun(
      pdfDoc,
      pageIndex,
      model,
      current.layout,
      firstRun,
      firstRun.partIndex,
      probeLines,
      undefined,
      fontProvider
    );
    if ('error' in encodedProbe) {
      return { updatedPdfBytes: pdfDocBytes, error: encodedProbe.error };
    }

    let finalLines = probeLines;
    let finalEncoded = encodedProbe;

    // If a substitute PDFFont was embedded, re-wrap with its exact glyph advance metrics!
    if (encodedProbe.substituteFont) {
      const subFont: PDFFont = encodedProbe.substituteFont;
      const exactWrapped = wrapParagraphsToWidth(paragraphs, clampedWidth, (s) => {
        try {
          return subFont.widthOfTextAtSize(s, effectiveEm);
        } catch {
          return stringWeight(s) * unitWidthPt;
        }
      });
      if (exactWrapped.join('\n') !== probeLines.join('\n')) {
        const reEncoded = await encodeForRun(
          pdfDoc,
          pageIndex,
          model,
          current.layout,
          firstRun,
          firstRun.partIndex,
          exactWrapped,
          undefined,
          fontProvider
        );
        if (!('error' in reEncoded)) {
          finalLines = exactWrapped;
          finalEncoded = reEncoded;
        }
      }
    }

    // 3. Optionally shift the starting textMatrix when the user dragged the left (W) edge
    let nextTm: PdfMatrix = [...firstRun.textMatrix] as PdfMatrix;
    if (Math.abs(deltaXPt) > 0.05 || Math.abs(deltaYPt) > 0.05) {
      const part = current.layout[firstRun.partIndex];
      const partInitialCtm = findPartInitialCtm(pdfDoc, pageIndex, model.streamText, current.layout, firstRun.partIndex);
      // Determine CTM active at primaryBlock
      const actions = resolveWrapperActions(
        model.streamText,
        part.start,
        part.end,
        partInitialCtm,
        [{ start: primaryBlock.startIndex, end: primaryBlock.endIndex }]
      );
      const blockCtm = actions[0]?.outerCtm ?? partInitialCtm;
      const invCtm = invertMatrix(blockCtm);
      if (invCtm) {
        const localDx = invCtm[0] * deltaXPt + invCtm[2] * deltaYPt;
        const localDy = invCtm[1] * deltaXPt + invCtm[3] * deltaYPt;
        nextTm = [nextTm[0], nextTm[1], nextTm[2], nextTm[3], nextTm[4] + localDx, nextTm[5] + localDy];
      }
    }

    const leading = measuredLeading ?? Math.abs(firstRun.fontSize) * 1.25;
    const textObject = buildTextObject(
      model.streamText,
      primaryBlock,
      finalEncoded.fontOperator,
      finalEncoded.lineOperations,
      leading,
      finalEncoded.substituteFont ? finalEncoded.originalFontOperator : null,
      nextTm
    );

    // 4. Splice rebuilt primary block and remove merged sibling blocks (end-to-start)
    const splices: Array<{ start: number; end: number; replacement: string }> = [
      { start: primaryBlock.startIndex, end: primaryBlock.endIndex, replacement: textObject },
      ...blocks.slice(1).map((b) => ({ start: b.startIndex, end: b.endIndex, replacement: '' })),
    ];
    splices.sort((a, b) => b.start - a.start);
    let newStreamText = model.streamText;
    for (const sp of splices) {
      newStreamText = newStreamText.substring(0, sp.start) + sp.replacement + newStreamText.substring(sp.end);
    }

    const page = pdfDoc.getPage(pageIndex);
    const updatedStream = writePageStreamText(pdfDoc, page, newStreamText);

    // Expand Form XObject /BBox if inside a Form
    const part = current.layout[firstRun.partIndex];
    if (part?.kind === 'form' && part.name && model.viewportTransform) {
      const partInitialCtm = findPartInitialCtm(pdfDoc, pageIndex, model.streamText, current.layout, firstRun.partIndex);
      const oldPdfBox = displayRectToPdfRect(primaryBlock.bbox, model.viewportTransform);
      const estimatedHeight = Math.max(oldPdfBox.height, finalLines.length * lineHeightEst);
      expandFormXObjectBBox(pdfDoc, pageIndex, part.name, partInitialCtm, {
        x: oldPdfBox.x + deltaXPt,
        y: oldPdfBox.y + oldPdfBox.height - estimatedHeight + deltaYPt,
        width: clampedWidth,
        height: estimatedHeight,
      });
    }

    const saved = await pdfDoc.save({ objectsPerTick: 500 });
    logger.success('edit', `Textový blok ${segmentIds.join(', ')} přelomen na šířku ${clampedWidth.toFixed(1)} pt (${finalLines.length} ř.)`, {
      segmentIds,
      newWidthPt: clampedWidth,
      lineCount: finalLines.length,
      fontSubstituted: Boolean(finalEncoded.substituteFont),
    });

    return {
      updatedPdfBytes: toExactArrayBuffer(saved),
      updatedStream,
      fontSubstituted: Boolean(finalEncoded.substituteFont),
      lineCount: finalLines.length,
    };
  } catch (err: any) {
    logger.error('edit', `Zalamování textového bloku selhalo: ${err?.message || err}`);
    return { updatedPdfBytes: pdfDocBytes, error: err?.message || String(err) };
  }
}
