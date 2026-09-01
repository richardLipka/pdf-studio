import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getCachedPdfDocument } from '../src/services/pdfLoader';
import {
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
} from '../src/types/annotations';

describe('Text Selection, Layer Rendering & Clipboard Support', () => {
  it('should extract text items, positions and glyph streams from PDF document for text layer', async () => {
    // Generate a test PDF with text using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Hello PDF Studio Text Selection and Clipboard Test', {
      x: 50,
      y: 350,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();
    const arrayBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);

    const docProxy = await getCachedPdfDocument('test-text-doc', arrayBuffer);
    const pdfPage = await docProxy.getPage(1);
    const textContent = await pdfPage.getTextContent();

    expect(textContent.items.length).toBeGreaterThan(0);
    const allExtractedStrings = textContent.items
      .map((item: any) => item.str)
      .join(' ');

    expect(allExtractedStrings).toContain('Hello');
    expect(allExtractedStrings).toContain('PDF Studio');
    expect(allExtractedStrings).toContain('Selection');
  });

  it('should accurately convert selection client rects to PDF point coordinate annotations', () => {
    const scale = 1.5;
    const containerRect = { left: 100, top: 100, width: 900, height: 600 };
    
    // Simulate 2 lines of selected text on screen
    const selectionClientRects = [
      { left: 150, top: 150, width: 300, height: 30 },
      { left: 150, top: 195, width: 200, height: 30 },
    ];

    const generatedHighlights: HighlightAnnotation[] = selectionClientRects.map((rect, idx) => {
      const pdfX = (rect.left - containerRect.left) / scale;
      const pdfY = (rect.top - containerRect.top) / scale;
      const pdfWidth = rect.width / scale;
      const pdfHeight = rect.height / scale;

      return {
        id: `hl_text_${idx}`,
        pageId: 'page-1',
        type: 'highlight',
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        color: '#fde047',
        opacity: 0.4,
        createdAt: 1000,
        updatedAt: 1000,
      };
    });

    expect(generatedHighlights).toHaveLength(2);
    // Line 1: (150-100)/1.5 = 33.33, (150-100)/1.5 = 33.33, width: 300/1.5 = 200, height: 30/1.5 = 20
    expect(generatedHighlights[0].x).toBeCloseTo(33.33, 1);
    expect(generatedHighlights[0].y).toBeCloseTo(33.33, 1);
    expect(generatedHighlights[0].width).toBeCloseTo(200, 1);
    expect(generatedHighlights[0].height).toBeCloseTo(20, 1);

    // Line 2: (150-100)/1.5 = 33.33, (195-100)/1.5 = 63.33, width: 200/1.5 = 133.33, height: 30/1.5 = 20
    expect(generatedHighlights[1].x).toBeCloseTo(33.33, 1);
    expect(generatedHighlights[1].y).toBeCloseTo(63.33, 1);
    expect(generatedHighlights[1].width).toBeCloseTo(133.33, 1);
    expect(generatedHighlights[1].height).toBeCloseTo(20, 1);
  });

  it('should generate accurate Underline and Strikethrough annotations on text selection ranges', () => {
    const scale = 2.0;
    const containerRect = { left: 0, top: 0, width: 1200, height: 800 };
    const rect = { left: 100, top: 200, width: 400, height: 40 };
    const strokeWidth = 2;

    const pdfX = (rect.left - containerRect.left) / scale; // 50
    const pdfY = (rect.top - containerRect.top) / scale;   // 100
    const pdfWidth = rect.width / scale;                  // 200
    const pdfHeight = rect.height / scale;                // 20

    const underline: UnderlineAnnotation = {
      id: 'ul-1',
      pageId: 'page-1',
      type: 'underline',
      x: pdfX,
      y: pdfY + pdfHeight - strokeWidth,
      width: pdfWidth,
      height: strokeWidth,
      strokeWidth,
      color: '#0284c7',
      opacity: 0.9,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const strikethrough: StrikethroughAnnotation = {
      id: 'st-1',
      pageId: 'page-1',
      type: 'strikethrough',
      x: pdfX,
      y: pdfY + pdfHeight / 2 - strokeWidth / 2,
      width: pdfWidth,
      height: strokeWidth,
      strokeWidth,
      color: '#dc2626',
      opacity: 0.9,
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Underline positioned at bottom of text line
    expect(underline.x).toBe(50);
    expect(underline.y).toBe(118); // 100 + 20 - 2
    expect(underline.width).toBe(200);
    expect(underline.strokeWidth).toBe(2);

    // Strikethrough positioned at vertical center of text line
    expect(strikethrough.x).toBe(50);
    expect(strikethrough.y).toBe(109); // 100 + 10 - 1
    expect(strikethrough.width).toBe(200);
    expect(strikethrough.strokeWidth).toBe(2);
  });
});
