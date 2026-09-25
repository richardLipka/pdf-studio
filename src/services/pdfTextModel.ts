import {
  ContentOperation,
  TEXT_SHOW_OPERATORS,
  textOperationStrings,
  tokenizeContentStream,
} from './pdfContentTokenizer';
import { parseStreamSegments, StreamPartLayout } from './contentStreamEditor';

/**
 * Exact text model of a page.
 *
 * The content stream is tokenized to find every text-showing operator (Tj, TJ, ', ") and its byte
 * range, and pdf.js' operator list supplies what those operators actually draw: the decoded glyphs
 * (Unicode, original character codes, widths) in execution order. Pairing the two gives, for each
 * operator, its real text, its exact position on the page and which character codes the font uses
 * for which characters — independent of how the font encodes text (subset fonts, Identity-H CID
 * fonts, custom encodings), where searching the raw stream for readable text cannot work.
 */

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A × B: apply A, then B (PDF row-vector convention) */
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5],
];

const invert = (m: Matrix): Matrix | null => {
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
};

const toMatrix = (args: unknown): Matrix | null => {
  const values = Array.from((args ?? []) as ArrayLike<number>).map(Number);
  return values.length >= 6 && values.slice(0, 6).every(Number.isFinite) ? (values.slice(0, 6) as Matrix) : null;
};

/** pdf.js passes some operands either spread or packed into one typed array */
const flatNumbers = (args: any[] | null | undefined): number[] => {
  if (!args) return [];
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && typeof args[0].length === 'number') {
    return Array.from(args[0] as ArrayLike<number>).map(Number);
  }
  return args.map(Number);
};

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextRunGlyph {
  unicode: string;
  code: number;
  isSpace: boolean;
}

export interface TextRun {
  /** Position of the text-showing operator: operands start / operator end in the composed stream */
  start: number;
  end: number;
  operator: string;
  partIndex: number;
  text: string;
  glyphs: TextRunGlyph[];
  /** pdf.js font identifier (unique per font object) */
  fontKey: string;
  /** Font resource name selected by the last Tf in the stream, e.g. "F1" */
  fontResource: string | null;
  fontSize: number;
  /** PostScript name reported by pdf.js, e.g. "ABCDEF+Calibri-Bold" */
  fontName: string;
  /** Bytes per character code when the operands match pdf.js' codes exactly */
  codeBytes: 1 | 2 | null;
  /** Text matrix when the operator starts (text space -> content space of its stream) */
  textMatrix: Matrix;
  /** Displayed page space (top-left origin, unscaled) */
  bbox: Box;
  /** Baseline start and end and em size in the content space of the page (for line analysis) */
  baselineStart: [number, number];
  baselineEnd: [number, number];
  emSize: number;
}

export interface TextBlock {
  segmentId: string;
  startIndex: number;
  endIndex: number;
  runs: TextRun[];
  text: string;
  bbox: Box;
}

export interface FontCodeMap {
  codeBytes: 1 | 2;
  codes: Map<string, number>;
}

export interface PageTextModel {
  aligned: boolean;
  /** Why alignment failed, for logging */
  reason?: string;
  streamText: string;
  runs: TextRun[];
  blocks: TextBlock[];
  blocksById: Map<string, TextBlock>;
  /** Character -> code maps per pdf.js font, from the glyphs used on the page */
  fontCodeMaps: Map<string, FontCodeMap>;
}

export interface FontMetrics {
  fontMatrix?: number[];
  ascent?: number;
  descent?: number;
  name?: string;
  vertical?: boolean;
}

export interface PageTextModelInput {
  streamText: string;
  layout: StreamPartLayout[];
  operatorList: { fnArray: ArrayLike<number>; argsArray: any[] };
  /** pdf.js OPS table */
  ops: Record<string, number>;
  getFont: (fontKey: string) => FontMetrics | null;
  /** Content space of the page -> displayed page space (pdf.js viewport at scale 1) */
  toDisplay: (x: number, y: number) => [number, number];
}

type StreamEvent =
  | { kind: 'text'; op: ContentOperation; partIndex: number; fontResource: string | null; fontSize: number }
  | { kind: 'formStart' }
  | { kind: 'formEnd' };

interface GeometryRun {
  glyphs: TextRunGlyph[];
  text: string;
  fontKey: string;
  fontSize: number;
  fontName: string;
  textMatrix: Matrix;
  bbox: Box;
  baselineStart: [number, number];
  baselineEnd: [number, number];
  emSize: number;
}

type ListEvent = { kind: 'text'; run: GeometryRun } | { kind: 'formStart' } | { kind: 'formEnd' };

/** Text operators in execution order, descending into the page's Form XObjects where they are painted */
function collectStreamEvents(streamText: string, layout: StreamPartLayout[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  const formIndexByName = new Map<string, number>();
  layout.forEach((part, idx) => {
    if (part.kind === 'form' && part.name) formIndexByName.set(part.name, idx);
  });

  const walk = (partIndex: number, inherited: { fontResource: string | null; fontSize: number }, depth: number) => {
    const part = layout[partIndex];
    const stack: Array<{ fontResource: string | null; fontSize: number }> = [];
    let state = { ...inherited };
    for (const op of tokenizeContentStream(streamText, part.start, part.end)) {
      switch (op.operator) {
        case 'Tf': {
          const name = op.operands.find((o) => o.type === 'name');
          const size = op.operands.find((o) => o.type === 'number');
          state = {
            fontResource: name ? name.raw.substring(1) : state.fontResource,
            fontSize: size ? parseFloat(size.raw) : state.fontSize,
          };
          break;
        }
        case 'q':
          stack.push({ ...state });
          break;
        case 'Q':
          state = stack.pop() ?? state;
          break;
        case 'Do': {
          // Only the page's own XObject names are known; nested forms are skipped during alignment
          const name = op.operands.find((o) => o.type === 'name');
          const formIndex = depth === 0 && name ? formIndexByName.get(name.raw.substring(1)) : undefined;
          if (formIndex !== undefined) {
            events.push({ kind: 'formStart' });
            walk(formIndex, state, depth + 1);
            events.push({ kind: 'formEnd' });
          }
          break;
        }
        default:
          if (TEXT_SHOW_OPERATORS.has(op.operator)) {
            events.push({ kind: 'text', op, partIndex, ...state });
          }
      }
    }
  };

  if (layout.length > 0 && layout[0].kind === 'page') {
    walk(0, { fontResource: null, fontSize: 0 }, 0);
  }
  return events;
}

/** Interprets the operator list and records the geometry of every text-showing operation */
function collectOperatorListEvents(input: PageTextModelInput): ListEvent[] {
  const { operatorList, ops, getFont, toDisplay } = input;
  const events: ListEvent[] = [];

  interface State {
    ctm: Matrix;
    fontKey: string;
    fontSize: number;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    leading: number;
    rise: number;
  }
  let state: State = {
    ctm: IDENTITY,
    fontKey: '',
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: State[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;

  const moveText = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    switch (fn) {
      case ops.save:
        stack.push({ ...state });
        break;
      case ops.restore:
        state = stack.pop() ?? state;
        break;
      case ops.transform: {
        const m = toMatrix(flatNumbers(args));
        if (m) state = { ...state, ctm: multiply(m, state.ctm) };
        break;
      }
      case ops.paintFormXObjectBegin: {
        stack.push({ ...state });
        const m = toMatrix(args?.[0]);
        if (m) state = { ...state, ctm: multiply(m, state.ctm) };
        events.push({ kind: 'formStart' });
        break;
      }
      case ops.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        events.push({ kind: 'formEnd' });
        break;
      case ops.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case ops.setFont:
        state = { ...state, fontKey: String(args?.[0] ?? ''), fontSize: Number(args?.[1] ?? 0) };
        break;
      case ops.setTextMatrix: {
        const m = toMatrix(flatNumbers(args));
        if (m) {
          tm = m;
          tlm = m;
        }
        break;
      }
      case ops.moveText: {
        const [tx, ty] = flatNumbers(args);
        moveText(tx || 0, ty || 0);
        break;
      }
      case ops.setLeadingMoveText: {
        const [tx, ty] = flatNumbers(args);
        state = { ...state, leading: -(ty || 0) };
        moveText(tx || 0, ty || 0);
        break;
      }
      case ops.nextLine:
        moveText(0, -state.leading);
        break;
      case ops.setLeading:
        state = { ...state, leading: Number(args?.[0] ?? 0) };
        break;
      case ops.setCharSpacing:
        state = { ...state, charSpacing: Number(args?.[0] ?? 0) };
        break;
      case ops.setWordSpacing:
        state = { ...state, wordSpacing: Number(args?.[0] ?? 0) };
        break;
      case ops.setHScale:
        state = { ...state, hScale: Number(args?.[0] ?? 100) / 100 };
        break;
      case ops.setTextRise:
        state = { ...state, rise: Number(args?.[0] ?? 0) };
        break;
      case ops.showText:
      case ops.showSpacedText: {
        const font = getFont(state.fontKey);
        const fontMatrix = font?.fontMatrix && font.fontMatrix.length >= 1 ? Number(font.fontMatrix[0]) : 0.001;
        const ascent = typeof font?.ascent === 'number' && font.ascent > 0 ? font.ascent : 0.8;
        const descent = typeof font?.descent === 'number' && font.descent < 0 ? font.descent : -0.2;
        const size = state.fontSize;
        const hScale = state.hScale;

        const glyphs: TextRunGlyph[] = [];
        let text = '';
        let advance = 0;
        for (const item of (args?.[0] ?? []) as any[]) {
          if (typeof item === 'number') {
            advance -= (item / 1000) * size * hScale;
            // Large negative kerning inside TJ is how many producers write word gaps
            if (item < -200 && text && !text.endsWith(' ')) text += ' ';
            continue;
          }
          if (!item) continue;
          const width = Number(item.width) || 0;
          advance += (width * fontMatrix * size + state.charSpacing + (item.isSpace ? state.wordSpacing : 0)) * hScale;
          const unicode = typeof item.unicode === 'string' ? item.unicode : '';
          glyphs.push({ unicode, code: Number(item.originalCharCode), isSpace: Boolean(item.isSpace) });
          text += unicode;
        }

        const renderMatrix = multiply(tm, state.ctm);
        const corners: Array<[number, number]> = [
          [0, state.rise + descent * size],
          [advance, state.rise + descent * size],
          [0, state.rise + ascent * size],
          [advance, state.rise + ascent * size],
        ];
        const displayCorners = corners.map(([x, y]) => {
          const [ux, uy] = apply(renderMatrix, x, y);
          return toDisplay(ux, uy);
        });
        const xs = displayCorners.map((p) => p[0]);
        const ys = displayCorners.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);

        const emVector = apply([renderMatrix[0], renderMatrix[1], renderMatrix[2], renderMatrix[3], 0, 0], 0, size);
        events.push({
          kind: 'text',
          run: {
            glyphs,
            text,
            fontKey: state.fontKey,
            fontSize: size,
            fontName: font?.name ?? '',
            textMatrix: tm,
            bbox: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
            baselineStart: apply(renderMatrix, 0, state.rise),
            baselineEnd: apply(renderMatrix, advance, state.rise),
            emSize: Math.hypot(emVector[0], emVector[1]) || Math.abs(size),
          },
        });
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
        break;
      }
      default:
        break;
    }
  }
  return events;
}

/** Bytes per code for which the operands reproduce pdf.js' glyph codes exactly */
function detectCodeBytes(op: ContentOperation, glyphs: TextRunGlyph[]): 1 | 2 | null {
  const bytes = textOperationStrings(op).flat();
  if (glyphs.length === 0) return null;
  for (const size of [1, 2] as const) {
    if (bytes.length !== glyphs.length * size) continue;
    const matches = glyphs.every((glyph, i) => {
      const code = size === 1 ? bytes[i] : (bytes[2 * i] << 8) | bytes[2 * i + 1];
      return code === glyph.code;
    });
    if (matches) return size;
  }
  return null;
}

const unionBox = (boxes: Box[]): Box => {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Joins the runs of a text object into lines using their baselines */
function blockText(runs: TextRun[]): string {
  let text = '';
  runs.forEach((run, idx) => {
    if (idx > 0) {
      const prev = runs[idx - 1];
      const dirX = prev.baselineEnd[0] - prev.baselineStart[0];
      const dirY = prev.baselineEnd[1] - prev.baselineStart[1];
      const len = Math.hypot(dirX, dirY);
      const [ux, uy] = len > 1e-6 ? [dirX / len, dirY / len] : [1, 0];
      const dx = run.baselineStart[0] - prev.baselineEnd[0];
      const dy = run.baselineStart[1] - prev.baselineEnd[1];
      const along = dx * ux + dy * uy;
      const across = -dx * uy + dy * ux;
      const em = Math.max(prev.emSize, run.emSize, 1e-6);
      if (Math.abs(across) > em * 0.5) {
        text = text.replace(/[ ]+$/, '') + '\n';
      } else if (along > em * 0.15 && !text.endsWith(' ') && !run.text.startsWith(' ')) {
        text += ' ';
      }
    }
    text += run.text;
  });
  return text.trim();
}

export function buildPageTextModel(input: PageTextModelInput): PageTextModel {
  const { streamText, layout } = input;
  const empty = (reason: string): PageTextModel => ({
    aligned: false,
    reason,
    streamText,
    runs: [],
    blocks: [],
    blocksById: new Map(),
    fontCodeMaps: new Map(),
  });

  const mine = collectStreamEvents(streamText, layout);
  const theirs = collectOperatorListEvents(input);

  // Pair both event sequences. Forms pdf.js paints that the stream walk does not know (nested
  // forms) are skipped as a whole; any other disagreement means the model cannot be trusted.
  const runs: TextRun[] = [];
  let i = 0;
  for (let j = 0; j < theirs.length; j++) {
    const event = theirs[j];
    if (event.kind === 'formStart') {
      if (mine[i]?.kind === 'formStart') {
        i++;
        continue;
      }
      let depth = 1;
      while (depth > 0 && j + 1 < theirs.length) {
        j++;
        if (theirs[j].kind === 'formStart') depth++;
        if (theirs[j].kind === 'formEnd') depth--;
      }
      continue;
    }
    if (event.kind === 'formEnd') {
      if (mine[i]?.kind !== 'formEnd') return empty(`form end mismatch at ${j}`);
      i++;
      continue;
    }
    const streamEvent = mine[i];
    if (streamEvent?.kind !== 'text') return empty(`text operator mismatch at ${j}`);
    i++;
    const { run } = event;
    runs.push({
      ...run,
      start: streamEvent.op.start,
      end: streamEvent.op.end,
      operator: streamEvent.op.operator,
      partIndex: streamEvent.partIndex,
      fontResource: streamEvent.fontResource,
      codeBytes: detectCodeBytes(streamEvent.op, run.glyphs),
    });
  }
  if (i !== mine.length) return empty(`${mine.length - i} stream operators without pdf.js counterpart`);

  const fontCodeMaps = new Map<string, FontCodeMap>();
  for (const run of runs) {
    if (!run.codeBytes) continue;
    let map = fontCodeMaps.get(run.fontKey);
    if (!map) {
      map = { codeBytes: run.codeBytes, codes: new Map() };
      fontCodeMaps.set(run.fontKey, map);
    }
    if (map.codeBytes !== run.codeBytes) continue;
    for (const glyph of run.glyphs) {
      if (glyph.unicode && !map.codes.has(glyph.unicode)) map.codes.set(glyph.unicode, glyph.code);
    }
  }

  const blocks: TextBlock[] = [];
  const blocksById = new Map<string, TextBlock>();
  const segments = parseStreamSegments(streamText).filter((s) => s.type === 'text');
  let runIdx = 0;
  const sortedRuns = [...runs].sort((a, b) => a.start - b.start);
  for (const segment of segments) {
    const blockRuns: TextRun[] = [];
    while (runIdx < sortedRuns.length && sortedRuns[runIdx].start < segment.startIndex) runIdx++;
    let k = runIdx;
    while (k < sortedRuns.length && sortedRuns[k].start < segment.endIndex) {
      blockRuns.push(sortedRuns[k]);
      k++;
    }
    if (blockRuns.length === 0) continue;
    // A form painted twice yields the same operators twice; keep the first occurrence
    const uniqueRuns = blockRuns.filter((run, idx) => idx === 0 || run.start !== blockRuns[idx - 1].start);
    const block: TextBlock = {
      segmentId: segment.id,
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      runs: uniqueRuns,
      text: blockText(uniqueRuns),
      bbox: unionBox(uniqueRuns.map((r) => r.bbox)),
    };
    blocks.push(block);
    blocksById.set(block.segmentId, block);
  }

  return { aligned: true, streamText, runs, blocks, blocksById, fontCodeMaps };
}

/**
 * Groups consecutive text objects that continue each other on the same line (e.g. a list number
 * and its text written as separate text objects). Text objects in other columns stay separate.
 */
export function groupAdjacentBlocks(blocks: TextBlock[]): TextBlock[][] {
  const groups: TextBlock[][] = [];
  for (const block of blocks) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1].runs[group[group.length - 1].runs.length - 1];
    const next = block.runs[0];
    if (group && prev && next) {
      const dirX = prev.baselineEnd[0] - prev.baselineStart[0];
      const dirY = prev.baselineEnd[1] - prev.baselineStart[1];
      const len = Math.hypot(dirX, dirY);
      const [ux, uy] = len > 1e-6 ? [dirX / len, dirY / len] : [1, 0];
      const dx = next.baselineStart[0] - prev.baselineEnd[0];
      const dy = next.baselineStart[1] - prev.baselineEnd[1];
      const along = dx * ux + dy * uy;
      const across = -dx * uy + dy * ux;
      const em = Math.max(prev.emSize, next.emSize, 1e-6);
      if (Math.abs(across) < em * 0.3 && along > -em * 0.5 && along < em * 1.5) {
        group.push(block);
        continue;
      }
    }
    groups.push([block]);
  }
  return groups;
}

/**
 * Leading between the first two lines of a text object, in the text space of its first run,
 * or null when it has a single line.
 */
export function measureLineLeading(block: TextBlock): number | null {
  const first = block.runs[0];
  const inverse = invert(first.textMatrix);
  if (!inverse) return null;
  for (const run of block.runs.slice(1)) {
    const [, dy] = apply(inverse, run.textMatrix[4], run.textMatrix[5]);
    if (Math.abs(dy) > Math.abs(first.fontSize) * 0.5) {
      return dy < 0 ? -dy : null;
    }
  }
  return null;
}
