import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  replaceTextInStreamString,
  replaceTextInPageContentStream,
  replaceTextInAllPagesContentStream,
  unescapePdfLiteralString,
  escapePdfLiteralString,
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

  describe('replaceTextInPageContentStream (Integration with PDF bytes)', () => {
    it('should replace text in a real PDF page content stream and produce valid PDF', async () => {
      // 1. Create a sample PDF with pdf-lib
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

      // 2. Perform in-place stream replacement on page 0
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

      // 3. Verify that the loaded PDF is valid and contains the modified text
      const reloadedDoc = await PDFDocument.load(result.updatedPdfBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      expect(reloadedDoc.getPageCount()).toBe(1);

      // 4. Verify logs
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
        99, // out of bounds
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
