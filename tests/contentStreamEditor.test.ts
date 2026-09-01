import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  replaceTextInStreamString,
  replaceTextInPageContentStream,
  replaceTextInAllPagesContentStream,
  unescapePdfLiteralString,
  escapePdfLiteralString,
  getPageContentStream,
  parseStreamSegments,
  extractPreviewTextFromBlock,
  updatePageContentStream,
  updateStreamSegmentInPage,
} from '../src/services/contentStreamEditor';
import { logger } from '../src/services/logger';

describe('PDF Content Stream Editor & In-Place Text Replacement', () => {
  beforeEach(() => {
    logger.clear();
  });

  describe('String Helper Utilities', () => {
    it('should correctly escape and unescape PDF literal strings', () => {
      const original = 'Hello (World) \\ Test / [123]';
      const escaped = escapePdfLiteralString(original);
      expect(escaped).toBe('Hello \\(World\\) \\\\ Test / [123]');
      const unescaped = unescapePdfLiteralString(escaped);
      expect(unescaped).toBe(original);
    });

    it('should unescape octal escape sequences in PDF strings', () => {
      // Octal 101 is 'A' (65)
      const octalStr = '\\101\\102\\103';
      expect(unescapePdfLiteralString(octalStr)).toBe('ABC');
    });
  });

  describe('replaceTextInStreamString', () => {
    it('should replace text within literal PDF strings', () => {
      const stream = `
        BT
        /F1 12 Tf
        72 712 Td
        (Smlouva o dilo 2025) Tj
        ET
      `;

      const { modifiedContent, count } = replaceTextInStreamString(
        stream,
        '2025',
        '2026'
      );

      expect(count).toBe(1);
      expect(modifiedContent).toContain('(Smlouva o dilo 2026) Tj');
    });

    it('should replace multiple occurrences of the same text', () => {
      const stream = `
        (Cena: 100 EUR) Tj
        T*
        (Zaloha: 100 EUR) Tj
      `;

      const { modifiedContent, count } = replaceTextInStreamString(
        stream,
        '100 EUR',
        '2500 CZK'
      );

      expect(count).toBe(2);
      expect(modifiedContent).toContain('(Cena: 2500 CZK) Tj');
      expect(modifiedContent).toContain('(Zaloha: 2500 CZK) Tj');
    });

    it('should respect matchCase option', () => {
      const stream = '(KONTRAKT) Tj (kontrakt) Tj';

      const caseSensitive = replaceTextInStreamString(stream, 'kontrakt', 'dohoda', {
        matchCase: true,
      });
      expect(caseSensitive.count).toBe(1);
      expect(caseSensitive.modifiedContent).toContain('(KONTRAKT) Tj (dohoda) Tj');

      const caseInsensitive = replaceTextInStreamString(stream, 'kontrakt', 'dohoda', {
        matchCase: false,
      });
      expect(caseInsensitive.count).toBe(2);
      expect(caseInsensitive.modifiedContent).toContain('(dohoda) Tj (dohoda) Tj');
    });

    it('should return count 0 when text is not found', () => {
      const stream = '(Standard text without matching keyword) Tj';
      const { modifiedContent, count } = replaceTextInStreamString(
        stream,
        'NonExistent',
        'Replacement'
      );
      expect(count).toBe(0);
      expect(modifiedContent).toBe(stream);
    });
  });

  describe('parseStreamSegments & extractPreviewTextFromBlock', () => {
    it('should correctly parse BT ... ET text blocks and extract human readable preview text', () => {
      const stream = `
        q 1 0 0 1 0 0 cm
        BT
        /F1 14 Tf
        72 712 Td
        (Smlouva o dilo) Tj
        ET
        0.5 g
        10 10 100 50 re f
        BT
        /TT2 12 Tf
        1 0 0 1 100 200 Tm
        [(Cena) 10 ( ) -5 (2500) 20 ( CZK)] TJ
        ET
        Q
      `;

      const segments = parseStreamSegments(stream);
      const textBlocks = segments.filter((s) => s.type === 'text');

      expect(textBlocks.length).toBe(2);
      expect(textBlocks[0].id).toBe('block_1');
      expect(textBlocks[0].previewText).toContain('Smlouva o dilo');
      expect(textBlocks[0].fontInfo).toBe('/F1 14pt');
      expect(textBlocks[0].positionInfo).toBe('X: 72.0, Y: 712.0');

      expect(textBlocks[1].id).toBe('block_2');
      expect(textBlocks[1].previewText).toContain('Cena 2500 CZK');
      expect(textBlocks[1].fontInfo).toBe('/TT2 12pt');
      expect(textBlocks[1].positionInfo).toBe('X: 100.0, Y: 200.0');
    });

    it('should extract text from hex and quote operators', () => {
      const block = `
        BT
        /F1 12 Tf
        <48656c6c6f20576f726c64> Tj
        (Dalsi radek) '
        ET
      `;

      const preview = extractPreviewTextFromBlock(block);
      expect(preview).toContain('Hello World');
      expect(preview).toContain('Dalsi radek');
    });
  });

  describe('getPageContentStream, updatePageContentStream & updateStreamSegmentInPage', () => {
    it('should extract decompressed page stream from a real PDF and parse segments', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([500, 500]);
      const font = await doc.embedFont(StandardFonts.Helvetica);

      page.drawText('Original Text In Stream 12345', {
        x: 50,
        y: 400,
        size: 14,
        font,
      });

      const bytes = await doc.save();
      const { streamText, streamCount } = await getPageContentStream(
        bytes.buffer as ArrayBuffer,
        0
      );

      expect(streamCount).toBeGreaterThanOrEqual(1);
      expect(streamText).toContain('BT');
      expect(streamText).toContain('ET');

      const segments = parseStreamSegments(streamText);
      const textBlocks = segments.filter((s) => s.type === 'text');
      expect(textBlocks.length).toBeGreaterThanOrEqual(1);
      expect(textBlocks[0].previewText).toContain('Original Text In Stream 12345');
    });

    it('should directly update a specific segment in the page stream', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([500, 500]);
      const font = await doc.embedFont(StandardFonts.Helvetica);

      page.drawText('Faktura 2025', { x: 50, y: 400, size: 12, font });
      const initialBytes = await doc.save();

      const { streamText } = await getPageContentStream(initialBytes.buffer as ArrayBuffer, 0);
      const segments = parseStreamSegments(streamText);
      const block1 = segments.find((s) => s.type === 'text');
      expect(block1).toBeDefined();

      // In pdf-lib hex encoding, 2025 is 32303235, 2026 is 32303236
      const modifiedBlock = block1!.rawContent.includes('32303235')
        ? block1!.rawContent.replace('32303235', '32303236')
        : block1!.rawContent.replace('2025', '2026');

      const result = await updateStreamSegmentInPage(
        initialBytes.buffer as ArrayBuffer,
        0,
        block1!.rawContent,
        modifiedBlock
      );

      expect(result.error).toBeUndefined();
      expect(result.updatedPdfBytes).toBeDefined();

      const reloadedStream = await getPageContentStream(result.updatedPdfBytes, 0);
      const reloadedSegments = parseStreamSegments(reloadedStream.streamText);
      const reloadedBlock = reloadedSegments.find((s) => s.type === 'text');
      expect(reloadedBlock?.previewText).toContain('Faktura 2026');
      expect(reloadedBlock?.previewText).not.toContain('Faktura 2025');
    });

    it('should directly replace the full page content stream', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([500, 500]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText('Old Content', { x: 50, y: 400, size: 12, font });
      const bytes = await doc.save();

      const customStream = `
        BT
        /F1 16 Tf
        100 300 Td
        (Direct Full Custom Stream Injection) Tj
        ET
      `;

      const result = await updatePageContentStream(bytes.buffer as ArrayBuffer, 0, customStream);
      expect(result.error).toBeUndefined();

      const reloadedStream = await getPageContentStream(result.updatedPdfBytes, 0);
      expect(reloadedStream.streamText).toContain('Direct Full Custom Stream Injection');
    });
  });

  describe('replaceTextInPageContentStream (Integration with PDF bytes)', () => {
    it('should replace text in a real PDF page content stream and produce valid PDF', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 400]);
      const font = await doc.embedFont(StandardFonts.Helvetica);

      page.drawText('Platnost do: 31.12.2025', {
        x: 50,
        y: 350,
        size: 14,
        font,
        color: rgb(0, 0, 0),
      });

      const initialBytes = await doc.save();

      const result = await replaceTextInPageContentStream(
        initialBytes.buffer as ArrayBuffer,
        0,
        '2025',
        '2026'
      );

      expect(result.occurrencesReplaced).toBe(1);
      expect(result.pagesModified).toEqual([0]);
      expect(result.updatedPdfBytes).toBeDefined();
      expect(result.updatedPdfBytes.byteLength).toBeGreaterThan(0);

      const reloadedDoc = await PDFDocument.load(result.updatedPdfBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      expect(reloadedDoc.getPageCount()).toBe(1);

      const logs = logger.getLogs();
      const editSuccess = logs.find(
        (l) => l.category === 'edit' && l.level === 'success'
      );
      expect(editSuccess).toBeDefined();
    });

    it('should handle non-existent page gracefully', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 400]);
      const bytes = await doc.save();

      const result = await replaceTextInPageContentStream(
        bytes.buffer as ArrayBuffer,
        99,
        'test',
        'replacement'
      );

      expect(result.occurrencesReplaced).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  describe('replaceTextInAllPagesContentStream', () => {
    it('should replace text across all pages in a multi-page document', async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);

      // Page 1
      const p1 = doc.addPage([500, 500]);
      p1.drawText('Spolecnost ACME verze 1.0', { x: 50, y: 400, size: 12, font });

      // Page 2
      const p2 = doc.addPage([500, 500]);
      p2.drawText('Copyright ACME Corp 2026', { x: 50, y: 400, size: 12, font });

      // Page 3 (no match)
      const p3 = doc.addPage([500, 500]);
      p3.drawText('Sekce bez klicoveho slova', { x: 50, y: 400, size: 12, font });

      const pdfBytes = await doc.save();

      const result = await replaceTextInAllPagesContentStream(
        pdfBytes.buffer as ArrayBuffer,
        'ACME',
        'NOVA-FIRMA'
      );

      expect(result.occurrencesReplaced).toBe(2);
      expect(result.pagesModified).toEqual([0, 1]);

      const reloadedDoc = await PDFDocument.load(result.updatedPdfBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      expect(reloadedDoc.getPageCount()).toBe(3);
    });
  });
});
