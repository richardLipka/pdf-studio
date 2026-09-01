import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  getPageImages,
  removeImageFromPage,
  removeStreamSegmentFromPage,
  removeMultipleElementsFromPage,
} from '../src/services/contentStreamEditor';
import { cloneSourceDocument } from '../src/context/DocumentContext';
import { SourceDocument } from '../src/types/document';

describe('Remove Elements (Blocks & Images) Service & Undo/Redo', () => {
  // Helper: Create sample 1-page PDF with text blocks and an embedded image
  async function createSamplePdf(): Promise<ArrayBuffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);

    // Draw text block 1
    page.drawText('Header Title Section', {
      x: 50,
      y: 720,
      size: 20,
      color: rgb(0, 0, 0),
    });

    // Draw text block 2
    page.drawText('Confidential Paragraph text to be deleted', {
      x: 50,
      y: 650,
      size: 12,
      color: rgb(0.2, 0.2, 0.2),
    });

    // Draw text block 3
    page.drawText('Footer Legal Notes 2026', {
      x: 50,
      y: 80,
      size: 10,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Embed 1x1 PNG image as XObject
    // 1x1 transparent PNG bytes
    const pngBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
      1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65,
      84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129,
      132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);

    const embeddedImage = await pdfDoc.embedPng(pngBytes);
    page.drawImage(embeddedImage, {
      x: 200,
      y: 400,
      width: 150,
      height: 100,
    });

    const saved = await pdfDoc.save();
    return saved.buffer.slice(
      saved.byteOffset,
      saved.byteOffset + saved.byteLength
    ) as ArrayBuffer;
  }

  it('should discover embedded images and inspect metadata', async () => {
    const pdfBytes = await createSamplePdf();
    const { images, error } = await getPageImages(pdfBytes, 0);

    expect(error).toBeUndefined();
    expect(images.length).toBeGreaterThanOrEqual(1);

    const firstImage = images[0];
    expect(firstImage.name).toMatch(/^\/[A-Za-z0-9_-]+/);
    expect(firstImage.cleanName).toBeTruthy();
    expect(firstImage.pixelWidth).toBe(1);
    expect(firstImage.pixelHeight).toBe(1);
  });

  it('should identify text blocks (BT ... ET) on page', async () => {
    const pdfBytes = await createSamplePdf();
    const { streamText, error } = await getPageContentStream(pdfBytes, 0);

    expect(error).toBeUndefined();
    expect(streamText).toContain('BT');

    const segments = parseStreamSegments(streamText);
    const textSegments = segments.filter((s) => s.type === 'text');
    expect(textSegments.length).toBeGreaterThanOrEqual(3);

    const confidentialBlock = textSegments.find((s) =>
      s.previewText.includes('Confidential')
    );
    expect(confidentialBlock).toBeDefined();
  });

  it('should remove a single text block permanently from content stream', async () => {
    const pdfBytes = await createSamplePdf();
    const { streamText } = await getPageContentStream(pdfBytes, 0);
    const segments = parseStreamSegments(streamText);
    const confidentialBlock = segments.find((s) =>
      s.previewText.includes('Confidential')
    );
    expect(confidentialBlock).toBeDefined();

    const { updatedPdfBytes, error } = await removeStreamSegmentFromPage(
      pdfBytes,
      0,
      confidentialBlock!
    );

    expect(error).toBeUndefined();

    // Verify stream in modified PDF no longer contains confidential text
    const modified = await getPageContentStream(updatedPdfBytes, 0);
    const modifiedSegments = parseStreamSegments(modified.streamText);
    expect(modifiedSegments.some((s) => s.previewText.includes('Confidential'))).toBe(false);
    expect(modifiedSegments.some((s) => s.previewText.includes('Header Title Section'))).toBe(true);
    expect(modifiedSegments.some((s) => s.previewText.includes('Footer Legal Notes'))).toBe(true);
  });

  it('should remove an embedded image from page XObject and content stream', async () => {
    const pdfBytes = await createSamplePdf();
    const { images } = await getPageImages(pdfBytes, 0);
    expect(images.length).toBeGreaterThanOrEqual(1);
    const imgName = images[0].cleanName;

    const { updatedPdfBytes, error } = await removeImageFromPage(
      pdfBytes,
      0,
      imgName
    );

    expect(error).toBeUndefined();

    // Verify image was removed from XObjects
    const afterImages = await getPageImages(updatedPdfBytes, 0);
    expect(afterImages.images.some((im) => im.cleanName === imgName)).toBe(false);

    // Verify stream no longer calls /Image Do
    const modified = await getPageContentStream(updatedPdfBytes, 0);
    expect(modified.streamText).not.toContain(`/${imgName} Do`);
  });

  it('should atomically remove multiple text blocks and images simultaneously', async () => {
    const pdfBytes = await createSamplePdf();
    const { streamText } = await getPageContentStream(pdfBytes, 0);
    const segments = parseStreamSegments(streamText);
    const textSegs = segments.filter((s) => s.type === 'text');

    const block1 = textSegs[0];
    const block2 = textSegs[1];
    const { images } = await getPageImages(pdfBytes, 0);
    const imgName = images[0].cleanName;

    const res = await removeMultipleElementsFromPage(
      pdfBytes,
      0,
      [block1.id, block2.id],
      [imgName]
    );

    expect(res.error).toBeUndefined();
    expect(res.removedCount).toBeGreaterThanOrEqual(3);

    const modified = await getPageContentStream(res.updatedPdfBytes, 0);
    const modifiedSegs = parseStreamSegments(modified.streamText);
    expect(modifiedSegs.some((s) => s.previewText.includes('Header Title Section'))).toBe(false);
    expect(modifiedSegs.some((s) => s.previewText.includes('Confidential'))).toBe(false);
    expect(modifiedSegs.some((s) => s.previewText.includes('Footer Legal Notes'))).toBe(true);
    expect(modified.streamText).not.toContain(`/${imgName} Do`);
  });

  it('should support Undo/Redo restoration of binary SourceDocument state', async () => {
    const initialBytes = await createSamplePdf();

    // 1. Initial State Snapshot
    const sourceV1: SourceDocument = {
      id: 'doc-1',
      name: 'test.pdf',
      arrayBuffer: initialBytes,
      updatedAt: 1000,
    };

    const historyStack: SourceDocument[] = [cloneSourceDocument(sourceV1)];

    // 2. Perform Removal (Mutate)
    const { images } = await getPageImages(sourceV1.arrayBuffer, 0);
    const { updatedPdfBytes } = await removeImageFromPage(
      sourceV1.arrayBuffer,
      0,
      images[0].cleanName
    );

    const sourceV2: SourceDocument = {
      id: 'doc-1',
      name: 'test.pdf',
      arrayBuffer: updatedPdfBytes,
      updatedAt: 2000,
    };
    historyStack.push(cloneSourceDocument(sourceV2));

    expect(historyStack.length).toBe(2);

    // Verify V2 has no image
    const v2Images = await getPageImages(historyStack[1].arrayBuffer, 0);
    expect(v2Images.images.length).toBe(0);

    // 3. Simulate Undo (Pop to V1)
    const restoredSourceV1 = cloneSourceDocument(historyStack[0]);
    const restoredImages = await getPageImages(restoredSourceV1.arrayBuffer, 0);

    // Image is completely restored in V1 binary buffer!
    expect(restoredImages.images.length).toBeGreaterThanOrEqual(1);
    expect(restoredImages.images[0].cleanName).toBe(images[0].cleanName);
  });
});
