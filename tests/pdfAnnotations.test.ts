import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from 'pdf-lib';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { PdfPageModel, SourceDocument } from '../src/types/document';
import {
  Annotation,
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
  TextAnnotation,
  NoteAnnotation,
  DrawingAnnotation,
  ShapeAnnotation,
} from '../src/types/annotations';

describe('PDF Export & ISO 32000-1 Annotations Compatibility', () => {
  it('should export all annotation types as valid ISO 32000-1 native PDF annotations in /Annots array', async () => {
    const pageModel: PdfPageModel = {
      id: 'page-1',
      sourceDocId: 'src-blank',
      originalPageIndex: 0,
      pageNumber: 1,
      width: 595.28,
      height: 841.89,
      rotation: 0,
      sourceType: 'blank',
    };

    const annotations: Annotation[] = [
      {
        id: 'hl-1',
        pageId: 'page-1',
        type: 'highlight',
        x: 100,
        y: 150,
        width: 200,
        height: 18,
        color: '#fde047',
        opacity: 0.4,
        comment: 'Important review highlight',
        author: 'Reviewer Alice',
        createdAt: 1000,
        updatedAt: 1000,
      } as HighlightAnnotation,
      {
        id: 'und-1',
        pageId: 'page-1',
        type: 'underline',
        x: 100,
        y: 200,
        width: 150,
        height: 2,
        strokeWidth: 2,
        color: '#0284c7',
        opacity: 0.9,
        comment: 'Blue underline comment',
        author: 'Reviewer Bob',
        createdAt: 1000,
        updatedAt: 1000,
      } as UnderlineAnnotation,
      {
        id: 'str-1',
        pageId: 'page-1',
        type: 'strikethrough',
        x: 100,
        y: 250,
        width: 120,
        height: 2,
        strokeWidth: 2,
        color: '#dc2626',
        opacity: 0.9,
        comment: 'Red strikeout comment',
        author: 'Reviewer Charlie',
        createdAt: 1000,
        updatedAt: 1000,
      } as StrikethroughAnnotation,
      {
        id: 'txt-1',
        pageId: 'page-1',
        type: 'text',
        x: 100,
        y: 300,
        width: 180,
        height: 30,
        color: '#0f172a',
        opacity: 1.0,
        text: 'Custom Editable Textbox',
        fontSize: 16,
        fontFamily: 'Inter',
        createdAt: 1000,
        updatedAt: 1000,
      } as TextAnnotation,
      {
        id: 'note-1',
        pageId: 'page-1',
        type: 'note',
        x: 100,
        y: 350,
        width: 24,
        height: 24,
        color: '#f59e0b',
        opacity: 1.0,
        text: 'Sticky Note Remark',
        author: 'Author Dave',
        createdAt: 1000,
        updatedAt: 1000,
      } as NoteAnnotation,
      {
        id: 'draw-1',
        pageId: 'page-1',
        type: 'drawing',
        x: 100,
        y: 400,
        width: 50,
        height: 50,
        points: [
          { x: 100, y: 400 },
          { x: 120, y: 420 },
          { x: 150, y: 450 },
        ],
        color: '#0284c7',
        strokeWidth: 2,
        opacity: 1.0,
        createdAt: 1000,
        updatedAt: 1000,
      } as DrawingAnnotation,
      {
        id: 'rect-1',
        pageId: 'page-1',
        type: 'shape',
        shapeType: 'rectangle',
        x: 100,
        y: 500,
        width: 100,
        height: 60,
        color: '#0284c7',
        fillColor: 'transparent',
        strokeWidth: 2,
        opacity: 1.0,
        createdAt: 1000,
        updatedAt: 1000,
      } as ShapeAnnotation,
      {
        id: 'circle-1',
        pageId: 'page-1',
        type: 'shape',
        shapeType: 'ellipse',
        x: 250,
        y: 500,
        width: 80,
        height: 80,
        color: '#10b981',
        fillColor: 'transparent',
        strokeWidth: 2,
        opacity: 1.0,
        createdAt: 1000,
        updatedAt: 1000,
      } as ShapeAnnotation,
      {
        id: 'line-1',
        pageId: 'page-1',
        type: 'shape',
        shapeType: 'line',
        x: 100,
        y: 600,
        width: 100,
        height: 50,
        endPoint: { x: 200, y: 650 },
        color: '#ef4444',
        strokeWidth: 2,
        opacity: 1.0,
        createdAt: 1000,
        updatedAt: 1000,
      } as ShapeAnnotation,
    ];

    const sources: SourceDocument[] = [];
    const exportedBytes = await exportEditedPdf(sources, [pageModel], annotations, 'test.pdf');
    expect(exportedBytes).toBeInstanceOf(Uint8Array);
    expect(exportedBytes.length).toBeGreaterThan(0);

    // Reload the exported PDF with pdf-lib to inspect the low-level object tree
    const loadedDoc = await PDFDocument.load(exportedBytes);
    expect(loadedDoc.getPageCount()).toBe(1);

    const firstPage = loadedDoc.getPage(0);
    const annotsRef = firstPage.node.get(PDFName.of('Annots'));
    expect(annotsRef).toBeInstanceOf(PDFArray);

    const annotsArray = annotsRef as PDFArray;
    expect(annotsArray.size()).toBe(9); // All 9 annotations embedded

    const subtypesFound: string[] = [];

    for (let i = 0; i < annotsArray.size(); i++) {
      const annotDict = annotsArray.lookup(i) as PDFDict;
      expect(annotDict.get(PDFName.of('Type'))?.toString()).toBe('/Annot');

      const subtypeName = annotDict.get(PDFName.of('Subtype'))?.toString() || '';
      subtypesFound.push(subtypeName);

      // Verify print flag (F: 4)
      expect(annotDict.get(PDFName.of('F'))?.toString()).toBe('4');

      // Verify specific subtypes
      if (subtypeName === '/Highlight' || subtypeName === '/Underline' || subtypeName === '/StrikeOut') {
        // Must contain QuadPoints array of 8 numbers
        const quadPoints = annotDict.get(PDFName.of('QuadPoints'));
        expect(quadPoints).toBeInstanceOf(PDFArray);
        expect((quadPoints as PDFArray).size()).toBe(8);

        // Must contain /CA opacity
        const ca = annotDict.get(PDFName.of('CA'));
        expect(ca).toBeDefined();

        // Must contain /Rect
        const rect = annotDict.get(PDFName.of('Rect'));
        expect(rect).toBeInstanceOf(PDFArray);
        expect((rect as PDFArray).size()).toBe(4);
      }

      if (subtypeName === '/FreeText') {
        // Must contain /DA (Default Appearance)
        const da = annotDict.get(PDFName.of('DA'));
        expect(da).toBeDefined();
        // Must contain /Contents with the textbox text
        const contents = annotDict.get(PDFName.of('Contents'));
        expect(contents).toBeDefined();
      }

      if (subtypeName === '/Text') {
        // Sticky Note must contain /Name /Comment
        const name = annotDict.get(PDFName.of('Name'))?.toString();
        expect(name).toBe('/Comment');
      }

      if (subtypeName === '/Ink') {
        // Must contain /InkList
        const inkList = annotDict.get(PDFName.of('InkList'));
        expect(inkList).toBeInstanceOf(PDFArray);
      }

      if (subtypeName === '/Square' || subtypeName === '/Circle') {
        // Must contain /Rect and /BS
        expect(annotDict.get(PDFName.of('Rect'))).toBeInstanceOf(PDFArray);
        expect(annotDict.get(PDFName.of('BS'))).toBeDefined();
      }

      if (subtypeName === '/Line') {
        // Must contain /L (Line Coordinates)
        const lineCoords = annotDict.get(PDFName.of('L'));
        expect(lineCoords).toBeInstanceOf(PDFArray);
        expect((lineCoords as PDFArray).size()).toBe(4);
      }
    }

    expect(subtypesFound).toContain('/Highlight');
    expect(subtypesFound).toContain('/Underline');
    expect(subtypesFound).toContain('/StrikeOut');
    expect(subtypesFound).toContain('/FreeText');
    expect(subtypesFound).toContain('/Text');
    expect(subtypesFound).toContain('/Ink');
    expect(subtypesFound).toContain('/Square');
    expect(subtypesFound).toContain('/Circle');
    expect(subtypesFound).toContain('/Line');
  });

  it('should preserve page rotation angles on exported pages', async () => {
    const pages: PdfPageModel[] = [
      {
        id: 'p-0',
        sourceDocId: 'src-1',
        originalPageIndex: 0,
        pageNumber: 1,
        width: 595,
        height: 842,
        rotation: 90,
        sourceType: 'blank',
      },
      {
        id: 'p-1',
        sourceDocId: 'src-1',
        originalPageIndex: 1,
        pageNumber: 2,
        width: 595,
        height: 842,
        rotation: 180,
        sourceType: 'blank',
      },
    ];

    const bytes = await exportEditedPdf([], pages, [], 'rotated.pdf');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(180);
  });
});
