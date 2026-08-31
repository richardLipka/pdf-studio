import { describe, it, expect } from 'vitest';

/**
 * Mirror of the color extractor logic in pdfLoader.ts for direct unit testing
 */
const extractColor = (rawColor: any, defaultColor: string): string => {
  if (!rawColor) return defaultColor;
  const len = rawColor.length;
  if (typeof len !== 'number' || len < 3) return defaultColor;

  let r = Number(rawColor[0]);
  let g = Number(rawColor[1]);
  let b = Number(rawColor[2]);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return defaultColor;

  // In PDF, colors are typically specified as normalized floats (0.0 .. 1.0)
  if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
    r = Math.round(r * 255);
    g = Math.round(g * 255);
    b = Math.round(b * 255);
  } else {
    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));
  }

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

describe('Color Extraction & TypedArray Parsing', () => {
  it('should correctly parse normalized float arrays (0.0 - 1.0)', () => {
    // Pure blue
    expect(extractColor([0, 0, 1], '#000000')).toBe('#0000ff');
    // Pure red
    expect(extractColor([1, 0, 0], '#000000')).toBe('#ff0000');
    // Sky blue (0.008, 0.518, 0.780) -> approx rgb(2, 132, 199) / #0284c7
    const skyBlue = extractColor([2 / 255, 132 / 255, 199 / 255], '#000000');
    expect(skyBlue).toBe('#0284c7');
  });

  it('should correctly parse Uint8ClampedArray returned by pdfjs-dist', () => {
    const uint8Arr = new Uint8ClampedArray([2, 132, 199]);
    // Array.isArray(uint8Arr) is false, but extractColor handles TypedArrays by checking length
    expect(Array.isArray(uint8Arr)).toBe(false);
    expect(extractColor(uint8Arr, '#f59e0b')).toBe('#0284c7');
  });

  it('should correctly parse Float32Array', () => {
    const floatArr = new Float32Array([1.0, 0.0, 0.0]);
    expect(extractColor(floatArr, '#000000')).toBe('#ff0000');
  });

  it('should return subtype default colors when color is null or empty', () => {
    expect(extractColor(null, '#fde047')).toBe('#fde047');
    expect(extractColor(undefined, '#dc2626')).toBe('#dc2626');
    expect(extractColor([], '#0284c7')).toBe('#0284c7');
  });
});
