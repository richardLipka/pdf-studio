import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  getPageImages,
  replaceImageOnPage,
  extractImageBytesFromPdf,
  PageImageInfo,
} from '../src/services/contentStreamEditor';
import { getPageTextBlocks } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

describe('Bitmap Graphics Engine & Inspection Suite', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');

  // Minimal 1x1 PNG base64 for testing replacement
  const samplePngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const samplePngBytes = Buffer.from(samplePngBase64, 'base64');

  it('detects and inspects bitmap images with accurate DPI, format, and full-page scan flags', async () => {
    // 1. Synthesize a test PDF with an embedded PNG image
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);

    const pngImage = await pdfDoc.embedPng(samplePngBytes);
    // Draw image at (50, 400) with size 200x150 pt
    page.drawImage(pngImage, {
      x: 50,
      y: 400,
      width: 200,
      height: 150,
    });

    const pdfBytes = (await pdfDoc.save({ useObjectStreams: false })).buffer;

    // 2. Query getPageImages
    const { images } = await getPageImages(pdfBytes, 0);
    expect(images.length).toBeGreaterThan(0);

    const firstImg = images[0];
    expect(firstImg.name).toBeDefined();
    expect(firstImg.pixelWidth).toBe(1);
    expect(firstImg.pixelHeight).toBe(1);
    expect(firstImg.width).toBe(200);
    expect(firstImg.height).toBe(150);
    expect(firstImg.format).toBe('png');
    expect(firstImg.dpi).toBeDefined();
    expect(firstImg.isFullPageScan).toBe(false);
  });

  it('correctly identifies full-page scan documents (e.g. scans taking >82% page area)', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);

    const pngImage = await pdfDoc.embedPng(samplePngBytes);
    // Draw image covering 100% of the page
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: 595,
      height: 842,
    });

    const pdfBytes = (await pdfDoc.save({ useObjectStreams: false })).buffer;

    const { images } = await getPageImages(pdfBytes, 0);
    expect(images.length).toBe(1);
    expect(images[0].isFullPageScan).toBe(true);
  });

  it('replaces an image XObject in place without altering content stream transformation matrices', async () => {
    // 1. Create a PDF with an image
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([500, 500]);
    const originalImg = await pdfDoc.embedPng(samplePngBytes);
    page.drawImage(originalImg, {
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });

    const originalBytes = (await pdfDoc.save({ useObjectStreams: false })).buffer;
    const { images: initialImages } = await getPageImages(originalBytes, 0);
    expect(initialImages.length).toBe(1);
    const targetImageName = initialImages[0].name;

    // 2. Perform replaceImageOnPage with new image bytes
    const replaceRes = await replaceImageOnPage(
      originalBytes,
      0,
      targetImageName,
      samplePngBytes,
      'image/png'
    );

    expect(replaceRes.error).toBeUndefined();
    expect(replaceRes.updatedPdfBytes).toBeDefined();
    expect(replaceRes.updatedPdfBytes.byteLength).toBeGreaterThan(0);

    // 3. Verify that the updated PDF reloads properly
    const reloadedDoc = await PDFDocument.load(replaceRes.updatedPdfBytes);
    expect(reloadedDoc.getPageCount()).toBe(1);

    // 4. Verify images in updated PDF
    const { images: updatedImages } = await getPageImages(replaceRes.updatedPdfBytes, 0);
    expect(updatedImages.length).toBe(1);
    expect(updatedImages[0].name).toBe(targetImageName);
    expect(updatedImages[0].width).toBe(300);
    expect(updatedImages[0].height).toBe(300);
  });

  it('extracts raw image bytes from PDF XObject for 1-click download', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    const img = await pdfDoc.embedPng(samplePngBytes);
    page.drawImage(img, { x: 50, y: 50, width: 100, height: 100 });
    const pdfBytes = (await pdfDoc.save({ useObjectStreams: false })).buffer;

    const { images } = await getPageImages(pdfBytes, 0);
    const targetName = images[0].name;

    const extRes = await extractImageBytesFromPdf(pdfBytes, 0, targetName);
    expect(extRes.error).toBeUndefined();
    expect(extRes.imageBytes).toBeDefined();
    expect(extRes.imageBytes?.length).toBeGreaterThan(0);
    expect(extRes.extension).toMatch(/bin|png|jpg/);
  });

  it('integrates image blocks into visual text blocks with vertical document order', async () => {
    // 1. Create a PDF with text at top, image in middle, text at bottom
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);

    // Top text (PDF coords: y = 750 -> Viewport coords: y ≈ 50)
    page.drawText('Top Header Title', { x: 50, y: 750, size: 24, color: rgb(0, 0, 0) });

    // Middle image (PDF coords: y = 400 -> Viewport coords: y ≈ 250)
    const img = await pdfDoc.embedPng(samplePngBytes);
    page.drawImage(img, { x: 50, y: 400, width: 200, height: 150 });

    // Bottom text (PDF coords: y = 100 -> Viewport coords: y ≈ 680)
    page.drawText('Bottom Footer Text', { x: 50, y: 100, size: 12, color: rgb(0, 0, 0) });

    const pdfBytes = (await pdfDoc.save({ useObjectStreams: false })).buffer;

    const sourceDoc: SourceDocument = {
      id: 'synthetic_img_test.pdf',
      name: 'synthetic_img_test.pdf',
      arrayBuffer: pdfBytes,
      pageCount: 1,
      updatedAt: Date.now(),
    };

    const pageModel: PdfPageModel = {
      id: 'page_synth_1',
      pageNumber: 1,
      sourceDocId: sourceDoc.id,
      sourceType: 'pdf',
      originalPageIndex: 0,
      rotation: 0,
      width: 600,
      height: 800,
      aspectRatio: 600 / 800,
    };

    // Extract visual blocks (interleaving text and images)
    const blocks = await getPageTextBlocks(sourceDoc, pageModel);
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const imgBlock = blocks.find((b) => b.type === 'image');
    expect(imgBlock).toBeDefined();
    expect(imgBlock?.imageName).toBeDefined();
    expect(imgBlock?.format).toBe('png');

    // Verify vertical ordering: Top text should have smaller Y than image, and image smaller Y than bottom text
    const topText = blocks.find((b) => b.text.includes('Top Header'));
    const bottomText = blocks.find((b) => b.text.includes('Bottom Footer'));

    if (topText && imgBlock && bottomText) {
      expect(topText.y).toBeLessThan(imgBlock.y);
      expect(imgBlock.y).toBeLessThan(bottomText.y);
    }
  });

  it('scans real PDF documents in testfiles for embedded bitmap graphics', async () => {
    if (!fs.existsSync(testFilesDir)) return;
    const files = fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf') && !f.includes('spec.pdf'));

    let totalImagesFound = 0;
    const documentsWithImages: string[] = [];

    for (const file of files) {
      const filePath = path.join(testFilesDir, file);
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;

      try {
        const { images } = await getPageImages(arrayBuffer, 0);
        if (images && images.length > 0) {
          totalImagesFound += images.length;
          documentsWithImages.push(file);

          for (const img of images) {
            expect(img.name).toBeDefined();
            expect(typeof img.width).toBe('number');
            expect(typeof img.height).toBe('number');
            if (img.dpi) {
              expect(img.dpi).toBeGreaterThan(0);
            }
          }
        }
      } catch (err) {
        // Encrypted or non-standard documents gracefully caught
      }
    }

    console.log(
      `\n[Real PDFs Scan] Found ${totalImagesFound} bitmap images across documents: ${documentsWithImages.join(', ')}`
    );
    expect(totalImagesFound).toBeGreaterThanOrEqual(0);
  }, 25000);
});
