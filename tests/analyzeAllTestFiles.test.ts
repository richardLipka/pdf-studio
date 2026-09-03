import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFRef, PDFRawStream, decodePDFRawStream, arrayAsString } from 'pdf-lib';
import {
  getPageContentStream,
  parseStreamSegments,
  parseStreamTree,
  extractPreviewTextFromBlock,
  replaceTextInStreamString,
  replaceTextBlockText,
} from '../src/services/contentStreamEditor';
import { getCachedPdfDocument, getPageTextBlocks } from '../src/services/pdfLoader';
import { PdfPageModel, SourceDocument } from '../src/types/document';

interface AnalysisSummary {
  file: string;
  sizeBytes: number;
  pageCount: number;
  page1Streams: number;
  textBlocksCount: number;
  graphicsBlocksCount: number;
  maxQNesting: number;
  treeNodesCount: number;
  hasMarkedContent: boolean;
  markedContentTags: string[];
  operatorsUsed: Record<string, number>;
  hasTj: boolean;
  hasTJArray: boolean;
  hasHexStrings: boolean;
  hasCustomCMapGlyphs: boolean;
  sampleStreamPreview: string[];
  samplePdfJsText: string[];
  blockReplaceSuccess: boolean;
  quickReplaceSuccessSample: boolean;
  quickReplaceFailReason?: string;
  borderAlignmentScore: string;
}

describe('In-depth Analysis of All Test PDFs', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const files = fs.existsSync(testFilesDir) ? fs.readdirSync(testFilesDir).filter((f) => f.endsWith('.pdf')) : [];

  it('runs deep architectural analysis across all testfiles', async () => {
    console.log(`\n======================================================`);
    console.log(`FOUND ${files.length} TEST FILES IN src/assets/testfiles`);
    console.log(`======================================================\n`);

    const summaries: AnalysisSummary[] = [];

    for (const file of files) {
      const filePath = path.join(testFilesDir, file);
      const stat = fs.statSync(filePath);
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      let pdfDoc: PDFDocument | null = null;
      let pageCount = 0;
      try {
        pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        pageCount = pdfDoc.getPageCount();
      } catch (e: any) {
        console.log(`[${file}] Failed to load with pdf-lib: ${e.message}`);
      }

      const { streamText, streamCount, error } = await getPageContentStream(arrayBuffer, 0);

      // Analyze stream text if present
      let textBlocksCount = 0;
      let graphicsBlocksCount = 0;
      let maxQNesting = 0;
      let currentQNesting = 0;
      let hasMarkedContent = false;
      const markedTags = new Set<string>();
      const operators: Record<string, number> = {};
      let hasTj = false;
      let hasTJArray = false;
      let hasHexStrings = false;
      let hasCustomCMapGlyphs = false;
      const sampleStreamPreview: string[] = [];

      if (streamText) {
        const segments = parseStreamSegments(streamText);
        textBlocksCount = segments.filter((s) => s.type === 'text').length;
        graphicsBlocksCount = segments.filter((s) => s.type === 'graphics').length;

        sampleStreamPreview.push(...segments.filter((s) => s.type === 'text').slice(0, 3).map((s) => s.previewText));

        // Scan tokens and operators
        const lines = streamText.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === 'q') {
            currentQNesting++;
            if (currentQNesting > maxQNesting) maxQNesting = currentQNesting;
          } else if (trimmed === 'Q') {
            if (currentQNesting > 0) currentQNesting--;
          } else if (trimmed.endsWith('BDC') || trimmed.endsWith('BMC')) {
            hasMarkedContent = true;
            const parts = trimmed.split(/\s+/);
            if (parts.length > 1) markedTags.add(parts[0]);
          }

          if (/\[.*\]\s*TJ/.test(trimmed)) hasTJArray = true;
          if (/\(.*\)\s*Tj/.test(trimmed) || /<.*>\s*Tj/.test(trimmed)) hasTj = true;
          if (/<[0-9a-fA-F\s]{2,}>/.test(trimmed)) hasHexStrings = true;

          // Track common operators
          const opMatch = trimmed.match(/([a-zA-Z*]+)$/);
          if (opMatch) {
            const op = opMatch[1];
            operators[op] = (operators[op] || 0) + 1;
          }
        }
      }

      // Check PDF.js text layer & Visual Text Blocks
      let samplePdfJsText: string[] = [];
      let borderAlignmentScore = 'N/A';
      let quickReplaceSuccessSample = false;
      let quickReplaceFailReason = undefined;

      try {
        const pdfjsDoc = await getCachedPdfDocument(file, arrayBuffer);
        const page1 = await pdfjsDoc.getPage(1);
        const textContent = await page1.getTextContent();
        samplePdfJsText = textContent.items
          .map((it: any) => it.str)
          .filter((s: string) => s && s.trim().length > 1)
          .slice(0, 5);

        // Check if sample text from PDF.js can be found by current replaceTextInStreamString
        if (samplePdfJsText.length > 0 && streamText) {
          const testWord = samplePdfJsText[0].trim();
          const repResult = replaceTextInStreamString(streamText, testWord, 'REPLACED_TEST');
          if (repResult.count > 0) {
            quickReplaceSuccessSample = true;
          } else {
            // Check why it failed
            if (!streamText.includes(testWord)) {
              if (hasTJArray) {
                quickReplaceFailReason = `Text is split inside [ (...) kerning (...) ] TJ array or uses hex font glyphs`;
              } else if (hasHexStrings) {
                quickReplaceFailReason = `Text is encoded as raw hex glyph indices <...> instead of literal characters`;
              } else {
                quickReplaceFailReason = `Stream characters use subset font encoding / CMap not matching raw ASCII`;
              }
            } else {
              quickReplaceFailReason = `Word exists in stream but outside literal parens / hex parser bounds`;
            }
          }
        }

        // Check Visual Blocks border accuracy
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
          rotation: 0,
          width: pageVp.width,
          height: pageVp.height,
          aspectRatio: pageVp.width / pageVp.height,
        };

        const visualBlocks = await getPageTextBlocks(sourceDoc, pageModel);
        if (visualBlocks.length > 0 && textContent.items.length > 0) {
          const matchedCount = visualBlocks.filter((vb) => vb.text && vb.text.length > 0 && !vb.text.startsWith('[Textový blok')).length;
          const ratio = (matchedCount / visualBlocks.length) * 100;
          borderAlignmentScore = `${matchedCount}/${visualBlocks.length} (${ratio.toFixed(0)}% matched visual text)`;
        } else if (textContent.items.length === 0) {
          borderAlignmentScore = 'Scanned/Image-only page (no vector text)';
        }
      } catch (e: any) {
        borderAlignmentScore = `PDF.js error: ${e.message}`;
      }

      let blockReplaceSuccess = false;
      let treeNodesCount = 0;
      if (streamText) {
        const segments = parseStreamSegments(streamText);
        const textSegments = segments.filter((s) => s.type === 'text');
        if (textSegments.length > 0) {
          const sampleBlock = textSegments.find((s) => s.previewText && !s.previewText.startsWith('[Textový blok')) || textSegments[0];
          const replaced = replaceTextBlockText(sampleBlock.rawContent, 'TEST_REPLACED_TEXT');
          if (replaced && replaced.includes('TEST_REPLACED_TEXT')) {
            blockReplaceSuccess = true;
          }
        }
        const tree = parseStreamTree(streamText);
        const countTree = (n: any): number => 1 + (n.children ? n.children.reduce((acc: number, c: any) => acc + countTree(c), 0) : 0);
        treeNodesCount = countTree(tree);
      }

      summaries.push({
        file,
        sizeBytes: stat.size,
        pageCount,
        page1Streams: streamCount,
        textBlocksCount,
        graphicsBlocksCount,
        maxQNesting,
        treeNodesCount,
        hasMarkedContent,
        markedContentTags: Array.from(markedTags),
        operatorsUsed: operators,
        hasTj,
        hasTJArray,
        hasHexStrings,
        hasCustomCMapGlyphs,
        sampleStreamPreview,
        samplePdfJsText,
        blockReplaceSuccess,
        quickReplaceSuccessSample,
        quickReplaceFailReason,
        borderAlignmentScore,
      });
    }

    const reportPath = path.resolve(__dirname, '../analysis_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(summaries, null, 2), 'utf8');
    console.log(`Saved report to ${reportPath}`);

    for (const s of summaries) {
      console.log(`- ${s.file}: pages=${s.pageCount}, blocks=${s.textBlocksCount}, treeNodes=${s.treeNodesCount}, blockRep=${s.blockReplaceSuccess}, TJRep=${s.quickReplaceSuccessSample}, border=${s.borderAlignmentScore}`);
    }
  }, 60000);
});
