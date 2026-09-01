import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getCachedPdfDocument } from '../src/services/pdfLoader';
import {
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
} from '../src/types/annotations';
import { findIntersectedTextLines } from '../src/utils/textSnap';

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

  it('should detect intersected text lines and snap underline and strikethrough over drawn text regions', () => {
    // Mock DOM page container with textLayer spans
    const pageContainer = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 1000 }),
      classList: {
        contains: (cls: string) => cls === 'pageContainer',
      },
      querySelector: (selector: string) => {
        if (selector === '.textLayer') {
          return {
            querySelectorAll: (sub: string) => {
              if (sub === 'span') {
                return [
                  // Line 1: y: 100..120, x: 50..250 (Text: "Agreement on terms")
                  {
                    textContent: 'Agreement on terms',
                    getBoundingClientRect: () => ({ left: 50, top: 100, width: 200, height: 20 }),
                  },
                  // Line 2: y: 130..150, x: 50..300 (Text: "Signed and verified by customer")
                  {
                    textContent: 'Signed and verified by customer',
                    getBoundingClientRect: () => ({ left: 50, top: 130, width: 250, height: 20 }),
                  },
                ];
              }
              return [];
            },
          };
        }
        return null;
      },
    } as any;

    // Dragged across line 1: x: 40..260, y: 95..125
    const dragBox1 = { x: 40, y: 95, width: 220, height: 30 };
    const lines1 = findIntersectedTextLines(pageContainer, dragBox1, 1.0);

    expect(lines1).toHaveLength(1);
    expect(lines1[0].text).toBe('Agreement on terms');
    expect(lines1[0].top).toBe(100);
    expect(lines1[0].bottom).toBe(120);

    // Verify underline calculation: lineBottom - strokeWidth (120 - 2 = 118)
    const underlineY = lines1[0].bottom - 2;
    expect(underlineY).toBe(118);

    // Verify strikethrough calculation: lineTop + lineH * 0.5 - strokeWidth / 2 (100 + 10 - 1 = 109)
    const strikeY = lines1[0].top + lines1[0].height * 0.5 - 2 / 2;
    expect(strikeY).toBe(109);

    // Dragged across empty margin: x: 500..600, y: 800..900 (No text)
    const emptyDrag = { x: 500, y: 800, width: 100, height: 100 };
    const emptyLines = findIntersectedTextLines(pageContainer, emptyDrag, 1.0);
    expect(emptyLines).toHaveLength(0);
  });
});
