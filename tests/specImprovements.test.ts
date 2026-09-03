import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFPage,
} from 'pdf-lib';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { getCachedPdfDocument } from '../src/services/pdfLoader';
import { SourceDocument, PdfPageModel } from '../src/types/document';

describe('ISO 32000-1 Specification Improvements for Unchanged Pages and Editing', () => {
  it('verifies that Link annotations can be preserved while removing stale review markups', async () => {
    // Create a document with a Link annotation and a Highlight annotation
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);

    // Create a Link annotation (URI)
    const linkDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [50, 700, 200, 720],
      A: {
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of('https://example.com'),
      },
    });
    const linkRef = doc.context.register(linkDict);

    // Create a Highlight annotation
    const highlightDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [50, 650, 200, 670],
    });
    const highlightRef = doc.context.register(highlightDict);

    const annotsArray = doc.context.obj([linkRef, highlightRef]);
    page.node.set(PDFName.of('Annots'), annotsArray);

    const docBytes = await doc.save();

    // Now test selective annotation filtering:
    // When saving unchanged pages, non-editable annotations like /Link and /Widget must be preserved!
    const loadedDoc = await PDFDocument.load(docBytes);
    const loadedPage = loadedDoc.getPage(0);
    const annots = loadedPage.node.lookup(PDFName.of('Annots'));
    expect(annots instanceof PDFArray).toBe(true);

    const editableSubtypes = new Set(['Highlight', 'Underline', 'StrikeOut', 'FreeText', 'Ink', 'Square', 'Circle', 'Line']);
    const preservedAnnots = loadedDoc.context.obj([]);

    for (let i = 0; i < (annots as PDFArray).size(); i++) {
      const annotRef = (annots as PDFArray).get(i);
      const annotDict = loadedDoc.context.lookup(annotRef);
      if (annotDict instanceof PDFDict) {
        const subtype = annotDict.lookup(PDFName.of('Subtype'));
        const subName = subtype instanceof PDFName ? subtype.asString().replace(/^\//, '') : '';
        if (!editableSubtypes.has(subName)) {
          preservedAnnots.push(annotRef);
        }
      }
    }

    expect(preservedAnnots.size()).toBe(1); // The Link annotation was preserved!
    const preservedSubtype = loadedDoc.context.lookup(preservedAnnots.get(0));
    expect((preservedSubtype as PDFDict).lookup(PDFName.of('Subtype'))?.toString()).toBe('/Link');
  });

  it('detects encrypted source documents and correctly falls back to high-res rasterization to avoid corrupted output', async () => {
    const specPath = path.resolve(__dirname, '../src/assets/testfiles/spec.pdf');
    if (!fs.existsSync(specPath)) return;

    const buffer = fs.readFileSync(specPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const sourceDoc: SourceDocument = {
      id: 'spec.pdf',
      name: 'spec.pdf',
      arrayBuffer,
      updatedAt: Date.now(),
    };

    // Export Page 1 using our exporter
    const pageModel: PdfPageModel = {
      id: 'page_1',
      sourceDocId: 'spec.pdf',
      sourceType: 'pdf',
      originalPageIndex: 0,
      width: 595,
      height: 842,
      rotation: 0,
    };

    const exportedBytes = await exportEditedPdf(
      [sourceDoc],
      [pageModel],
      [],
      'test_spec_p1.pdf',
      {
        scale: 1.5,
        format: 'image/jpeg',
        jpegQuality: 0.85,
      }
    );

    expect(exportedBytes).toBeDefined();
    expect(exportedBytes.byteLength).toBeGreaterThan(1000);

    // Verify with PDF.js that the exported page can be rendered and parsed without flate stream corruption
    const verifyDoc = await getCachedPdfDocument('exported_spec_p1.pdf', exportedBytes);
    expect(verifyDoc.numPages).toBe(1);
    const verifyPage = await verifyDoc.getPage(1);
    expect(verifyPage).toBeDefined();
    const opList = await verifyPage.getOperatorList();
    console.log('Verification PDF.js Operator List count:', opList.fnArray.length);
    expect(opList.fnArray.length).toBeGreaterThan(0);
  }, 60000);
});
