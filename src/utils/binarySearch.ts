/**
 * Fast zero-allocation byte sequence locator in a Uint8Array.
 * Prevents memory explosion and call-stack blowups from converting multi-MB PDFs to JS strings.
 */
export function findByteSequence(haystack: Uint8Array, needleAscii: string, startOffset = 0): number {
  const needleLen = needleAscii.length;
  const haystackLen = haystack.length;
  if (needleLen === 0 || haystackLen < needleLen) return -1;

  // Convert ASCII needle to byte lookup
  const needleBytes = new Uint8Array(needleLen);
  for (let i = 0; i < needleLen; i++) {
    needleBytes[i] = needleAscii.charCodeAt(i);
  }

  const firstByte = needleBytes[0];
  const maxSearch = haystackLen - needleLen;

  for (let i = startOffset; i <= maxSearch; i++) {
    if (haystack[i] === firstByte) {
      let match = true;
      for (let j = 1; j < needleLen; j++) {
        if (haystack[i + j] !== needleBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
  }

  return -1;
}

/**
 * Searches for a regex-like pattern inside a Uint8Array using a sliding ASCII window.
 */
export function findBytePattern(
  haystack: Uint8Array,
  patternRegex: RegExp,
  windowSize = 8192
): { index: number; match: string } | null {
  const decoder = new TextDecoder('latin1');
  const step = Math.floor(windowSize / 2);

  for (let i = 0; i < haystack.length; i += step) {
    const chunk = haystack.subarray(i, Math.min(i + windowSize, haystack.length));
    const str = decoder.decode(chunk);
    const m = str.match(patternRegex);
    if (m && m.index !== undefined) {
      return {
        index: i + m.index,
        match: m[0],
      };
    }
  }

  return null;
}
