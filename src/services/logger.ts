export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogCategory = 'load' | 'save' | 'render' | 'system' | 'edit' | 'crypto';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  title: string;
  details?: string;
}

type LogListener = (logs: LogEntry[]) => void;

/**
 * Safely serializes arbitrary details (including circular structures, BigInt,
 * and massive typed arrays/buffers) without throwing or causing memory bloat.
 */
export function safeSerializeDetails(details: any): string | undefined {
  if (details === undefined || details === null) {
    return details === null ? 'null' : undefined;
  }

  if (details instanceof Error) {
    let result = `${details.name}: ${details.message}`;
    if (details.stack) {
      result += `\n${details.stack}`;
    }
    if ((details as any).cause) {
      result += `\nCaused by: ${safeSerializeDetails((details as any).cause)}`;
    }
    return result;
  }

  if (typeof details === 'string') {
    return details;
  }

  if (typeof details === 'number' || typeof details === 'boolean') {
    return String(details);
  }

  if (typeof details === 'bigint') {
    return `${details.toString()}n`;
  }

  if (details instanceof ArrayBuffer) {
    return `[ArrayBuffer: ${details.byteLength} B (${(details.byteLength / 1024).toFixed(1)} KB)]`;
  }

  if (ArrayBuffer.isView(details)) {
    return `[${details.constructor.name}: ${details.byteLength} B (${(details.byteLength / 1024).toFixed(1)} KB)]`;
  }

  // Handle circular references and serialize objects safely
  const seen = new WeakSet();

  try {
    const stringified = JSON.stringify(
      details,
      (_key, value) => {
        if (value === null) return null;
        if (typeof value === 'bigint') return `${value.toString()}n`;
        if (value instanceof ArrayBuffer) {
          return `[ArrayBuffer: ${value.byteLength} B (${(value.byteLength / 1024).toFixed(1)} KB)]`;
        }
        if (ArrayBuffer.isView(value)) {
          return `[${value.constructor.name}: ${value.byteLength} B (${(value.byteLength / 1024).toFixed(1)} KB)]`;
        }
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        if (typeof value === 'object') {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        // Truncate gigantic strings in individual properties to prevent OOM
        if (typeof value === 'string' && value.length > 4096) {
          return `${value.substring(0, 4096)}... [truncated ${value.length - 4096} chars]`;
        }
        return value;
      },
      2
    );
    return stringified;
  } catch {
    // If JSON.stringify fails, extract safe key values
    try {
      const keys = Object.keys(details);
      const safeSummary: Record<string, any> = {};
      for (const k of keys.slice(0, 25)) {
        const val = (details as any)[k];
        if (typeof val === 'function') continue;
        safeSummary[k] = typeof val === 'object' ? '[Object]' : String(val);
      }
      return JSON.stringify(safeSummary, null, 2);
    } catch {
      return String(details);
    }
  }
}

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxLogs = 500;

  public log(level: LogLevel, category: LogCategory, title: string, details?: string | Error | any) {
    const detailsStr = safeSerializeDetails(details);

    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
      level,
      category,
      title,
      details: detailsStr,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.notify();

    // Also forward to console for developer inspectability
    const prefix = `[PDF Studio][${category.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, title, details || '');
    } else if (level === 'warn') {
      console.warn(prefix, title, details || '');
    } else if (level === 'info') {
      console.info(prefix, title, details || '');
    }
  }

  public info(category: LogCategory, title: string, details?: any) {
    this.log('info', category, title, details);
  }

  public warn(category: LogCategory, title: string, details?: any) {
    this.log('warn', category, title, details);
  }

  public error(category: LogCategory, title: string, details?: any) {
    this.log('error', category, title, details);
  }

  public success(category: LogCategory, title: string, details?: any) {
    this.log('success', category, title, details);
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public getWarningAndErrorCount(): { warns: number; errors: number; totalIssues: number } {
    const warns = this.logs.filter((l) => l.level === 'warn').length;
    const errors = this.logs.filter((l) => l.level === 'error').length;
    return { warns, errors, totalIssues: warns + errors };
  }

  public clear() {
    this.logs = [];
    this.notify();
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    try {
      listener([...this.logs]);
    } catch (err) {
      console.error('[PDF Studio][LOGGER] Error initializing log listener:', err);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify() {
    const snapshot = [...this.logs];
    this.listeners.forEach((l) => {
      try {
        l(snapshot);
      } catch (err) {
        console.error('[PDF Studio][LOGGER] Error executing log listener:', err);
      }
    });
  }

  /**
   * Export all recorded logs as a formatted JSON string
   */
  public exportAsJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Export all recorded logs as human-readable plain text
   */
  public exportAsText(): string {
    return this.logs
      .map((entry) => {
        const time = entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp);
        const level = entry.level.toUpperCase().padEnd(7);
        const cat = `[${entry.category.toUpperCase()}]`.padEnd(10);
        let out = `${time} ${level} ${cat} ${entry.title}`;
        if (entry.details) {
          out += `\n  Details: ${entry.details.replace(/\n/g, '\n  ')}`;
        }
        return out;
      })
      .join('\n\n');
  }
}

export const logger = new LoggerService();
