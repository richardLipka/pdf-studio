import { describe, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRef } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  parseStreamTree,
  replaceTextBlockText,
  getPageImages,
} from '../src/services/contentStreamEditor';
import {
  getCachedPdfDocument,
  getPageTextBlocks,
  extractPageVisualImages,
} from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

describe('Deep Dive Analysis of spec.pdf', () => {
  const specPath = path.resolve(__dirname, '../src/assets/testfiles/spec.pdf');

  it('analyzes catalog, outlines, pages, stream structures, and performance', async () => {
    if (!fs.existsSync(specPath)) {
      console.warn('spec.pdf does not exist');
      return;
    }

    const buffer = fs.readFileSync(specPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    console.log(`\n===============================================================`);
    console.log(` ANALYZING SPEC.PDF (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`===============================================================\n`);

    // 1. PDF-Lib Document structure analysis
    const t0 = Date.now();
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true, updateMetadata: false });
    const loadTime = Date.now() - t0;
    const pageCount = pdfDoc.getPageCount();
    console.log(`1. [PDF-LIB] Document Loaded in ${loadTime}ms. Total Pages: ${pageCount}`);

    // Catalog inspection
    const catalog = pdfDoc.catalog;
    const outlines = catalog.get(PDFName.of('Outlines'));
    const acroForm = catalog.get(PDFName.of('AcroForm'));
    const structTreeRoot = catalog.get(PDFName.of('StructTreeRoot'));
    const markInfo = catalog.get(PDFName.of('MarkInfo'));
    console.log(`   - Outlines (Bookmarks): ${outlines ? 'Present' : 'None'}`);
    console.log(`   - AcroForm (Interactive Forms): ${acroForm ? 'Present' : 'None'}`);
    console.log(`   - StructTreeRoot (Tagged PDF / Logical Structure Tree): ${structTreeRoot ? 'Present' : 'None'}`);
    console.log(`   - MarkInfo: ${markInfo ? 'Present' : 'None'}`);

    // Direct stream extraction benchmark from loaded pdfDoc
    const sampleIndices = [0, 1, 2, 9, 24, 49, 99, 149, 199, 349, 499, 699];

    console.log(`\n===============================================================`);
    console.log(` STREAM EXTRACTION SPEED WITH CACHED PDFDOCUMENT`);
    console.log(`===============================================================`);

    const pdfjsDoc = await getCachedPdfDocument('spec.pdf', arrayBuffer);

    for (const pIdx of sampleIndices) {
      if (pIdx >= pageCount) continue;
      const tStart = performance.now();
      const { streamText, streamCount, isEncrypted } = await getPageContentStream(arrayBuffer, pIdx);
      const streamExtractMs = performance.now() - tStart;

      // Parse segments
      const tSeg0 = performance.now();
      const segments = parseStreamSegments(streamText);
      const segMs = performance.now() - tSeg0;
      const textSegs = segments.filter((s) => s.type === 'text');
      const graphSegs = segments.filter((s) => s.type === 'graphics');

      // Parse tree
      const tTree0 = performance.now();
      const tree = parseStreamTree(streamText);
      const treeMs = performance.now() - tTree0;

      // PDF.js text items
      const tPdfjs0 = performance.now();
      const pdfjsPage = await pdfjsDoc.getPage(pIdx + 1);
      const textContent = await pdfjsPage.getTextContent();
      const pdfjsMs = performance.now() - tPdfjs0;

      // Find top operators
      const opCounts: Record<string, number> = {};
      const ops = ['q', 'Q', 'cm', 'Do', 'Tj', 'TJ', 'Tf', 're', 'm', 'l', 'c', 'v', 'y', 'f', 's', 'B', 'W', 'RG', 'rg', 'BDC', 'EMC', 'BMC', 'DP', 'MP'];
      for (const op of ops) {
        const re = new RegExp(`\\b${op}\\b`, 'g');
        const matches = streamText.match(re);
        if (matches && matches.length > 0) {
          opCounts[op] = matches.length;
        }
      }
      const topOps = Object.entries(opCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(', ');

      console.log(`Page ${(pIdx + 1).toString().padStart(3)}: Stream=${streamExtractMs.toFixed(2)}ms (${streamCount} str, enc=${isEncrypted}) | Segs=${segMs.toFixed(2)}ms (${textSegs.length}txt, ${graphSegs.length}gfx) | Tree=${treeMs.toFixed(2)}ms (${tree.children?.length || 0} top) | PDF.js=${pdfjsMs.toFixed(2)}ms (${textContent.items.length} items) | Ops: [${topOps}]`);

      // Check text samples on page
      if (textSegs.length > 0) {
        const sampleText = textSegs.slice(0, 2).map((s) => `[${s.id}] "${s.previewText.replace(/\s+/g, ' ').substring(0, 40)}"`).join(' | ');
        console.log(`        Sample Text: ${sampleText}`);
      }
    }
  }, 120000);
});
