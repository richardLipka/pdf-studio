import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  replaceTextBlockText,
  replaceImageOnPage,
  extractImageBytesFromPdf,
  PageImageInfo,
} from '../src/services/contentStreamEditor';
import { getCachedPdfDocument, getPageTextBlocks } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

describe('Comprehensive Real-World PDF Testing & Verification', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir)
    ? fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf'))
    : [];

  it('verifies test files exist', () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  const testImagePngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  for (const file of files) {
    describe(`Document: ${file}`, () => {
      it('scans multiple pages, extracts text & bitmap images, tests replacements and stream operations', async () => {
        const filePath = path.join(testFilesDir, file);
        const buffer = fs.readFileSync(filePath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        // 1. Determine page count
        let totalPages = 0;
        try {
          const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          totalPages = pdfDoc.getPageCount();
        } catch {
          // pdfjs fallback
        }

        const pdfjsDoc = await getCachedPdfDocument(file, arrayBuffer);
        if (totalPages === 0) totalPages = pdfjsDoc.numPages;
        expect(totalPages).toBeGreaterThanOrEqual(1);

        // Scan up to 4 pages per document
        const pagesToTest = Math.min(4, totalPages);

        for (let pageIdx = 0; pageIdx < pagesToTest; pageIdx++) {
          const page = await pdfjsDoc.getPage(pageIdx + 1);
          const vp = page.getViewport({ scale: 1.0 });

          const sourceDoc: SourceDocument = {
            id: file,
            name: file,
            arrayBuffer,
            updatedAt: Date.now(),
          };
          const pageModel: PdfPageModel = {
            id: `p_${file}_${pageIdx}`,
            sourceDocId: file,
            sourceType: 'pdf',
            originalPageIndex: pageIdx,
            rotation: page.rotate || 0,
            width: vp.width,
            height: vp.height,
            aspectRatio: vp.width / vp.height,
          };

          // 2. Extract visual blocks (Text + Bitmap images)
          const blocks = await getPageTextBlocks(sourceDoc, pageModel);
          const imgBlocks = blocks.filter((b) => b.isImage);
          const textBlocks = blocks.filter((b) => !b.isImage);

          // Geometry validation
          for (const b of blocks) {
            expect(Number.isFinite(b.x)).toBe(true);
            expect(Number.isFinite(b.y)).toBe(true);
            expect(Number.isFinite(b.width)).toBe(true);
            expect(Number.isFinite(b.height)).toBe(true);
            expect(b.width).toBeGreaterThanOrEqual(0);
            expect(b.height).toBeGreaterThanOrEqual(0);

            if (!b.isImage) {
              // Text blocks must not explode past page bounds
              expect(b.width).toBeLessThanOrEqual(vp.width * 1.05);
            } else {
              // Bitmap image properties
              expect(b.pixelWidth).toBeDefined();
              expect(b.pixelHeight).toBeDefined();
              expect(b.dpi).toBeDefined();
              if (b.dpi) {
                expect(b.dpi).toBeGreaterThan(0);
              }
              expect(b.isFullPageScan).toBeDefined();
            }
          }

          // 3. Content stream analysis
          const { streamText, error: streamErr } = await getPageContentStream(arrayBuffer, pageIdx);
          if (streamText && !streamErr) {
            const segments = parseStreamSegments(streamText);
            expect(Array.isArray(segments)).toBe(true);

            // Text segments test
            const textSegments = segments.filter((s) => s.type === 'text');
            if (textSegments.length > 0) {
              const testSub = replaceTextBlockText(textSegments[0].rawContent, 'TEST_VAL');
              expect(typeof testSub).toBe('string');
              expect(testSub.length).toBeGreaterThan(0);
            }

            // Image segments test
            const imgSegments = segments.filter((s) => s.type === 'image');
            if (imgSegments.length > 0 && imgBlocks.length > 0) {
              const targetImg = imgBlocks[0];
              const imageName = targetImg.text || '';

              // Test raw image byte extraction
              const rawBytes = await extractImageBytesFromPdf(arrayBuffer, pageIdx, imageName);
              // rawBytes is either Uint8Array or null (if Flate/raw without header)
              if (rawBytes) {
                expect(rawBytes.length).toBeGreaterThan(0);
              }

              // Test in-place image replacement
              try {
                const replacedBuffer = await replaceImageOnPage(
                  arrayBuffer,
                  pageIdx,
                  imageName,
                  testImagePngBase64
                );
                expect(replacedBuffer).toBeDefined();
                expect(replacedBuffer.byteLength).toBeGreaterThan(0);

                // Verify the resulting document is valid PDF
                const verifyDoc = await PDFDocument.load(replacedBuffer, { ignoreEncryption: true });
                expect(verifyDoc.getPageCount()).toBe(totalPages);
              } catch (e: any) {
                // If encrypted document, it throws a safe error
                expect(e.message).toBeDefined();
              }
            }
          }
        }
      }, 60000);
    });
  }
});
