import {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  PDFPage,
  PDFName,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFImage,
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
  subtype: 'Text' | 'Highlight' | 'Underline' | 'StrikeOut' | 'FreeText' | 'Ink';
  rect: [number, number, number, number];
  quadPoints?: number[];
  inkList?: number[][];
  contents?: string;
  author?: string;
  colorRgb?: { red: number; green: number; blue: number };
  opacity?: number;
  strokeWidth?: number;
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
      contents = '',
      author = '',
      colorRgb,
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

    if (subtype === 'Highlight') {
      annotDictProps.CA = opacity || 0.4;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
    } else if (subtype === 'Underline') {
      annotDictProps.CA = opacity || 0.9;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
    } else if (subtype === 'StrikeOut') {
      annotDictProps.CA = opacity || 0.9;
      annotDictProps.QuadPoints = quadPoints || [x1, y2, x2, y2, x1, y1, x2, y1];
    } else if (subtype === 'Text') {
      annotDictProps.Name = 'Comment';
    } else if (subtype === 'Ink' && inkList) {
      annotDictProps.InkList = inkList;
      annotDictProps.BS = context.obj({ Type: 'Border', W: strokeWidth || 2 });
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
  const outputDoc = await PDFDocument.create();

  // Pre-load source PDF documents into memory map
  const sourceDocsMap = new Map<string, PDFDocument>();
  for (const src of sources) {
    if (src.arrayBuffer) {
      try {
        const doc = await PDFDocument.load(src.arrayBuffer, { ignoreEncryption: true });
        sourceDocsMap.set(src.id, doc);
      } catch (e) {
        console.warn(`Could not load source doc ${src.id}:`, e);
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
      const indicesToCopy = srcPages.map((p) => p.originalPageIndex);
      try {
        const copiedList = await outputDoc.copyPages(srcDoc, indicesToCopy);
        copiedPagesMap.set(src.id, copiedList);
      } catch (err) {
        console.warn(`Error batch copying pages from source ${src.id}:`, err);
      }
    }
  }

  // Pre-embed standard fonts for text and notes
  const fontHelvetica = await outputDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await outputDoc.embedFont(StandardFonts.HelveticaBold);

  // Cache embedded image objects (signatures, stamps, image pages)
  const imageEmbedCache = new Map<string, PDFImage>();
  const srcCounter = new Map<string, number>();

  // Process pages in order
  for (const pageModel of pages) {
    let targetPage: PDFPage;

    if (pageModel.sourceType === 'image' && pageModel.imageDataUrl) {
      let embeddedImage = imageEmbedCache.get(pageModel.imageDataUrl);
      if (!embeddedImage) {
        if (pageModel.imageDataUrl.startsWith('data:image/png')) {
          embeddedImage = await outputDoc.embedPng(pageModel.imageDataUrl);
        } else {
          try {
            embeddedImage = await outputDoc.embedJpg(pageModel.imageDataUrl);
          } catch {
            embeddedImage = await outputDoc.embedPng(pageModel.imageDataUrl);
          }
        }
        imageEmbedCache.set(pageModel.imageDataUrl, embeddedImage);
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
          const [copiedPage] = await outputDoc.copyPages(srcDoc, [pageModel.originalPageIndex]);
          targetPage = outputDoc.addPage(copiedPage);
        } else {
          targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
        }
      }
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
            const pdfColor = hexToPdfRgb(u.color || '#0284c7');
            const pdfY = pageHeight - (u.y + (u.strokeWidth || 2));
            const x1 = u.x;
            const y1 = pdfY;
            const x2 = u.x + u.width;
            const y2 = pdfY + Math.max(4, u.strokeWidth || 2);

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: u.id,
              subtype: 'Underline',
              rect: [x1, y1, x2, y2],
              quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
              contents: u.comment,
              author: u.author,
              colorRgb: pdfColor,
              opacity: u.opacity || 0.9,
              strokeWidth: u.strokeWidth || 2,
            });
            break;
          }

          case 'strikethrough': {
            const s = ann as StrikethroughAnnotation;
            const pdfColor = hexToPdfRgb(s.color || '#dc2626');
            const pdfY = pageHeight - (s.y + (s.strokeWidth || 2));
            const x1 = s.x;
            const y1 = pdfY;
            const x2 = s.x + s.width;
            const y2 = pdfY + Math.max(4, s.strokeWidth || 2);

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: s.id,
              subtype: 'StrikeOut',
              rect: [x1, y1, x2, y2],
              quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
              contents: s.comment,
              author: s.author,
              colorRgb: pdfColor,
              opacity: s.opacity || 0.9,
              strokeWidth: s.strokeWidth || 2,
            });
            break;
          }

          case 'text': {
            const t = ann as TextAnnotation;
            const pdfColor = hexToPdfRgb(t.color || '#1e293b');
            const fontSize = t.fontSize || 12;
            const pdfY = pageHeight - t.y - fontSize;

            if (t.backgroundColor && t.backgroundColor !== 'transparent') {
              targetPage.drawRectangle({
                x: t.x - 2,
                y: pageHeight - t.y - t.height,
                width: t.width + 4,
                height: t.height,
                color: hexToPdfRgb(t.backgroundColor),
                opacity: 0.9,
              });
            }

            // Split multiline text
            const lines = (t.text || '').split('\n');
            let currentLineY = pdfY;
            for (const line of lines) {
              if (line.trim().length > 0) {
                targetPage.drawText(line, {
                  x: t.x,
                  y: currentLineY,
                  size: fontSize,
                  font: t.bold ? fontHelveticaBold : fontHelvetica,
                  color: pdfColor,
                  opacity: t.opacity || 1.0,
                });
              }
              currentLineY -= fontSize * 1.25;
            }

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: t.id,
              subtype: 'FreeText',
              rect: [t.x, pageHeight - t.y - t.height, t.x + t.width, pageHeight - t.y],
              contents: t.text,
              author: t.author,
              colorRgb: pdfColor,
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

            const pdfColor = hexToPdfRgb(d.color || '#0284c7');
            const minX = Math.min(...d.points.map((p) => p.x));
            const maxX = Math.max(...d.points.map((p) => p.x));
            const minY = Math.min(...d.points.map((p) => pageHeight - p.y));
            const maxY = Math.max(...d.points.map((p) => pageHeight - p.y));
            const inkPath = d.points.flatMap((p) => [p.x, pageHeight - p.y]);

            addNativePdfAnnotation(outputDoc, targetPage, {
              id: d.id,
              subtype: 'Ink',
              rect: [minX, minY, maxX, maxY],
              inkList: [inkPath],
              colorRgb: pdfColor,
              strokeWidth: d.strokeWidth || 2,
            });
            break;
          }

          case 'signature': {
            const sig = ann as SignatureAnnotation;
            if (!sig.imageDataUrl) break;

            let sigImage = imageEmbedCache.get(sig.imageDataUrl);
            if (!sigImage) {
              sigImage = await outputDoc.embedPng(sig.imageDataUrl);
              imageEmbedCache.set(sig.imageDataUrl, sigImage);
            }
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
            const strokeColor = hexToPdfRgb(sh.color || '#0284c7');
            const pdfY = pageHeight - sh.y - sh.height;

            if (sh.shapeType === 'rectangle') {
              targetPage.drawRectangle({
                x: sh.x,
                y: pdfY,
                width: sh.width,
                height: sh.height,
                borderColor: strokeColor,
                borderWidth: sh.strokeWidth || 2,
                color: sh.fillColor && sh.fillColor !== 'transparent' ? hexToPdfRgb(sh.fillColor) : undefined,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'ellipse') {
              targetPage.drawEllipse({
                x: sh.x + sh.width / 2,
                y: pdfY + sh.height / 2,
                xScale: sh.width / 2,
                yScale: sh.height / 2,
                borderColor: strokeColor,
                borderWidth: sh.strokeWidth || 2,
                color: sh.fillColor && sh.fillColor !== 'transparent' ? hexToPdfRgb(sh.fillColor) : undefined,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'line' && sh.endPoint) {
              targetPage.drawLine({
                start: { x: sh.x, y: pageHeight - sh.y },
                end: { x: sh.endPoint.x, y: pageHeight - sh.endPoint.y },
                thickness: sh.strokeWidth || 2,
                color: strokeColor,
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

  // Save document as bytes with PDF 1.5 Object Stream compression
  const pdfBytes = await outputDoc.save({ useObjectStreams: true });

  // Create client-side download link
  const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = outputFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 2000);

  return pdfBytes;
};
