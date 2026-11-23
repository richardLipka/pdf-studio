import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  getPageImages,
  removeMultipleElementsFromPage,
  replaceImageOnPage,
  extractImageBytesFromPdf,
  replaceTextInPageContentStream,
} from '../src/services/contentStreamEditor';
import {
  getCachedPdfDocument,
  getPageTextBlocks,
  getPageTextModel,
  parsePdfPages,
  extractPdfMetadata,
  getDocumentOutlines,
  clearPdfCache,
} from '../src/services/pdfLoader';
import { repairPdfDefects } from '../src/services/pdfRepair';
import { extractFormFieldsFromPdf } from '../src/services/formService';
import { replaceTextBlockContent, replaceTextLineContent } from '../src/services/pdfTextEditor';
import { toReadableBlock, fromReadableBlock } from '../src/services/pdfReadableStream';
import { searchPdfDocument } from '../src/services/pdfSearchService';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { WhiteoutAnnotation } from '../src/types/annotations';
import {
  clampInlineEditorPosition,
  getNextSelectionAfterRemoval,
} from '../src/utils/editModeState';
import { PdfPageModel, SourceDocument } from '../src/types/document';

// Valid 1x1 PNG for real in-place XObject replacement verification
const SAMPLE_PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
  1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65,
  84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129,
  132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

interface CorpusReportRow {
  file: string;
  pages: number;
  encrypted: boolean;
  repaired: number;
  aligned: boolean;
  textBlocks: number;
  images: number;
  inlineImages: number;
  lineEdit: string;
  blockEdit: string;
  readableRT: string;
  singleDelete: string;
  batchDelete: string;
  imgReplace: string;
  imgDelete: string;
  findReplace: string;
  searchHits: number;
  exportOk: boolean;
  untouchedP2: string;
}

describe('Unified Edit UX Verification across ALL PDFs in src/assets/testfiles', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir)
    ? fs.readdirSync(testFilesDir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
    : [];

  const report: CorpusReportRow[] = [];

  afterAll(() => {
    clearPdfCache();
    if (report.length > 0) {
      console.log('\n=== UNIFIED EDIT UX CORPUS VERIFICATION REPORT ===');
      console.table(report);
    }
  });

  it.skipIf(files.length === 0)('discovers all PDF documents in src/assets/testfiles', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(
      `verifies complete Edit UX lifecycle on ${file}`,
      async () => {
        const filePath = path.join(testFilesDir, file);
        const rawBytes = fs.readFileSync(filePath);
        const rawBuffer = rawBytes.buffer.slice(
          rawBytes.byteOffset,
          rawBytes.byteOffset + rawBytes.byteLength
        ) as ArrayBuffer;

        // 1. Repair & parse document metadata, pages, outlines, forms
        const { buffer, repairs } = await repairPdfDefects(rawBuffer);
        const sourceId = `corpus_${file}`;
        const parsedPages = await parsePdfPages(buffer, sourceId);
        expect(parsedPages.length).toBeGreaterThanOrEqual(1);

        const sourceDoc: SourceDocument = {
          id: sourceId,
          name: file,
          arrayBuffer: buffer,
          updatedAt: Date.now(),
        };

        const meta = await extractPdfMetadata(sourceId, buffer);
        expect(meta).toBeDefined();
        const outlines = await getDocumentOutlines(sourceDoc);
        expect(Array.isArray(outlines)).toBe(true);
        const formFields = await extractFormFieldsFromPdf(buffer, sourceId, parsedPages.slice(0, 3));
        expect(Array.isArray(formFields)).toBe(true);

        // Pick the first page that has text or images (fallback to page 0)
        let targetIdx = 0;
        let streamRes = await getPageContentStream(buffer, 0);
        let imagesRes = await getPageImages(buffer, 0);
        let segments = streamRes.streamText
          ? parseStreamSegments(streamRes.streamText).filter((s) => s.type === 'text')
          : [];

        if (!streamRes.isEncrypted && segments.length === 0 && imagesRes.images.length === 0 && parsedPages.length > 1) {
          for (let probe = 1; probe < Math.min(parsedPages.length, 6); probe++) {
            const probeStream = await getPageContentStream(buffer, probe);
            const probeImages = await getPageImages(buffer, probe);
            const probeSegs = probeStream.streamText
              ? parseStreamSegments(probeStream.streamText).filter((s) => s.type === 'text')
              : [];
            if (probeSegs.length > 0 || probeImages.images.length > 0) {
              targetIdx = probe;
              streamRes = probeStream;
              imagesRes = probeImages;
              segments = probeSegs;
              break;
            }
          }
        }

        const pageModel: PdfPageModel = parsedPages[targetIdx];
        const isEncrypted = Boolean(streamRes.isEncrypted);

        // 2. Visual blocks & text model & inline editor clamping
        const visualBlocks = await getPageTextBlocks(sourceDoc, pageModel);
        const model = await getPageTextModel(sourceDoc, pageModel);

        for (const vb of visualBlocks) {
          expect(Number.isFinite(vb.x)).toBe(true);
          expect(Number.isFinite(vb.y)).toBe(true);
          expect(Number.isFinite(vb.width)).toBe(true);
          expect(Number.isFinite(vb.height)).toBe(true);
          expect(vb.width).toBeGreaterThanOrEqual(0);
          expect(vb.height).toBeGreaterThanOrEqual(0);

          if (vb.type !== 'image') {
            const clamped = clampInlineEditorPosition(
              { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
              pageModel.width,
              pageModel.height,
              1.0
            );
            expect(clamped.left).toBeGreaterThanOrEqual(4);
            expect(clamped.top).toBeGreaterThanOrEqual(4);
            expect(clamped.left + clamped.width).toBeLessThanOrEqual(Math.max(200, pageModel.width) + 1);
          }
        }

        // Validate PageImageInfo invariants (inline vs XObject, occurrence, placementCount)
        const images = imagesRes.images || [];
        const inlineImages = images.filter((im) => im.kind === 'inline' || !im.name);
        const xobjectImages = images.filter((im) => im.kind !== 'inline' && Boolean(im.name));
        for (const im of images) {
          expect(im.id).toBeTruthy();
          expect(im.cleanName).toBeTruthy();
          if (im.kind === 'inline') {
            expect(im.name).toBe('');
          } else {
            expect(im.name.startsWith('/')).toBe(true);
          }
          if (im.placementCount !== undefined && im.placementCount > 1) {
            expect(im.occurrence).toBeDefined();
            expect(im.occurrence!).toBeGreaterThanOrEqual(0);
            expect(im.occurrence!).toBeLessThan(im.placementCount);
          }
        }

        // Capture untouched sibling page stream for multi-page invariant checks
        const siblingIdx = parsedPages.length > 1 ? (targetIdx === 0 ? 1 : 0) : -1;
        const origSiblingStream =
          !isEncrypted && siblingIdx >= 0
            ? (await getPageContentStream(buffer, siblingIdx)).streamText
            : null;

        let lineEditStatus = 'skip';
        let blockEditStatus = 'skip';
        let readableRtStatus = 'skip';
        let singleDeleteStatus = 'skip';
        let batchDeleteStatus = 'skip';
        let imgReplaceStatus = 'skip';
        let imgDeleteStatus = 'skip';
        let findReplaceStatus = 'skip';
        let untouchedP2Status = siblingIdx >= 0 ? 'n/a' : '1-page';

        if (!isEncrypted) {
          // 3. Inline line edit + Block text rewrite + Readable code round-trip
          if (model?.aligned && model.blocks.length > 0) {
            const candidateBlock = model.blocks.find((b) => b.lines.length > 0 && b.text.trim().length > 0);
            if (candidateBlock) {
              const firstLine = candidateBlock.lines[0];
              const marker = 'UX_Řádek_ČŽ';
              const lineRes = await replaceTextLineContent(buffer, targetIdx, model, firstLine.id, marker);
              expect(lineRes.error).toBeUndefined();
              expect(lineRes.updatedPdfBytes.byteLength).toBeGreaterThan(0);

              // Verify edited PDF opens cleanly in pdf.js and contains the new text
              const editedDoc = await getCachedPdfDocument(`${sourceId}_line`, lineRes.updatedPdfBytes);
              expect(editedDoc.numPages).toBe(parsedPages.length);
              const editedPdfPage = await editedDoc.getPage(targetIdx + 1);
              const tc = await editedPdfPage.getTextContent();
              const pageStr = tc.items.map((it: any) => it.str || '').join('');
              editedPdfPage.cleanup();
              expect(pageStr).toContain('UX_');
              lineEditStatus = lineRes.fontSubstituted ? 'ok(sub)' : 'ok(orig)';

              if (siblingIdx >= 0 && origSiblingStream !== null) {
                const afterSibling = await getPageContentStream(lineRes.updatedPdfBytes, siblingIdx);
                expect(afterSibling.streamText).toBe(origSiblingStream);
                untouchedP2Status = 'identical';
              }

              // Block text rewrite
              const blockRes = await replaceTextBlockContent(
                buffer,
                targetIdx,
                model,
                candidateBlock.segmentId,
                'Blok upraven 2026'
              );
              expect(blockRes.error).toBeUndefined();
              const verifyBlockDoc = await PDFDocument.load(blockRes.updatedPdfBytes, { ignoreEncryption: true });
              expect(verifyBlockDoc.getPageCount()).toBe(parsedPages.length);
              blockEditStatus = blockRes.fontSubstituted ? 'ok(sub)' : 'ok(orig)';

              // Readable code round-trip
              const readable = toReadableBlock(model, candidateBlock);
              if (readable.originals.length > 0) {
                const roundTripped = fromReadableBlock(model, candidateBlock, readable, readable.text);
                expect('error' in roundTripped).toBe(false);
                readableRtStatus = 'ok';
              }
            }
          }

          // 4. Single block deletion + neighbour selection + Batch deletion
          if (segments.length >= 1) {
            const orderedIds = segments.map((s) => s.id);
            const midIdx = Math.min(1, segments.length - 1);
            const targetSeg = segments[midIdx];
            const delRes = await removeMultipleElementsFromPage(
              buffer,
              targetIdx,
              [targetSeg.id],
              [],
              { [targetSeg.id]: targetSeg.rawContent }
            );
            expect(delRes.error).toBeUndefined();
            expect(delRes.removedCount).toBeGreaterThanOrEqual(1);

            const remainingAfterSingle = orderedIds.filter((id) => id !== targetSeg.id);
            const nextSel = getNextSelectionAfterRemoval(
              remainingAfterSingle,
              new Set([targetSeg.id]),
              targetSeg.id,
              orderedIds
            );
            if (orderedIds.length >= 3 && midIdx === 1) {
              expect(nextSel).toBe(orderedIds[2]);
            } else if (orderedIds.length === 2 && midIdx === 1) {
              expect(nextSel).toBe(orderedIds[0]);
            } else if (orderedIds.length === 1) {
              expect(nextSel).toBeNull();
            }

            const afterSingleDoc = await PDFDocument.load(delRes.updatedPdfBytes, { ignoreEncryption: true });
            expect(afterSingleDoc.getPageCount()).toBe(parsedPages.length);
            singleDeleteStatus = 'ok';

            // Batch delete 2 items (2 blocks, or 1 block + 1 image)
            if (segments.length >= 2 || images.length >= 1) {
              const batchBlocks = segments.length >= 2 ? [segments[0].id, segments[1].id] : [segments[0].id];
              const batchImgs = segments.length >= 2 ? [] : [images[0].id];
              const expected: Record<string, string> = {};
              for (const id of batchBlocks) {
                const seg = segments.find((s) => s.id === id);
                if (seg) expected[id] = seg.rawContent;
              }
              const batchRes = await removeMultipleElementsFromPage(
                buffer,
                targetIdx,
                batchBlocks,
                batchImgs,
                expected
              );
              expect(batchRes.error).toBeUndefined();
              expect(batchRes.removedCount).toBeGreaterThanOrEqual(2);
              const afterBatchDoc = await PDFDocument.load(batchRes.updatedPdfBytes, { ignoreEncryption: true });
              expect(afterBatchDoc.getPageCount()).toBe(parsedPages.length);
              batchDeleteStatus = `ok(-${batchRes.removedCount})`;
            }
          }

          // 5. Image extraction, XObject replacement, and placement deletion
          // If the target page has no XObject image, probe up to 20 pages of multi-page PDFs to test real XObject replacement too
          let xImgPageIdx = targetIdx;
          let xImgTarget = xobjectImages[0];
          if (!xImgTarget && parsedPages.length > 1) {
            for (let p = 0; p < Math.min(parsedPages.length, 20); p++) {
              if (p === targetIdx) continue;
              const probeImgs = await getPageImages(buffer, p);
              const foundXObj = probeImgs.images.find((im) => im.kind !== 'inline' && Boolean(im.name));
              if (foundXObj) {
                xImgPageIdx = p;
                xImgTarget = foundXObj;
                break;
              }
            }
          }

          if (xImgTarget) {
            const ext = await extractImageBytesFromPdf(buffer, xImgPageIdx, xImgTarget.cleanName);
            expect(ext).toBeDefined();

            const rep = await replaceImageOnPage(buffer, xImgPageIdx, xImgTarget.name, SAMPLE_PNG_1X1, 'image/png');
            if (!rep.error) {
              const repDoc = await PDFDocument.load(rep.updatedPdfBytes, { ignoreEncryption: true });
              expect(repDoc.getPageCount()).toBe(parsedPages.length);
              const otherIdx = parsedPages.length > 1 ? (xImgPageIdx === 0 ? 1 : 0) : -1;
              if (otherIdx >= 0) {
                const origOther = (await getPageContentStream(buffer, otherIdx)).streamText;
                const afterOther = (await getPageContentStream(rep.updatedPdfBytes, otherIdx)).streamText;
                expect(afterOther).toBe(origOther);
                untouchedP2Status = 'identical';
              }
              imgReplaceStatus = xImgPageIdx === targetIdx ? 'ok' : `ok(p${xImgPageIdx + 1})`;
            } else {
              imgReplaceStatus = `safe-err`;
            }
          } else if (inlineImages.length > 0) {
            imgReplaceStatus = 'inline-guarded';
          }

          const delImgPageIdx = images.length > 0 ? targetIdx : xImgTarget ? xImgPageIdx : -1;
          const delImgTarget = images[0] || xImgTarget;
          if (delImgTarget && delImgPageIdx >= 0) {
            const beforeCount =
              delImgPageIdx === targetIdx
                ? images.length
                : (await getPageImages(buffer, delImgPageIdx)).images.length;
            const delImgRes = await removeMultipleElementsFromPage(buffer, delImgPageIdx, [], [delImgTarget.id]);
            expect(delImgRes.error).toBeUndefined();
            const afterImgs = await getPageImages(delImgRes.updatedPdfBytes, delImgPageIdx);
            expect(afterImgs.images.length).toBeLessThan(beforeCount);
            imgDeleteStatus = `ok(${beforeCount}->${afterImgs.images.length})`;
          }

          // 6. Find & Replace on target page (leaving sibling page untouched)
          if (segments.length > 0) {
            // Find a literal ASCII word (length >= 3) inside the raw content stream parentheses if present
            const literalWordMatch = streamRes.streamText.match(/\(([A-Za-z]{3,12})\)/);
            if (literalWordMatch) {
              const needle = literalWordMatch[1];
              const frRes = await replaceTextInPageContentStream(buffer, targetIdx, needle, 'REPLACED', {
                matchCase: true,
              });
              expect(frRes.error).toBeUndefined();
              expect(frRes.occurrencesReplaced).toBeGreaterThanOrEqual(1);
              if (siblingIdx >= 0 && origSiblingStream !== null) {
                const afterFrSibling = await getPageContentStream(frRes.updatedPdfBytes, siblingIdx);
                expect(afterFrSibling.streamText).toBe(origSiblingStream);
              }
              findReplaceStatus = `ok(${frRes.occurrencesReplaced})`;
            } else {
              // Subset/CID-encoded stream: ensure Find & Replace handles cleanly without error/corruption
              const frRes = await replaceTextInPageContentStream(buffer, targetIdx, '__NO_SUCH_TOKEN__', 'X', {
                matchCase: true,
              });
              expect(frRes.error).toBeUndefined();
              expect(frRes.occurrencesReplaced).toBe(0);
              findReplaceStatus = 'subset-safe(0)';
            }
          }
        }

        // 7. In-document search over up to 3 pages (including encrypted docs readable by pdf.js)
        let searchHits = 0;
        const searchSlice = parsedPages.slice(0, Math.min(3, parsedPages.length));
        const sampleWord = visualBlocks
          .filter((b) => b.type !== 'image' && b.text)
          .flatMap((b) => b.text.split(/\s+/))
          .find((w) => /^[A-Za-zÀ-ž]{4,}$/.test(w));
        if (sampleWord) {
          const matches = await searchPdfDocument(
            searchSlice,
            [sourceDoc],
            sampleWord,
            { caseSensitive: false, wholeWord: false }
          );
          searchHits = matches.length;
          if (targetIdx < searchSlice.length) {
            expect(searchHits, `word="${sampleWord}" on ${file}`).toBeGreaterThanOrEqual(1);
          }
          for (const m of matches) {
            expect(m.rects.length).toBeGreaterThan(0);
            for (const r of m.rects) {
              expect(Number.isFinite(r.x)).toBe(true);
              expect(Number.isFinite(r.y)).toBe(true);
              expect(r.width).toBeGreaterThanOrEqual(0);
              expect(r.height).toBeGreaterThanOrEqual(0);
            }
          }
        }

        // 8. Export preservation + Whiteout overlay check (slice first 3 pages on huge docs to keep test fast)
        let exportOk = false;
        if (!isEncrypted) {
          const exportSlice = parsedPages.slice(0, Math.min(3, parsedPages.length));
          const whiteoutSample: WhiteoutAnnotation = {
            id: `wo_corpus_${file}`,
            pageId: exportSlice[0].id,
            type: 'whiteout',
            x: 36,
            y: 36,
            width: 140,
            height: 22,
            color: '#ffffff',
            fillColor: '#ffffff',
            opacity: 1,
            text: 'Přepsáno 2026',
            textColor: '#0f172a',
            fontSize: 11,
            fontFamily: 'Inter',
            createdAt: 1000,
            updatedAt: 1000,
          };
          const exportedBytes = await exportEditedPdf(
            [sourceDoc],
            exportSlice,
            [whiteoutSample],
            file,
            undefined,
            meta,
            {},
            'interactive',
            false
          );
          expect(exportedBytes.length).toBeGreaterThan(0);
          const exportedDoc = await PDFDocument.load(exportedBytes, { ignoreEncryption: true });
          expect(exportedDoc.getPageCount()).toBe(exportSlice.length);
          exportOk = true;
        }

        report.push({
          file,
          pages: parsedPages.length,
          encrypted: isEncrypted,
          repaired: repairs.length,
          aligned: Boolean(model?.aligned),
          textBlocks: segments.length,
          images: images.length,
          inlineImages: inlineImages.length,
          lineEdit: lineEditStatus,
          blockEdit: blockEditStatus,
          readableRT: readableRtStatus,
          singleDelete: singleDeleteStatus,
          batchDelete: batchDeleteStatus,
          imgReplace: imgReplaceStatus,
          imgDelete: imgDeleteStatus,
          findReplace: findReplaceStatus,
          searchHits,
          exportOk,
          untouchedP2: untouchedP2Status,
        });
      },
      90000
    );
  }
});
