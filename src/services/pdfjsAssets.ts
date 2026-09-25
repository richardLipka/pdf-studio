/**
 * Location of the pdf.js runtime assets (wasm image decoders, standard fonts, CMaps, ICC profiles).
 * pdf.js requests these by file name at runtime, so vite.config.ts serves them in development and
 * copies them into the build under `pdfjs/` next to index.html.
 */
export const getPdfjsAssetBaseUrl = (): string | null => {
  if (typeof document === 'undefined') return null;
  try {
    return new URL('pdfjs/', document.baseURI).href;
  } catch {
    return null;
  }
};

/** getDocument options pointing pdf.js at its runtime assets (empty outside the browser) */
export const getPdfjsAssetOptions = () => {
  const base = getPdfjsAssetBaseUrl();
  if (!base) return {};
  return {
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}iccs/`,
  };
};
