import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getPageImages, parseStreamSegments, getPageContentStream } from '../src/services/contentStreamEditor';
import { getCachedPdfDocument, getPageTextBlocks } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

describe('Images and Paragraph Block Selection Diagnostics', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir) ? fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf')) : [];

  it('tests robust image extraction with inherited resources and operator list', async () => {
    const pdfjsLib = await import('pdfjs-dist');
    const ops = pdfjsLib.OPS;

    console.log('\n--- TESTING ROBUST IMAGE EXTRACTION ON ALL FILES ---');
    for (const file of files) {
      const filePath = path.join(testFilesDir, file);
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      try {
        const pdfDoc = await getCachedPdfDocument(file, arrayBuffer);
        const pageCount = pdfDoc.numPages;

        let totalImagesFound = 0;
        for (let p = 1; p <= Math.min(3, pageCount); p++) {
          const page = await pdfDoc.getPage(p);
          const opList = await page.getOperatorList();
          for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageMaskXObject) {
              totalImagesFound++;
            }
          }
        }
        if (totalImagesFound > 0) {
          console.log(`[${file}] Total images detected (first 3 pages): ${totalImagesFound}`);
        }
      } catch (e: any) {
        console.log(`[${file}] Error: ${e.message}`);
      }
    }
  });

  it('verifies visualBlocks separation and image discovery', async () => {
    for (const file of ['temata_vskp_-_podklady_pro_zadani_vskp.pdf']) {
      const filePath = path.join(testFilesDir, file);
      if (!fs.existsSync(filePath)) continue;

      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const pdfDoc = await getCachedPdfDocument(file, arrayBuffer);
      const page1 = await pdfDoc.getPage(1);
      const pageVp = page1.getViewport({ scale: 1.0 });

      const textContent = await page1.getTextContent();
      const p1 = textContent.items.find((it: any) => it.str?.includes('1. Seznamte se'));
      const p2 = textContent.items.find((it: any) => it.str?.includes('2. Seznamte se'));
      console.log('POINT 1 transform:', (p1 as any)?.transform, 'str:', (p1 as any)?.str);
      console.log('POINT 2 transform:', (p2 as any)?.transform, 'str:', (p2 as any)?.str);

      const sourceDoc: SourceDocument = {
        id: file,
        name: file,
        arrayBuffer,
        updatedAt: Date.now(),
      };
      const pageModel: PdfPageModel = {
        id: `p_${file}_0`,
        sourceDocId: file,
        sourceType: 'pdf',
        originalPageIndex: 0,
        rotation: 0,
        width: pageVp.width,
        height: pageVp.height,
        aspectRatio: pageVp.width / pageVp.height,
      };

      const visualBlocks = await getPageTextBlocks(sourceDoc, pageModel);
      console.log(`\n[${file}] Extracted ${visualBlocks.length} visual blocks:`);
      const imgBlocks = visualBlocks.filter((b) => b.type === 'image');
      const textBlocks = visualBlocks.filter((b) => b.type !== 'image');
      console.log(`  - Text blocks: ${textBlocks.length}`);
      console.log(`  - Image blocks: ${imgBlocks.length}`);
      imgBlocks.forEach((img) => {
        console.log(`    🖼️ [${img.id}] "${img.text}" @ (${img.x.toFixed(1)}, ${img.y.toFixed(1)}) ${img.width.toFixed(1)}x${img.height.toFixed(1)}`);
      });
      textBlocks.filter((b) => parseInt(b.id.replace('block_', ''), 10) >= 15 && parseInt(b.id.replace('block_', ''), 10) <= 25).forEach((tb) => {
        console.log(`    📄 [${tb.id}] (${tb.segmentIds?.join(',')}) @ (${tb.x.toFixed(1)}, ${tb.y.toFixed(1)}) ${tb.width.toFixed(1)}x${tb.height.toFixed(1)} -> "${tb.text}"`);
      });
    }
  });
});
