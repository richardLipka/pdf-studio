/**
 * Prioritized Lazy Rendering Queue for PDF Pages and Thumbnails.
 * Prevents CPU/GPU and WebWorker saturation on large PDF files (> 5 pages).
 */

export enum RenderPriority {
  /** Visible in the current viewport or within prefetch margin */
  VIEWPORT = 1,
  /** Initial batch of pages (pages 0..4 on initial load) */
  INITIAL_BATCH = 2,
  /** Background sequential rendering for offscreen pages */
  BACKGROUND = 3,
  /** Low-priority sidebar thumbnails */
  THUMBNAIL = 4,
}

interface QueueItem {
  id: string;
  priority: RenderPriority;
  timestamp: number;
  execute: () => Promise<void>;
  resolve: () => void;
  reject: (err: any) => void;
  isCancelled: boolean;
}

class PdfRenderQueue {
  private queue: QueueItem[] = [];
  private activeCount: number = 0;
  private maxConcurrent: number = 1; // 1 concurrent task ensures zero contention on PDF.js worker/canvas

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Enqueue a render task with a specific priority.
   * If an item with the same ID is already pending, its priority is elevated if higher.
   */
  public enqueue(
    id: string,
    priority: RenderPriority,
    execute: () => Promise<void>
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // If task already exists in waiting queue, elevate its priority if needed
      const existing = this.queue.find((item) => item.id === id && !item.isCancelled);
      if (existing) {
        if (priority < existing.priority) {
          existing.priority = priority;
          this.sortQueue();
        }
        // Chain promises
        const originalResolve = existing.resolve;
        const originalReject = existing.reject;
        existing.resolve = () => {
          originalResolve();
          resolve();
        };
        existing.reject = (err) => {
          originalReject(err);
          reject(err);
        };
        return;
      }

      const item: QueueItem = {
        id,
        priority,
        timestamp: Date.now(),
        execute,
        resolve,
        reject,
        isCancelled: false,
      };

      this.queue.push(item);
      this.sortQueue();
      this.processNext();
    });
  }

  /**
   * Elevate the priority of an already enqueued task (e.g. when user scrolls into view).
   */
  public elevatePriority(id: string, newPriority: RenderPriority): boolean {
    const item = this.queue.find((q) => q.id === id && !q.isCancelled);
    if (item && newPriority < item.priority) {
      item.priority = newPriority;
      this.sortQueue();
      this.processNext();
      return true;
    }
    return false;
  }

  /**
   * Cancel a pending task by ID (e.g. on component unmount).
   */
  public cancel(id: string): void {
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      item.isCancelled = true;
      this.queue = this.queue.filter((q) => q.id !== id);
      try {
        item.resolve(); // Cleanly unblock awaiting callers
      } catch {
        // ignore
      }
    }
  }

  /**
   * Clear all pending tasks (e.g. on document switch).
   */
  public clear(): void {
    for (const item of this.queue) {
      item.isCancelled = true;
      try {
        item.resolve(); // Cleanly unblock awaiting callers
      } catch {
        // ignore
      }
    }
    this.queue = [];
  }

  /**
   * Returns current pending queue length.
   */
  public getPendingCount(): number {
    return this.queue.filter((item) => !item.isCancelled).length;
  }

  /**
   * Returns whether a task with the given ID is pending in the queue.
   */
  public isPending(id: string): boolean {
    return this.queue.some((item) => item.id === id && !item.isCancelled);
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower number = higher priority
      }
      return a.timestamp - b.timestamp; // FIFO for same priority
    });
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) {
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) {
      return;
    }

    if (nextItem.isCancelled) {
      this.processNext();
      return;
    }

    this.activeCount++;

    nextItem
      .execute()
      .then(() => {
        if (!nextItem.isCancelled) {
          nextItem.resolve();
        }
      })
      .catch((err) => {
        if (!nextItem.isCancelled) {
          nextItem.reject(err);
        }
      })
      .finally(() => {
        this.activeCount--;
        // Yield control to microtask/browser frame before processing next item
        if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
          window.requestAnimationFrame(() => this.processNext());
        } else {
          setTimeout(() => this.processNext(), 0);
        }
      });
  }
}

// Global shared instance of render queue
export const renderQueue = new PdfRenderQueue(1);
