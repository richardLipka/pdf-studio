import { describe, it, expect } from 'vitest';
import { findByteSequence, findBytePattern } from '../src/utils/binarySearch';
import { safeSerializeDetails } from '../src/services/logger';

describe('Binary Search Utility & Logger Hardening', () => {
  describe('findByteSequence', () => {
    it('finds exact ASCII byte sequences in Uint8Array without string conversion', () => {
      const text = 'Hello world! PDF-1.7 /ByteRange [ 0 100 200 300 ] %%EOF';
      const bytes = new TextEncoder().encode(text);

      const offset1 = findByteSequence(bytes, 'PDF-1.7');
      expect(offset1).toBe(text.indexOf('PDF-1.7'));

      const offset2 = findByteSequence(bytes, '/ByteRange');
      expect(offset2).toBe(text.indexOf('/ByteRange'));

      const offset3 = findByteSequence(bytes, '%%EOF');
      expect(offset3).toBe(text.indexOf('%%EOF'));
    });

    it('returns -1 when sequence is not found or empty', () => {
      const bytes = new TextEncoder().encode('short buffer');
      expect(findByteSequence(bytes, 'not-present')).toBe(-1);
      expect(findByteSequence(bytes, '')).toBe(-1);
      expect(findByteSequence(new Uint8Array(0), 'test')).toBe(-1);
    });

    it('respects startOffset', () => {
      const text = 'repeat repeat repeat';
      const bytes = new TextEncoder().encode(text);

      const first = findByteSequence(bytes, 'repeat', 0);
      expect(first).toBe(0);

      const second = findByteSequence(bytes, 'repeat', first + 1);
      expect(second).toBe(7);

      const third = findByteSequence(bytes, 'repeat', second + 1);
      expect(third).toBe(14);
    });
  });

  describe('findBytePattern', () => {
    it('matches regex patterns across byte chunks', () => {
      const text = 'Header ... /ByteRange [ 0 1000000000 1000000000 1000000000 ] ... Trailer';
      const bytes = new TextEncoder().encode(text);

      const pattern = /\/ByteRange\s*\[\s*0\s+1000000000\s+1000000000\s+1000000000\s*\]/;
      const match = findBytePattern(bytes, pattern);

      expect(match).not.toBeNull();
      expect(match!.index).toBe(text.indexOf('/ByteRange'));
      expect(match!.match).toContain('/ByteRange');
    });

    it('returns null when pattern does not match', () => {
      const bytes = new TextEncoder().encode('simple text without pattern');
      const match = findBytePattern(bytes, /missing_token_[0-9]+/);
      expect(match).toBeNull();
    });
  });

  describe('safeSerializeDetails Hardening', () => {
    it('handles mutual circular Error.cause chains without throwing or stack overflow', () => {
      const errA: any = new Error('Error A');
      const errB: any = new Error('Error B');
      errA.cause = errB;
      errB.cause = errA; // Circular cause

      expect(() => {
        const serialized = safeSerializeDetails(errA);
        expect(serialized).toBeDefined();
        expect(serialized).toContain('Error: Error A');
        expect(serialized).toContain('Error: Error B');
        expect(serialized).toContain('[Circular Error: Error: Error A]');
      }).not.toThrow();
    });

    it('correctly serializes shared non-circular sub-objects (DAG) without false circular warnings', () => {
      const sharedConfig = { theme: 'studio', scale: 2.0 };
      const compositeObj = {
        primary: sharedConfig,
        secondary: sharedConfig, // shared reference, but not circular
      };

      const serialized = safeSerializeDetails(compositeObj);
      expect(serialized).toBeDefined();
      expect(serialized).toContain('"theme": "studio"');
      expect(serialized).not.toContain('[Circular Reference]');
    });
  });
});
