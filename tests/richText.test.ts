import { describe, it, expect } from 'vitest';
import {
  parseRichTextToLines,
  linesToPlainText,
  formatPlainTextToHtml,
  getBulletSymbol,
} from '../src/utils/richText';

describe('Rich Text Parsing & Multiline Text Utilities', () => {
  it('should parse HTML with inline bold and italic tags into structured spans', () => {
    const html = '<p>Normal text with <b>bold words</b> and <i>italic words</i></p>';
    const lines = parseRichTextToLines('', html);

    expect(lines.length).toBeGreaterThan(0);
    const spans = lines[0].spans;
    expect(spans).toBeDefined();

    const boldSpan = spans.find((s) => s.bold === true);
    expect(boldSpan).toBeDefined();
    expect(boldSpan?.text).toBe('bold words');

    const italicSpan = spans.find((s) => s.italic === true);
    expect(italicSpan).toBeDefined();
    expect(italicSpan?.text).toBe('italic words');
  });

  it('should parse multiline HTML with <br> and <p> elements correctly (Shift+Enter equivalent)', () => {
    const html = '<p>Line 1<br>Line 2</p><p>Line 3</p>';
    const lines = parseRichTextToLines('', html);

    expect(lines.length).toBe(3);
    expect(lines[0].spans.map((s) => s.text).join('')).toBe('Line 1');
    expect(lines[1].spans.map((s) => s.text).join('')).toBe('Line 2');
    expect(lines[2].spans.map((s) => s.text).join('')).toBe('Line 3');
  });

  it('should format unordered bullet lists with customizable bullet styles', () => {
    const html = '<ul><li>First item</li><li>Second <b>bold</b> item</li></ul>';

    // Disc bullet (default)
    const linesDisc = parseRichTextToLines('', html, 'disc');
    expect(linesDisc.length).toBe(2);
    expect(linesDisc[0].spans[0].text).toBe('• ');
    expect(linesDisc[0].spans[1].text).toBe('First item');
    expect(linesDisc[1].spans[0].text).toBe('• ');
    expect(linesDisc[1].spans[2].bold).toBe(true);

    // Square bullet
    const linesSquare = parseRichTextToLines('', html, 'square');
    expect(linesSquare[0].spans[0].text).toBe('▪ ');

    // Dash bullet
    const linesDash = parseRichTextToLines('', html, 'dash');
    expect(linesDash[0].spans[0].text).toBe('– ');

    // Arrow bullet
    const linesArrow = parseRichTextToLines('', html, 'arrow');
    expect(linesArrow[0].spans[0].text).toBe('▸ ');
  });

  it('should automatically number ordered lists (<ol><li>)', () => {
    const html = '<ol><li>First step</li><li>Second step</li><li>Third step</li></ol>';
    const lines = parseRichTextToLines('', html);

    expect(lines.length).toBe(3);
    expect(lines[0].spans[0].text).toBe('1. ');
    expect(lines[0].spans[1].text).toBe('First step');
    expect(lines[1].spans[0].text).toBe('2. ');
    expect(lines[1].spans[1].text).toBe('Second step');
    expect(lines[2].spans[0].text).toBe('3. ');
    expect(lines[2].spans[1].text).toBe('Third step');
  });

  it('should convert plain text with newlines and markdown formatting gracefully', () => {
    const plain = 'Header line\nThis is **bold** text\n*Italic* note\n• Item one\n1. Numbered item';
    const lines = parseRichTextToLines(plain);

    expect(lines.length).toBe(5);
    expect(lines[0].spans[0].text).toBe('Header line');

    const boldSpan = lines[1].spans.find((s) => s.bold);
    expect(boldSpan?.text).toBe('bold');

    const italicSpan = lines[2].spans.find((s) => s.italic);
    expect(italicSpan?.text).toBe('Italic');

    expect(lines[3].spans[0].text).toBe('• ');
    expect(lines[3].spans[1].text).toBe('Item one');

    expect(lines[4].spans[0].text).toBe('1. ');
    expect(lines[4].spans[1].text).toBe('Numbered item');
  });

  it('should convert lines back to clean multiline plain text representation', () => {
    const html = '<p>Line A</p><ul><li>Bullet B</li></ul><ol><li>Step C</li></ol>';
    const lines = parseRichTextToLines('', html);
    const plainText = linesToPlainText(lines);

    expect(plainText).toContain('Line A');
    expect(plainText).toContain('• Bullet B');
    expect(plainText).toContain('1. Step C');
  });

  it('should convert plain text to HTML for contentEditable initialization', () => {
    const plain = 'First line\nSecond line & special <char>';
    const html = formatPlainTextToHtml(plain);

    expect(html).toBe('First line<br>Second line &amp; special &lt;char&gt;');
  });

  it('should return correct bullet symbols for all bullet styles', () => {
    expect(getBulletSymbol('disc')).toBe('•');
    expect(getBulletSymbol('square')).toBe('▪');
    expect(getBulletSymbol('dash')).toBe('–');
    expect(getBulletSymbol('arrow')).toBe('▸');
  });
});
