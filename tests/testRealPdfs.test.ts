import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  extractPreviewTextFromBlock,
  extractFontDetailsFromBlock,
  extractCoordinatesFromBlock,
  decodeStreamObject,
} from '../src/services/contentStreamEditor';
import { getPageTextBlocks, getCachedPdfDocument } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

describe('Real-world PDF Analysis & Block Extraction', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir) ? fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf')) : [];

  it('should list all test files in testfiles directory', () => {
    if (files.length === 0) {
      console.log('No local PDF test files found in src/assets/testfiles (excluded from git).');
      expect(files.length).toBe(0);
      return;
    }
    expect(files.length).toBeGreaterThan(0);
    console.log('Found real-world PDF test files:', files);
  });

  for (const file of files) {
    describe(`PDF File: ${file}`, () => {
      const filePath = path.join(testFilesDir, file);

      it('should parse content streams and extract structured segments without crashing', async () => {
        const buffer = fs.readFileSync(filePath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        const { streamText, streamCount, error } = await getPageContentStream(arrayBuffer, 0);
        console.log(`\n--- [${file}] Page 1 Content Stream ---`);
        console.log(`Stream count: ${streamCount}, Text length: ${streamText.length}, Error: ${error || 'none'}`);
        expect(typeof streamText).toBe('string');

        if (streamText) {
          const segments = parseStreamSegments(streamText);
          const textSegments = segments.filter((s) => s.type === 'text');
          console.log(`Total segments: ${segments.length}, Text blocks: ${textSegments.length}`);

          textSegments.slice(0, 5).forEach((seg, i) => {
            console.log(`  Block #${i + 1} [${seg.id}]: "${seg.previewText}" | Font: ${seg.fontInfo || 'none'} | Pos: ${seg.positionInfo || 'none'}`);
          });

          expect(segments.length).toBeGreaterThanOrEqual(0);
        }
      }, 60000);

      it('should inspect document pages, XObjects, and visual text blocks', async () => {
        const buffer = fs.readFileSync(filePath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        const pdfDoc = await getCachedPdfDocument(file, arrayBuffer);
        const pageCount = pdfDoc.numPages;
        console.log(`\n=== [${file}] Total Pages: ${pageCount} ===`);

        if (file.includes('UUR_2026')) {
          const { streamText } = await getPageContentStream(arrayBuffer, 0);
          const segments = parseStreamSegments(streamText);
          const page = await pdfDoc.getPage(1);
          const textContent = await page.getTextContent();
          console.log(`\n=== [${file}] Items vs Segments ===`);
          console.log(`UUR_2026 raw stream length: ${streamText?.length}`);
        }

        const pagesToTest = Math.min(2, pageCount);
        for (let p = 1; p <= pagesToTest; p++) {
          const page = await pdfDoc.getPage(p);
          const pageVp = page.getViewport({ scale: 1.0 });

          const sourceDoc: SourceDocument = {
            id: file,
            name: file,
            arrayBuffer,
            updatedAt: Date.now(),
          };
          const pageModel: PdfPageModel = {
            id: `p_${file}_${p - 1}`,
            sourceDocId: file,
            sourceType: 'pdf',
            originalPageIndex: p - 1,
            rotation: 0,
            width: pageVp.width,
            height: pageVp.height,
            aspectRatio: pageVp.width / pageVp.height,
          };

          const blocks = await getPageTextBlocks(sourceDoc, pageModel);
          console.log(`  Page ${p} Extracted Visual Blocks: ${blocks.length}`);
          blocks.forEach((b, i) => {
            console.log(`    #${i + 1} [${b.id}]: "${b.text.substring(0, 50)}" @ (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) ${b.width.toFixed(1)}x${b.height.toFixed(1)}`);
          });
        }
      }, 60000);
    });
  }
});
