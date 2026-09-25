import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getPageTextModel } from '../src/services/pdfLoader';
import { parseStreamSegments, getPageContentStream, isLikelyCiphertext } from '../src/services/contentStreamEditor';
import { tokenizeContentStream, decodeLiteralStringBytes } from '../src/services/pdfContentTokenizer';
import { replaceTextBlockContent, replaceTextLineContent } from '../src/services/pdfTextEditor';
import { toReadableBlock, fromReadableBlock } from '../src/services/pdfReadableStream';
import { PdfPageModel, SourceDocument } from '../src/types/document';

// Serve pdfjs-dist's Liberation fonts for the substitute font, like the browser build does
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

const liberation = () =>
  fs.readFileSync(path.resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));

/** Page with a standard-font line, a subset CID-font Czech line, a TJ line and text in a Form XObject */
async function buildSamplePdf(): Promise<{ source: SourceDocument; page: PdfPageModel }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const unicodeFont = await doc.embedFont(liberation(), { subset: true });
  const page = doc.addPage([600, 800]);
  page.drawText('Hello MARKET', { x: 50, y: 700, size: 14, font: helvetica });
  page.drawText('Příliš žluťoučký kůň', { x: 50, y: 650, size: 20, font: unicodeFont });

  // A TJ line with kerning and a word gap, and a form XObject with its own text
  const helvRef = helvetica.ref;
  const form = doc.context.register(
    doc.context.flateStream('BT /FH 12 Tf 1 0 0 1 10 10 Tm (Header in form) Tj ET', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 300, 50],
      Resources: { Font: { FH: helvRef } },
    })
  );
  const resources = page.node.Resources()!;
  resources.set(PDFName.of('XObject'), doc.context.obj({ Fm1: form }));
  const fonts = resources.lookup(PDFName.of('Font')) as any;
  fonts.set(PDFName.of('FX'), helvRef);
  page.pushOperators();
  const extra = doc.context.register(
    doc.context.flateStream(
      'BT /FX 10 Tf 1 0 0 1 50 600 Tm [(BUD) 20 (GET) -300 (2026)] TJ ET\nq 1 0 0 1 300 500 cm /Fm1 Do Q'
    )
  );
  const contents = page.node.Contents() as any;
  contents.push(extra);

  const bytes = await doc.save();
  const source: SourceDocument = { id: 'model-test', name: 'model.pdf', arrayBuffer: toArrayBuffer(bytes) };
  const pageModel: PdfPageModel = {
    id: 'p1', sourceDocId: 'model-test', sourceType: 'pdf', originalPageIndex: 0, rotation: 0, width: 600, height: 800,
  };
  return { source, page: pageModel };
}

describe('Content stream tokenizer', () => {
  it('does not split text objects at "ET" inside strings or names', () => {
    const stream = 'BT /F1 12 Tf (BUDGET SHEET) Tj ET\nBT /FBT 9 Tf <0041> Tj ET';
    const segments = parseStreamSegments(stream).filter((s) => s.type === 'text');
    expect(segments.map((s) => s.rawContent)).toEqual([
      'BT /F1 12 Tf (BUDGET SHEET) Tj ET',
      'BT /FBT 9 Tf <0041> Tj ET',
    ]);
  });

  it('skips inline image data and decodes literal string escapes', () => {
    const ops = tokenizeContentStream('BI /W 2 /H 1 ID \u0001ET\u0002 EI q (a\\(b\\051\\\nc) Tj Q');
    expect(ops.map((o) => o.operator)).toEqual(['BI', 'ID', 'q', 'Tj', 'Q']);
    expect(decodeLiteralStringBytes(ops[3].operands[0].raw)).toEqual([0x61, 0x28, 0x62, 0x29, 0x63]);
  });
});

describe('Page text model', () => {
  it('aligns every text operator with the decoded text and exact position', async () => {
    const { source, page } = await buildSamplePdf();
    const model = await getPageTextModel(source, page);
    expect(model?.aligned).toBe(true);

    const texts = model!.blocks.map((b) => b.text);
    expect(texts).toEqual(['Hello MARKET', 'Příliš žluťoučký kůň', 'BUDGET 2026', 'Header in form']);

    // Displayed space has a top-left origin: baseline y = 800 - 700 = 100, text above it
    const hello = model!.blocks[0].bbox;
    expect(hello.x).toBeCloseTo(50, 0);
    expect(hello.y + hello.height).toBeCloseTo(100 + 0.207 * 14, 0);
    expect(hello.y).toBeCloseTo(100 - 0.718 * 14, 0);

    // Form text: cm moves it to (300, 500), Tm to (10, 10) inside the form
    const header = model!.blocks[3].bbox;
    expect(header.x).toBeCloseTo(310, 0);

    // The subset CID font uses 2-byte codes that cannot be found by searching the stream for text
    const czech = model!.blocks[1].runs[0];
    expect(czech.codeBytes).toBe(2);
    expect(model!.fontCodeMaps.get(czech.fontKey)?.codes.has('ř')).toBe(true);
    const { streamText } = await getPageContentStream(source.arrayBuffer, 0);
    expect(streamText.includes('Příliš')).toBe(false);
  });
});

describe('Text block editing', () => {
  const edit = async (source: SourceDocument, page: PdfPageModel, blockIndex: number, newText: string) => {
    const model = (await getPageTextModel(source, page))!;
    const segmentId = model.blocks[blockIndex].segmentId;
    const result = await replaceTextBlockContent(source.arrayBuffer, 0, model, segmentId, newText);
    expect(result.error).toBeUndefined();
    const edited: SourceDocument = { ...source, id: `${source.id}-edited`, arrayBuffer: result.updatedPdfBytes };
    const editedModel = (await getPageTextModel(edited, { ...page, sourceDocId: edited.id }))!;
    expect(editedModel.aligned).toBe(true);
    return { result, editedModel, before: model };
  };

  it('rewrites text of a subset CID font using the glyphs it already contains', async () => {
    const { source, page } = await buildSamplePdf();
    const { result, editedModel, before } = await edit(source, page, 1, 'kůň žluťoučký Příliš');
    expect(result.fontSubstituted).toBe(false);
    expect(editedModel.blocks.map((b) => b.text)).toEqual([
      'Hello MARKET', 'kůň žluťoučký Příliš', 'BUDGET 2026', 'Header in form',
    ]);
    // Same position and font size as the original text
    const original = before.blocks[1].bbox;
    const edited = editedModel.blocks[1].bbox;
    expect(edited.x).toBeCloseTo(original.x, 1);
    expect(edited.y).toBeCloseTo(original.y, 1);
    expect(edited.height).toBeCloseTo(original.height, 1);
  });

  it('embeds a substitute font when the original lacks a character and keeps the following text intact', async () => {
    const { source, page } = await buildSamplePdf();
    const { result, editedModel } = await edit(source, page, 0, 'Dobrý den, světe');
    expect(result.fontSubstituted).toBe(true);
    expect(editedModel.blocks.map((b) => b.text)).toEqual([
      'Dobrý den, světe', 'Příliš žluťoučký kůň', 'BUDGET 2026', 'Header in form',
    ]);
    // The substitute font must not leak into the text objects that follow
    expect(editedModel.blocks[2].runs[0].fontName).toMatch(/Helvetica/);
  });

  it('writes multi-line text with the original line position and edits text inside form XObjects', async () => {
    const { source, page } = await buildSamplePdf();
    const multi = await edit(source, page, 2, 'BUDGET\n2027');
    expect(multi.editedModel.blocks[2].text).toBe('BUDGET\n2027');
    const [line1, line2] = multi.editedModel.blocks[2].runs;
    expect(line2.bbox.y).toBeGreaterThan(line1.bbox.y + 8);

    const form = await edit(source, page, 3, 'Header');
    expect(form.editedModel.blocks[3].text).toBe('Header');
    expect(form.editedModel.blocks[3].bbox.x).toBeCloseTo(310, 0);
  });
});

describe('Human editing helpers', () => {
  const lineDoc = async () => {
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('x', { x: 10, y: 10, size: 1, font: helvetica });
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as any;
    fonts.set(PDFName.of('FL'), helvetica.ref);
    const extra = doc.context.register(
      doc.context.flateStream('BT /FL 12 Tf 14 TL 1 0 0 1 50 500 Tm (Line one) Tj T* [(Line) -250 (two)] TJ T* (Line three) Tj ET')
    );
    (page.node.Contents() as any).push(extra);
    const bytes = await doc.save();
    const source: SourceDocument = { id: 'lines', name: 'lines.pdf', arrayBuffer: toArrayBuffer(bytes) };
    const pageModel: PdfPageModel = {
      id: 'p1', sourceDocId: 'lines', sourceType: 'pdf', originalPageIndex: 0, rotation: 0, width: 600, height: 800,
    };
    return { source, pageModel };
  };

  it('splits a text object into lines and rewrites one line without moving the others', async () => {
    const { source, pageModel } = await lineDoc();
    const model = (await getPageTextModel(source, pageModel))!;
    const block = model.blocks.find((b) => b.text.startsWith('Line one'))!;
    expect(block.lines.map((l) => l.text)).toEqual(['Line one', 'Line two', 'Line three']);
    const third = block.lines[2].bbox;

    const result = await replaceTextLineContent(source.arrayBuffer, 0, model, block.lines[1].id, 'Zebra quiz');
    expect(result.error).toBeUndefined();
    // Characters not shown on the page come from the standard font's full encoding
    expect(result.fontSubstituted).toBe(false);
    const edited = (await getPageTextModel({ ...source, id: 'lines-2', arrayBuffer: result.updatedPdfBytes }, { ...pageModel, sourceDocId: 'lines-2' }))!;
    const editedBlock = edited.blocks.find((b) => b.text.startsWith('Line one'))!;
    expect(editedBlock.lines.map((l) => l.text)).toEqual(['Line one', 'Zebra quiz', 'Line three']);
    expect(editedBlock.lines[2].bbox.y).toBeCloseTo(third.y, 1);
    expect(editedBlock.lines[2].bbox.x).toBeCloseTo(third.x, 1);
  });

  it('shows hex glyph codes as readable text and converts only changed strings back', async () => {
    const { source, page } = await buildSamplePdf();
    const model = (await getPageTextModel(source, page))!;
    const block = model.blocks[1];
    const raw = model.streamText.substring(block.startIndex, block.endIndex);
    const readable = toReadableBlock(model, block);
    expect(readable.text).toContain('«Příliš žluťoučký kůň»');
    expect(fromReadableBlock(model, block, readable, readable.text)).toEqual({ raw });

    const changed = fromReadableBlock(model, block, readable, readable.text.replace('«Příliš žluťoučký kůň»', '«kůň úpí»'));
    expect('raw' in changed).toBe(false);
    const ok = fromReadableBlock(model, block, readable, readable.text.replace('«Příliš žluťoučký kůň»', '«kůň žluťoučký»'));
    expect('raw' in ok && /<[0-9A-F]+> Tj/.test(ok.raw)).toBe(true);
  });

  it('does not report pages starting with an inline image as undecodable', () => {
    const binary = Array.from({ length: 400 }, (_, i) => String.fromCharCode(128 + (i % 120))).join('');
    const stream = `q 100 0 0 100 0 0 cm BI /W 20 /H 20 /BPC 8 /CS /G ID ${binary} EI Q BT /F1 12 Tf (Hello) Tj ET`;
    expect(isLikelyCiphertext(stream)).toBe(false);
    expect(isLikelyCiphertext(binary + binary)).toBe(true);
  });
});
