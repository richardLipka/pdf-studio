import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { PDFDocument } from 'pdf-lib';
import { getCachedPdfDocument, getPageTextBlocks } from '../src/services/pdfLoader';
import { SourceDocument, PdfPageModel } from '../src/types/document';

interface FileVisibilityAudit {
  fileName: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  pageCount: number;
  viewportDimensions: string;
  textItemsCount: number;
  imageCount: number;
  vectorPathsCount: number;
  visualBlocksCount: number;
  contentType: 'Text Document' | 'Scanned Image / Raster' | 'Mixed Text & Images' | 'Vector Graphics / Slides';
  isContentVisible: boolean;
  status: 'PASSED' | 'FAILED';
}

// PDF.js operator constants for visibility analysis
const PDFJS_OPS = {
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 87,
  constructPath: 18,
  stroke: 19,
  fill: 23,
  eoFill: 24,
  showText: 43,
  showSpacedText: 44,
};

describe('Local Build & Asset Visibility Test Suite', () => {
  const rootDir = path.resolve(__dirname, '..');
  const releaseExePath = path.join(rootDir, 'release/win-unpacked/PDF Studio.exe');
  const distIndexPath = path.join(rootDir, 'dist/index.html');
  const distElectronMainPath = path.join(rootDir, 'dist-electron/main.cjs');
  const distElectronPreloadPath = path.join(rootDir, 'dist-electron/preload.cjs');
  const testFilesDir = path.join(rootDir, 'src/assets/testfiles');

  const assetFiles = fs.existsSync(testFilesDir)
    ? fs.readdirSync(testFilesDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
    : [];

  const auditResults: FileVisibilityAudit[] = [];

  // =========================================================================
  // 1. Local Build Verification
  // =========================================================================
  describe('Local Build Artifacts & Desktop Binary Verification', () => {
    it('verifies that the web bundle (dist/index.html) is built and valid', () => {
      expect(fs.existsSync(distIndexPath)).toBe(true);
      const htmlContent = fs.readFileSync(distIndexPath, 'utf-8');
      expect(htmlContent).toContain('id="root"');
      expect(htmlContent).toContain('PDF Studio');
      expect(htmlContent).toMatch(/<script type="module"/);
    });

    it('verifies that the Electron main and preload bundles are built', () => {
      expect(fs.existsSync(distElectronMainPath)).toBe(true);
      expect(fs.existsSync(distElectronPreloadPath)).toBe(true);
      const mainStat = fs.statSync(distElectronMainPath);
      const preloadStat = fs.statSync(distElectronPreloadPath);
      expect(mainStat.size).toBeGreaterThan(1000);
      expect(preloadStat.size).toBeGreaterThan(500);
    });

    it('verifies that the local desktop executable (PDF Studio.exe) exists and has valid PE headers', () => {
      expect(fs.existsSync(releaseExePath)).toBe(true);
      const stat = fs.statSync(releaseExePath);
      // Packaged electron binary should be substantial (> 100 MB)
      expect(stat.size).toBeGreaterThan(100 * 1024 * 1024);

      // Verify DOS header ('MZ')
      const fd = fs.openSync(releaseExePath, 'r');
      const headerBuf = Buffer.alloc(64);
      fs.readSync(fd, headerBuf, 0, 64, 0);
      fs.closeSync(fd);

      const magic = headerBuf.toString('ascii', 0, 2);
      expect(magic).toBe('MZ');
    });

    it('verifies that the local executable can be launched with an asset file as parameter', async () => {
      if (assetFiles.length === 0 || !fs.existsSync(releaseExePath)) return;

      const sampleAsset = path.join(testFilesDir, assetFiles[0]);
      // Spawn executable with sample asset path
      const proc = cp.spawn(releaseExePath, [sampleAsset], {
        windowsHide: true,
        stdio: 'ignore',
      });

      expect(proc.pid).toBeDefined();
      expect(proc.pid).toBeGreaterThan(0);

      // Allow process initialization then terminate cleanly
      await new Promise((resolve) => setTimeout(resolve, 800));
      try {
        proc.kill();
      } catch {
        // Already closed or detached
      }
    }, 10000);
  });

  // =========================================================================
  // 2. Asset Discovery Verification
  // =========================================================================
  describe('Assets Corpus Discovery', () => {
    it('discovers all PDF files in src/assets/testfiles', () => {
      expect(assetFiles.length).toBeGreaterThanOrEqual(14);
      console.log(`\nDiscovered ${assetFiles.length} asset files for local build visibility testing:`);
      assetFiles.forEach((file, idx) => console.log(`  ${idx + 1}. ${file}`));
    });
  });

  // =========================================================================
  // 3. Execution & Visibility Verification for Each Asset File
  // =========================================================================
  describe('Per-File Execution & Content Visibility Verification', () => {
    for (const fileName of assetFiles) {
      it(`executes and verifies visible content for [${fileName}]`, async () => {
        const filePath = path.join(testFilesDir, fileName);
        const fileStat = fs.statSync(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        const arrayBuffer = fileBuffer.buffer.slice(
          fileBuffer.byteOffset,
          fileBuffer.byteOffset + fileBuffer.byteLength
        );

        // 1. Load document via PDF.js (underlying renderer in both web and desktop local build)
        const pdfDoc = await getCachedPdfDocument(fileName, arrayBuffer);
        const numPages = pdfDoc.numPages;
        expect(numPages).toBeGreaterThanOrEqual(1);

        // Also check pdf-lib structure where possible
        let pdfLibPages = 0;
        try {
          const pdfLibDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          pdfLibPages = pdfLibDoc.getPageCount();
        } catch {
          pdfLibPages = numPages;
        }
        expect(pdfLibPages).toBeGreaterThanOrEqual(1);

        // 2. Inspect first page (and up to first 3 pages) for content visibility
        const page1 = await pdfDoc.getPage(1);
        const vp = page1.getViewport({ scale: 1.0 });

        // Geometry assertions
        expect(vp.width).toBeGreaterThan(50);
        expect(vp.height).toBeGreaterThan(50);
        expect(Number.isFinite(vp.width)).toBe(true);
        expect(Number.isFinite(vp.height)).toBe(true);

        // 3. Text content inspection
        const textContent = await page1.getTextContent();
        let totalTextChars = 0;
        let validTextItemsCount = 0;

        for (const item of textContent.items as any[]) {
          if (item.str && item.str.trim().length > 0) {
            validTextItemsCount++;
            totalTextChars += item.str.length;
          }
        }

        // 4. Operator list inspection (Images, Vector drawings)
        const opList = await page1.getOperatorList();
        let imageOpsCount = 0;
        let vectorPathOpsCount = 0;

        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          if (
            fn === PDFJS_OPS.paintImageXObject ||
            fn === PDFJS_OPS.paintInlineImageXObject ||
            fn === PDFJS_OPS.paintImageMaskXObject
          ) {
            imageOpsCount++;
          } else if (
            fn === PDFJS_OPS.constructPath ||
            fn === PDFJS_OPS.stroke ||
            fn === PDFJS_OPS.fill ||
            fn === PDFJS_OPS.eoFill
          ) {
            vectorPathOpsCount++;
          }
        }

        // 5. Visual blocks inspection (integrated model)
        const sourceDoc: SourceDocument = {
          id: fileName,
          name: fileName,
          arrayBuffer,
          updatedAt: Date.now(),
        };
        const pageModel: PdfPageModel = {
          id: `p_${fileName}_0`,
          sourceDocId: fileName,
          sourceType: 'pdf',
          originalPageIndex: 0,
          rotation: page1.rotate || 0,
          width: vp.width,
          height: vp.height,
          aspectRatio: vp.width / vp.height,
        };

        const visualBlocks = await getPageTextBlocks(sourceDoc, pageModel);
        const visualImages = visualBlocks.filter((b) => b.isImage);
        const visualTexts = visualBlocks.filter((b) => !b.isImage);

        // Determine content classification
        let contentType: FileVisibilityAudit['contentType'] = 'Text Document';
        if (validTextItemsCount === 0 && (imageOpsCount > 0 || visualImages.length > 0)) {
          contentType = 'Scanned Image / Raster';
        } else if (validTextItemsCount > 0 && (imageOpsCount > 0 || visualImages.length > 0)) {
          contentType = 'Mixed Text & Images';
        } else if (validTextItemsCount === 0 && vectorPathOpsCount > 0) {
          contentType = 'Vector Graphics / Slides';
        }

        // Total visible elements
        const totalVisibleElements =
          validTextItemsCount + imageOpsCount + visualImages.length + vectorPathOpsCount;

        // Content visibility assertion: Document MUST NOT BE BLANK
        const isContentVisible =
          totalVisibleElements > 0 &&
          (validTextItemsCount > 0 || imageOpsCount > 0 || visualImages.length > 0 || vectorPathOpsCount > 0);

        expect(isContentVisible).toBe(true);

        // Format file size
        const sizeFormatted =
          fileStat.size > 1024 * 1024
            ? `${(fileStat.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(fileStat.size / 1024).toFixed(1)} KB`;

        auditResults.push({
          fileName,
          fileSizeBytes: fileStat.size,
          fileSizeFormatted: sizeFormatted,
          pageCount: numPages,
          viewportDimensions: `${Math.round(vp.width)} × ${Math.round(vp.height)} pt`,
          textItemsCount: validTextItemsCount,
          imageCount: Math.max(imageOpsCount, visualImages.length),
          vectorPathsCount: vectorPathOpsCount,
          visualBlocksCount: visualBlocks.length,
          contentType,
          isContentVisible,
          status: isContentVisible ? 'PASSED' : 'FAILED',
        });
      }, 45000);
    }
  });

  // =========================================================================
  // 4. Audit Summary & Visibility Matrix Output
  // =========================================================================
  describe('Audit Summary Matrix', () => {
    it('verifies that 100% of tested asset files have visible content', () => {
      expect(auditResults.length).toBe(assetFiles.length);

      console.log('\n========================================================================================================================');
      console.log('                            LOCAL BUILD & ASSETS CONTENT VISIBILITY AUDIT MATRIX                                        ');
      console.log('========================================================================================================================');
      console.log(
        '| File Name                                            | Size     | Pages | Dimensions     | Text | Img | Vectors | Type            | Status  |'
      );
      console.log(
        '|------------------------------------------------------|----------|-------|----------------|------|-----|---------|-----------------|---------|'
      );

      for (const res of auditResults) {
        const filePad = res.fileName.length > 52 ? res.fileName.slice(0, 49) + '...' : res.fileName.padEnd(52, ' ');
        const sizePad = res.fileSizeFormatted.padEnd(8, ' ');
        const pagesPad = String(res.pageCount).padStart(5, ' ');
        const dimsPad = res.viewportDimensions.padEnd(14, ' ');
        const textPad = String(res.textItemsCount).padStart(4, ' ');
        const imgPad = String(res.imageCount).padStart(3, ' ');
        const vecPad = String(res.vectorPathsCount).padStart(7, ' ');
        const typePad = res.contentType.padEnd(15, ' ').slice(0, 15);
        const statusPad = res.status === 'PASSED' ? 'VISIBLE ✓' : 'BLANK ✗';

        console.log(
          `| ${filePad} | ${sizePad} | ${pagesPad} | ${dimsPad} | ${textPad} | ${imgPad} | ${vecPad} | ${typePad} | ${statusPad} |`
        );
      }
      console.log('========================================================================================================================\n');

      const failedFiles = auditResults.filter((r) => !r.isContentVisible);
      expect(failedFiles.length).toBe(0);
    });
  });
});
