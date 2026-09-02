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
    expect(files.length).toBeGreaterThan(0);
    console.log('Found real-world PDF test files:', files);
  });

  for (const file of files) {
    describe(`PDF File: ${file}`, () => {
      const filePath = path.join(testFilesDir, file);
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      it('should parse content streams and extract structured segments without crashing', async () => {
        const { streamText, streamCount, error } = await getPageContentStream(arrayBuffer, 0);
        expect(error).toBeUndefined();
        console.log(`\n--- [${file}] Page 1 Content Stream ---`);
        console.log(`Stream count: ${streamCount}, Text length: ${streamText.length}`);

        if (streamText) {
          const segments = parseStreamSegments(streamText);
          const textSegments = segments.filter((s) => s.type === 'text');
          console.log(`Total segments: ${segments.length}, Text blocks: ${textSegments.length}`);

          textSegments.slice(0, 5).forEach((seg, i) => {
            console.log(`  Block #${i + 1} [${seg.id}]: "${seg.previewText}" | Font: ${seg.fontInfo || 'none'} | Pos: ${seg.positionInfo || 'none'}`);
          });

          expect(segments.length).toBeGreaterThanOrEqual(0);
        }
      });

      it('should inspect document pages, XObjects, and visual text blocks', async () => {
        const pdfDoc = await getCachedPdfDocument(file, arrayBuffer);
        const pageCount = pdfDoc.numPages;
        console.log(`\n=== [${file}] Total Pages: ${pageCount} ===`);

        if (file.includes('temata')) {
          const { streamText } = await getPageContentStream(arrayBuffer, 0);
          const segments = parseStreamSegments(streamText);
          console.log(`\n=== [${file}] Segment Details ===`);
          segments.filter((s) => s.type === 'text').slice(0, 8).forEach((s, idx) => {
            console.log(`--- Segment #${idx + 1} [${s.id}] ---`);
            console.log(s.rawContent);
          });
        }

        const sourceDoc: SourceDocument = {
          id: file,
          name: file,
          arrayBuffer,
          updatedAt: Date.now(),
        };

        for (let p = 1; p <= Math.min(pageCount, 2); p++) {
          const page = await pdfDoc.getPage(p);
          const pageVp = page.getViewport({ scale: 1.0 });
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
      });
    });
  }
});
