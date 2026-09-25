import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import { getPdfjsAssetBaseUrl } from './pdfjsAssets';

/**
 * Font selection for text written into exported PDFs.
 *
 * The 14 standard PDF fonts only cover WinAnsi (Latin-1 + a few extras), so characters such as
 * "č ř ě ů ň ť ď" either crash pdf-lib ("WinAnsi cannot encode") or come out as wrong glyphs.
 * Text that fits WinAnsi keeps using the lightweight standard fonts; anything else is drawn with an
 * embedded (subsetted) Liberation Sans, which ships with pdfjs-dist. If that font cannot be loaded
 * (e.g. outside the browser), unsupported characters degrade to their base letters ("ř" -> "r").
 */

export type FontStyleKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

const UNICODE_FONT_FILES: Record<FontStyleKey, string> = {
  regular: 'LiberationSans-Regular.ttf',
  bold: 'LiberationSans-Bold.ttf',
  italic: 'LiberationSans-Italic.ttf',
  boldItalic: 'LiberationSans-BoldItalic.ttf',
};

const fontBytesCache = new Map<FontStyleKey, Promise<Uint8Array | null>>();

const loadUnicodeFontBytes = (style: FontStyleKey): Promise<Uint8Array | null> => {
  let pending = fontBytesCache.get(style);
  if (!pending) {
    // The same files pdf.js uses as its standard font data (served under pdfjs/standard_fonts/)
    const url = `${getPdfjsAssetBaseUrl() ?? ''}standard_fonts/${UNICODE_FONT_FILES[style]}`;
    pending =
      typeof fetch === 'function'
        ? fetch(url)
            .then(async (res) => (res.ok ? new Uint8Array(await res.arrayBuffer()) : null))
            .catch(() => null)
        : Promise.resolve(null);
    fontBytesCache.set(style, pending);
  }
  return pending;
};

export const styleKeyFor = (bold?: boolean, italic?: boolean): FontStyleKey =>
  bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

export const standardFontFor = (family: string | undefined, bold?: boolean, italic?: boolean): StandardFonts => {
  const fam = (family || '').toLowerCase();
  const style = styleKeyFor(bold, italic);
  if (fam.includes('courier')) {
    return {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    }[style];
  }
  if (fam.includes('times') || fam.includes('georgia')) {
    return {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    }[style];
  }
  return {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  }[style];
};

// Symbols produced by the editor (bullets, arrows) that neither font family can draw
const SYMBOL_FALLBACKS: Record<string, string> = {
  '▸': '›',
  '▪': '•',
  '→': '->',
  '←': '<-',
  '✓': 'v',
};

const glyphSupportCache = new WeakMap<PDFFont, Map<string, boolean>>();

export const fontSupportsChar = (font: PDFFont, char: string): boolean => {
  let cache = glyphSupportCache.get(font);
  if (!cache) {
    cache = new Map();
    glyphSupportCache.set(font, cache);
  }
  const cached = cache.get(char);
  if (cached !== undefined) return cached;

  let supported: boolean;
  const fontkitFont = (font as any).embedder?.font;
  if (fontkitFont && typeof fontkitFont.hasGlyphForCodePoint === 'function') {
    // Custom (embedded) font: encodeText never throws, it silently falls back to .notdef
    supported = fontkitFont.hasGlyphForCodePoint(char.codePointAt(0)!);
  } else {
    try {
      font.encodeText(char);
      supported = true;
    } catch {
      supported = false;
    }
  }
  cache.set(char, supported);
  return supported;
};

export const fontSupportsText = (font: PDFFont, text: string): boolean =>
  Array.from(text).every((ch) => fontSupportsChar(font, ch));

/**
 * Makes text drawable with the given font: unsupported characters fall back to their base letter
 * without diacritics, a close symbol, or "?" as a last resort. Line breaks become spaces.
 */
export const prepareTextForFont = (font: PDFFont, text: string): string =>
  Array.from(text.replace(/[\r\n\t]/g, ' '))
    .map((ch) => {
      if (fontSupportsChar(font, ch)) return ch;
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (base && Array.from(base).every((b) => fontSupportsChar(font, b))) return base;
      const symbol = SYMBOL_FALLBACKS[ch];
      if (symbol && Array.from(symbol).every((b) => fontSupportsChar(font, b))) return symbol;
      return '?';
    })
    .join('');

/**
 * Per-document font cache that picks the standard font for WinAnsi text and an embedded Unicode
 * font for everything else.
 */
export class PdfFontProvider {
  private standardFonts = new Map<StandardFonts, Promise<PDFFont>>();
  private unicodeFonts = new Map<FontStyleKey, Promise<PDFFont | null>>();

  constructor(private readonly doc: PDFDocument) {}

  getStandardFont(name: StandardFonts): Promise<PDFFont> {
    let font = this.standardFonts.get(name);
    if (!font) {
      font = this.doc.embedFont(name);
      this.standardFonts.set(name, font);
    }
    return font;
  }

  getUnicodeFont(style: FontStyleKey): Promise<PDFFont | null> {
    let font = this.unicodeFonts.get(style);
    if (!font) {
      font = loadUnicodeFontBytes(style).then(async (bytes) => {
        if (!bytes) return null;
        try {
          // fontkit is large and only needed for embedded fonts, so it is loaded on first use
          const { default: fontkit } = await import('@pdf-lib/fontkit');
          this.doc.registerFontkit(fontkit);
          return await this.doc.embedFont(bytes, { subset: true });
        } catch {
          return null;
        }
      });
      this.unicodeFonts.set(style, font);
    }
    return font;
  }

  /** Returns the best font for drawing `text`; pass the result to prepareTextForFont before drawing. */
  async fontFor(family: string | undefined, bold: boolean | undefined, italic: boolean | undefined, text: string): Promise<PDFFont> {
    const standard = await this.getStandardFont(standardFontFor(family, bold, italic));
    const needed = text.replace(/[\r\n\t]/g, '');
    if (fontSupportsText(standard, needed)) return standard;
    const unicode = await this.getUnicodeFont(styleKeyFor(bold, italic));
    return unicode ?? standard;
  }
}
