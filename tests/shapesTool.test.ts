import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { PdfPageModel } from '../src/types/document';
import { ShapeAnnotation } from '../src/types/annotations';

describe('Geometric Shapes Tool & Toolbar Enhancements', () => {
  it('should export Rectangle, Ellipse, and Line shapes to ISO 32000-1 native annotations with proper borders and fill colors', async () => {
    const pageModel: PdfPageModel = {
      id: 'page-shapes',
      sourceDocId: 'src-blank',
      originalPageIndex: 0,
      pageNumber: 1,
      width: 595.28,
      height: 841.89,
      rotation: 0,
      sourceType: 'blank',
    };

    const annotations: ShapeAnnotation[] = [
      {
        id: 'shape-rect-1',
        pageId: 'page-shapes',
        type: 'shape',
        shapeType: 'rectangle',
        x: 50,
        y: 100,
        width: 150,
        height: 80,
        color: '#dc2626',
        fillColor: '#fef3c7',
        strokeWidth: 4,
        opacity: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'shape-ellipse-1',
        pageId: 'page-shapes',
        type: 'shape',
        shapeType: 'ellipse',
        x: 250,
        y: 100,
        width: 120,
        height: 90,
        color: '#16a34a',
        fillColor: 'transparent',
        strokeWidth: 2,
        opacity: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'shape-line-1',
        pageId: 'page-shapes',
        type: 'shape',
        shapeType: 'line',
        x: 50,
        y: 300,
        width: 200,
        height: 50,
        endPoint: { x: 250, y: 350 },
        color: '#0284c7',
        strokeWidth: 6,
        opacity: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const exportedBytes = await exportEditedPdf([], [pageModel], annotations, 'shapes-test.pdf');
    const doc = await PDFDocument.load(exportedBytes);
    const pages = doc.getPages();
    expect(pages.length).toBe(1);

    const pageNode = pages[0].node;
    const annotsRef = pageNode.get(PDFName.of('Annots')) as PDFArray;
    expect(annotsRef).toBeDefined();
    expect(annotsRef.size()).toBe(3);

    const annots: PDFDict[] = [];
    for (let i = 0; i < annotsRef.size(); i++) {
      annots.push(annotsRef.lookup(i) as PDFDict);
    }

    // 1. Verify Rectangle (Square subtype)
    const squareAnnot = annots.find((a) => a.get(PDFName.of('Subtype'))?.toString() === '/Square');
    expect(squareAnnot).toBeDefined();
    const squareBs = squareAnnot!.lookup(PDFName.of('BS')) as PDFDict;
    expect(squareBs.get(PDFName.of('W'))?.toString()).toBe('4');
    const squareIc = squareAnnot!.lookup(PDFName.of('IC')) as PDFArray;
    expect(squareIc).toBeDefined(); // Filled with #fef3c7

    // 2. Verify Ellipse (Circle subtype)
    const circleAnnot = annots.find((a) => a.get(PDFName.of('Subtype'))?.toString() === '/Circle');
    expect(circleAnnot).toBeDefined();
    const circleBs = circleAnnot!.lookup(PDFName.of('BS')) as PDFDict;
    expect(circleBs.get(PDFName.of('W'))?.toString()).toBe('2');
    const circleIc = circleAnnot!.lookup(PDFName.of('IC'));
    expect(circleIc).toBeUndefined(); // Transparent fill -> no /IC dictionary entry

    // 3. Verify Line (Line subtype)
    const lineAnnot = annots.find((a) => a.get(PDFName.of('Subtype'))?.toString() === '/Line');
    expect(lineAnnot).toBeDefined();
    const lineBs = lineAnnot!.lookup(PDFName.of('BS')) as PDFDict;
    expect(lineBs.get(PDFName.of('W'))?.toString()).toBe('6');
    const lineL = lineAnnot!.lookup(PDFName.of('L')) as PDFArray;
    expect(lineL).toBeDefined();
    expect(lineL.size()).toBe(4); // [x1, y1, x2, y2]
  });

  it('should support updating shape type, fill color, and stroke width dynamically', () => {
    let shape: ShapeAnnotation = {
      id: 'shape-dyn',
      pageId: 'page-1',
      type: 'shape',
      shapeType: 'rectangle',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      color: '#000000',
      strokeWidth: 2,
      createdAt: 100,
      updatedAt: 100,
    };

    // Morph to ellipse with fill
    shape = {
      ...shape,
      shapeType: 'ellipse',
      fillColor: '#dbeafe',
      strokeWidth: 8,
      updatedAt: 200,
    };

    expect(shape.shapeType).toBe('ellipse');
    expect(shape.fillColor).toBe('#dbeafe');
    expect(shape.strokeWidth).toBe(8);

    // Morph to line
    shape = {
      ...shape,
      shapeType: 'line',
      endPoint: { x: 100, y: 100 },
      fillColor: undefined,
      updatedAt: 300,
    };

    expect(shape.shapeType).toBe('line');
    expect(shape.endPoint).toEqual({ x: 100, y: 100 });
    expect(shape.fillColor).toBeUndefined();
  });
});
