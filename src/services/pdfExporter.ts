import {
  PDFDocument,
  rgb,
  degrees,
  PDFPage,
  PDFName,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFImage,
  PDFDict,
  ParseSpeeds,
} from 'pdf-lib';
import { PdfPageModel, SourceDocument } from '../types/document';
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
} from '../types/annotations';
import { renderPdfPageToDataUrl } from './pdfLoader';
import { logger } from './logger';

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
    const bytes = new Uint8Array(buffer.slice(0, Math.min(32, buffer.byteLength)));
    return Array.from(bytes)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
  } catch {
    return 'N/A';
  }
};

/**
 * Robustly loads a source PDF document with multi-stage fallback options, deep catalog repair,
 * and comprehensive diagnostic error tracking
 */
export const loadSourcePdfDocWithDiagnostics = async (
  arrayBuffer: ArrayBuffer
): Promise<LoadSourceResult> => {
  const attempts: Array<Record<string, any>> = [
    { name: 'Slow + NoThrow + CapNumbers', ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, parseSpeed: ParseSpeeds.Slow, capNumbers: true },
    { name: 'Fastest + NoThrow + CapNumbers', ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, parseSpeed: ParseSpeeds.Fastest, capNumbers: true },
    { name: 'NoThrow + CapNumbers', ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, capNumbers: true },
    { name: 'NoThrow + Standard', ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false },
    { name: 'IgnoreEncryption Only', ignoreEncryption: true },
    { name: 'Standard Default', parseSpeed: ParseSpeeds.Slow },
  ];

  const diagnosticAttempts: LoadAttemptDiagnostic[] = [];
  const repairLog: string[] = [];

  for (let i = 0; i < attempts.length; i++) {
    const opt = attempts[i];
    try {
      const copyBuf = arrayBuffer.slice(0);
      const doc = await PDFDocument.load(copyBuf, opt);
      repairPdfDocCatalog(doc, repairLog);
      const count = doc.getPageCount();
      if (count > 0) {
        diagnosticAttempts.push({
          attempt: i + 1,
          options: opt,
          success: true,
        });
        return { doc, attempts: diagnosticAttempts, repairLog };
      }
    } catch (err: any) {
      diagnosticAttempts.push({
        attempt: i + 1,
        options: opt,
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

    if (subtype === 'Highlight') {
      annotDictProps.CA = opacity || 0.4;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
      const w = Math.max(0.1, x2 - x1);
      const h = Math.max(0.1, y2 - y1);
      streamOperators = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`;
    } else if (subtype === 'Underline') {
      annotDictProps.CA = opacity || 0.9;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      const lineY = (y1 + (strokeWidth || 2) / 2).toFixed(2);
      streamOperators = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j ${x1.toFixed(2)} ${lineY} m ${x2.toFixed(2)} ${lineY} l S Q`;
    } else if (subtype === 'StrikeOut') {
      annotDictProps.CA = opacity || 0.9;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      const lineY = ((y1 + y2) / 2).toFixed(2);
      streamOperators = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j ${x1.toFixed(2)} ${lineY} m ${x2.toFixed(2)} ${lineY} l S Q`;
    } else if (subtype === 'Text') {
      annotDictProps.Name = 'Comment';
    } else if (subtype === 'FreeText') {
      const fs = options.fontSize || 14;
      annotDictProps.DA = PDFString.of(`/Helv ${fs} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
    } else if (subtype === 'Ink' && inkList) {
      annotDictProps.InkList = inkList;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];

      let inkOps = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j `;
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
      annotDictProps.CA = opacity || 1.0;
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

      let shapeOps = `q ${strokeWidth} w 1 J 1 j ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG `;
      if (interiorColorRgb) {
        shapeOps += `${interiorColorRgb.red.toFixed(3)} ${interiorColorRgb.green.toFixed(3)} ${interiorColorRgb.blue.toFixed(3)} rg `;
      }
      if (subtype === 'Square') {
        shapeOps += `${rx} ${ry} ${rw} ${rh} re ${interiorColorRgb ? 'B' : 'S'} Q`;
      } else {
        const radX = (w / 2 - halfW);
        const radY = (h / 2 - halfW);
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
        shapeOps += `${interiorColorRgb ? 'B' : 'S'} Q`;
      }
      streamOperators = shapeOps;
    } else if (subtype === 'Line' && lineCoordinates) {
      annotDictProps.CA = opacity || 1.0;
      annotDictProps.L = lineCoordinates;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
      annotDictProps.Border = [0, 0, strokeWidth || 2];
      const [lx1, ly1, lx2, ly2] = lineCoordinates;
      streamOperators = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${strokeWidth} w 1 J 1 j ${lx1.toFixed(2)} ${ly1.toFixed(2)} m ${lx2.toFixed(2)} ${ly2.toFixed(2)} l S Q`;
    }

    // Attach Appearance Stream (/AP << /N streamRef >>) for universal ISO 32000-1 viewer rendering
    if (streamOperators) {
      const apFormDict = {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: rect,
        Resources: {
          ProcSet: ['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI'],
        },
      };
      const apStream = context.flateStream(streamOperators, apFormDict);
      const apStreamRef = context.register(apStream);
      annotDictProps.AP = context.obj({
        N: apStreamRef,
      });
    }

    const annotDict = context.obj(annotDictProps);
    const annotRef = context.register(annotDict);

    // Get or create Annots array on page node
    const annotsName = PDFName.of('Annots');
    let annots = targetPage.node.get(annotsName);
    if (!annots) {
      const newAnnots = context.obj([annotRef]);
      targetPage.node.set(annotsName, newAnnots);
    } else if (annots instanceof PDFArray) {
      annots.push(annotRef);
    }
  } catch (err) {
    console.warn('Failed to embed native PDF annotation:', err);
  }
};

/**
 * Exports edited document with all pages, drawn annotations, and native PDF comments
 */
export const exportEditedPdf = async (
  sources: SourceDocument[],
  pages: PdfPageModel[],
  annotations: Annotation[],
  outputFileName: string = 'document-edited.pdf'
): Promise<Uint8Array> => {
  const startTime = Date.now();
  logger.info('save', `Zahájen export PDF: "${outputFileName}" (${pages.length} stran)`, {
    outputFileName,
    totalPages: pages.length,
    sourcesCount: sources.length,
    annotationsCount: annotations.length,
  });

  const outputDoc = await PDFDocument.create();

  // Pre-load source PDF documents into memory map with automatic catalog repair
  const sourceDocsMap = new Map<string, PDFDocument>();
  for (const src of sources) {
    if (src.arrayBuffer) {
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

    // Find all pages originating from this source
    const srcPages = pages.filter((p) => p.sourceDocId === src.id && p.sourceType === 'pdf');
    if (srcPages.length > 0) {
      try {
        const pageCount = srcDoc.getPageCount();
        const indicesToCopy = srcPages.map((p) =>
          Math.min(Math.max(0, p.originalPageIndex ?? 0), Math.max(0, pageCount - 1))
        );
        const copiedList = await outputDoc.copyPages(srcDoc, indicesToCopy);
        copiedPagesMap.set(src.id, copiedList);
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
    imageEmbedCache.set(dataUrl, cached);
    return cached;
  };

  // Process pages in order
  for (const pageModel of pages) {
    let targetPage: PDFPage | null = null;

    if (pageModel.sourceType === 'image' && (pageModel.imageBytes || pageModel.imageDataUrl)) {
      let embeddedImage: PDFImage;
      if (pageModel.imageBytes) {
        if (pageModel.imageMimeType === 'image/png') {
          embeddedImage = await outputDoc.embedPng(pageModel.imageBytes);
        } else {
          try {
            embeddedImage = await outputDoc.embedJpg(pageModel.imageBytes);
          } catch {
            embeddedImage = await outputDoc.embedPng(pageModel.imageBytes);
          }
        }
      } else {
        embeddedImage = await embedDataUrlImage(outputDoc, pageModel.imageDataUrl!);
      }

      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
      targetPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageModel.width,
        height: pageModel.height,
      });
    } else if (pageModel.sourceType === 'blank') {
      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
    } else {
      const count = srcCounter.get(pageModel.sourceDocId) || 0;
      const list = copiedPagesMap.get(pageModel.sourceDocId);
      if (list && list[count]) {
        targetPage = outputDoc.addPage(list[count]);
        srcCounter.set(pageModel.sourceDocId, count + 1);
      } else {
        const srcDoc = sourceDocsMap.get(pageModel.sourceDocId);
        if (srcDoc) {
          try {
            const pageCount = srcDoc.getPageCount();
            const pageIdx = Math.min(
              Math.max(0, pageModel.originalPageIndex ?? 0),
              Math.max(0, pageCount - 1)
            );
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
          const sourceDoc = sources.find((s) => s.id === pageModel.sourceDocId) || sources[0];
          if (sourceDoc && sourceDoc.arrayBuffer) {
            const highResDataUrl = await renderPdfPageToDataUrl(sourceDoc, pageModel, 2.0);
            const embeddedImg = await embedDataUrlImage(outputDoc, highResDataUrl);
            targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
            targetPage.drawImage(embeddedImg, {
              x: 0,
              y: 0,
              width: pageModel.width,
              height: pageModel.height,
            });
            const dataUrlKb = (highResDataUrl.length * 0.75 / 1024).toFixed(1);
            logger.warn(
              'save',
              `Záchranná rastrizace pro stranu ${pageModel.id} proběhla úspěšně (${dataUrlKb} KB)`,
              {
                pageId: pageModel.id,
                pageNumber: (pageModel.originalPageIndex ?? 0) + 1,
                sourceDocId: pageModel.sourceDocId,
                dimensions: `${pageModel.width.toFixed(0)} × ${pageModel.height.toFixed(0)} pt`,
                rasterScale: 2.0,
                renderedImageSizeKB: dataUrlKb,
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
        }
      }
    }

    if (!targetPage) {
      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
    }

    // Clear pre-existing annotations dictionary on copied page so deleted/modified annotations don't conflict
    try {
      targetPage.node.delete(PDFName.of('Annots'));
    } catch {
      // Ignore if no Annots node
    }

    // Apply rotation
    if (pageModel.rotation !== undefined) {
      targetPage.setRotation(degrees(pageModel.rotation));
    }

    const { height: pageHeight } = targetPage.getSize();

    // Get annotations for this page
    const pageAnnotations = annotations.filter((a) => a.pageId === pageModel.id);

    for (const ann of pageAnnotations) {
      try {
        switch (ann.type) {
          case 'highlight': {
            const h = ann as HighlightAnnotation;
            const pdfColor = hexToPdfRgb(h.color || '#fef08a');
            const pdfY = pageHeight - h.y - h.height;
            const x1 = h.x;
            const y1 = pdfY;
            const x2 = h.x + h.width;
            const y2 = pdfY + h.height;

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: h.id,
              subtype: 'Highlight',
              rect: [x1, y1, x2, y2],
              quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
              contents: h.comment,
              author: h.author,
              colorRgb: pdfColor,
              opacity: h.opacity || 0.4,
            });
            break;
          }

          case 'underline': {
            const u = ann as UnderlineAnnotation;
            const strokeWidth = u.strokeWidth || 2;
            const pdfColor = hexToPdfRgb(u.color || '#0284c7');
            const pad = Math.max(2, strokeWidth / 2);
            const pdfY = pageHeight - (u.y + strokeWidth);
            const x1 = u.x;
            const y1 = pdfY - pad;
            const x2 = u.x + u.width;
            const y2 = pdfY + strokeWidth + pad;

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: u.id,
              subtype: 'Underline',
              rect: [x1, y1, x2, y2],
              quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
              contents: u.comment,
              author: u.author,
              colorRgb: pdfColor,
              opacity: u.opacity || 0.9,
              strokeWidth,
            });
            break;
          }

          case 'strikethrough': {
            const s = ann as StrikethroughAnnotation;
            const strokeWidth = s.strokeWidth || 2;
            const pdfColor = hexToPdfRgb(s.color || '#dc2626');
            const pad = Math.max(2, strokeWidth / 2);
            const pdfY = pageHeight - (s.y + strokeWidth);
            const x1 = s.x;
            const y1 = pdfY - pad;
            const x2 = s.x + s.width;
            const y2 = pdfY + strokeWidth + pad;

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: s.id,
              subtype: 'StrikeOut',
              rect: [x1, y1, x2, y2],
              quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
              contents: s.comment,
              author: s.author,
              colorRgb: pdfColor,
              opacity: s.opacity || 0.9,
              strokeWidth,
            });
            break;
          }

          case 'text': {
            const t = ann as TextAnnotation;
            const pdfColor = hexToPdfRgb(t.color || '#0f172a');
            const fontSize = t.fontSize || 14;
            const x1 = t.x;
            const y1 = pageHeight - t.y - t.height;
            const x2 = t.x + t.width;
            const y2 = pageHeight - t.y;

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: t.id,
              subtype: 'FreeText',
              rect: [x1, y1, x2, y2],
              contents: t.text,
              author: t.author,
              colorRgb: pdfColor,
              fontSize,
            });
            break;
          }

          case 'note': {
            const n = ann as NoteAnnotation;
            const pdfColor = hexToPdfRgb(n.color || '#f59e0b');
            const pdfY = pageHeight - n.y - 20;

            addNativePdfAnnotation(outputDoc, targetPage, {
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

            targetPage.drawImage(sigImage, {
              x: sig.x,
              y: pdfY,
              width: sig.width,
              height: sig.height,
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
                id: sh.id,
                subtype: 'Circle',
                rect: [x1, y1, x2, y2],
                colorRgb: strokeColor,
                interiorColorRgb: interiorColor,
                strokeWidth,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'line' && sh.endPoint) {
              const startX = sh.x;
              const startY = pageHeight - sh.y;
              const endX = sh.endPoint.x;
              const endY = pageHeight - sh.endPoint.y;
              const pad = Math.max(2, strokeWidth / 2);
              const minLx = Math.min(startX, endX) - pad;
              const maxLx = Math.max(startX, endX) + pad;
              const minLy = Math.min(startY, endY) - pad;
              const maxLy = Math.max(startY, endY) + pad;

              addNativePdfAnnotation(outputDoc, targetPage, {
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
      } catch (err) {
        console.warn(`Error drawing annotation ${ann.id}:`, err);
      }
    }
  }

  try {
    // Save document as bytes with PDF 1.5 Object Stream compression
    const pdfBytes = await outputDoc.save({ useObjectStreams: true });
    const elapsed = Date.now() - startTime;
    logger.success('save', `PDF export úspěšně dokončen: ${(pdfBytes.length / 1024).toFixed(1)} KB za ${elapsed} ms`, {
      outputFileName,
      sizeBytes: pdfBytes.length,
      durationMs: elapsed,
      totalPages: pages.length,
    });

    // Create client-side download link if in browser environment
    if (typeof document !== 'undefined') {
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
        if (document.body.contains(link)) {
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
