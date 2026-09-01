export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogCategory = 'load' | 'save' | 'render' | 'system' | 'edit';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  title: string;
  details?: string;
}

type LogListener = (logs: LogEntry[]) => void;

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxLogs = 500;

  public log(level: LogLevel, category: LogCategory, title: string, details?: string | Error | any) {
    let detailsStr: string | undefined;
    if (details instanceof Error) {
      detailsStr = `${details.name}: ${details.message}\n${details.stack || ''}`;
    } else if (typeof details === 'object') {
      try {
        detailsStr = JSON.stringify(details, null, 2);
      } catch {
        detailsStr = String(details);
      }
    } else if (details !== undefined) {
      detailsStr = String(details);
    }

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
    listener([...this.logs]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const snapshot = [...this.logs];
    this.listeners.forEach((l) => l(snapshot));
  }
}

export const logger = new LoggerService();
