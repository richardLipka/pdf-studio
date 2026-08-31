import {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  PDFPage,
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

export const exportEditedPdf = async (
  sources: SourceDocument[],
  pages: PdfPageModel[],
  annotations: Annotation[],
  outputFileName: string = 'document-edited.pdf'
): Promise<Uint8Array> => {
  const outputDoc = await PDFDocument.create();

  // Map to hold loaded Source Documents in pdf-lib
  const sourceDocsMap = new Map<string, PDFDocument>();

  for (const src of sources) {
    try {
      const doc = await PDFDocument.load(src.arrayBuffer, { ignoreEncryption: true });
      sourceDocsMap.set(src.id, doc);
    } catch (e) {
      console.error(`Failed to load source doc ${src.id} in pdf-lib:`, e);
    }
  }

  // Preload standard fonts
  const fontHelvetica = await outputDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await outputDoc.embedFont(StandardFonts.HelveticaBold);

  // Reconstruct each page in current order
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageModel = pages[pageIdx];
    let targetPage: PDFPage;

    if (pageModel.sourceType === 'image' && pageModel.imageDataUrl) {
      // Embed Image Page
      let embeddedImage;
      if (pageModel.imageDataUrl.startsWith('data:image/png')) {
        embeddedImage = await outputDoc.embedPng(pageModel.imageDataUrl);
      } else {
        // Assume JPEG or convert
        try {
          embeddedImage = await outputDoc.embedJpg(pageModel.imageDataUrl);
        } catch {
          // If jpg embed fails, use png
          embeddedImage = await outputDoc.embedPng(pageModel.imageDataUrl);
        }
      }

      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
      targetPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageModel.width,
        height: pageModel.height,
      });
    } else if (pageModel.sourceType === 'blank') {
      // Blank Page
      targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
    } else {
      // PDF Page from source
      const srcDoc = sourceDocsMap.get(pageModel.sourceDocId);
      if (srcDoc) {
        const [copiedPage] = await outputDoc.copyPages(srcDoc, [pageModel.originalPageIndex]);
        targetPage = outputDoc.addPage(copiedPage);
      } else {
        targetPage = outputDoc.addPage([pageModel.width, pageModel.height]);
      }
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
            targetPage.drawRectangle({
              x: h.x,
              y: pdfY,
              width: Math.max(2, h.width),
              height: Math.max(2, h.height),
              color: pdfColor,
              opacity: h.opacity || 0.35,
            });
            break;
          }

          case 'underline': {
            const u = ann as UnderlineAnnotation;
            const pdfColor = hexToPdfRgb(u.color || '#ef4444');
            const pdfY = pageHeight - (u.y + u.height);
            targetPage.drawLine({
              start: { x: u.x, y: pdfY },
              end: { x: u.x + u.width, y: pdfY },
              thickness: u.strokeWidth || 2,
              color: pdfColor,
              opacity: u.opacity || 0.9,
            });
            break;
          }

          case 'strikethrough': {
            const s = ann as StrikethroughAnnotation;
            const pdfColor = hexToPdfRgb(s.color || '#dc2626');
            const pdfY = pageHeight - (s.y + s.height / 2);
            targetPage.drawLine({
              start: { x: s.x, y: pdfY },
              end: { x: s.x + s.width, y: pdfY },
              thickness: s.strokeWidth || 2,
              color: pdfColor,
              opacity: s.opacity || 0.85,
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
            break;
          }

          case 'note': {
            const n = ann as NoteAnnotation;
            const pdfColor = hexToPdfRgb(n.color || '#fbbf24');
            const pdfY = pageHeight - n.y - 20;

            // Draw Note Sticky Icon Badge
            targetPage.drawRectangle({
              x: n.x,
              y: pdfY,
              width: 20,
              height: 20,
              color: pdfColor,
              borderColor: rgb(0.7, 0.5, 0.1),
              borderWidth: 1,
            });

            targetPage.drawText('N', {
              x: n.x + 6,
              y: pdfY + 4,
              size: 11,
              font: fontHelveticaBold,
              color: rgb(0.2, 0.15, 0.05),
            });

            // If note has text, also render a subtle callout box beside it
            if (n.text) {
              const textSnippet = n.text.length > 50 ? n.text.substring(0, 47) + '...' : n.text;
              targetPage.drawRectangle({
                x: n.x + 24,
                y: pdfY - 2,
                width: Math.min(220, textSnippet.length * 6 + 14),
                height: 24,
                color: rgb(1, 0.98, 0.85),
                borderColor: rgb(0.85, 0.75, 0.4),
                borderWidth: 0.5,
              });
              targetPage.drawText(textSnippet, {
                x: n.x + 30,
                y: pdfY + 5,
                size: 8,
                font: fontHelvetica,
                color: rgb(0.2, 0.2, 0.2),
              });
            }
            break;
          }

          case 'drawing': {
            const d = ann as DrawingAnnotation;
            if (d.points && d.points.length > 1) {
              const pdfColor = hexToPdfRgb(d.color || '#0284c7');
              for (let i = 0; i < d.points.length - 1; i++) {
                const p1 = d.points[i];
                const p2 = d.points[i + 1];
                targetPage.drawLine({
                  start: { x: p1.x, y: pageHeight - p1.y },
                  end: { x: p2.x, y: pageHeight - p2.y },
                  thickness: d.strokeWidth || 2,
                  color: pdfColor,
                  opacity: d.opacity || 1.0,
                });
              }
            }
            break;
          }

          case 'signature': {
            const sig = ann as SignatureAnnotation;
            if (sig.imageDataUrl) {
              const sigImg = await outputDoc.embedPng(sig.imageDataUrl);
              const pdfY = pageHeight - sig.y - sig.height;
              targetPage.drawImage(sigImg, {
                x: sig.x,
                y: pdfY,
                width: sig.width,
                height: sig.height,
                opacity: sig.opacity || 1.0,
              });
            }
            break;
          }

          case 'shape': {
            const sh = ann as ShapeAnnotation;
            const pdfColor = hexToPdfRgb(sh.color || '#0284c7');
            const pdfY = pageHeight - sh.y - sh.height;

            if (sh.shapeType === 'rectangle') {
              targetPage.drawRectangle({
                x: sh.x,
                y: pdfY,
                width: sh.width,
                height: sh.height,
                borderColor: pdfColor,
                borderWidth: sh.strokeWidth || 2,
                color: sh.fillColor ? hexToPdfRgb(sh.fillColor) : undefined,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'ellipse') {
              targetPage.drawEllipse({
                x: sh.x + sh.width / 2,
                y: pdfY + sh.height / 2,
                xScale: Math.max(1, sh.width / 2),
                yScale: Math.max(1, sh.height / 2),
                borderColor: pdfColor,
                borderWidth: sh.strokeWidth || 2,
                color: sh.fillColor ? hexToPdfRgb(sh.fillColor) : undefined,
                opacity: sh.opacity || 1.0,
              });
            } else if (sh.shapeType === 'line' || sh.shapeType === 'arrow') {
              targetPage.drawLine({
                start: { x: sh.x, y: pageHeight - sh.y },
                end: { x: sh.x + sh.width, y: pageHeight - (sh.y + sh.height) },
                thickness: sh.strokeWidth || 2,
                color: pdfColor,
                opacity: sh.opacity || 1.0,
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error(`Failed to burn annotation ${ann.id}:`, err);
      }
    }
  }

  const outputPdfBytes = await outputDoc.save();

  // Trigger browser download
  const blob = new Blob([outputPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = outputFileName.endsWith('.pdf') ? outputFileName : `${outputFileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);

  return outputPdfBytes;
};
