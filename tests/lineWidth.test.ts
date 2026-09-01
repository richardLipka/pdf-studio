import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFStream } from 'pdf-lib';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { PdfPageModel } from '../src/types/document';
import {
  Annotation,
  DrawingAnnotation,
  ShapeAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
} from '../src/types/annotations';

describe('Line Width Storage, Export, and ISO 32000-1 Appearance Rendering', () => {
  it('should store and render exact strokeWidth in /BS, /Border, and /AP Appearance Streams', async () => {
    const pageModel: PdfPageModel = {
      id: 'page_lw_test',
      sourceDocId: 'blank_src',
      originalPageIndex: 0,
      pageNumber: 1,
      width: 600,
      height: 800,
      rotation: 0,
      sourceType: 'blank',
    };

    const annotations: Annotation[] = [
      {
        id: 'draw_1',
        pageId: 'page_lw_test',
        type: 'drawing',
        x: 50,
        y: 100,
        width: 100,
        height: 100,
        strokeWidth: 6,
        color: '#dc2626',
        opacity: 1.0,
        points: [
          { x: 50, y: 100 },
          { x: 150, y: 200 },
        ],
        createdAt: 1000,
        updatedAt: 1000,
      } as DrawingAnnotation,
      {
        id: 'line_1',
        pageId: 'page_lw_test',
        type: 'shape',
        shapeType: 'line',
        x: 50,
        y: 300,
        width: 200,
        height: 0,
        strokeWidth: 8,
        endPoint: { x: 250, y: 300 },
        color: '#0284c7',
        opacity: 1.0,
        createdAt: 1000,
        updatedAt: 1000,
      } as ShapeAnnotation,
      {
        id: 'rect_1',
        pageId: 'page_lw_test',
        type: 'shape',
        shapeType: 'rectangle',
        x: 50,
        y: 400,
        width: 120,
        height: 80,
        strokeWidth: 4,
        color: '#16a34a',
        fillColor: '#86efac',
        opacity: 0.9,
        createdAt: 1000,
        updatedAt: 1000,
      } as ShapeAnnotation,
      {
        id: 'ul_1',
        pageId: 'page_lw_test',
        type: 'underline',
        x: 50,
        y: 550,
        width: 180,
        height: 4,
        strokeWidth: 4,
        color: '#9333ea',
        opacity: 0.9,
        createdAt: 1000,
        updatedAt: 1000,
      } as UnderlineAnnotation,
      {
        id: 'st_1',
        pageId: 'page_lw_test',
        type: 'strikethrough',
        x: 50,
        y: 600,
        width: 180,
        height: 6,
        strokeWidth: 6,
        color: '#ea580c',
        opacity: 0.9,
        createdAt: 1000,
        updatedAt: 1000,
      } as StrikethroughAnnotation,
    ];

    const bytes = await exportEditedPdf([], [pageModel], annotations, 'line-widths.pdf');
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const annotsArray = page.node.get(PDFName.of('Annots')) as PDFArray;

    expect(annotsArray.size()).toBe(5);

    const expectedWidths = [6, 8, 4, 4, 6];

    for (let i = 0; i < annotsArray.size(); i++) {
      const dict = annotsArray.lookup(i) as PDFDict;
      const expectedW = expectedWidths[i];

      // 1. Check Border Style (/BS << /W width >>)
      const bsDict = dict.get(PDFName.of('BS')) as PDFDict;
      expect(bsDict).toBeDefined();
      const bsW = bsDict.get(PDFName.of('W'));
      expect(bsW).toBeDefined();

      // 2. Check /Border array
      const borderArr = dict.get(PDFName.of('Border')) as PDFArray;
      expect(borderArr).toBeDefined();
      expect(borderArr.size()).toBe(3);

      // 3. Check Appearance Stream (/AP << /N FormXObject >>)
      const apDict = dict.get(PDFName.of('AP')) as PDFDict;
      expect(apDict).toBeDefined();
      const apN = apDict.get(PDFName.of('N'));
      expect(apN).toBeDefined();

      // Verify the stream content includes the stroke width 'w' operator
      const streamObj = dict.context.lookup(apN) as PDFStream;
      const rawBytes = streamObj.getContents();
      const uncompressedBytes = zlib.inflateSync(rawBytes);
      const textDecoder = new TextDecoder();
      const streamText = textDecoder.decode(uncompressedBytes);

      expect(streamText).toContain(`${expectedW} w`);
    }
  });
});
