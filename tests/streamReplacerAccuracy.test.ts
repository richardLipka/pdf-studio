import { describe, it, expect } from 'vitest';
import { replaceTextInStreamString } from '../src/services/contentStreamEditor';

describe('Content Stream Text Replacement Precision', () => {
  it('should NOT cascade double-replace when replacement contains the search string (e.g. test -> testing)', () => {
    const stream = 'BT /F1 12 Tf [ (test) ] TJ ET';
    const result = replaceTextInStreamString(stream, 'test', 'testing');

    expect(result.count).toBe(1);
    expect(result.modifiedContent).toContain('[ (testing) ] TJ');
    expect(result.modifiedContent).not.toContain('testinging');
  });

  it('should correctly replace text inside kerning TJ arrays split across multiple tokens', () => {
    const stream = 'BT /F1 12 Tf [ (Hel) -10 (lo) ] TJ ET';
    const result = replaceTextInStreamString(stream, 'Hello', 'Greetings');

    expect(result.count).toBe(1);
    expect(result.modifiedContent).toContain('[ (Greetings) ] TJ');
  });

  it('should accurately replace both standalone strings and TJ array strings without interference', () => {
    const stream = `
BT
/F1 12 Tf
(test) Tj
T*
[ (test) ] TJ
ET
`;
    const result = replaceTextInStreamString(stream, 'test', 'verified');

    expect(result.count).toBe(2);
    expect(result.modifiedContent).toContain('(verified) Tj');
    expect(result.modifiedContent).toContain('[ (verified) ] TJ');
    expect(result.modifiedContent).not.toContain('verifiedverified');
  });

  it('should safely escape parentheses inside replacement text without breaking PDF stream syntax', () => {
    const stream = 'BT /F1 12 Tf (Old Text) Tj ET';
    const result = replaceTextInStreamString(stream, 'Old Text', 'New (With Parens) Text');

    expect(result.count).toBe(1);
    // In PDF literal string, parens must be escaped as \( and \)
    expect(result.modifiedContent).toContain('(New \\(With Parens\\) Text) Tj');
  });
});
