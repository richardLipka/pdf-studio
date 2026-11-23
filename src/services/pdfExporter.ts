import {
  PDFDocument,
  rgb,
  degrees,
  PDFPage,
  PDFName,
  PDFNull,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFImage,
  PDFDict,
  PDFRef,
  PDFObjectCopier,
  ParseSpeeds,
  PDFFont,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import {
  PdfPageModel,
  SourceDocument,
  RasterizationSettings,
  DEFAULT_RASTERIZATION_SETTINGS,
  DocumentMetadata,
  RESERVED_METADATA_KEYS,
} from '../types/document';
import {
  Annotation,
  DrawingAnnotation,
  HighlightAnnotation,
  NoteAnnotation,
  ShapeAnnotation,
  SignatureAnnotation,
  StrikethroughAnnotation,
  TextAnnotation,
  UnderlineAnnotation,
  WhiteoutAnnotation,
} from '../types/annotations';
import { renderPdfPageToDataUrl } from './pdfLoader';
import { safeGetPageResources } from './contentStreamEditor';
import { parseRichTextToLines, linesToPlainText } from '../utils/richText';
import { logger } from './logger';
import { FormExportMode } from '../types/form';
import { applyFormValuesToPdfDocument } from './formService';
import { PdfFontProvider, prepareTextForFont, standardFontFor, fontSupportsText } from './pdfFonts';
import { convertImageDataUrlToPng } from '../utils/file';
import { getMarkupLine, getTextQuad } from '../utils/markupGeometry';

type Matrix = [number, number, number, number, number, number];

const isIdentityMatrix = (m: Matrix): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

const transformPoint = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const transformRect = (m: Matrix, rect: [number, number, number, number]): [number, number, number, number] => {
  const [ax, ay] = transformPoint(m, rect[0], rect[1]);
  const [bx, by] = transformPoint(m, rect[2], rect[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
};

const transformCoordinateList = (m: Matrix, coords: number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    out.push(...transformPoint(m, coords[i], coords[i + 1]));
  }
  return out;
};

/**
 * Annotations are stored in the page as it is displayed (after /Rotate and cropping) with a
 * top-left origin. The exporter computes coordinates in that displayed space with the y axis
 * flipped upwards ("display space"); `matrix` maps display space into PDF user space.
 */
export interface PageDisplaySpace {
  displayWidth: number;
  displayHeight: number;
  matrix: Matrix;
}

export const getPageDisplaySpace = (page: PDFPage): PageDisplaySpace => {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  // Like pdf.js, show the intersection of CropBox and MediaBox (falling back to MediaBox)
  let llx = Math.max(media.x, crop.x);
  let lly = Math.max(media.y, crop.y);
  let urx = Math.min(media.x + media.width, crop.x + crop.width);
  let ury = Math.min(media.y + media.height, crop.y + crop.height);
  if (urx - llx <= 0 || ury - lly <= 0) {
    llx = media.x;
    lly = media.y;
    urx = media.x + media.width;
    ury = media.y + media.height;
  }
  const width = urx - llx;
  const height = ury - lly;

  switch (((page.getRotation().angle % 360) + 360) % 360) {
    case 90:
      return { displayWidth: height, displayHeight: width, matrix: [0, 1, -1, 0, urx, lly] };
    case 180:
      return { displayWidth: width, displayHeight: height, matrix: [-1, 0, 0, -1, urx, ury] };
    case 270:
      return { displayWidth: height, displayHeight: width, matrix: [0, -1, 1, 0, llx, ury] };
    default:
      return { displayWidth: width, displayHeight: height, matrix: [1, 0, 0, 1, llx, lly] };
  }
};

// Runs pdf-lib drawing calls with coordinates given in display space
const drawInDisplaySpace = (page: PDFPage, matrix: Matrix, draw: () => void) => {
  if (isIdentityMatrix(matrix)) {
    draw();
    return;
  }
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  draw();
  page.pushOperators(popGraphicsState());
};


/**
 * Safely repairs broken or indirect catalog /Pages pointers in third-party PDFs
 */
const repairPdfDocCatalog = (doc: PDFDocument, repairLog: string[] = []) => {
  try {
    const catalog = doc.catalog as any;
    let pagesObj: any;
    try {
      pagesObj = catalog?.dict ? catalog.dict.lookup(PDFName.of('Pages')) : null;
    } catch {
      pagesObj = null;
    }

    if (!pagesObj && catalog?.dict) {
      // Find the root page tree object (/Type /Pages with no /Parent)
      const indirectObjects = doc.context.enumerateIndirectObjects();
      let rootPageTreeRef: any = null;

      for (const [ref, obj] of indirectObjects) {
        if (
          obj instanceof PDFDict &&
          obj.lookup(PDFName.of('Type')) === PDFName.of('Pages') &&
          !obj.lookup(PDFName.of('Parent'))
        ) {
          rootPageTreeRef = ref;
          break;
        }
      }

      if (!rootPageTreeRef) {
        for (const [ref, obj] of indirectObjects) {
          if (obj instanceof PDFDict && obj.lookup(PDFName.of('Type')) === PDFName.of('Pages')) {
            rootPageTreeRef = ref;
            break;
          }
        }
      }

      if (rootPageTreeRef) {
        catalog.dict.set(PDFName.of('Pages'), rootPageTreeRef);
        repairLog.push('Opraven kořenový uzel /Pages v katalogu dokumentu.');
      } else {
        // Deep reconstruction: find all orphan /Type /Page objects and construct a new root /Pages
        const pageRefs: any[] = [];
        for (const [ref, obj] of indirectObjects) {
          if (obj instanceof PDFDict && obj.lookup(PDFName.of('Type')) === PDFName.of('Page')) {
            pageRefs.push(ref);
          }
        }
        if (pageRefs.length > 0) {
          const newPagesDict = doc.context.obj({
            Type: 'Pages',
            Kids: pageRefs,
            Count: pageRefs.length,
          });
          const newPagesRef = doc.context.register(newPagesDict);
          catalog.dict.set(PDFName.of('Pages'), newPagesRef);
          for (const pRef of pageRefs) {
            const pObj = doc.context.lookup(pRef);
            if (pObj instanceof PDFDict) {
              pObj.set(PDFName.of('Parent'), newPagesRef);
            }
          }
          repairLog.push(`Hloubkově rekonstruován strom /Pages z ${pageRefs.length} nalezených stran.`);
        }
      }
    }
  } catch (e: any) {
    repairLog.push(`Chyba při pokusu o opravu katalogu: ${e?.message || e}`);
    console.warn('Could not repair PDF catalog:', e);
  }
};

export interface LoadAttemptDiagnostic {
  attempt: number;
  options: Record<string, any>;
  success: boolean;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
}

export interface LoadSourceResult {
  doc: PDFDocument | null;
  attempts: LoadAttemptDiagnostic[];
  repairLog: string[];
}

/**
 * Extracts printable ASCII header (first 32 bytes) for diagnostics
 */
export const extractPdfHeader = (buffer: ArrayBuffer): string => {
  try {
    const bytes = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength));
    return Array.from(bytes)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
  } catch {
    return 'N/A';
  }
};

/**
 * Trims extraneous bytes before %PDF- header and after last %%EOF marker
 * which often prevents strict PDF parsers from loading scanner/comic PDFs
 */
export const sanitizePdfBuffer = (buffer: ArrayBuffer): ArrayBuffer => {
  try {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 10) return buffer;

    // 1. Find "%PDF-" header offset in first 4096 bytes
    let startOffset = 0;
    for (let i = 0; i < Math.min(u8.length - 5, 4096); i++) {
      if (
        u8[i] === 0x25 && // %
        u8[i + 1] === 0x50 && // P
        u8[i + 2] === 0x44 && // D
        u8[i + 3] === 0x46 && // F
        u8[i + 4] === 0x2d // -
      ) {
        startOffset = i;
        break;
      }
    }

    // 2. Find last "%%EOF" offset in last 16384 bytes
    let endOffset = u8.length;
    for (let i = u8.length - 5; i >= Math.max(0, u8.length - 16384); i--) {
      if (
        u8[i] === 0x25 && // %
        u8[i + 1] === 0x25 && // %
        u8[i + 2] === 0x45 && // E
        u8[i + 3] === 0x4f && // O
        u8[i + 4] === 0x46 // F
      ) {
        // Scan past possible whitespace / newlines after %%EOF
        let e = i + 5;
        while (e < u8.length && (u8[e] === 0x0a || u8[e] === 0x0d || u8[e] === 0x20 || u8[e] === 0x00)) {
          e++;
        }
        endOffset = e;
        break;
      }
    }

    if (startOffset > 0 || endOffset < u8.length) {
      return buffer.slice(startOffset, endOffset);
    }
    return buffer;
  } catch {
    return buffer;
  }
};

/**
 * Robustly loads a source PDF document with multi-stage fallback options, sanitized buffers, deep catalog repair,
 * and comprehensive diagnostic error tracking
 */
export const loadSourcePdfDocWithDiagnostics = async (
  arrayBuffer: ArrayBuffer
): Promise<LoadSourceResult> => {
  const sanitizedBuffer = sanitizePdfBuffer(arrayBuffer);
  const wasSanitized = sanitizedBuffer.byteLength !== arrayBuffer.byteLength;

  const rawAttempts: Array<{ name: string; buffer: ArrayBuffer; opt: Record<string, any> }> = [
    { name: 'Fast + NoThrow + CapNumbers', buffer: arrayBuffer, opt: { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, parseSpeed: ParseSpeeds.Fast, capNumbers: true } },
    { name: 'Fastest + NoThrow', buffer: arrayBuffer, opt: { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, parseSpeed: ParseSpeeds.Fastest } },
    { name: 'Fast + IgnoreEncryption', buffer: arrayBuffer, opt: { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fast } },
  ];

  if (wasSanitized) {
    rawAttempts.push(
      { name: 'Sanitized Buffer + Fast + NoThrow + CapNumbers', buffer: sanitizedBuffer, opt: { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, parseSpeed: ParseSpeeds.Fast, capNumbers: true } },
      { name: 'Sanitized Buffer + Fast + IgnoreEncryption', buffer: sanitizedBuffer, opt: { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fast } }
    );
  }

  rawAttempts.push({ name: 'Standard Default', buffer: arrayBuffer, opt: { parseSpeed: ParseSpeeds.Fast } });

  const diagnosticAttempts: LoadAttemptDiagnostic[] = [];
  const repairLog: string[] = [];

  if (wasSanitized) {
    repairLog.push(`Detekovány a oříznuty nadbytečné bajty v bufferu (${arrayBuffer.byteLength} B -> ${sanitizedBuffer.byteLength} B)`);
  }

  for (let i = 0; i < rawAttempts.length; i++) {
    const attempt = rawAttempts[i];
    try {
      // pdf-lib reads bytes without mutating or detaching the buffer: pass a zero-copy view
      const doc = await PDFDocument.load(new Uint8Array(attempt.buffer), attempt.opt);
      repairPdfDocCatalog(doc, repairLog);
      const count = doc.getPageCount();
      if (count > 0) {
        diagnosticAttempts.push({
          attempt: i + 1,
          options: { name: attempt.name, ...attempt.opt },
          success: true,
        });
        return { doc, attempts: diagnosticAttempts, repairLog };
      }
    } catch (err: any) {
      diagnosticAttempts.push({
        attempt: i + 1,
        options: { name: attempt.name, ...attempt.opt },
        success: false,
        errorName: err?.name || 'Error',
        errorMessage: err?.message || String(err),
        errorStack: err?.stack,
      });
    }
  }

  return { doc: null, attempts: diagnosticAttempts, repairLog };
};

export const loadSourcePdfDoc = async (arrayBuffer: ArrayBuffer): Promise<PDFDocument | null> => {
  const res = await loadSourcePdfDocWithDiagnostics(arrayBuffer);
  return res.doc;
};

/**
 * Converts Hex / RGB string to pdf-lib rgb values (0..1)
 */
export const hexToPdfRgb = (color: string) => {
  let hex = color.replace('#', '');
  if (hex.startsWith('rgb')) {
    const match = color.match(/\d+/g);
    if (match && match.length >= 3) {
      return rgb(
        parseInt(match[0], 10) / 255,
        parseInt(match[1], 10) / 255,
        parseInt(match[2], 10) / 255
      );
    }
  }

  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }

  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;

  return rgb(r / 255, g / 255, b / 255);
};

interface NativePdfAnnotOptions {
  id?: string;
  subtype:
  | 'Text'
  | 'Highlight'
  | 'Underline'
  | 'StrikeOut'
  | 'FreeText'
  | 'Ink'
  | 'Square'
  | 'Circle'
  | 'Line';
  rect: [number, number, number, number];
  quadPoints?: number[];
  inkList?: number[][];
  lineCoordinates?: [number, number, number, number];
  contents?: string;
  author?: string;
  colorRgb?: { red: number; green: number; blue: number };
  interiorColorRgb?: { red: number; green: number; blue: number };
  opacity?: number;
  strokeWidth?: number;
  fontSize?: number;
  richTextXml?: string;
  customStreamOperators?: string;
  customResources?: Record<string, any>;
  borderWidth?: number;
  // Maps the display-space geometry above (and the appearance stream content) into user space
  matrix?: Matrix;
  // Underline / StrikeOut: the line to draw [x1, y1, x2, y2] in display space (y up)
  markupLine?: [number, number, number, number];
  // Highlight: optional list of sub-rectangles [x1, y1, x2, y2] in display space (y up)
  highlightRects?: Array<[number, number, number, number]>;
}

/**
 * Embeds standard ISO 32000-1 PDF annotations in target page Annots array
 */
const addNativePdfAnnotation = (
  pdfDoc: PDFDocument,
  targetPage: PDFPage,
  options: NativePdfAnnotOptions
) => {
  try {
    const context = pdfDoc.context;
    const {
      id,
      subtype,
      rect,
      quadPoints,
      inkList,
      lineCoordinates,
      contents = '',
      author = '',
      colorRgb,
      interiorColorRgb,
      opacity = 1.0,
      strokeWidth = 2,
    } = options;

    const [x1, y1, x2, y2] = rect;
    const r = colorRgb ? colorRgb.red : 1;
    const g = colorRgb ? colorRgb.green : 0.8;
    const b = colorRgb ? colorRgb.blue : 0.2;

    const annotDictProps: Record<string, any> = {
      Type: 'Annot',
      Subtype: subtype,
      Rect: rect,
      C: [r, g, b],
      F: 4, // Print flag
      CreationDate: PDFString.fromDate(new Date()),
      M: PDFString.fromDate(new Date()),
    };

    if (id) {
      annotDictProps.NM = PDFHexString.fromText(id);
    }
    if (contents && contents.trim()) {
      annotDictProps.Contents = PDFHexString.fromText(contents);
    }
    if (author && author.trim()) {
      annotDictProps.T = PDFHexString.fromText(author);
    }

    let streamOperators = '';
    // ISO 32000-1 §§ 11.3.5, 12.5.5: when /AP /N is present, viewers ignore /CA and render the
    // appearance stream directly, so transparency & highlight Multiply blending must live in /ExtGState.
    let apExtGState: Record<string, any> | null = null;
    const makeGs = (alpha: number, blendMode?: string): string => {
      const clamped = Math.max(0.01, Math.min(1, alpha));
      const gsDict: Record<string, any> = { Type: 'ExtGState', ca: clamped, CA: clamped };
      if (blendMode) gsDict.BM = blendMode;
      apExtGState = { GS0: gsDict };
      return '/GS0 gs ';
    };

    if (subtype === 'Highlight') {
      const effOpacity = opacity ?? 0.4;
      annotDictProps.CA = effOpacity;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
      const gsOp = makeGs(effOpacity, 'Multiply');
      const drawRects =
        options.highlightRects && options.highlightRects.length > 0 ? options.highlightRects : [rect];
      const rectOps = drawRects
        .map(([rx1, ry1, rx2, ry2]) => {
          const rw = Math.max(0.1, rx2 - rx1);
          const rh = Math.max(0.1, ry2 - ry1);
          return `${rx1.toFixed(2)} ${ry1.toFixed(2)} ${rw.toFixed(2)} ${rh.toFixed(2)} re f`;
        })
        .join(' ');
      streamOperators = `q ${gsOp}${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${rectOps} Q`;
    } else if (subtype === 'Underline' || subtype === 'StrikeOut') {
      const effOpacity = opacity ?? 0.9;
      annotDictProps.CA = effOpacity;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      // markupLine carries the exact (possibly vertical) line; otherwise derive a horizontal one from rect
      const defaultY = subtype === 'Underline' ? y1 + (strokeWidth || 2) / 2 : (y1 + y2) / 2;
      const [lx1, ly1, lx2, ly2] = options.markupLine ?? [x1, defaultY, x2, defaultY];
      const gsOp = effOpacity < 0.999 ? makeGs(effOpacity) : '';
      streamOperators = `q ${gsOp}${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j ${lx1.toFixed(2)} ${ly1.toFixed(2)} m ${lx2.toFixed(2)} ${ly2.toFixed(2)} l S Q`;
    } else if (subtype === 'Text') {
      annotDictProps.Name = 'Comment';
    } else if (subtype === 'FreeText') {
      const fs = options.fontSize || 14;
      annotDictProps.DA = PDFString.of(`/Helv ${fs} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
      // ISO 32000-1 Table 164 / 174: /C on FreeText is the background color ([] = transparent); text color is in /DA
      annotDictProps.C = interiorColorRgb
        ? [interiorColorRgb.red, interiorColorRgb.green, interiorColorRgb.blue]
        : [];
      if (options.richTextXml) {
        annotDictProps.RC = PDFHexString.fromText(options.richTextXml);
      }
      if (interiorColorRgb) {
        annotDictProps.IC = [interiorColorRgb.red, interiorColorRgb.green, interiorColorRgb.blue];
      }
      if (options.borderWidth && options.borderWidth > 0) {
        annotDictProps.BS = context.obj({ Type: 'Border', W: options.borderWidth });
        annotDictProps.Border = [0, 0, options.borderWidth];
      } else {
        // Explicit zero-width border prevents readers from applying ISO default [0 0 1]
        annotDictProps.BS = context.obj({ Type: 'Border', W: 0 });
        annotDictProps.Border = [0, 0, 0];
      }
      if (options.customStreamOperators) {
        streamOperators = options.customStreamOperators;
      }
    } else if (subtype === 'Ink' && inkList) {
      const effOpacity = opacity ?? 1.0;
      if (effOpacity < 0.999) {
        annotDictProps.CA = effOpacity;
      }
      annotDictProps.InkList = inkList;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];

      const gsOp = effOpacity < 0.999 ? makeGs(effOpacity) : '';
      let inkOps = `q ${gsOp}${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j `;
      for (const path of inkList) {
        if (path.length >= 2) {
          inkOps += `${path[0].toFixed(2)} ${path[1].toFixed(2)} m `;
          for (let k = 2; k < path.length; k += 2) {
            inkOps += `${path[k].toFixed(2)} ${path[k + 1].toFixed(2)} l `;
          }
          inkOps += 'S ';
        }
      }
      inkOps += 'Q';
      streamOperators = inkOps;
    } else if (subtype === 'Square' || subtype === 'Circle') {
      const effOpacity = opacity ?? 1.0;
      annotDictProps.CA = effOpacity;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      if (interiorColorRgb) {
        annotDictProps.IC = [interiorColorRgb.red, interiorColorRgb.green, interiorColorRgb.blue];
      }
      const w = Math.max(0.1, x2 - x1);
      const h = Math.max(0.1, y2 - y1);
      const halfW = strokeWidth / 2;
      const rx = (x1 + halfW).toFixed(2);
      const ry = (y1 + halfW).toFixed(2);
      const rw = Math.max(0.1, w - strokeWidth).toFixed(2);
      const rh = Math.max(0.1, h - strokeWidth).toFixed(2);

      const gsOp = effOpacity < 0.999 ? makeGs(effOpacity) : '';
      let shapeOps = `q ${gsOp}${strokeWidth} w 1 J 1 j ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG `;
      if (interiorColorRgb) {
        shapeOps += `${interiorColorRgb.red.toFixed(3)} ${interiorColorRgb.green.toFixed(3)} ${interiorColorRgb.blue.toFixed(3)} rg `;
      }
      if (subtype === 'Square') {
        shapeOps += `${rx} ${ry} ${rw} ${rh} re ${interiorColorRgb ? 'B' : 'S'} Q`;
      } else {
        const radX = Math.max(0.1, w / 2 - halfW);
        const radY = Math.max(0.1, h / 2 - halfW);
        const k = 0.5522847498;
        const ox = radX * k;
        const oy = radY * k;
        const cxN = x1 + w / 2;
        const cyN = y1 + h / 2;
        shapeOps += `${(cxN - radX).toFixed(2)} ${cyN.toFixed(2)} m `;
        shapeOps += `${(cxN - radX).toFixed(2)} ${(cyN + oy).toFixed(2)} ${(cxN - ox).toFixed(2)} ${(cyN + radY).toFixed(2)} ${cxN.toFixed(2)} ${(cyN + radY).toFixed(2)} c `;
        shapeOps += `${(cxN + ox).toFixed(2)} ${(cyN + radY).toFixed(2)} ${(cxN + radX).toFixed(2)} ${(cyN + oy).toFixed(2)} ${(cxN + radX).toFixed(2)} ${cyN.toFixed(2)} c `;
        shapeOps += `${(cxN + radX).toFixed(2)} ${(cyN - oy).toFixed(2)} ${(cxN + ox).toFixed(2)} ${(cyN - radY).toFixed(2)} ${cxN.toFixed(2)} ${(cyN - radY).toFixed(2)} c `;
        shapeOps += `${(cxN - ox).toFixed(2)} ${(cyN - radY).toFixed(2)} ${(cxN - radX).toFixed(2)} ${(cyN - oy).toFixed(2)} ${(cxN - radX).toFixed(2)} ${cyN.toFixed(2)} c `;
        shapeOps += `h ${interiorColorRgb ? 'B' : 'S'} Q`;
      }
      streamOperators = shapeOps;
    } else if (subtype === 'Line' && lineCoordinates) {
      const effOpacity = opacity ?? 1.0;
      annotDictProps.CA = effOpacity;
      annotDictProps.L = lineCoordinates;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      const [lx1, ly1, lx2, ly2] = lineCoordinates;
      const gsOp = effOpacity < 0.999 ? makeGs(effOpacity) : '';
      streamOperators = `q ${gsOp}${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j ${lx1.toFixed(2)} ${ly1.toFixed(2)} m ${lx2.toFixed(2)} ${ly2.toFixed(2)} l S Q`;
    }

    // Geometry above is in display space; map it into user space for rotated / offset pages.
    // The appearance stream keeps display-space content and gets the same /Matrix, so its
    // transformed BBox coincides exactly with /Rect and viewers draw it without rescaling.
    const matrix = options.matrix && !isIdentityMatrix(options.matrix) ? options.matrix : undefined;
    if (matrix) {
      annotDictProps.Rect = transformRect(matrix, rect);
      if (annotDictProps.QuadPoints) {
        annotDictProps.QuadPoints = transformCoordinateList(matrix, annotDictProps.QuadPoints);
      }
      if (annotDictProps.InkList) {
        annotDictProps.InkList = (annotDictProps.InkList as number[][]).map((path) => transformCoordinateList(matrix, path));
      }
      if (annotDictProps.L) {
        annotDictProps.L = transformCoordinateList(matrix, annotDictProps.L);
      }
    }

    // Attach Appearance Stream (/AP << /N streamRef >>) for universal ISO 32000-1 viewer rendering
    if (streamOperators) {
      const resources: Record<string, any> = options.customResources
        ? { ...options.customResources }
        : { ProcSet: ['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI'] };
      if (apExtGState) {
        resources.ExtGState = apExtGState;
      }
      const apFormDict: Record<string, any> = {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: rect,
        Resources: resources,
      };
      if (matrix) {
        apFormDict.Matrix = matrix;
      }
      const apStream = context.flateStream(streamOperators, apFormDict);
      const apStreamRef = context.register(apStream);
      annotDictProps.AP = context.obj({
        N: apStreamRef,
      });
    }

    const annotDict = context.obj(annotDictProps);
    const annotRef = context.register(annotDict);

    // Get or create Annots array on page node (resolve indirect /Annots per ISO 32000-1 Table 30)
    const annotsName = PDFName.of('Annots');
    const existingAnnotsRaw = targetPage.node.get(annotsName);
    const existingAnnots = existingAnnotsRaw ? context.lookup(existingAnnotsRaw) : undefined;
    if (existingAnnots instanceof PDFArray) {
      existingAnnots.push(annotRef);
    } else {
      const newAnnots = context.obj([annotRef]);
      targetPage.node.set(annotsName, newAnnots);
    }
  } catch (err) {
    console.warn('Failed to embed native PDF annotation:', err);
  }
};

// Annotation subtypes that extractPdfAnnotations imports as editable PilsenPDF annotations. The
// exporter drops these from copied pages and writes the (possibly edited or deleted) versions from
// the editor state instead; every other subtype (Link, Widget, Stamp, FileAttachment...) is preserved.
const EDITOR_MANAGED_SUBTYPES = new Set([
  'Text', 'Highlight', 'Underline', 'StrikeOut', 'FreeText', 'Ink', 'Square', 'Circle', 'Line',
]);

const nameOf = (value: unknown): string =>
  value instanceof PDFName ? value.asString().replace(/^\//, '') : '';

/**
 * Removes pre-existing annotations that the editor manages (see EDITOR_MANAGED_SUBTYPES) together
 * with the Popup annotations attached to them, keeping all structural annotations intact.
 */
const removeEditorManagedAnnotations = (page: PDFPage) => {
  const context = page.node.context;
  const existingAnnots = context.lookup(page.node.get(PDFName.of('Annots')));
  if (!(existingAnnots instanceof PDFArray)) return;

  const entries = existingAnnots.asArray().map((ref) => ({ ref, dict: context.lookup(ref) }));
  const removedRefs = new Set<string>();
  for (const { ref, dict } of entries) {
    if (dict instanceof PDFDict && EDITOR_MANAGED_SUBTYPES.has(nameOf(dict.lookup(PDFName.of('Subtype'))))) {
      removedRefs.add(ref.toString());
    }
  }

  // Leave untouched pages' /Annots array intact when nothing needs filtering
  if (removedRefs.size === 0) return;

  const preservedAnnots = context.obj([]);
  for (const { ref, dict } of entries) {
    if (!(dict instanceof PDFDict) || removedRefs.has(ref.toString())) continue;
    if (nameOf(dict.lookup(PDFName.of('Subtype'))) === 'Popup') {
      const parent = dict.get(PDFName.of('Parent'));
      if (parent && removedRefs.has(parent.toString())) continue;
    }
    preservedAnnots.push(ref);
  }

  if (preservedAnnots.size() > 0) {
    page.node.set(PDFName.of('Annots'), preservedAnnots);
  } else {
    page.node.delete(PDFName.of('Annots'));
  }
};

export interface WrappedPiece {
  text: string;
  font: PDFFont;
  width: number;
}

const measureText = (font: PDFFont, text: string, size: number): number => {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.55;
  }
};

/**
 * Word-wraps styled runs (one paragraph) into lines no wider than maxWidth, like the editor's
 * text boxes do. Words longer than a line are split; wrapped lines do not start with spaces.
 */
export function wrapStyledRuns(
  runs: { text: string; font: PDFFont }[],
  fontSize: number,
  maxWidth: number
): WrappedPiece[][] {
  const lines: WrappedPiece[][] = [];
  let current: WrappedPiece[] = [];
  let width = 0;
  let wrapped = false;
  const push = (text: string, font: PDFFont, pieceWidth: number) => {
    const last = current[current.length - 1];
    if (last && last.font === font) {
      last.text += text;
      last.width += pieceWidth;
    } else {
      current.push({ text, font, width: pieceWidth });
    }
    width += pieceWidth;
  };
  const trimTrailingSpace = () => {
    const last = current[current.length - 1];
    if (!last) return;
    const trimmed = last.text.replace(/\s+$/, '');
    if (trimmed === last.text) return;
    if (trimmed) {
      last.text = trimmed;
      last.width = measureText(last.font, trimmed, fontSize);
    } else {
      current.pop();
    }
  };
  const breakLine = () => {
    trimTrailingSpace();
    lines.push(current);
    current = [];
    width = 0;
    wrapped = true;
  };

  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        if (width === 0 && wrapped) continue;
        push(token, run.font, measureText(run.font, token, fontSize));
        continue;
      }
      const tokenWidth = measureText(run.font, token, fontSize);
      if (width > 0 && width + tokenWidth > maxWidth) breakLine();
      if (tokenWidth <= maxWidth) {
        push(token, run.font, tokenWidth);
        continue;
      }
      let chunk = '';
      for (const ch of Array.from(token)) {
        if (chunk && width + measureText(run.font, chunk + ch, fontSize) > maxWidth) {
          push(chunk, run.font, measureText(run.font, chunk, fontSize));
          breakLine();
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      if (chunk) push(chunk, run.font, measureText(run.font, chunk, fontSize));
    }
  }
  trimTrailingSpace();
  lines.push(current);
  return lines;
}

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const validDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** XMP packet mirroring the document information, so XMP-first readers show the same values */
export const buildXmpPacket = (metadata: DocumentMetadata, created: Date | null, modified: Date): string => {
  const lines: string[] = [];
  const alt = (tag: string, value?: string) => {
    if (value) lines.push(`   <${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(value)}</rdf:li></rdf:Alt></${tag}>`);
  };
  const simple = (tag: string, value?: string) => {
    if (value) lines.push(`   <${tag}>${xmlEscape(value)}</${tag}>`);
  };
  lines.push('   <dc:format>application/pdf</dc:format>');
  alt('dc:title', metadata.title);
  if (metadata.author) {
    const authors = metadata.author.split(/\s*;\s*/).filter(Boolean);
    lines.push(`   <dc:creator><rdf:Seq>${authors.map((a) => `<rdf:li>${xmlEscape(a)}</rdf:li>`).join('')}</rdf:Seq></dc:creator>`);
  }
  alt('dc:description', metadata.subject);
  const keywords = (metadata.keywords || '').split(/[,;]/).map((k) => k.trim()).filter(Boolean);
  if (keywords.length > 0) {
    lines.push(`   <dc:subject><rdf:Bag>${keywords.map((k) => `<rdf:li>${xmlEscape(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>`);
  }
  simple('dc:source', metadata.source);
  if (metadata.language) lines.push(`   <dc:language><rdf:Bag><rdf:li>${xmlEscape(metadata.language)}</rdf:li></rdf:Bag></dc:language>`);
  simple('pdf:Keywords', metadata.keywords);
  simple('pdf:Producer', metadata.producer);
  simple('xmp:CreatorTool', metadata.creator);
  if (created) simple('xmp:CreateDate', created.toISOString());
  simple('xmp:ModifyDate', modified.toISOString());
  simple('xmp:MetadataDate', modified.toISOString());
  const bom = String.fromCharCode(0xfeff);
  return [
    `<?xpacket begin="${bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    ...lines,
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
};

/**
 * Writes document metadata: the information dictionary (standard fields, Source and custom
 * properties), the catalog language and an XMP packet with the same values. Empty fields are
 * removed rather than left with pdf-lib's defaults.
 */
export const applyDocumentMetadata = (doc: PDFDocument, metadata: DocumentMetadata, now: Date = new Date()) => {
  const info = (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
  const setText = (key: string, value?: string) => {
    if (value && value.trim()) info.set(PDFName.of(key), PDFHexString.fromText(value));
    else info.delete(PDFName.of(key));
  };
  setText('Title', metadata.title);
  setText('Author', metadata.author);
  setText('Subject', metadata.subject);
  setText('Keywords', metadata.keywords);
  setText('Creator', metadata.creator);
  setText('Producer', metadata.producer);
  setText('Source', metadata.source);

  const created = validDate(metadata.creationDate);
  if (created) doc.setCreationDate(created);
  const modified =
    metadata.autoModificationDate === false ? validDate(metadata.modificationDate) || now : now;
  doc.setModificationDate(modified);

  for (const { key, value } of metadata.customProperties || []) {
    const cleanKey = key.trim();
    if (!cleanKey || RESERVED_METADATA_KEYS.has(cleanKey)) continue;
    setText(cleanKey, value);
  }

  if (metadata.language && metadata.language.trim()) {
    doc.setLanguage(metadata.language.trim());
  } else {
    doc.catalog.delete(PDFName.of('Lang'));
  }

  const xmp = buildXmpPacket(metadata, created || doc.getCreationDate() || null, modified);
  const xmpStream = doc.context.stream(new TextEncoder().encode(xmp), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmpStream));
};

/**
 * Exports edited document with all pages, drawn annotations, and native PDF comments
 */
export const exportEditedPdf = async (
  sources: SourceDocument[],
  pages: PdfPageModel[],
  annotations: Annotation[],
  outputFileName: string = 'document-edited.pdf',
  rasterSettings: RasterizationSettings = DEFAULT_RASTERIZATION_SETTINGS,
  metadata?: DocumentMetadata,
  formValues?: Record<string, string | boolean | string[]>,
  formExportMode: FormExportMode = 'interactive',
  triggerDownload: boolean = true
): Promise<Uint8Array> => {
  const startTime = Date.now();
  logger.info('save', `Zahájen export PDF: "${outputFileName}" (${pages.length} stran)`, {
    outputFileName,
    totalPages: pages.length,
    sourcesCount: sources.length,
    annotationsCount: annotations.length,
    rasterSettings,
    metadata,
    formFieldsCount: formValues ? Object.keys(formValues).length : 0,
    formExportMode,
  });

  const outputDoc = await PDFDocument.create();

  // Apply document metadata if provided
  if (metadata) {
    applyDocumentMetadata(outputDoc, metadata);
  }

  // Only load source PDF documents that are actually referenced by at least one kept page
  const usedSourceIds = new Set<string>();
  for (const p of pages) {
    if (p.sourceType === 'pdf' && p.sourceDocId) usedSourceIds.add(p.sourceDocId);
  }
  const sourcesById = new Map<string, SourceDocument>();
  for (const src of sources) {
    sourcesById.set(src.id, src);
  }
  const annotationsByPageId = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    let bucket = annotationsByPageId.get(ann.pageId);
    if (!bucket) {
      bucket = [];
      annotationsByPageId.set(ann.pageId, bucket);
    }
    bucket.push(ann);
  }

  // Pre-load referenced source PDF documents into memory map with automatic catalog repair
  const sourceDocsMap = new Map<string, PDFDocument>();
  for (const src of sources) {
    if (src.arrayBuffer && usedSourceIds.has(src.id)) {
      const loadResult = await loadSourcePdfDocWithDiagnostics(src.arrayBuffer);
      if (loadResult.doc) {
        sourceDocsMap.set(src.id, loadResult.doc);
        logger.info('save', `Načten zdrojový dokument "${src.name || src.id}" pro vektorové kopírování`, {
          sourceId: src.id,
          name: src.name,
          bytes: src.arrayBuffer.byteLength,
          fileSizeKB: (src.arrayBuffer.byteLength / 1024).toFixed(1),
          header: extractPdfHeader(src.arrayBuffer),
          attemptsUsed: loadResult.attempts.length,
          repairsApplied: loadResult.repairLog,
        });
      } else {
        const errorSummaries = loadResult.attempts.map((a) => ({
          attempt: a.attempt,
          strategy: a.options.name || JSON.stringify(a.options),
          errorType: a.errorName,
          message: a.errorMessage,
          stack: a.errorStack ? a.errorStack.split('\n').slice(0, 4).join('\n') : undefined,
        }));

        logger.warn(
          'save',
          `PDF-lib nemohl načíst zdrojový dokument "${src.name || src.id}". Bude použita záchranná rastrizace stránek.`,
          {
            sourceId: src.id,
            name: src.name,
            fileSize: `${(src.arrayBuffer.byteLength / 1024).toFixed(1)} KB (${src.arrayBuffer.byteLength} B)`,
            pdfHeader: extractPdfHeader(src.arrayBuffer),
            diagnosticMessage: 'Dokument obsahuje syntaktické chyby, poškozené xref tabulky, nestandardní kompresi objektů nebo nepodporované kódování v PDF-lib.',
            attemptsCount: loadResult.attempts.length,
            attemptErrors: errorSummaries,
            impact: 'Stránky z tohoto zdroje budou uloženy jako rastrové obrázky, což může výrazně zvýšit velikost výsledného PDF.',
          }
        );
        console.warn(`PDF-lib could not parse source doc ${src.id}. Detailed diagnostics:`, errorSummaries);
      }
    }
  }

  // Batch copy all needed pages per source document to preserve shared fonts/images and avoid asset duplication
  const copiedPagesMap = new Map<string, PDFPage[]>();
  for (const src of sources) {
    const srcDoc = sourceDocsMap.get(src.id);
    if (!srcDoc) continue;

    // ISO 32000-1 Section 7.6: Encrypted source document detection
    // pdf-lib does NOT decrypt stream contents; copying raw encrypted streams into an unencrypted
    // outputDoc causes corrupted FlateDecode streams in viewers. We must use high-res render fallback!
    const isEncrypted = Boolean(srcDoc.context.trailerInfo.Encrypt);
    if (isEncrypted) {
      logger.warn(
        'save',
        `Zdrojový dokument "${src.name || src.id}" je chráněn standardním šifrováním oprávnění (ISO 32000-1 Section 7.6). Strany budou uloženy pomocí bezztrátového vykreslení pro zaručení čitelnosti ve všech prohlížečích.`,
        {
          sourceId: src.id,
          reason: 'Přímé binární kopírování šifrovaných streamů do nešifrovaného PDF by způsobilo neplatné kompresní bloky (Unknown compression method in flate stream).',
        }
      );
      continue;
    }

    // Find all pages originating from this source
    const srcPages = pages.filter((p) => p.sourceDocId === src.id && p.sourceType === 'pdf');
    if (srcPages.length > 0) {
      try {
        const pageCount = srcDoc.getPageCount();
        const indicesToCopy = srcPages.map((p) =>
          Math.min(Math.max(0, p.originalPageIndex ?? 0), Math.max(0, pageCount - 1))
        );

        await srcDoc.flush();
        const copier = PDFObjectCopier.for(srcDoc.context, outputDoc.context);
        const rawSrcPages = srcDoc.getPages();
        const keptIndexSet = new Set(indicesToCopy);
        const allPagesKept = keptIndexSet.size === rawSrcPages.length;

        // ISO 32000-1 §§ 12.3.2, 12.3.3, 12.5.6.5, 12.7.2:
        // Pre-map every kept source page ref to its pre-allocated output page ref, and map deleted
        // source page refs to PDFNull. This guarantees that:
        //  1) /Outlines, internal /Link destinations, /Dests, and /AcroForm /P point to the ACTUAL
        //     copied pages in outputDoc (never orphan duplicate pages).
        //  2) Deleted pages (and their fonts/images/content) are NEVER dragged into outputDoc.
        //  3) Pages are copied once instead of twice, halving memory and output size.
        const traversed = (copier as unknown as { traversedObjects: Map<any, any> }).traversedObjects;
        const firstOutRefBySrcRef = new Map<PDFRef, PDFRef>();
        const keptSrcAnnotRefs = new Set<PDFRef>();
        for (let i = 0; i < rawSrcPages.length; i++) {
          const pRef = rawSrcPages[i].ref;
          if (keptIndexSet.has(i)) {
            if (!firstOutRefBySrcRef.has(pRef)) {
              const outRef = outputDoc.context.nextRef();
              firstOutRefBySrcRef.set(pRef, outRef);
              traversed.set(pRef, outRef);
            }
            if (!allPagesKept) {
              const annotsArr = srcDoc.context.lookup(rawSrcPages[i].node.get(PDFName.of('Annots')));
              if (annotsArr instanceof PDFArray) {
                for (let ai = 0; ai < annotsArr.size(); ai++) {
                  const aRef = annotsArr.get(ai);
                  if (aRef instanceof PDFRef) keptSrcAnnotRefs.add(aRef);
                }
              }
            }
          } else {
            traversed.set(pRef, PDFNull);
          }
        }

        // Copy pages first into their pre-allocated refs
        const assignedSrcRefs = new Set<PDFRef>();
        const copiedList: PDFPage[] = new Array(indicesToCopy.length);
        for (let idx = 0, len = indicesToCopy.length; idx < len; idx++) {
          const rawSrcPage = rawSrcPages[indicesToCopy[idx]];

          // ISO 32000-1 Section 7.7.3.4: Resolve inherited attributes before copying
          // (Resources, MediaBox, CropBox, Rotate may reside in parent /Pages nodes)
          try {
            if (!rawSrcPage.node.has(PDFName.of('Resources'))) {
              const inheritedRes = safeGetPageResources(rawSrcPage.node);
              if (inheritedRes) rawSrcPage.node.set(PDFName.of('Resources'), inheritedRes);
            }
            if (!rawSrcPage.node.has(PDFName.of('MediaBox'))) {
              const inheritedMedia = rawSrcPage.node.MediaBox();
              if (inheritedMedia) rawSrcPage.node.set(PDFName.of('MediaBox'), inheritedMedia);
            }
            if (!rawSrcPage.node.has(PDFName.of('CropBox'))) {
              const inheritedCrop = rawSrcPage.node.CropBox();
              if (inheritedCrop) rawSrcPage.node.set(PDFName.of('CropBox'), inheritedCrop);
            }
            if (!rawSrcPage.node.has(PDFName.of('Rotate'))) {
              const inheritedRotate = rawSrcPage.node.Rotate();
              if (inheritedRotate) rawSrcPage.node.set(PDFName.of('Rotate'), inheritedRotate);
            }
          } catch {
            // ignore attribute resolution errors
          }

          const copiedPageLeaf = copier.copy(rawSrcPage.node);
          const preallocated = firstOutRefBySrcRef.get(rawSrcPage.ref);
          let ref: PDFRef;
          if (preallocated && !assignedSrcRefs.has(rawSrcPage.ref)) {
            outputDoc.context.assign(preallocated, copiedPageLeaf);
            assignedSrcRefs.add(rawSrcPage.ref);
            ref = preallocated;
          } else {
            // Duplicated page gets its own leaf ref while still sharing copied resources
            ref = outputDoc.context.register(copiedPageLeaf);
          }
          copiedList[idx] = PDFPage.of(copiedPageLeaf, ref, outputDoc);
        }
        copiedPagesMap.set(src.id, copiedList);

        // Preserve interactive AcroForm fields and widgets using the shared copier
        try {
          const srcAcroObj = srcDoc.catalog.get(PDFName.of('AcroForm'));
          if (srcAcroObj && !outputDoc.catalog.has(PDFName.of('AcroForm'))) {
            if (allPagesKept) {
              const copied = copier.copy(srcAcroObj);
              const acroRef = copied instanceof PDFRef ? copied : outputDoc.context.register(copied);
              outputDoc.catalog.set(PDFName.of('AcroForm'), acroRef);
            } else {
              const srcAcroDict = srcDoc.context.lookup(srcAcroObj);
              if (srcAcroDict instanceof PDFDict) {
                const fieldReferencesKeptWidget = (obj: unknown, seen = new Set<unknown>()): boolean => {
                  if (!obj || seen.has(obj)) return false;
                  seen.add(obj);
                  if (obj instanceof PDFRef && keptSrcAnnotRefs.has(obj)) return true;
                  const dict = obj instanceof PDFRef ? srcDoc.context.lookup(obj) : obj;
                  if (!(dict instanceof PDFDict)) return false;
                  const kids = dict.lookup(PDFName.of('Kids'));
                  if (kids instanceof PDFArray) {
                    for (let ki = 0; ki < kids.size(); ki++) {
                      if (fieldReferencesKeptWidget(kids.get(ki), seen)) return true;
                    }
                    return false;
                  }
                  // Leaf field without /Rect or /Subtype /Widget (non-visual field) is kept; widget-only field must be on a kept page
                  const hasRect = dict.has(PDFName.of('Rect'));
                  const isWidget = nameOf(dict.lookup(PDFName.of('Subtype'))) === 'Widget';
                  return !hasRect && !isWidget;
                };
                const srcFields = srcAcroDict.lookup(PDFName.of('Fields'));
                const copiedFields = outputDoc.context.obj([]) as PDFArray;
                if (srcFields instanceof PDFArray) {
                  for (let fi = 0; fi < srcFields.size(); fi++) {
                    const fRef = srcFields.get(fi);
                    if (fieldReferencesKeptWidget(fRef)) {
                      copiedFields.push(copier.copy(fRef));
                    }
                  }
                }
                if (copiedFields.size() > 0) {
                  const newAcroDict = outputDoc.context.obj({}) as PDFDict;
                  for (const [k, v] of srcAcroDict.entries()) {
                    if (k === PDFName.of('Fields')) {
                      newAcroDict.set(k, copiedFields);
                    } else {
                      newAcroDict.set(k, copier.copy(v));
                    }
                  }
                  newAcroDict.set(PDFName.of('Fields'), copiedFields);
                  outputDoc.catalog.set(PDFName.of('AcroForm'), outputDoc.context.register(newAcroDict));
                }
              }
            }
          }
        } catch (acroErr) {
          logger.warn('save', `Nelze zkopírovat AcroForm ze zdroje ${src.id}: ${acroErr}`);
        }

        // Preserve Document Outlines (bookmarks / TOC tree) pointing to the actual copied pages (ISO 32000-1 §12.3.3)
        try {
          const srcOutlines = srcDoc.catalog.get(PDFName.of('Outlines'));
          if (srcOutlines && !outputDoc.catalog.has(PDFName.of('Outlines'))) {
            const copied = copier.copy(srcOutlines);
            const outlinesRef = copied instanceof PDFRef ? copied : outputDoc.context.register(copied);
            outputDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
          }
        } catch {
          // ignore outlines copy error
        }

        // Preserve Named Destinations (ISO 32000-1 §12.3.2.3: Catalog /Dests and /Names /Dests)
        try {
          const srcDests = srcDoc.catalog.get(PDFName.of('Dests'));
          if (srcDests && !outputDoc.catalog.has(PDFName.of('Dests'))) {
            const copiedDests = copier.copy(srcDests);
            outputDoc.catalog.set(
              PDFName.of('Dests'),
              copiedDests instanceof PDFRef ? copiedDests : outputDoc.context.register(copiedDests)
            );
          }
          const srcNames = srcDoc.catalog.lookup(PDFName.of('Names'));
          if (srcNames instanceof PDFDict) {
            const srcNamesDests = srcNames.get(PDFName.of('Dests'));
            if (srcNamesDests) {
              const existingOutNames = outputDoc.catalog.lookup(PDFName.of('Names'));
              const outNames =
                existingOutNames instanceof PDFDict ? existingOutNames : (outputDoc.context.obj({}) as PDFDict);
              if (!outNames.has(PDFName.of('Dests'))) {
                const copiedNamesDests = copier.copy(srcNamesDests);
                outNames.set(
                  PDFName.of('Dests'),
                  copiedNamesDests instanceof PDFRef
                    ? copiedNamesDests
                    : outputDoc.context.register(copiedNamesDests)
                );
                if (!(existingOutNames instanceof PDFDict)) {
                  outputDoc.catalog.set(PDFName.of('Names'), outputDoc.context.register(outNames));
                }
              }
            }
          }
        } catch {
          // ignore named destinations copy error
        }

        logger.info('save', `Zkopírováno ${copiedList.length} originálních vektorových stran ze zdroje "${src.name || src.id}"`, {
          sourceId: src.id,
          pagesCopied: copiedList.length,
        });
      } catch (err: any) {
        logger.warn('save', `Chyba při hromadném kopírování stran ze zdroje ${src.id}: ${err?.message || err}`, {
          sourceId: src.id,
          error: err?.message || String(err),
          stack: err?.stack,
        });
        console.warn(`Error batch copying pages from source ${src.id}:`, err);
      }
    }
  }

  // Cache embedded image objects (signatures, stamps, image pages)
  const imageEmbedCache = new Map<string, PDFImage>();
  const srcCounter = new Map<string, number>();

  const embedDataUrlImage = async (doc: PDFDocument, dataUrl: string): Promise<PDFImage> => {
    let cached = imageEmbedCache.get(dataUrl);
    if (cached) return cached;

    try {
      if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
        cached = await doc.embedJpg(dataUrl);
      } else if (dataUrl.startsWith('data:image/png')) {
        cached = await doc.embedPng(dataUrl);
      } else {
        try {
          cached = await doc.embedPng(dataUrl);
        } catch {
          cached = await doc.embedJpg(dataUrl);
        }
      }
    } catch (embedErr) {
      // Formats PDF cannot store directly (WebP, GIF, ...) are re-encoded as PNG in the browser
      const pngDataUrl = await convertImageDataUrlToPng(dataUrl);
      if (!pngDataUrl) throw embedErr;
      cached = await doc.embedPng(pngDataUrl);
    }
    imageEmbedCache.set(dataUrl, cached);
    return cached;
  };

  const embedImagePage = async (pageModel: PdfPageModel): Promise<PDFImage> => {
    if (pageModel.imageBytes) {
      try {
        if (pageModel.imageMimeType === 'image/png') {
          return await outputDoc.embedPng(pageModel.imageBytes);
        }
        try {
          return await outputDoc.embedJpg(pageModel.imageBytes);
        } catch {
          return await outputDoc.embedPng(pageModel.imageBytes);
        }
      } catch (bytesErr) {
        if (!pageModel.imageDataUrl) throw bytesErr;
      }
    }
    return embedDataUrlImage(outputDoc, pageModel.imageDataUrl!);
  };

  const fonts = new PdfFontProvider(outputDoc);

  // Process pages in order
  for (const pageModel of pages) {
    let targetPage: PDFPage | null = null;
    // Rasterized pages are rendered already rotated, so they must not get /Rotate again
    let appliedRotation = pageModel.rotation || 0;
    // pageModel.width/height describe the page as displayed; the MediaBox of generated pages is unrotated
    const quarterTurned = ((appliedRotation % 360) + 360) % 180 !== 0;
    const mediaWidth = quarterTurned ? pageModel.height : pageModel.width;
    const mediaHeight = quarterTurned ? pageModel.width : pageModel.height;

    if (pageModel.sourceType === 'image' && (pageModel.imageBytes || pageModel.imageDataUrl)) {
      const embeddedImage = await embedImagePage(pageModel);

      targetPage = outputDoc.addPage([mediaWidth, mediaHeight]);
      targetPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: mediaWidth,
        height: mediaHeight,
      });
    } else if (pageModel.sourceType === 'blank') {
      targetPage = outputDoc.addPage([mediaWidth, mediaHeight]);
    } else {
      const count = srcCounter.get(pageModel.sourceDocId) || 0;
      const list = copiedPagesMap.get(pageModel.sourceDocId);
      if (list && list[count]) {
        targetPage = outputDoc.addPage(list[count]);
        srcCounter.set(pageModel.sourceDocId, count + 1);
      } else {
        const srcDoc = sourceDocsMap.get(pageModel.sourceDocId);
        if (srcDoc && !srcDoc.context.trailerInfo.Encrypt) {
          try {
            const pageCount = srcDoc.getPageCount();
            const pageIdx = Math.min(
              Math.max(0, pageModel.originalPageIndex ?? 0),
              Math.max(0, pageCount - 1)
            );
            const rawSrcPage = srcDoc.getPage(pageIdx);
            try {
              if (!rawSrcPage.node.has(PDFName.of('Resources'))) {
                const inheritedRes = safeGetPageResources(rawSrcPage.node);
                if (inheritedRes) rawSrcPage.node.set(PDFName.of('Resources'), inheritedRes);
              }
              if (!rawSrcPage.node.has(PDFName.of('MediaBox'))) {
                const inheritedMedia = rawSrcPage.node.MediaBox();
                if (inheritedMedia) rawSrcPage.node.set(PDFName.of('MediaBox'), inheritedMedia);
              }
              if (!rawSrcPage.node.has(PDFName.of('CropBox'))) {
                const inheritedCrop = rawSrcPage.node.CropBox();
                if (inheritedCrop) rawSrcPage.node.set(PDFName.of('CropBox'), inheritedCrop);
              }
              if (!rawSrcPage.node.has(PDFName.of('Rotate'))) {
                const inheritedRotate = rawSrcPage.node.Rotate();
                if (inheritedRotate) rawSrcPage.node.set(PDFName.of('Rotate'), inheritedRotate);
              }
            } catch { }
            const [copiedPage] = await outputDoc.copyPages(srcDoc, [pageIdx]);
            targetPage = outputDoc.addPage(copiedPage);
          } catch (copyErr: any) {
            logger.warn('save', `Kopírování strany ${pageModel.id} selhalo, bude použita záchranná rastrizace: ${copyErr?.message || copyErr}`, {
              pageId: pageModel.id,
              sourceDocId: pageModel.sourceDocId,
              error: copyErr?.message || String(copyErr),
              stack: copyErr?.stack,
            });
            console.warn(`copyPages failed for page ${pageModel.id}, falling back to high-res render:`, copyErr);
            targetPage = null;
          }
        }
      }

      // If pdf-lib direct copy was unavailable or failed for this page, use high-res rendering fallback
      if (!targetPage) {
        try {
          const sourceDoc = sourcesById.get(pageModel.sourceDocId) || sources[0];
          if (sourceDoc && sourceDoc.arrayBuffer) {
            const scale = rasterSettings.scale || 2.0;
            const format = rasterSettings.format || 'image/jpeg';
            const quality = rasterSettings.jpegQuality ?? 0.90;

            const highResDataUrl = await renderPdfPageToDataUrl(
              sourceDoc,
              pageModel,
              scale,
              format,
              quality
            );
            const embeddedImg = await embedDataUrlImage(outputDoc, highResDataUrl);
            targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
            appliedRotation = 0;
            targetPage.drawImage(embeddedImg, {
              x: 0,
              y: 0,
              width: pageModel.width,
              height: pageModel.height,
            });
            const dataUrlKb = (highResDataUrl.length * 0.75 / 1024).toFixed(1);
            const isJpeg = format === 'image/jpeg';
            logger.warn(
              'save',
              `Záchranná rastrizace pro stranu ${pageModel.id} proběhla úspěšně (${dataUrlKb} KB, ${isJpeg ? `JPEG ${Math.round(quality * 100)} %` : 'PNG'}, ${scale}× měřítko)`,
              {
                pageId: pageModel.id,
                pageNumber: (pageModel.originalPageIndex ?? 0) + 1,
                sourceDocId: pageModel.sourceDocId,
                dimensions: `${pageModel.width.toFixed(0)} × ${pageModel.height.toFixed(0)} pt`,
                rasterScale: `${scale}× (${Math.round(scale * 72)} DPI)`,
                rasterFormat: format,
                jpegQuality: isJpeg ? `${Math.round(quality * 100)} %` : 'N/A (Lossless PNG)',
                renderedImageSizeKB: `${dataUrlKb} KB`,
                transformationNote: isJpeg
                  ? `Strana byla transformována do optimalizovaného JPEG s nativní DCTDecode kompresí (${Math.round(quality * 100)} % kvalita, měřítko ${scale}×).`
                  : `Strana byla uložena v bezztrátovém PNG (měřítko ${scale}×).`,
                reason: sourceDocsMap.has(pageModel.sourceDocId)
                  ? 'Kopírování této konkrétní strany selhalo (např. poškozený obsah strany nebo fonty)'
                  : `Zdrojový PDF dokument "${pageModel.sourceDocId}" se nepodařilo načíst do PDF-lib parseru`,
                note: 'Výsledný PDF soubor je větší z důvodu rastrového uložení této strany.',
              }
            );
          }
        } catch (renderErr: any) {
          logger.error(
            'save',
            `Záchranné vykreslení strany ${pageModel.id} selhalo: ${renderErr?.message || renderErr}`,
            {
              pageId: pageModel.id,
              error: renderErr?.message || String(renderErr),
              stack: renderErr?.stack,
            }
          );
          console.error(`High-res render fallback failed for page ${pageModel.id}:`, renderErr);
          targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
          appliedRotation = 0;
        }
      }
    }

    if (!targetPage) {
      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
      appliedRotation = 0;
    }

    // Filter pre-existing annotations on copied pages:
    // Retain structural annotations like /Link (hyperlinks/TOC) and /Widget (forms)
    // per ISO 32000-1 Section 12.5, while removing stale review markups managed by PilsenPDF
    try {
      removeEditorManagedAnnotations(targetPage);
    } catch {
      // Ignore if no Annots node
    }

    // Only set /Rotate when the effective angle actually changed (keep untouched pages unmodified)
    const currentRotation = ((targetPage.getRotation().angle % 360) + 360) % 360;
    const desiredRotation = ((appliedRotation % 360) + 360) % 360;
    if (currentRotation !== desiredRotation) {
      targetPage.setRotation(degrees(desiredRotation));
    }

    // Get annotations for this page (skip display-space calculation if none)
    const pageAnnotations = annotationsByPageId.get(pageModel.id) || [];
    if (pageAnnotations.length === 0) continue;

    // Annotation geometry is computed in display space (y up) and mapped through space.matrix
    const space = getPageDisplaySpace(targetPage);
    const pageHeight = space.displayHeight;
    const matrix = space.matrix;

    for (const ann of pageAnnotations) {
      try {
        switch (ann.type) {
          case 'highlight': {
            const h = ann as HighlightAnnotation;
            const pdfColor = hexToPdfRgb(h.color || '#fef08a');
            const subRects: Array<[number, number, number, number]> =
              h.rects && h.rects.length > 0
                ? h.rects.map((r) => {
                  const ry1 = pageHeight - r.y - r.height;
                  return [r.x, ry1, r.x + r.width, ry1 + r.height];
                })
                : [
                  [
                    h.x,
                    pageHeight - h.y - h.height,
                    h.x + h.width,
                    pageHeight - h.y,
                  ],
                ];
            const x1 = Math.min(...subRects.map((r) => r[0]));
            const y1 = Math.min(...subRects.map((r) => r[1]));
            const x2 = Math.max(...subRects.map((r) => r[2]));
            const y2 = Math.max(...subRects.map((r) => r[3]));
            const quadPoints = subRects.flatMap(([rx1, ry1, rx2, ry2]) => [
              rx1, ry2, rx2, ry2, rx1, ry1, rx2, ry1,
            ]);

            addNativePdfAnnotation(outputDoc, targetPage, {
              matrix,
              id: h.id,
              subtype: 'Highlight',
              rect: [x1, y1, x2, y2],
              quadPoints,
              highlightRects: subRects,
              contents: h.comment,
              author: h.author,
              colorRgb: pdfColor,
              opacity: h.opacity || 0.4,
            });
            break;
          }

          case 'underline':
          case 'strikethrough': {
            const m = ann as UnderlineAnnotation | StrikethroughAnnotation;
            const strokeWidth = m.strokeWidth || 2;
            const pdfColor = hexToPdfRgb(m.color || (m.type === 'underline' ? '#0284c7' : '#dc2626'));
            const pad = Math.max(2, strokeWidth / 2) + strokeWidth / 2;
            // Same line as drawn on screen, along the text's bottom edge / middle in its reading direction
            const [start, end] = getMarkupLine(m.type, m, m.textRotation);
            const lineUp: [number, number, number, number] = [start.x, pageHeight - start.y, end.x, pageHeight - end.y];
            const x1 = Math.min(lineUp[0], lineUp[2]) - pad;
            const y1 = Math.min(lineUp[1], lineUp[3]) - pad;
            const x2 = Math.max(lineUp[0], lineUp[2]) + pad;
            const y2 = Math.max(lineUp[1], lineUp[3]) + pad;
            // QuadPoints of the markup box in text reading order (top-left, top-right, bottom-left,
            // bottom-right): its bottom edge / middle is exactly the drawn line, only /Rect is padded
            const quad = getTextQuad(m, m.textRotation);
            const quadPoints = [quad.topLeft, quad.topRight, quad.bottomLeft, quad.bottomRight].flatMap((p) => [
              p.x,
              pageHeight - p.y,
            ]);

            addNativePdfAnnotation(outputDoc, targetPage, {
              matrix,
              id: m.id,
              subtype: m.type === 'underline' ? 'Underline' : 'StrikeOut',
              rect: [x1, y1, x2, y2],
              quadPoints,
              markupLine: lineUp,
              contents: m.comment,
              author: m.author,
              colorRgb: pdfColor,
              opacity: m.opacity || 0.9,
              strokeWidth,
            });
            break;
          }

          case 'text': {
            const t = ann as TextAnnotation;
            const pdfColor = hexToPdfRgb(t.color || '#0f172a');
            const fontSize = t.fontSize || 14;
            const x1 = t.x;
            let y1 = pageHeight - t.y - t.height;
            const x2 = t.x + t.width;
            const y2 = pageHeight - t.y;

            // 2. Parse lines and spans
            const parsedLines = parseRichTextToLines(t.text, t.richText, t.bulletStyle || 'disc');
            const fullPlainText = linesToPlainText(parsedLines);

            // Typography metrics
            const lineHeight = fontSize * 1.25;
            const padX = 4;
            const padY = 4;

            // Each span uses a standard font when its text fits WinAnsi, otherwise an embedded
            // Unicode font, so Czech and other non-Latin-1 characters keep their correct glyphs.
            // Paragraphs are word-wrapped to the box width, as the editor shows them.
            const maxLineWidth = Math.max(fontSize, x2 - x1 - padX * 2);
            const visualLines: WrappedPiece[][] = [];
            for (const line of parsedLines) {
              const runs: { text: string; font: PDFFont }[] = [];
              for (const span of line.spans) {
                if (!span.text) continue;
                const fontObj = await fonts.fontFor(t.fontFamily, span.bold, span.italic, span.text);
                runs.push({ text: prepareTextForFont(fontObj, span.text), font: fontObj });
              }
              visualLines.push(...wrapStyledRuns(runs, fontSize, maxLineWidth));
            }
            // The PDF fonts measure slightly differently from the browser's: grow the box
            // downward instead of cutting off the last line
            const neededHeight = padY * 2 + fontSize * 1.25 + Math.max(0, visualLines.length - 1) * lineHeight;
            if (neededHeight > y2 - y1) y1 = y2 - neededHeight;

            // 3. Build ISO 32000-1 Appearance Stream
            let streamOps = '';
            const w = Math.max(0.1, x2 - x1);
            const h = Math.max(0.1, y2 - y1);

            // Background rectangle (only if not transparent)
            let interiorRgb: { red: number; green: number; blue: number } | undefined;
            if (t.backgroundColor && t.backgroundColor !== 'transparent') {
              interiorRgb = hexToPdfRgb(t.backgroundColor);
              streamOps += `q ${interiorRgb.red.toFixed(3)} ${interiorRgb.green.toFixed(3)} ${interiorRgb.blue.toFixed(3)} rg ${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q `;
            }

            // Border stroke (only if width > 0 and not transparent)
            if (t.borderWidth && t.borderWidth > 0 && t.borderColor && t.borderColor !== 'transparent') {
              const borderRgb = hexToPdfRgb(t.borderColor);
              streamOps += `q ${t.borderWidth} w 1 J 1 j ${borderRgb.red.toFixed(3)} ${borderRgb.green.toFixed(3)} ${borderRgb.blue.toFixed(3)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q `;
            }

            // Typography stream
            let curY = y2 - padY - fontSize;
            const { red: tr, green: tg, blue: tb } = pdfColor;

            streamOps += `q ${tr.toFixed(3)} ${tg.toFixed(3)} ${tb.toFixed(3)} rg `;

            // F1-F4 are the regular/bold/italic/bold-italic standard fonts, U1.. the Unicode ones.
            const spanFontNames = new Map<PDFFont, string>();
            const standardStyles: Array<[boolean, boolean]> = [[false, false], [true, false], [false, true], [true, true]];
            for (const [idx, [bold, italic]] of standardStyles.entries()) {
              const standardFont = await fonts.getStandardFont(standardFontFor(t.fontFamily, bold, italic));
              spanFontNames.set(standardFont, `F${idx + 1}`);
            }
            let unicodeFontCount = 0;
            const fontResourceName = (font: PDFFont) => {
              let name = spanFontNames.get(font);
              if (!name) {
                name = `U${++unicodeFontCount}`;
                spanFontNames.set(font, name);
              }
              return name;
            };

            for (const pieces of visualLines) {
              let curX = x1 + padX;
              for (const piece of pieces) {
                if (!piece.text) continue;
                streamOps += `BT /${fontResourceName(piece.font)} ${fontSize} Tf 1 0 0 1 ${curX.toFixed(2)} ${curY.toFixed(2)} Tm ${piece.font.encodeText(piece.text).toString()} Tj ET `;
                curX += piece.width;
              }
              curY -= lineHeight;
            }
            streamOps += `Q`;

            // Prepare custom resources with fonts
            const fontsDict = outputDoc.context.obj({});
            for (const [font, name] of spanFontNames) {
              fontsDict.set(PDFName.of(name), font.ref);
            }

            const customResources = {
              ProcSet: ['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI'],
              Font: fontsDict,
            };

            const rcXml = t.richText
              ? `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:8.0.0" xfa:spec="2.0.2">${t.richText}</body>`
              : undefined;

            addNativePdfAnnotation(outputDoc, targetPage, {
              matrix,
              id: t.id,
              subtype: 'FreeText',
              rect: [x1, y1, x2, y2],
              contents: fullPlainText || t.text,
              author: t.author,
              colorRgb: pdfColor,
              interiorColorRgb: interiorRgb,
              fontSize,
              richTextXml: rcXml,
              customStreamOperators: streamOps,
              customResources,
              borderWidth: t.borderWidth,
            });
            break;
          }

          case 'whiteout': {
            const w = ann as WhiteoutAnnotation;
            const maskColor = hexToPdfRgb(w.fillColor || w.color || '#ffffff');
            const pdfY = pageHeight - w.y - w.height;

            // Overlay text is burned into the page content (no extra FreeText annotation, which
            // viewers would render as a second copy of the same text on top of it)
            const textLines = w.text && w.text.trim() ? w.text.split(/\r?\n/) : [];
            const textColor = hexToPdfRgb(w.textColor || '#0f172a');
            const fontSize = w.fontSize || 12;
            let font: PDFFont | null = null;
            if (textLines.length > 0) {
              try {
                font = await fonts.fontFor(w.fontFamily, w.bold, w.italic, textLines.join(''));
              } catch (fontErr) {
                logger.warn('save', `Nelze načíst font pro whiteout: ${fontErr}`);
              }
            }

            drawInDisplaySpace(targetPage, matrix, () => {
              // 1. Draw opaque whiteout rectangle to mask underlying content
              targetPage!.drawRectangle({
                x: w.x,
                y: pdfY,
                width: w.width,
                height: w.height,
                color: maskColor,
                opacity: w.opacity ?? 1.0,
              });

              // 2. If overlay text is provided, render vector typography on top
              if (!font) return;
              const lineHeight = fontSize * 1.2;
              let currentTextY = pdfY + w.height - fontSize - 2;
              const overlayFont = font;
              const wrappedLines = textLines.flatMap((line) =>
                wrapStyledRuns([{ text: prepareTextForFont(overlayFont, line), font: overlayFont }], fontSize, Math.max(fontSize, w.width - 6))
              );
              for (const pieces of wrappedLines) {
                if (currentTextY < pdfY) break;
                const text = pieces.map((p) => p.text).join('');
                if (text) {
                  targetPage!.drawText(text, {
                    x: w.x + 3,
                    y: currentTextY,
                    size: fontSize,
                    font: overlayFont,
                    color: textColor,
                  });
                }
                currentTextY -= lineHeight;
              }
            });
            break;
          }

          case 'note': {
            const n = ann as NoteAnnotation;
            const pdfColor = hexToPdfRgb(n.color || '#f59e0b');
            const pdfY = pageHeight - n.y - 20;

            addNativePdfAnnotation(outputDoc, targetPage, {
              matrix,
              id: n.id,
              subtype: 'Text',
              rect: [n.x, pdfY, n.x + 20, pdfY + 20],
              contents: n.text,
              author: n.author,
              colorRgb: pdfColor,
            });
            break;
          }

          case 'drawing': {
            const d = ann as DrawingAnnotation;
            if (!d.points || d.points.length < 2) break;

            const strokeWidth = d.strokeWidth || 2;
            const pad = Math.max(2, strokeWidth / 2);
            const pdfColor = hexToPdfRgb(d.color || '#0284c7');
            const minX = Math.min(...d.points.map((p) => p.x)) - pad;
            const maxX = Math.max(...d.points.map((p) => p.x)) + pad;
            const minY = Math.min(...d.points.map((p) => pageHeight - p.y)) - pad;
            const maxY = Math.max(...d.points.map((p) => pageHeight - p.y)) + pad;
            const inkPath = d.points.flatMap((p) => [p.x, pageHeight - p.y]);

            addNativePdfAnnotation(outputDoc, targetPage, {
              matrix,
              id: d.id,
              subtype: 'Ink',
              rect: [minX, minY, maxX, maxY],
              inkList: [inkPath],
              colorRgb: pdfColor,
              strokeWidth,
            });
            break;
          }

          case 'signature': {
            const sig = ann as SignatureAnnotation;
            if (!sig.imageDataUrl) break;

            const sigImage = await embedDataUrlImage(outputDoc, sig.imageDataUrl);
            const pdfY = pageHeight - sig.y - sig.height;

            drawInDisplaySpace(targetPage, matrix, () => {
              targetPage!.drawImage(sigImage, {
                x: sig.x,
                y: pdfY,
                width: sig.width,
                height: sig.height,
              });
            });
            break;
          }

          case 'shape': {
            const sh = ann as ShapeAnnotation;
            const strokeWidth = sh.strokeWidth || 2;
            const strokeColor = hexToPdfRgb(sh.color || '#0284c7');
            const hasFill = sh.fillColor && sh.fillColor !== 'transparent';
            const interiorColor = hasFill ? hexToPdfRgb(sh.fillColor!) : undefined;
            const pdfY = pageHeight - sh.y - sh.height;
            const x1 = sh.x;
            const y1 = pdfY;
            const x2 = sh.x + sh.width;
            const y2 = pdfY + sh.height;

            if (sh.shapeType === 'rectangle') {
              addNativePdfAnnotation(outputDoc, targetPage, {
                matrix,
                id: sh.id,
                subtype: 'Square',
                rect: [x1, y1, x2, y2],
                colorRgb: strokeColor,
                interiorColorRgb: interiorColor,
                strokeWidth,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'ellipse') {
              addNativePdfAnnotation(outputDoc, targetPage, {
                matrix,
                id: sh.id,
                subtype: 'Circle',
                rect: [x1, y1, x2, y2],
                colorRgb: strokeColor,
                interiorColorRgb: interiorColor,
                strokeWidth,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'line') {
              // Shapes morphed into a line from a rectangle/ellipse have no endPoint yet
              const end = sh.endPoint ?? { x: sh.x + sh.width, y: sh.y + sh.height };
              const startX = sh.x;
              const startY = pageHeight - sh.y;
              const endX = end.x;
              const endY = pageHeight - end.y;
              const pad = Math.max(2, strokeWidth / 2);
              const minLx = Math.min(startX, endX) - pad;
              const maxLx = Math.max(startX, endX) + pad;
              const minLy = Math.min(startY, endY) - pad;
              const maxLy = Math.max(startY, endY) + pad;

              addNativePdfAnnotation(outputDoc, targetPage, {
                matrix,
                id: sh.id,
                subtype: 'Line',
                rect: [minLx, minLy, maxLx, maxLy],
                lineCoordinates: [startX, startY, endX, endY],
                colorRgb: strokeColor,
                strokeWidth,
                opacity: sh.opacity || 1.0,
              });
            }
            break;
          }

          default:
            break;
        }
      } catch (err: any) {
        logger.warn(
          'save',
          `Anotaci "${ann.id}" (${ann.type}) se nepodařilo zapsat do výsledného PDF: ${err?.message || err}`,
          {
            annotationId: ann.id,
            annotationType: ann.type,
            pageId: pageModel.id,
            error: err?.message || String(err),
          }
        );
        console.warn(`Error drawing annotation ${ann.id}:`, err);
      }
    }
  }

  // Ensure copied form widgets (and annotations that already carry /P) point to targetPage.ref
  // without mutating untouched structural annotations (e.g. /Link) that have no stale /P entry
  try {
    for (const targetPage of outputDoc.getPages()) {
      const annotsObj = targetPage.node.get(PDFName.of('Annots'));
      const annots = outputDoc.context.lookup(annotsObj);
      if (annots instanceof PDFArray) {
        for (let i = 0; i < annots.size(); i++) {
          const annotRef = annots.get(i);
          const annotDict = outputDoc.context.lookup(annotRef);
          if (annotDict instanceof PDFDict) {
            const isWidget = nameOf(annotDict.lookup(PDFName.of('Subtype'))) === 'Widget';
            const currentP = annotDict.get(PDFName.of('P'));
            if ((isWidget || currentP !== undefined) && currentP !== targetPage.ref) {
              annotDict.set(PDFName.of('P'), targetPage.ref);
            }
          }
        }
      }
    }
  } catch (pErr) {
    console.warn('Could not update widget /P page refs:', pErr);
  }

  // Apply interactive form field values and optional flattening
  const hasFormValues = Boolean(formValues && Object.keys(formValues).length > 0);
  const shouldProcessForm =
    hasFormValues || (formExportMode === 'flatten' && outputDoc.catalog.has(PDFName.of('AcroForm')));
  if (shouldProcessForm) {
    let appearanceFont: PDFFont | undefined;
    if (formExportMode === 'flatten') {
      // Check if any form value (new or existing) needs Unicode glyphs beyond WinAnsi
      const stdHelv = await fonts.getStandardFont(standardFontFor('Helvetica', false, false));
      let needsUnicode = false;
      for (const val of Object.values(formValues || {})) {
        const texts = Array.isArray(val) ? val : typeof val === 'string' ? [val] : [];
        if (texts.some((s) => !fontSupportsText(stdHelv, s.replace(/[\r\n\t]/g, '')))) {
          needsUnicode = true;
          break;
        }
      }
      if (!needsUnicode) {
        try {
          for (const f of outputDoc.getForm().getFields()) {
            const existingText = typeof (f as any).getText === 'function' ? (f as any).getText() : '';
            if (existingText && !fontSupportsText(stdHelv, existingText.replace(/[\r\n\t]/g, ''))) {
              needsUnicode = true;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
      if (needsUnicode) {
        appearanceFont = (await fonts.getUnicodeFont('regular')) ?? undefined;
      }
    }
    applyFormValuesToPdfDocument(outputDoc, formValues || {}, formExportMode === 'flatten', appearanceFont);
  }

  try {
    // Save document as bytes with PDF 1.5 Object Stream compression.
    // Skip pdf-lib's WinAnsi updateFieldAppearances when we already handled forms above
    // (otherwise pdf-lib crashes on Czech UTF-16BE interactive fields whose stale /AP was cleared).
    const pdfBytes = await outputDoc.save({
      useObjectStreams: true,
      objectsPerTick: 500,
      updateFieldAppearances: !shouldProcessForm,
    });
    const elapsed = Date.now() - startTime;
    logger.success('save', `PDF export úspěšně dokončen: ${(pdfBytes.length / 1024).toFixed(1)} KB za ${elapsed} ms`, {
      outputFileName,
      sizeBytes: pdfBytes.length,
      durationMs: elapsed,
      totalPages: pages.length,
    });

    // Create client-side download link if in browser environment
    if (triggerDownload && typeof document !== 'undefined') {
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = outputFileName;
      link.style.position = 'fixed';
      link.style.top = '-9999px';
      link.style.left = '-9999px';
      link.style.opacity = '0';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        if (typeof document !== 'undefined' && document.body?.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(downloadUrl);
      }, 1500);
    }

    return pdfBytes;
  } catch (err: any) {
    logger.error('save', `Uložení PDF dokumentu selhalo: ${err?.message || err}`, err);
    throw err;
  }
};
