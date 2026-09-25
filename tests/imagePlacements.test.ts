import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import {
  getPageImages,
  getPageContentStream,
  removeMultipleElementsFromPage,
  removeXObjectInvocations,
  removeInlineImage,
  countXObjectInvocations,
} from '../src/services/contentStreamEditor';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// 1x1 red PNG
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

/** A page painting the same image three times, one inline image and an image inside a scaled form */
async function buildPage(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const png = await doc.embedPng(PNG_1PX);
  page.drawImage(png, { x: 0, y: 0, width: 1, height: 1 }); // registers the image, replaced below
  const form = doc.context.register(
    doc.context.flateStream('q 50 0 0 40 0 0 cm /ImF Do Q', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 100, 100],
      Matrix: [2, 0, 0, 2, 0, 0],
      Resources: { XObject: { ImF: png.ref } },
    })
  );
  const resources = page.node.Resources()!;
  resources.set(PDFName.of('XObject'), doc.context.obj({ ImA: png.ref, Fm1: form }));
  const content = doc.context.register(
    doc.context.flateStream(
      [
        'q 100 0 0 50 10 700 cm /ImA Do Q',
        'q 100 0 0 50 10 600 cm /ImA Do Q',
        'q 100 0 0 50 10 500 cm /ImA Do Q',
        'q 20 0 0 10 300 300 cm BI /W 2 /H 1 /BPC 8 /CS /G ID AB EI Q',
        'q 1 0 0 1 200 100 cm /Fm1 Do Q',
      ].join('\n')
    )
  );
  page.node.set(PDFName.of('Contents'), content);
  return toArrayBuffer(await doc.save());
}

describe('Image placements', () => {
  it('lists every painted image with its own id and position, forms and inline images included', async () => {
    const bytes = await buildPage();
    const { images, error } = await getPageImages(bytes, 0);
    expect(error).toBeUndefined();
    expect(images.map((im) => im.id)).toEqual(['img:ImA:0', 'img:ImA:1', 'img:ImA:2', 'inline:0', 'img:ImF:0']);
    const [a0, a1, , inline, formImage] = images;
    expect([a0.x, a0.y, a0.width, a0.height]).toEqual([10, 700, 100, 50]);
    expect(a1.y).toBe(600);
    expect(a0.placementCount).toBe(3);
    expect(inline).toMatchObject({ kind: 'inline', x: 300, y: 300, width: 20, height: 10, pixelWidth: 2, pixelHeight: 1 });
    // Form matrix (scale 2) applied on top of the translation where the form is invoked
    expect(formImage).toMatchObject({ inForm: true, x: 200, y: 100, width: 100, height: 80 });
    // Form XObjects themselves are not images
    expect(images.some((im) => im.cleanName === 'Fm1')).toBe(false);
  });

  it('deletes single placements and drops the image resource only when it is no longer painted', async () => {
    const bytes = await buildPage();
    // Two placements of the same image in one call: later occurrences go first, no renumbering slip
    const first = await removeMultipleElementsFromPage(bytes, 0, [], ['img:ImA:0', 'img:ImA:2']);
    expect(first.error).toBeUndefined();
    const after = await getPageImages(first.updatedPdfBytes, 0);
    expect(after.images.filter((im) => im.cleanName === 'ImA').map((im) => im.y)).toEqual([600]);

    const doc1 = await PDFDocument.load(first.updatedPdfBytes);
    const xobjects1 = doc1.getPage(0).node.Resources()!.lookup(PDFName.of('XObject')) as PDFDict;
    expect(xobjects1.has(PDFName.of('ImA'))).toBe(true);

    const second = await removeMultipleElementsFromPage(first.updatedPdfBytes, 0, [], ['img:ImA:0', 'inline:0']);
    expect(second.error).toBeUndefined();
    const doc2 = await PDFDocument.load(second.updatedPdfBytes);
    const xobjects2 = doc2.getPage(0).node.Resources()!.lookup(PDFName.of('XObject')) as PDFDict;
    expect(xobjects2.has(PDFName.of('ImA'))).toBe(false);
    const { streamText } = await getPageContentStream(second.updatedPdfBytes, 0);
    expect(streamText).not.toContain('BI');
    expect(streamText).toContain('/Fm1 Do');

    // The image inside the form can be removed too
    const third = await removeMultipleElementsFromPage(second.updatedPdfBytes, 0, [], ['img:ImF:0']);
    expect(third.error).toBeUndefined();
    expect((await getPageImages(third.updatedPdfBytes, 0)).images).toEqual([]);
  });

  it('removes one occurrence or one inline image by index', () => {
    const stream = 'q /Im1 Do Q q /Im1 Do Q BI /W 1 /H 1 ID x EI BI /W 1 /H 1 ID y EI';
    const one = removeXObjectInvocations(stream, 'Im1', 1);
    expect(one.removed).toBe(1);
    expect(countXObjectInvocations(one.stream, 'Im1')).toBe(1);
    const inline = removeInlineImage(stream, 1);
    expect(inline.stream).toContain('ID x EI');
    expect(inline.stream).not.toContain('ID y EI');
  });
});
