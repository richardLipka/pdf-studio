import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { inflateSync } from 'zlib';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFRawStream,
  StandardFonts,
  degrees,
} from 'pdf-lib';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { rotatePage, rotateAnnotationWithPage } from '../src/services/pageManager';
import {
  getPageContentStream,
  parseStreamSegments,
  removeMultipleElementsFromPage,
  replaceTextInStreamString,
  updateStreamSegmentInPage,
  escapePdfLiteralString,
  unescapePdfLiteralString,
} from '../src/services/contentStreamEditor';
import { signPdfWithCertificate, generateSelfSignedCertificate } from '../src/services/digitalSignatureService';
import { prepareTextForFont } from '../src/services/pdfFonts';
import { createSamplePdfDoc } from '../src/utils/file';
import { PdfPageModel, SourceDocument } from '../src/types/document';
import {
  Annotation,
  DrawingAnnotation,
  HighlightAnnotation,
  ShapeAnnotation,
  StrikethroughAnnotation,
  UnderlineAnnotation,
} from '../src/types/annotations';
import { getMarkupLine, markupBoxFromLine, markupLineFromQuad } from '../src/utils/markupGeometry';
import { parsePdfPages, extractPdfAnnotations } from '../src/services/pdfLoader';

// Serve the Liberation fonts shipped with pdfjs-dist to the exporter, like the browser build does
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const fileName = String(url).split('/').pop()!;
    const fontPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts', fileName);
    if (!fs.existsSync(fontPath)) return new Response(null, { status: 404 });
    return new Response(fs.readFileSync(fontPath));
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const annotsOf = (doc: PDFDocument, pageIndex = 0): PDFDict[] => {
  const annots = doc.getPage(pageIndex).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref) as PDFDict);
};

const subtypeOf = (dict: PDFDict) => dict.lookup(PDFName.of('Subtype'))?.toString();

const numbersOf = (arr: unknown): number[] =>
  (arr as PDFArray).asArray().map((n: any) => n.asNumber());

describe('Page rotation keeps displayed dimensions and annotations consistent', () => {
  const page: PdfPageModel = {
    id: 'p1',
    sourceDocId: 'blank',
    sourceType: 'blank',
    originalPageIndex: 0,
    rotation: 0,
    width: 600,
    height: 800,
  };

  it('swaps width and height on quarter turns only', () => {
    const r90 = rotatePage(page, 90);
    expect([r90.width, r90.height, r90.rotation]).toEqual([800, 600, 90]);
    const r180 = rotatePage(page, 180);
    expect([r180.width, r180.height, r180.rotation]).toEqual([600, 800, 180]);
    const rNeg90 = rotatePage(page, -90);
    expect([rNeg90.width, rNeg90.height, rNeg90.rotation]).toEqual([800, 600, 270]);
  });

  it('moves annotations with the content and returns them after a full turn', () => {
    const highlight: HighlightAnnotation = {
      id: 'h', pageId: 'p1', type: 'highlight', x: 10, y: 20, width: 100, height: 12,
      color: '#ff0', opacity: 0.4, createdAt: 0, updatedAt: 0,
    };
    // Clockwise quarter turn: the top-left corner of the content goes to the top-right
    const turned = rotateAnnotationWithPage(highlight, 600, 800, 90);
    expect(turned).toMatchObject({ x: 800 - 32, y: 10, width: 12, height: 100 });

    let current: Annotation = highlight;
    let w = 600;
    let h = 800;
    for (let i = 0; i < 4; i++) {
      current = rotateAnnotationWithPage(current, w, h, 90);
      [w, h] = [h, w];
    }
    expect(current).toMatchObject({ x: 10, y: 20, width: 100, height: 12 });

    const drawing: DrawingAnnotation = {
      id: 'd', pageId: 'p1', type: 'drawing', x: 0, y: 0, width: 10, height: 10, color: '#000',
      opacity: 1, strokeWidth: 2, points: [{ x: 0, y: 0 }, { x: 50, y: 70 }], createdAt: 0, updatedAt: 0,
    };
    const flipped = rotateAnnotationWithPage(drawing, 600, 800, 180) as DrawingAnnotation;
    expect(flipped.points).toEqual([{ x: 600, y: 800 }, { x: 550, y: 730 }]);
  });
});

describe('Export maps annotations into rotated and offset pages', () => {
  it('places a highlight drawn on a 90° rotated page where it is displayed', async () => {
    // Blank A4 portrait page rotated to landscape: displayed 842 x 595
    const rotated = rotatePage(
      { id: 'p1', sourceDocId: 'blank', sourceType: 'blank', originalPageIndex: 0, rotation: 0, width: 595, height: 842 },
      90
    );
    const highlight: HighlightAnnotation = {
      id: 'h', pageId: 'p1', type: 'highlight', x: 100, y: 50, width: 200, height: 20,
      color: '#fde047', opacity: 0.4, createdAt: 0, updatedAt: 0,
    };

    const bytes = await exportEditedPdf([], [rotated], [highlight], 'rotated.pdf');
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    expect(page.getRotation().angle).toBe(90);
    // The MediaBox stays portrait, /Rotate turns it
    expect(page.getMediaBox()).toMatchObject({ width: 595, height: 842 });

    const [annot] = annotsOf(doc);
    // Display (x, yTop) -> user space for /Rotate 90: x_user = y_display, y_user = x_display
    expect(numbersOf(annot.lookup(PDFName.of('Rect')))).toEqual([50, 100, 70, 300]);
    const ap = doc.context.lookup((annot.lookup(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'))) as PDFRawStream;
    expect(numbersOf(ap.dict.lookup(PDFName.of('Matrix')))).toEqual([0, 1, -1, 0, 595, 0]);
  });

  it('keeps annotation positions on pages whose CropBox does not start at the origin', async () => {
    const srcDoc = await PDFDocument.create();
    const srcPage = srcDoc.addPage([600, 800]);
    srcPage.setMediaBox(0, 0, 600, 800);
    srcPage.setCropBox(50, 100, 500, 600);
    const source: SourceDocument = { id: 'main', name: 'crop.pdf', arrayBuffer: toArrayBuffer(await srcDoc.save()) };
    const pageModel: PdfPageModel = {
      id: 'p1', sourceDocId: 'main', sourceType: 'pdf', originalPageIndex: 0, rotation: 0, width: 500, height: 600,
    };
    const shape: ShapeAnnotation = {
      id: 's', pageId: 'p1', type: 'shape', shapeType: 'rectangle', x: 0, y: 0, width: 100, height: 50,
      color: '#000000', strokeWidth: 2, opacity: 1, createdAt: 0, updatedAt: 0,
    };

    const doc = await PDFDocument.load(await exportEditedPdf([source], [pageModel], [shape], 'crop.pdf'));
    const [annot] = annotsOf(doc);
    // Top-left of the visible (cropped) area is (50, 700) in user space
    expect(numbersOf(annot.lookup(PDFName.of('Rect')))).toEqual([50, 650, 150, 700]);
  });

  it('keeps unrotated MediaBox for rotated image pages', async () => {
    const pngBytes = Uint8Array.from(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    );
    const imagePage = rotatePage(
      { id: 'img', sourceDocId: 'img_1', sourceType: 'image', originalPageIndex: 0, rotation: 0, width: 400, height: 300,
        imageBytes: pngBytes, imageMimeType: 'image/png' },
      90
    );
    const doc = await PDFDocument.load(await exportEditedPdf([], [imagePage], [], 'img.pdf'));
    expect(doc.getPage(0).getMediaBox()).toMatchObject({ width: 400, height: 300 });
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });
});

describe('Export handles pre-existing annotations without loss or duplication', () => {
  it('drops imported sticky notes (re-created from editor state) but preserves stamps', async () => {
    const srcDoc = await PDFDocument.create();
    const page = srcDoc.addPage([600, 800]);
    const note = srcDoc.context.register(
      srcDoc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('old note') })
    );
    const popup = srcDoc.context.register(
      srcDoc.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [40, 40, 200, 100], Parent: note })
    );
    const stamp = srcDoc.context.register(
      srcDoc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [100, 100, 200, 150], Name: 'Approved' })
    );
    page.node.set(PDFName.of('Annots'), srcDoc.context.obj([note, popup, stamp]));

    const source: SourceDocument = { id: 'main', name: 'notes.pdf', arrayBuffer: toArrayBuffer(await srcDoc.save()) };
    const pageModel: PdfPageModel = {
      id: 'p1', sourceDocId: 'main', sourceType: 'pdf', originalPageIndex: 0, rotation: 0, width: 600, height: 800,
    };
    // The editor state holds the imported note (as extractPdfAnnotations would create it)
    const importedNote: Annotation = {
      id: 'imported_note', pageId: 'p1', type: 'note', x: 10, y: 770, width: 24, height: 24,
      color: '#f59e0b', opacity: 1, text: 'old note', createdAt: 0, updatedAt: 0,
    };

    const doc = await PDFDocument.load(await exportEditedPdf([source], [pageModel], [importedNote], 'notes.pdf'));
    const subtypes = annotsOf(doc).map(subtypeOf).sort();
    expect(subtypes).toEqual(['/Stamp', '/Text']);
  });

  it('burns whiteout text into the page without adding a duplicate FreeText annotation', async () => {
    const page: PdfPageModel = {
      id: 'p1', sourceDocId: 'blank', sourceType: 'blank', originalPageIndex: 0, rotation: 0, width: 595, height: 842,
    };
    const whiteout: Annotation = {
      id: 'w', pageId: 'p1', type: 'whiteout', x: 50, y: 50, width: 200, height: 30, color: '#ffffff',
      fillColor: '#ffffff', opacity: 1, text: 'Nová cena: 1200 Kč', textColor: '#000000', fontSize: 12,
      fontFamily: 'Inter', createdAt: 0, updatedAt: 0,
    };
    const doc = await PDFDocument.load(await exportEditedPdf([], [page], [whiteout], 'wo.pdf'));
    expect(annotsOf(doc)).toHaveLength(0);
    // Czech text needs the embedded Unicode font
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const baseFonts = fonts.entries().map(([, ref]) => (doc.context.lookup(ref) as PDFDict).lookup(PDFName.of('BaseFont'))!.toString());
    expect(baseFonts.some((name) => name.includes('LiberationSans'))).toBe(true);
  });

  it('writes Czech text annotations with a Unicode font instead of mis-mapped WinAnsi codes', async () => {
    const page: PdfPageModel = {
      id: 'p1', sourceDocId: 'blank', sourceType: 'blank', originalPageIndex: 0, rotation: 0, width: 595, height: 842,
    };
    const text: Annotation = {
      id: 't', pageId: 'p1', type: 'text', x: 50, y: 50, width: 300, height: 40, color: '#000000', opacity: 1,
      text: 'Příliš žluťoučký kůň', fontSize: 14, fontFamily: 'Inter', createdAt: 0, updatedAt: 0,
    };
    const doc = await PDFDocument.load(await exportEditedPdf([], [page], [text], 'cz.pdf'));
    const [annot] = annotsOf(doc);
    const ap = doc.context.lookup((annot.lookup(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'))) as PDFRawStream;
    const ops = new TextDecoder('latin1').decode(inflateSync(Buffer.from(ap.contents)));
    expect(ops).toContain('/U1 14 Tf');
    const apFonts = (ap.dict.lookup(PDFName.of('Resources')) as PDFDict).lookup(PDFName.of('Font')) as PDFDict;
    expect(apFonts.has(PDFName.of('U1'))).toBe(true);
  });

  it('does not trigger a download when asked not to (signing exports in memory first)', async () => {
    const click = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, click }),
      body: { appendChild: vi.fn(), removeChild: vi.fn(), contains: () => false },
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() }));
    try {
      const page: PdfPageModel = {
        id: 'p1', sourceDocId: 'blank', sourceType: 'blank', originalPageIndex: 0, rotation: 0, width: 595, height: 842,
      };
      await exportEditedPdf([], [page], [], 'x.pdf', undefined, undefined, undefined, 'interactive', false);
      expect(click).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('document', undefined);
    }
  });
});

describe('Content stream editing with Form XObjects', () => {
  const buildDocWithSharedForm = async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.context.register(
      doc.context.flateStream('BT /F1 10 Tf 1 0 0 1 20 20 Tm (Header in form) Tj ET', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 300, 100],
        Resources: { Font: { F1: font.ref } },
      })
    );
    const resources = doc.context.register(doc.context.obj({ Font: { F1: font.ref }, XObject: { Fm0: form } }));
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([600, 800]);
      page.node.set(PDFName.of('Resources'), resources);
      const contents = doc.context.register(
        doc.context.flateStream(
          `q /Fm0 Do Q\nBT /F1 12 Tf 1 0 0 1 72 700 Tm (Body text) Tj ET\nBT /F1 12 Tf 1 0 0 1 72 680 Tm (Second line) Tj ET`
        )
      );
      page.node.set(PDFName.of('Contents'), contents);
    }
    return toArrayBuffer(await doc.save());
  };

  const pageContentsText = async (bytes: ArrayBuffer, pageIndex: number) => {
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(pageIndex).node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    return streams
      .map((s: any) => new TextDecoder('latin1').decode(s.dict.has(PDFName.of('Filter')) ? inflateSync(Buffer.from(s.contents)) : s.contents))
      .join('\n');
  };

  it('does not inline form content into the page when removing a page text block', async () => {
    const bytes = await buildDocWithSharedForm();
    const { streamText } = await getPageContentStream(bytes, 0);
    expect(streamText).toContain('Header in form');

    const target = parseStreamSegments(streamText).find((s) => s.previewText === 'Second line')!;
    const res = await removeMultipleElementsFromPage(bytes, 0, [target.id], []);
    expect(res.error).toBeUndefined();

    const contents = await pageContentsText(res.updatedPdfBytes, 0);
    expect(contents).toContain('Body text');
    expect(contents).not.toContain('Second line');
    expect(contents).not.toContain('Header in form');
    expect(res.updatedStream).toContain('Header in form');
  });

  it('writes edits of form text into a page-local copy of the form', async () => {
    const bytes = await buildDocWithSharedForm();
    const res = await updateStreamSegmentInPage(
      bytes,
      0,
      'BT /F1 10 Tf 1 0 0 1 20 20 Tm (Header in form) Tj ET',
      'BT /F1 10 Tf 1 0 0 1 20 20 Tm (Edited header) Tj ET'
    );
    expect(res.error).toBeUndefined();
    expect(await pageContentsText(res.updatedPdfBytes, 0)).not.toContain('header');

    const page1 = await getPageContentStream(res.updatedPdfBytes, 0);
    const page2 = await getPageContentStream(res.updatedPdfBytes, 1);
    expect(page1.streamText).toContain('Edited header');
    expect(page2.streamText).toContain('Header in form');
  });

  it('removes the selected one of two identical blocks', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const block = 'BT /F1 12 Tf 1 0 0 1 72 700 Tm (Same) Tj ET';
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`${block}\nq 1 0 0 1 0 0 cm Q\n${block}`)));
    const bytes = toArrayBuffer(await doc.save());

    const segments = parseStreamSegments((await getPageContentStream(bytes, 0)).streamText).filter((s) => s.type === 'text');
    const res = await removeMultipleElementsFromPage(bytes, 0, [segments[1].id], []);
    expect(res.updatedStream).toBe(`${block}\nq 1 0 0 1 0 0 cm Q\n`);
  });

  it('keeps shared images on other pages when removing an image from one page', async () => {
    const doc = await PDFDocument.create();
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const image = await doc.embedPng(pngBytes);
    const resources = doc.context.register(doc.context.obj({ XObject: { Im1: image.ref } }));
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([600, 800]);
      page.node.set(PDFName.of('Resources'), resources);
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 100 0 0 100 50 50 cm /Im1 Do Q')));
    }
    const bytes = toArrayBuffer(await doc.save());

    const res = await removeMultipleElementsFromPage(bytes, 0, [], ['Im1']);
    const out = await PDFDocument.load(res.updatedPdfBytes);
    const xobjectOf = (i: number) => out.getPage(i).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjectOf(0).has(PDFName.of('Im1'))).toBe(false);
    expect(xobjectOf(1).has(PDFName.of('Im1'))).toBe(true);
    expect(await pageContentsText(res.updatedPdfBytes, 1)).toContain('/Im1 Do');
  });
});

describe('Text replacement never rewrites operators', () => {
  it('leaves the stream untouched when the text only appears outside strings', () => {
    const stream = 'q 1 0 0 1 0 0 cm 0 0 100 100 re f Q BT /F1 12 Tf (Hello) Tj ET';
    const res = replaceTextInStreamString(stream, 're', 'XX');
    expect(res.count).toBe(0);
    expect(res.modifiedContent).toBe(stream);
  });

  it('keeps Czech characters of a replaced literal string encoded as octal escapes', () => {
    const stream = `BT /F1 12 Tf (P${escapePdfLiteralString('říliš žluťoučký kůň', true)}) Tj ET`;
    const res = replaceTextInStreamString(stream, 'kůň', 'pes');
    expect(res.count).toBe(1);
    // No raw non-Latin-1 characters may reach the byte stream
    expect([...res.modifiedContent].every((c) => c.charCodeAt(0) < 256)).toBe(true);
    const literal = res.modifiedContent.match(/\((.*)\) Tj/)![1];
    expect(unescapePdfLiteralString(literal)).toBe('Příliš žluťoučký pes');
  });
});

describe('Digital signatures', () => {
  let cert: Awaited<ReturnType<typeof generateSelfSignedCertificate>>;
  beforeAll(async () => {
    cert = await generateSelfSignedCertificate({ commonName: 'Jiří Dvořák', validityDays: 30 });
  }, 60000);

  it('signs documents whose AcroForm is an indirect object and draws the requested badge', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const form = doc.getForm();
    form.createTextField('name').addToPage(doc.getPage(0), { x: 50, y: 700 });
    expect(doc.catalog.get(PDFName.of('AcroForm'))!.constructor.name).toBe('PDFRef');

    const result = await signPdfWithCertificate(
      toArrayBuffer(await doc.save()),
      cert.privateKeyPem,
      cert.certificatePem,
      { reason: 'Schváleno ředitelem', visualAppearance: true }
    );
    const signed = await PDFDocument.load(result.signedPdfBytes);
    const widget = annotsOf(signed).find((a) => a.lookup(PDFName.of('FT'))?.toString() === '/Sig')!;
    expect(widget).toBeDefined();
    const rect = numbersOf(widget.lookup(PDFName.of('Rect')));
    expect(rect[2] - rect[0]).toBeGreaterThan(0);
    expect(widget.lookup(PDFName.of('AP'))).toBeInstanceOf(PDFDict);

    const sig = widget.lookup(PDFName.of('V')) as PDFDict;
    expect((sig.lookup(PDFName.of('Reason')) as PDFHexString).decodeText()).toBe('Schváleno ředitelem');
    expect((sig.lookup(PDFName.of('Name')) as PDFHexString).decodeText()).toBe('Jiří Dvořák');
  }, 60000);

  it('generates certificates with positive serial numbers', () => {
    expect(cert.certInfo.serialNumber.startsWith('01')).toBe(true);
  });
});

describe('Czech text in generated PDFs', () => {
  it('builds the Czech sample document', async () => {
    const buffer = await createSamplePdfDoc('cs');
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(2);
  });

  it('degrades characters a standard font cannot draw instead of throwing', async () => {
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    expect(prepareTextForFont(helvetica, 'Důvěrnost ▸ šéf')).toBe('Duvernost › šéf');
    doc.addPage().drawText(prepareTextForFont(helvetica, 'DŮVĚRNOSTI'), { font: helvetica });
  });
});

describe('Underline and strikethrough orientation', () => {
  const underline: UnderlineAnnotation = {
    id: 'u', pageId: 'p1', type: 'underline', x: 100, y: 200, width: 150, height: 2, strokeWidth: 2,
    color: '#0284c7', opacity: 0.9, createdAt: 0, updatedAt: 0,
  };

  it('moves the line to the edge where the text bottom ends up after a page turn', () => {
    // Page 600 x 800; underline along the bottom edge (y = 202) of horizontal text
    expect(getMarkupLine('underline', underline, underline.textRotation)).toEqual([
      { x: 100, y: 202 }, { x: 250, y: 202 },
    ]);
    const turned = rotateAnnotationWithPage(underline, 600, 800, 90) as UnderlineAnnotation;
    expect(turned.textRotation).toBe(90);
    // Content point (x, y) -> (800 - y, x): the former bottom edge becomes the box's left edge
    expect(getMarkupLine('underline', turned, turned.textRotation)).toEqual([
      { x: 598, y: 100 }, { x: 598, y: 250 },
    ]);
  });

  it('rebuilds the same box from its line for every orientation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const kind of ['underline', 'strikethrough'] as const) {
        const box = { x: 10, y: 20, width: rotation % 180 ? 3 : 90, height: rotation % 180 ? 90 : 3 };
        const [start, end] = getMarkupLine(kind, box, rotation);
        expect(markupBoxFromLine(kind, start, end, 3, rotation)).toEqual(box);
      }
    }
  });

  it('reads the same line from QuadPoints in Acrobat and specification corner order', () => {
    // Text running top to bottom (rotated 90°) in display space, box x 10..22, y 100..300
    const acrobat = [{ x: 22, y: 100 }, { x: 22, y: 300 }, { x: 10, y: 100 }, { x: 10, y: 300 }];
    const counterClockwise = [{ x: 10, y: 100 }, { x: 10, y: 300 }, { x: 22, y: 300 }, { x: 22, y: 100 }];
    for (const quad of [acrobat, counterClockwise]) {
      expect(markupLineFromQuad('underline', quad)).toEqual({
        start: { x: 10, y: 100 }, end: { x: 10, y: 300 }, textRotation: 90,
      });
      expect(markupLineFromQuad('strikethrough', quad)).toMatchObject({
        start: { x: 16, y: 100 }, end: { x: 16, y: 300 },
      });
    }
  });

  it('survives export and re-import on a rotated page without moving', async () => {
    const page = rotatePage(
      { id: 'p1', sourceDocId: 'blank', sourceType: 'blank', originalPageIndex: 0, rotation: 0, width: 600, height: 800 },
      90
    );
    const vertical = rotateAnnotationWithPage(underline, 600, 800, 90) as UnderlineAnnotation;
    const strike: StrikethroughAnnotation = {
      id: 's', pageId: 'p1', type: 'strikethrough', x: 300, y: 100, width: 200, height: 4, strokeWidth: 4,
      color: '#dc2626', opacity: 0.9, createdAt: 0, updatedAt: 0,
    };
    const bytes = await exportEditedPdf([], [page], [vertical, strike], 'markups.pdf');

    const buffer = toArrayBuffer(bytes);
    const reloadedPages = await parsePdfPages(buffer, 'roundtrip');
    expect(reloadedPages[0]).toMatchObject({ rotation: 90, width: 800, height: 600 });
    const imported = await extractPdfAnnotations(buffer, 'roundtrip', reloadedPages);

    const u = imported.find((a) => a.type === 'underline') as UnderlineAnnotation;
    const s = imported.find((a) => a.type === 'strikethrough') as StrikethroughAnnotation;
    expect(u.textRotation).toBe(90);
    const [us, ue] = getMarkupLine('underline', u, u.textRotation);
    const [vs, ve] = getMarkupLine('underline', vertical, vertical.textRotation);
    expect([us.x, us.y, ue.x, ue.y].map(Math.round)).toEqual([vs.x, vs.y, ve.x, ve.y].map(Math.round));

    expect(s.textRotation).toBe(0);
    const [ss, se] = getMarkupLine('strikethrough', s, s.textRotation);
    expect([ss.x, ss.y, se.x, se.y].map(Math.round)).toEqual([300, 102, 500, 102]);
  });
});

describe('Rotation helpers used by the exporter', () => {
  it('rotated copied pages keep /Rotate from the page model', async () => {
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([600, 800]).setRotation(degrees(90));
    const source: SourceDocument = { id: 'main', name: 'r.pdf', arrayBuffer: toArrayBuffer(await srcDoc.save()) };
    const pageModel: PdfPageModel = {
      id: 'p1', sourceDocId: 'main', sourceType: 'pdf', originalPageIndex: 0, rotation: 180, width: 600, height: 800,
    };
    const doc = await PDFDocument.load(await exportEditedPdf([source], [pageModel], [], 'r.pdf'));
    expect(doc.getPage(0).getRotation().angle).toBe(180);
  });
});
