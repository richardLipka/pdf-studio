/**
 * Tokenizer for PDF content streams (ISO 32000-1, 7.8.2).
 *
 * Content streams are sequences of operands followed by an operator. Unlike regular expressions over
 * the raw text, the tokenizer knows where strings, arrays, dictionaries, comments and inline images
 * begin and end, so text such as "(BUDGET) Tj" is never mistaken for an ET operator.
 * Offsets refer to positions in the (latin1-decoded) stream text.
 */

export type OperandType = 'number' | 'name' | 'string' | 'hexstring' | 'array' | 'dict' | 'keyword';

export interface Operand {
  type: OperandType;
  raw: string;
  start: number;
  end: number;
}

export interface ContentOperation {
  operator: string;
  operands: Operand[];
  /** Start of the first operand (or of the operator when it has none) */
  start: number;
  /** Position right after the operator keyword */
  end: number;
  operatorStart: number;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

const isWhitespace = (ch: string) => WHITESPACE.has(ch.charCodeAt(0));
const isRegular = (ch: string) => !isWhitespace(ch) && !DELIMITERS.has(ch);

// Operand keywords that are values, not operators
const VALUE_KEYWORDS = new Set(['true', 'false', 'null']);

/** Index right after the literal string starting at `start` (which must be "(") */
const skipLiteralString = (text: string, start: number, end: number): number => {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return end;
};

const skipHexString = (text: string, start: number, end: number): number => {
  const close = text.indexOf('>', start + 1);
  return close === -1 || close >= end ? end : close + 1;
};

const skipDict = (text: string, start: number, end: number): number => {
  let depth = 0;
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === '(') {
      i = skipLiteralString(text, i, end);
      continue;
    }
    if (ch === '<' && text[i + 1] === '<') {
      depth++;
      i += 2;
      continue;
    }
    if (ch === '>' && text[i + 1] === '>') {
      depth--;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    if (ch === '<') {
      i = skipHexString(text, i, end);
      continue;
    }
    i++;
  }
  return end;
};

const skipArray = (text: string, start: number, end: number): number => {
  let depth = 0;
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === '(') {
      i = skipLiteralString(text, i, end);
      continue;
    }
    if (ch === '<' && text[i + 1] === '<') {
      i = skipDict(text, i, end);
      continue;
    }
    if (ch === '<') {
      i = skipHexString(text, i, end);
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return end;
};

/** Position right after the "EI" that ends inline image data starting at `dataStart` */
const skipInlineImageData = (text: string, dataStart: number, end: number): number => {
  let i = dataStart;
  while (i < end) {
    const found = text.indexOf('EI', i);
    if (found === -1 || found + 2 > end) return end;
    const before = found === 0 ? ' ' : text[found - 1];
    const after = found + 2 >= text.length ? ' ' : text[found + 2];
    if (isWhitespace(before) && (isWhitespace(after) || DELIMITERS.has(after))) {
      return found + 2;
    }
    i = found + 2;
  }
  return end;
};

/**
 * Splits content stream text (or the range [start, end) of it) into operations.
 */
export function tokenizeContentStream(text: string, start = 0, end = text.length): ContentOperation[] {
  const operations: ContentOperation[] = [];
  let operands: Operand[] = [];
  let i = start;

  while (i < end) {
    const ch = text[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    if (ch === '%') {
      while (i < end && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }

    let tokenEnd: number;
    let type: OperandType | null = null;

    if (ch === '(') {
      tokenEnd = skipLiteralString(text, i, end);
      type = 'string';
    } else if (ch === '<' && text[i + 1] === '<') {
      tokenEnd = skipDict(text, i, end);
      type = 'dict';
    } else if (ch === '<') {
      tokenEnd = skipHexString(text, i, end);
      type = 'hexstring';
    } else if (ch === '[') {
      tokenEnd = skipArray(text, i, end);
      type = 'array';
    } else if (ch === '/') {
      tokenEnd = i + 1;
      while (tokenEnd < end && isRegular(text[tokenEnd])) tokenEnd++;
      type = 'name';
    } else if (DELIMITERS.has(ch)) {
      // Stray delimiter (")", "]", ">", "{", "}"): skip it
      i++;
      continue;
    } else {
      tokenEnd = i + 1;
      while (tokenEnd < end && isRegular(text[tokenEnd])) tokenEnd++;
      const word = text.substring(i, tokenEnd);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        type = 'number';
      } else if (VALUE_KEYWORDS.has(word)) {
        type = 'keyword';
      } else {
        // Operator
        let opEnd = tokenEnd;
        if (word === 'ID') {
          // Inline image data: a single whitespace byte follows ID, then binary data up to EI
          opEnd = skipInlineImageData(text, tokenEnd + 1, end);
        }
        operations.push({
          operator: word,
          operands,
          start: operands.length > 0 ? operands[0].start : i,
          end: opEnd,
          operatorStart: i,
        });
        operands = [];
        i = opEnd;
        continue;
      }
    }

    operands.push({ type, raw: text.substring(i, tokenEnd), start: i, end: tokenEnd });
    i = tokenEnd;
  }

  return operations;
}

const ESCAPES: Record<string, number> = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c, '(': 0x28, ')': 0x29, '\\': 0x5c };

/** Raw bytes of a literal string operand "(…)" */
export function decodeLiteralStringBytes(raw: string): number[] {
  const bytes: number[] = [];
  const inner = raw.startsWith('(') ? raw.substring(1, raw.endsWith(')') ? raw.length - 1 : raw.length) : raw;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      bytes.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) break;
    if (next in ESCAPES) {
      bytes.push(ESCAPES[next]);
      i++;
    } else if (next >= '0' && next <= '7') {
      let digits = '';
      while (digits.length < 3 && inner[i + 1] >= '0' && inner[i + 1] <= '7') {
        digits += inner[i + 1];
        i++;
      }
      bytes.push(parseInt(digits, 8) & 0xff);
    } else if (next === '\r' || next === '\n') {
      // Line continuation
      i++;
      if (next === '\r' && inner[i + 1] === '\n') i++;
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
      i++;
    }
  }
  return bytes;
}

/** Raw bytes of a hex string operand "<…>" */
export function decodeHexStringBytes(raw: string): number[] {
  let hex = raw.replace(/[<>\s]/g, '');
  if (hex.length % 2 === 1) hex += '0';
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const value = parseInt(hex.substring(i, i + 2), 16);
    bytes.push(Number.isNaN(value) ? 0 : value);
  }
  return bytes;
}

export function decodeStringOperandBytes(operand: Operand): number[] {
  return operand.type === 'hexstring' ? decodeHexStringBytes(operand.raw) : decodeLiteralStringBytes(operand.raw);
}

/** Items of a TJ array: byte strings and numeric position adjustments */
export function decodeTextArray(raw: string): Array<number[] | number> {
  const inner = raw.substring(1, raw.endsWith(']') ? raw.length - 1 : raw.length);
  const items: Array<number[] | number> = [];
  const tokens = tokenizeContentStream(`${inner} TJ`);
  const operands = tokens.length > 0 ? tokens[tokens.length - 1].operands : [];
  for (const operand of operands) {
    if (operand.type === 'string' || operand.type === 'hexstring') {
      items.push(decodeStringOperandBytes(operand));
    } else if (operand.type === 'number') {
      items.push(parseFloat(operand.raw));
    }
  }
  return items;
}

/** Byte strings shown by a text-showing operation (Tj, TJ, ', ") */
export function textOperationStrings(op: ContentOperation): number[][] {
  if (op.operator === 'TJ') {
    const array = op.operands.find((o) => o.type === 'array');
    return array ? (decodeTextArray(array.raw).filter((item) => Array.isArray(item)) as number[][]) : [];
  }
  const str = [...op.operands].reverse().find((o) => o.type === 'string' || o.type === 'hexstring');
  return str ? [decodeStringOperandBytes(str)] : [];
}

export const TEXT_SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);
