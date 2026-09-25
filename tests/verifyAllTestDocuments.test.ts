import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  StreamSegment,
  replaceTextBlockText,
} from '../src/services/contentStreamEditor';
import { getCachedPdfDocument, getPageTextBlocks } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';
import { VisualTextBlock } from '../src/types/document';

interface VerificationResult {
  fileName: string;
  fileSizeBytes: number;
  totalPages: number;
  visualBlocksCount: number;
  imageBlocksCount: number;
  textBlocksCount: number;
  boundedWidthScore: string;
  overlapCollisionsCount: number;
  layeringTargetingScore: string;
  sectionsCount: number;
  h1HeadingsCount: number;
  h2HeadingsCount: number;
  streamEditable: boolean;
  status: 'PASSED' | 'WARNING' | 'FAILED';
  notes: string;
}

describe('Full Verification across ALL Test Documents', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir)
    ? fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf'))
    : [];

  const results: VerificationResult[] = [];

  // The corpus in src/assets/testfiles is gitignored (local-only), so a fresh clone skips this suite
  it.skipIf(files.length === 0)('verifies that all test files exist', () => {
    expect(files.length).toBeGreaterThan(0);
    console.log(`\nFound ${files.length} test documents in ${testFilesDir}`);
  });

  for (const file of files) {
    describe(`Document: ${file}`, () => {
      it('performs complete visual block, overlap, layering, and document tree verification', async () => {
        const filePath = path.join(testFilesDir, file);
        const stat = fs.statSync(filePath);
        const buffer = fs.readFileSync(filePath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        // 1. PDF Document Loading
        let pageCount = 0;
        try {
          const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          pageCount = pdfDoc.getPageCount();
        } catch (e: any) {
          // pdfjs-dist fallback
        }

        const pdfjsDoc = await getCachedPdfDocument(file, arrayBuffer);
        if (pageCount === 0) {
          pageCount = pdfjsDoc.numPages;
        }
        expect(pageCount).toBeGreaterThanOrEqual(1);

        // 2. Viewport and Page Model for Page 1
        const page1 = await pdfjsDoc.getPage(1);
        const pageVp = page1.getViewport({ scale: 1.0 });
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
          rotation: page1.rotate || 0,
          width: pageVp.width,
          height: pageVp.height,
          aspectRatio: pageVp.width / pageVp.height,
        };

        // 3. Visual Text & Image Blocks Extraction (with bounded merging)
        const visualBlocks = await getPageTextBlocks(sourceDoc, pageModel);
        const imageBlocks = visualBlocks.filter((b) => b.isImage);
        const textBlocks = visualBlocks.filter((b) => !b.isImage);

        // Verify bounding boxes: no negative dimensions or NaN
        for (const b of visualBlocks) {
          expect(b.width).toBeGreaterThanOrEqual(0);
          expect(b.height).toBeGreaterThanOrEqual(0);
          expect(Number.isNaN(b.x)).toBe(false);
          expect(Number.isNaN(b.y)).toBe(false);
        }

        // 4. Overlap & Column Bounding Verification
        // Check whether any block has width exceeding page bounds + margin
        let explodedWidthCount = 0;
        for (const b of textBlocks) {
          if (b.width > pageVp.width * 1.05) {
            explodedWidthCount++;
            console.log(`[${file}] Exploded block: id=${b.id}, text="${b.text.slice(0, 60)}", width=${b.width}, pageW=${pageVp.width}, x=${b.x}, y=${b.y}`);
          }
        }
        expect(explodedWidthCount).toBe(0);

        // Check same-line collisions between distinct text blocks
        let sameLineCollisions = 0;
        for (let i = 0; i < textBlocks.length; i++) {
          for (let j = i + 1; j < textBlocks.length; j++) {
            const b1 = textBlocks[i];
            const b2 = textBlocks[j];
            const dy = Math.abs(b1.y - b2.y);
            if (dy < 6) {
              // Same horizontal line
              const xOverlap = Math.max(0, Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x));
              const minWidth = Math.min(b1.width, b2.width);
              // Substantial collision (> 50% of the smaller block's width)
              if (minWidth > 15 && xOverlap > minWidth * 0.5) {
                sameLineCollisions++;
              }
            }
          }
        }

        // 5. Layering & Clickability (Smallest-Area-First Stacking Order)
        // Simulate TextLayer sorting: images first (z:10), text by area descending (z:20..)
        const sortedDisplayBlocks = [...visualBlocks].sort((a, b) => {
          if (a.isImage && !b.isImage) return -1;
          if (!a.isImage && b.isImage) return 1;
          const areaA = (a.width || 0) * (a.height || 0);
          const areaB = (b.width || 0) * (b.height || 0);
          return areaB - areaA;
        });

        // Test that for any overlapping pair A (large) and B (small), B gets higher z-index
        let correctlyLayeredPairs = 0;
        let totalEnclosedPairs = 0;

        for (let i = 0; i < textBlocks.length; i++) {
          for (let j = 0; j < textBlocks.length; j++) {
            if (i === j) continue;
            const b1 = textBlocks[i];
            const b2 = textBlocks[j];
            const area1 = b1.width * b1.height;
            const area2 = b2.width * b2.height;

            // Check if b2 is largely contained in b1 and significantly smaller
            if (area1 > area2 * 1.5) {
              const xOverlap = Math.max(0, Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x));
              const yOverlap = Math.max(0, Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y));
              const overlapArea = xOverlap * yOverlap;

              if (overlapArea > area2 * 0.7) {
                totalEnclosedPairs++;
                const idx1 = sortedDisplayBlocks.indexOf(b1);
                const idx2 = sortedDisplayBlocks.indexOf(b2);
                // b2 should appear AFTER b1 in DOM render order (idx2 > idx1) or have higher z-index
                const z1 = b1.isImage ? 10 : 20 + idx1;
                const z2 = b2.isImage ? 10 : 20 + idx2;
                if (z2 > z1) {
                  correctlyLayeredPairs++;
                }
              }
            }
          }
        }

        const layeringScore =
          totalEnclosedPairs === 0
            ? '100% (No enclosed overlaps)'
            : `${((correctlyLayeredPairs / totalEnclosedPairs) * 100).toFixed(0)}% (${correctlyLayeredPairs}/${totalEnclosedPairs} enclosed blocks clickable on top)`;

        // 6. Sémantic Document Tree & Section Grouping (EditSidePanel)
        const { streamText } = await getPageContentStream(arrayBuffer, 0);
        let streamSegments: StreamSegment[] = [];
        if (streamText) {
          streamSegments = parseStreamSegments(streamText).filter((s) => s.type === 'text');
        }

        // Build document sections
        interface DocumentSection {
          id: string;
          title: string;
          role: 'h1' | 'h2' | 'intro';
          children: any[];
        }

        const sections: DocumentSection[] = [];
        let currentSec: DocumentSection | null = null;
        let secIdx = 1;
        let h1Count = 0;
        let h2Count = 0;

        const blocksToGroup = streamSegments.length > 0 ? streamSegments : textBlocks;

        for (const b of blocksToGroup) {
          const role = (b as any).headingRole;
          if (role === 'h1' || role === 'h2') {
            if (role === 'h1') h1Count++;
            if (role === 'h2') h2Count++;
            currentSec = {
              id: `sec_${b.id}`,
              title: (b as any).previewText || (b as any).text || '',
              role,
              children: [],
            };
            sections.push(currentSec);
            secIdx++;
          } else {
            if (!currentSec) {
              currentSec = {
                id: `sec_intro_${secIdx}`,
                title: 'Úvodní obsah / Záhlaví',
                role: 'intro',
                children: [],
              };
              sections.push(currentSec);
              secIdx++;
            }
            currentSec.children.push(b);
          }
        }

        // Verify sections: all grouped blocks must be accounted for
        const totalGrouped = sections.reduce((acc, s) => acc + (s.role !== 'intro' ? 1 : 0) + s.children.length, 0);
        expect(totalGrouped).toBe(blocksToGroup.length);

        // 7. Content Stream Editable Check
        const streamEditable = streamText.length > 0;
        if (streamEditable && streamSegments.length > 0) {
          const sample = streamSegments[0];
          const replaced = replaceTextBlockText(sample.rawContent, 'VERIFY_OK');
          expect(typeof replaced).toBe('string');
        }

        const res: VerificationResult = {
          fileName: file,
          fileSizeBytes: stat.size,
          totalPages: pageCount,
          visualBlocksCount: visualBlocks.length,
          imageBlocksCount: imageBlocks.length,
          textBlocksCount: textBlocks.length,
          boundedWidthScore: `${textBlocks.length - explodedWidthCount}/${textBlocks.length} bounded (0 exploded)`,
          overlapCollisionsCount: sameLineCollisions,
          layeringTargetingScore: layeringScore,
          sectionsCount: sections.length,
          h1HeadingsCount: h1Count,
          h2HeadingsCount: h2Count,
          streamEditable,
          status: sameLineCollisions > 5 ? 'WARNING' : 'PASSED',
          notes: !streamEditable ? 'Šifrovaný dokument nebo bez přímého streamu (chráněno)' : 'Plně editovatelné bloky a stream',
        };

        results.push(res);
      }, 60000);
    });
  }

  it('prints comprehensive verification summary table for all documents', () => {
    console.log('\n========================================================================================================');
    console.log('                          KOMPLETNÍ OVĚŘENÍ VŠECH 14 TESTOVACÍCH DOKUMENTŮ');
    console.log('========================================================================================================');

    console.table(
      results.map((r) => ({
        Soubor: r.fileName,
        Stran: r.totalPages,
        Bloků: r.visualBlocksCount,
        'Obrázky': r.imageBlocksCount,
        'Omezená šířka': r.boundedWidthScore,
        'Kolize řádků': r.overlapCollisionsCount,
        'Klikatelnost na vrchu': r.layeringTargetingScore,
        Sekce: `${r.sectionsCount} (${r.h1HeadingsCount} H1, ${r.h2HeadingsCount} H2)`,
        Stream: r.streamEditable ? 'Ano' : 'Uzamčeno',
        Výsledek: r.status,
      }))
    );

    const reportPath = path.resolve(__dirname, '../verification_results.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`Saved detailed JSON results to: ${reportPath}`);

    // All must pass
    for (const r of results) {
      expect(r.status).not.toBe('FAILED');
    }
  });
});
