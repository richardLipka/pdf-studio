import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFHexString, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { removeXObjectInvocations, removeMultipleElementsFromPage, getPageContentStream } from '../src/services/contentStreamEditor';
import { applyDocumentMetadata, buildXmpPacket, wrapStyledRuns } from '../src/services/pdfExporter';
import { extractPdfMetadata } from '../src/services/pdfLoader';
import { assembleImagePdf, processPixels, flattenScaleFor, DEFAULT_FLATTEN_OPTIONS } from '../src/services/pdfFlattener';
import { DocumentMetadata } from '../src/types/document';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// 1x1 red PNG
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

describe('Image removal', () => {
  it('removes only the image when text is drawn before it in the same graphics group', () => {
    // Word-style stream: one outer q ... Q with text and then the image; a regex spanning from the
    // outer "q" up to "/Im1 Do Q" used to delete the text as well
    const stream = 'q 0.5 0 0 0.5 0 0 cm BT /F1 24 Tf 100 1400 Td (Text before image) Tj ET q 400 0 0 300 100 600 cm /Im1 Do Q Q';
    const { stream: out, removed } = removeXObjectInvocations(stream, 'Im1');
    expect(removed).toBe(1);
    expect(out).toContain('(Text before image) Tj');
    expect(out).not.toContain('/Im1 Do');
    // The image's own q ... cm ... Q wrapper goes with it, the outer group stays balanced
    expect(out).not.toContain('400 0 0 300 100 600 cm');
    expect((out.match(/\bq\b/g) || []).length).toBe((out.match(/\bQ\b/g) || []).length);
  });

  it('keeps a group that draws something else and removes just the invocation', () => {
    const stream = 'q 1 0 0 RG 0 0 m 10 10 l S /Im1 Do Q /Im2 Do';
    const { stream: out, removed } = removeXObjectInvocations(stream, '/Im1');
    expect(removed).toBe(1);
    expect(out).toContain('0 0 m 10 10 l S');
    expect(out).toContain('/Im2 Do');
    expect(out).not.toContain('/Im1 Do');
  });

  it('does not touch other names that share a prefix, and matches #-escaped names', () => {
    const { stream: out } = removeXObjectInvocations('q /Im10 Do Q q /Im1 Do Q q /Im#31x Do Q', 'Im1');
    expect(out).toContain('/Im10 Do');
    expect(out).not.toMatch(/\/Im1 Do/);
    expect(removeXObjectInvocations('q /Im#31x Do Q', 'Im1x').removed).toBe(1);
  });

  it('deletes a selected image from a real page and reports images it cannot find', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('Caption', { x: 50, y: 700, size: 14, font });
    const png = await doc.embedPng(PNG_1PX);
    page.drawImage(png, { x: 50, y: 400, width: 200, height: 200 });
    const bytes = toArrayBuffer(await doc.save());
    const before = await getPageContentStream(bytes, 0);
    const imageName = before.streamText.match(/\/(\S+) Do/)![1];

    const result = await removeMultipleElementsFromPage(bytes, 0, [], [imageName]);
    expect(result.error).toBeUndefined();
    expect(result.removedCount).toBe(1);
    const after = await getPageContentStream(result.updatedPdfBytes, 0);
    expect(after.streamText).not.toContain(`/${imageName} Do`);
    expect(after.streamText).toContain('Tj');

    const missing = await removeMultipleElementsFromPage(result.updatedPdfBytes, 0, [], [imageName]);
    expect(missing.error).toMatch(/nepodařilo najít/);
  });
});

describe('Document metadata', () => {
  const metadata: DocumentMetadata = {
    title: 'Smlouva o dílo',
    author: 'Jana Nováková',
    subject: 'Dodatek č. 2',
    keywords: 'smlouva, dodatek, 2026',
    creator: 'PDF Studio',
    producer: 'PDF Studio (test)',
    creationDate: '2024-03-15T08:30:00.000Z',
    modificationDate: '2025-01-02T10:00:00.000Z',
    autoModificationDate: false,
    source: 'Archiv – sken 2024',
    language: 'cs-CZ',
    customProperties: [
      { key: 'Company', value: 'Žluťoučký s.r.o.' },
      { key: 'Title', value: 'reserved keys are ignored' },
      { key: '', value: 'empty keys are ignored' },
    ],
  };

  it('writes Info entries, custom properties, language and XMP, and reads them back', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    applyDocumentMetadata(doc, metadata, new Date('2026-09-25T12:00:00Z'));
    const bytes = await doc.save();

    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reloaded.getTitle()).toBe('Smlouva o dílo');
    expect(reloaded.getAuthor()).toBe('Jana Nováková');
    expect(reloaded.getKeywords()).toBe('smlouva, dodatek, 2026');
    expect(reloaded.getCreationDate()?.toISOString()).toBe('2024-03-15T08:30:00.000Z');
    expect(reloaded.getModificationDate()?.toISOString()).toBe('2025-01-02T10:00:00.000Z');
    const info = (reloaded as any).getInfoDict();
    const text = (key: string) => {
      const v = info.lookup(PDFName.of(key));
      return v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined;
    };
    expect(text('Source')).toBe('Archiv – sken 2024');
    expect(text('Company')).toBe('Žluťoučký s.r.o.');
    expect(String(reloaded.catalog.lookup(PDFName.of('Lang')))).toContain('cs-CZ');

    const xmp = reloaded.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
    const xml = new TextDecoder().decode(decodePDFRawStream(xmp).decode());
    expect(xml).toContain('<dc:source>Archiv – sken 2024</dc:source>');
    expect(xml).toContain('<rdf:li>smlouva</rdf:li>');
    expect(xml).toContain('<xmp:CreateDate>2024-03-15T08:30:00.000Z</xmp:CreateDate>');

    // The app's loader returns the same values (custom properties included)
    const read = await extractPdfMetadata('meta-test', toArrayBuffer(bytes));
    expect(read.source).toBe('Archiv – sken 2024');
    expect(read.language).toBe('cs-CZ');
    expect(read.customProperties).toEqual([{ key: 'Company', value: 'Žluťoučký s.r.o.' }]);
    expect(read.creationDate).toBe('2024-03-15T08:30:00.000Z');
  });

  it('uses the time of saving as modification date by default and escapes XML', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const xml = buildXmpPacket({ ...metadata, title: 'A < B & "C"' }, null, now);
    expect(xml).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(xml).toContain('<xmp:ModifyDate>2026-09-25T12:00:00.000Z</xmp:ModifyDate>');
  });
});

describe('Flatten to images', () => {
  it('builds one full-page image per page with the original page sizes and metadata', async () => {
    const pdf = await assembleImagePdf(
      [
        { widthPt: 595, heightPt: 842, bytes: PNG_1PX, format: 'png' },
        { widthPt: 842, heightPt: 595, bytes: PNG_1PX, format: 'png' },
      ],
      { title: 'Sken', author: 'Tester', subject: '', keywords: '', creator: '', producer: '' }
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getSize()).toEqual({ width: 842, height: 595 });
    expect(doc.getTitle()).toBe('Sken');
    // Nothing but the image is drawn: no fonts on the page
    const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font')) as { keys(): unknown[] } | undefined;
    expect(fonts?.keys().length ?? 0).toBe(0);
  });

  it('converts pixels to grayscale / black and white and caps huge canvases', () => {
    const px = new Uint8ClampedArray([200, 40, 40, 255, 250, 250, 250, 255]);
    processPixels(px, { ...DEFAULT_FLATTEN_OPTIONS, colorMode: 'grayscale' }, () => 0.5);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    processPixels(px, { ...DEFAULT_FLATTEN_OPTIONS, colorMode: 'bw' }, () => 0.5);
    expect([px[0], px[4]]).toEqual([0, 255]);

    // A0 at 300 DPI would exceed browser canvas limits
    const scale = flattenScaleFor(2384, 3370, 300);
    expect(2384 * 3370 * scale * scale).toBeLessThanOrEqual(16_000_001);
  });
});

describe('Text wrapping in exported text boxes', () => {
  it('wraps words to the box width, splits over-long words and drops spaces at wrapped line starts', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize('Poznamka vpecena', 12) + 1;
    const lines = wrapStyledRuns([{ text: 'Poznamka vpecena do skenu', font }], 12, width);
    expect(lines.map((l) => l.map((p) => p.text).join(''))).toEqual(['Poznamka vpecena', 'do skenu']);
    for (const line of lines) expect(line.reduce((w, p) => w + p.width, 0)).toBeLessThanOrEqual(width + 0.01);

    const long = wrapStyledRuns([{ text: 'Supercalifragilistic', font }], 12, font.widthOfTextAtSize('Superc', 12));
    expect(long.length).toBeGreaterThan(2);
    expect(long.map((l) => l.map((p) => p.text).join('')).join('')).toBe('Supercalifragilistic');

    // Runs in different fonts stay separate pieces on the same line
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const mixed = wrapStyledRuns([{ text: 'Hello ', font }, { text: 'world', font: bold }], 12, 500);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].map((p) => p.font)).toEqual([font, bold]);
  });
});
