import { describe, it, expect, vi } from 'vitest';
import { logger, safeSerializeDetails } from '../src/services/logger';

describe('Logger Service Robustness & Safe Serialization', () => {
  it('should safely serialize huge ArrayBuffers and Uint8Arrays without expanding into millions of entries', () => {
    // 5 MB binary array
    const largeBuffer = new Uint8Array(5 * 1024 * 1024);
    const serialized = safeSerializeDetails({
      filename: 'document.pdf',
      data: largeBuffer,
      rawBuffer: largeBuffer.buffer,
    });

    expect(serialized).toBeDefined();
    // It should be a short, concise description, not megabytes of numbers!
    expect(serialized!.length).toBeLessThan(1000);
    expect(serialized).toContain('[Uint8Array: 5242880 B (5120.0 KB)]');
    expect(serialized).toContain('[ArrayBuffer: 5242880 B (5120.0 KB)]');
  });

  it('should safely serialize circular object references without throwing or turning into [object Object]', () => {
    const circularObj: any = { name: 'Parent', child: {} };
    circularObj.child.parent = circularObj;

    const serialized = safeSerializeDetails(circularObj);
    expect(serialized).toBeDefined();
    expect(serialized).toContain('Parent');
    expect(serialized).toContain('[Circular Reference]');
  });

  it('should serialize BigInt and nested Errors with cause', () => {
    const rootError = new Error('Root network failure');
    const wrapError = new Error('Document export failed', { cause: rootError });

    const serializedErr = safeSerializeDetails(wrapError);
    expect(serializedErr).toContain('Document export failed');
    expect(serializedErr).toContain('Caused by: Error: Root network failure');

    const serializedBigInt = safeSerializeDetails({ b: BigInt(9007199254740991) });
    expect(serializedBigInt).toContain('9007199254740991n');
  });

  it('should deliver notifications to subscribers safely on every log message', () => {
    logger.clear();
    const listener = vi.fn();
    const unsubscribe = logger.subscribe(listener);

    // Initial subscribe call
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();

    // Fire 5 logs in sequence
    for (let i = 0; i < 5; i++) {
      logger.info('system', `Log message ${i}`);
    }

    expect(listener).toHaveBeenCalledTimes(5);
    expect(logger.getLogs().length).toBe(5);

    unsubscribe();
  });

  it('should protect against listener exceptions without crashing calling code', () => {
    const faultyListener = () => {
      throw new Error('Exploding UI component');
    };
    const unsubscribe = logger.subscribe(faultyListener);

    // Should NOT throw
    expect(() => {
      logger.error('system', 'Test error with faulty listener');
    }).not.toThrow();

    unsubscribe();
  });

  it('should export logs as JSON and formatted plain text', () => {
    logger.clear();
    logger.info('load', 'Test document load', { pages: 5 });
    logger.warn('save', 'Fallback triggered', 'Low memory');

    const jsonExport = logger.exportAsJson();
    expect(jsonExport).toContain('Test document load');
    expect(JSON.parse(jsonExport)).toHaveLength(2);

    const textExport = logger.exportAsText();
    expect(textExport).toContain('[LOAD]');
    expect(textExport).toContain('[SAVE]');
    expect(textExport).toContain('Fallback triggered');
  });
});
