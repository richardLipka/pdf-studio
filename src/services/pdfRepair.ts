import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream } from 'pdf-lib';

/**
 * Repairs PDF defects that other viewers tolerate but that make pdf.js draw blank pages.
 *
 * CCITT fax images (scans) whose /DecodeParms /Rows is larger than the image: some scan pipelines
 * write garbage there (e.g. /Rows 1084690432 for a 2952-row page). pdf.js 6 decodes CCITT with a
 * WASM decoder that trusts /Rows and gives up ("Jbig2Error: Unknown error"), so every page of such
 * a scan renders white; Acrobat, browsers' viewers and older pdf.js decode up to the image height.
 * The repair sets /Rows to the image height.
 *
 * Only documents that contain CCITT images are parsed (a byte scan decides), and a document is
 * re-serialized only when something was fixed, so ordinary files keep their exact bytes.
 */

export interface PdfRepairResult {
  buffer: ArrayBuffer;
  /** Human-readable list of what was fixed (empty when the buffer was returned unchanged) */
  repairs: string[];
}

const CCITT_MARKER = 'CCITTFaxDecode';

/** True when the ASCII text occurs in the bytes */
export const containsAscii = (bytes: Uint8Array, text: string): boolean => {
  const codes = Array.from(text, (c) => c.charCodeAt(0));
  const first = codes[0];
  const last = bytes.length - codes.length;
  for (let i = bytes.indexOf(first); i !== -1 && i <= last; i = bytes.indexOf(first, i + 1)) {
    let match = true;
    for (let j = 1; j < codes.length; j++) {
      if (bytes[i + j] !== codes[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
};

const numberValue = (obj: PDFObject | undefined): number | undefined =>
  obj instanceof PDFNumber ? obj.asNumber() : undefined;

const filterNames = (filter: PDFObject | undefined): string[] => {
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((f) => (f instanceof PDFName ? f.decodeText() : ''));
  }
  return [];
};

export const repairPdfDefects = async (buffer: ArrayBuffer): Promise<PdfRepairResult> => {
  const unchanged: PdfRepairResult = { buffer, repairs: [] };
  if (!containsAscii(new Uint8Array(buffer), CCITT_MARKER)) return unchanged;

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return unchanged;
  }
  // Strings and streams of encrypted files cannot be re-serialized by pdf-lib
  if (doc.isEncrypted) return unchanged;

  const context = doc.context;
  let fixedImages = 0;
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const ccittIndex = filterNames(dict.lookup(PDFName.of('Filter'))).indexOf(CCITT_MARKER);
    if (ccittIndex < 0) continue;
    const height = numberValue(dict.lookup(PDFName.of('Height')));
    if (!height || height <= 0) continue;

    const parmsKey = PDFName.of('DecodeParms');
    const parmsValue = dict.lookup(parmsKey);
    const parms =
      parmsValue instanceof PDFArray
        ? parmsValue.lookupMaybe(ccittIndex, PDFDict)
        : parmsValue instanceof PDFDict
        ? parmsValue
        : undefined;
    if (!parms) continue;
    const rows = numberValue(parms.lookup(PDFName.of('Rows')));
    if (rows === undefined || (rows > 0 && rows <= height)) continue;

    // The parameters may be shared by several images: give this image its own corrected copy
    const fixedParms = parms.clone(context);
    fixedParms.set(PDFName.of('Rows'), PDFNumber.of(height));
    if (parmsValue instanceof PDFArray) {
      const fixedArray = parmsValue.clone(context);
      fixedArray.set(ccittIndex, fixedParms);
      dict.set(parmsKey, fixedArray);
    } else {
      dict.set(parmsKey, fixedParms);
    }
    fixedImages++;
  }

  if (fixedImages === 0) return unchanged;
  try {
    const saved = await doc.save({ updateFieldAppearances: false });
    return {
      buffer: saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
      repairs: [`${fixedImages} CCITT image(s): /DecodeParms /Rows larger than the image height`],
    };
  } catch {
    return unchanged;
  }
};
