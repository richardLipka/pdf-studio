import { describe, it, expect, beforeEach } from 'vitest';
import { logger } from '../src/services/logger';

describe('Logger Service & Diagnostic Logging', () => {
  beforeEach(() => {
    logger.clear();
  });

  it('should capture info, warn, error, and success log entries with categories', () => {
    logger.info('load', 'Test document loading started', { bytes: 1024 });
    logger.warn('save', 'Fallback rendering required for page 1');
    logger.error('render', 'Canvas context error', new Error('Canvas render failed'));
    logger.success('save', 'Document exported successfully', { totalPages: 5 });

    const logs = logger.getLogs();
    expect(logs.length).toBe(4);

    expect(logs[0].level).toBe('success');
    expect(logs[0].category).toBe('save');
    expect(logs[0].title).toBe('Document exported successfully');

    expect(logs[1].level).toBe('error');
    expect(logs[1].category).toBe('render');
    expect(logs[1].details).toContain('Canvas render failed');

    expect(logs[2].level).toBe('warn');
    expect(logs[2].category).toBe('save');

    expect(logs[3].level).toBe('info');
    expect(logs[3].category).toBe('load');
  });

  it('should accurately calculate warning, error, and total issue counts', () => {
    expect(logger.getWarningAndErrorCount()).toEqual({
      warns: 0,
      errors: 0,
      totalIssues: 0,
    });

    logger.info('load', 'Normal info log');
    logger.warn('save', 'Warning 1');
    logger.warn('save', 'Warning 2');
    logger.error('render', 'Error 1');

    expect(logger.getWarningAndErrorCount()).toEqual({
      warns: 2,
      errors: 1,
      totalIssues: 3,
    });
  });

  it('should notify subscribers when new logs are added or cleared', () => {
    let callCount = 0;
    let lastLogsLength = 0;

    const unsubscribe = logger.subscribe((logs) => {
      callCount++;
      lastLogsLength = logs.length;
    });

    // Initial subscription call
    expect(callCount).toBe(1);
    expect(lastLogsLength).toBe(0);

    logger.info('load', 'Testing subscription 1');
    expect(callCount).toBe(2);
    expect(lastLogsLength).toBe(1);

    logger.clear();
    expect(callCount).toBe(3);
    expect(lastLogsLength).toBe(0);

    unsubscribe();

    logger.info('load', 'Testing after unsubscribe');
    expect(callCount).toBe(3);
  });
});
