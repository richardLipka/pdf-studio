import { decodeHexStringBytes, decodeLiteralStringBytes, TEXT_SHOW_OPERATORS, tokenizeContentStream } from './pdfContentTokenizer';
import { PageTextModel, TextBlock, TextRun } from './pdfTextModel';

/**
 * Human-readable form of a text object's code: every string operand of Tj / TJ / ' / " whose
 * glyphs are known is shown as «decoded text», whatever the font encoding (hex glyph ids of
 * CID fonts, re-encoded simple fonts...). Kerning numbers and all other operators stay as they are.
 *
 * Converting back re-encodes only the strings that were changed, with the codes of the font
 * selected at that point; untouched strings keep their original bytes.
 */

export interface ReadableBlock {
  text: string;
  /** Decoded text and original operand of every «...» occurrence, in order */
  originals: { text: string; raw: string }[];
}

const OPEN = '«';
const CLOSE = '»';

/** Glyph codes of one string operand */
const operandCodes = (raw: string, codeBytes: 1 | 2): number[] | null => {
  const bytes = raw.startsWith('<') ? decodeHexStringBytes(raw) : decodeLiteralStringBytes(raw);
  if (!bytes || bytes.length % codeBytes !== 0) return null;
  const codes: number[] = [];
  for (let i = 0; i < bytes.length; i += codeBytes) {
    codes.push(codeBytes === 1 ? bytes[i] : (bytes[i] << 8) | bytes[i + 1]);
  }
  return codes;
};

export function toReadableBlock(model: PageTextModel, block: TextBlock): ReadableBlock {
  const stream = model.streamText;
  const runsByStart = new Map<number, TextRun>(block.runs.map((r) => [r.start, r]));
  const originals: ReadableBlock['originals'] = [];
  const replacements: { start: number; end: number; text: string }[] = [];

  for (const op of tokenizeContentStream(stream, block.startIndex, block.endIndex)) {
    if (!TEXT_SHOW_OPERATORS.has(op.operator)) continue;
    const run = runsByStart.get(op.start);
    if (!run || !run.codeBytes) continue;
    const last = op.operands[op.operands.length - 1];
    if (!last) continue;
    // String operands of the operator with their absolute positions
    const strings: { start: number; end: number; raw: string }[] = [];
    if (last.type === 'array') {
      // Array elements are operands of no operator: tokenize them with a trailing pseudo-operator
      const offset = last.start + 1;
      const inner = tokenizeContentStream(`${stream.substring(offset, last.end - 1)} X`);
      (inner[inner.length - 1]?.operands ?? []).forEach((o) => {
        if (o.type === 'string' || o.type === 'hexstring') strings.push({ start: o.start + offset, end: o.end + offset, raw: o.raw });
      });
    } else if (last.type === 'string' || last.type === 'hexstring') {
      strings.push({ start: last.start, end: last.end, raw: last.raw });
    }
    let glyphIdx = 0;
    const pending: typeof replacements = [];
    let ok = true;
    for (const str of strings) {
      const codes = operandCodes(str.raw, run.codeBytes);
      if (!codes) {
        ok = false;
        break;
      }
      const glyphs = run.glyphs.slice(glyphIdx, glyphIdx + codes.length);
      glyphIdx += codes.length;
      const decodable =
        glyphs.length === codes.length &&
        glyphs.every((g, i) => g.code === codes[i] && g.unicode && !g.unicode.includes(OPEN) && !g.unicode.includes(CLOSE));
      if (!decodable) continue; // leave this operand as raw code
      pending.push({ start: str.start, end: str.end, text: glyphs.map((g) => g.unicode).join('') });
    }
    if (!ok || glyphIdx !== run.glyphs.length) continue;
    pending.forEach((rep) => {
      replacements.push(rep);
      originals.push({ text: rep.text, raw: stream.substring(rep.start, rep.end) });
    });
  }

  let text = '';
  let cursor = block.startIndex;
  for (const rep of replacements) {
    text += stream.substring(cursor, rep.start) + OPEN + rep.text + CLOSE;
    cursor = rep.end;
  }
  text += stream.substring(cursor, block.endIndex);
  return { text, originals };
}

const toHex = (codes: number[], codeBytes: 1 | 2) =>
  `<${codes.map((c) => c.toString(16).padStart(codeBytes * 2, '0')).join('').toUpperCase()}>`;

/** Converts readable code back to PDF operators, or explains which characters cannot be written */
export function fromReadableBlock(
  model: PageTextModel,
  block: TextBlock,
  readable: ReadableBlock,
  edited: string
): { raw: string } | { error: string } {
  // Font resource names of this stream part -> code maps
  const part = block.runs[0]?.partIndex;
  const mapByResource = new Map<string, string>();
  model.runs.forEach((run) => {
    if (run.partIndex === part && run.fontResource && !mapByResource.has(run.fontResource)) {
      mapByResource.set(run.fontResource, run.fontKey);
    }
  });
  let currentFont = block.runs[0]?.fontResource ?? null;
  const tfPattern = /\/([^\s/<>[\]()%{}]+)\s+[-+.\d]+\s+Tf\b/g;

  let out = '';
  let cursor = 0;
  let occurrence = 0;
  const pattern = new RegExp(`${OPEN}([^${OPEN}${CLOSE}]*)${CLOSE}`, 'g');
  for (const match of edited.matchAll(pattern)) {
    const before = edited.substring(cursor, match.index);
    for (const tf of before.matchAll(tfPattern)) currentFont = tf[1];
    out += before;
    cursor = match.index! + match[0].length;
    const text = match[1];
    const original = readable.originals[occurrence++];
    if (original && original.text === text) {
      out += original.raw;
      continue;
    }
    const fontKey = currentFont ? mapByResource.get(currentFont) : undefined;
    const map = fontKey ? model.fontCodeMaps.get(fontKey) : undefined;
    if (!map) return { error: `Písmo /${currentFont ?? '?'} nelze pro text „${text}“ zakódovat.` };
    const codes: number[] = [];
    const missing = new Set<string>();
    for (const ch of Array.from(text)) {
      const code = map.codes.get(ch);
      if (code === undefined) missing.add(ch);
      else codes.push(code);
    }
    if (missing.size > 0) {
      return {
        error: `Písmo /${currentFont} neobsahuje znaky: ${[...missing].map((c) => (c === ' ' ? 'mezera' : c)).join(' ')}. Použijte „Upravit text bloku“ (doplní náhradní písmo).`,
      };
    }
    out += toHex(codes, map.codeBytes);
  }
  out += edited.substring(cursor);
  if (out.includes(OPEN) || out.includes(CLOSE)) return { error: 'Neuzavřený řetězec «…».' };
  return { raw: out };
}
