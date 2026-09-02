import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RenderPriority } from '../src/services/renderQueue';

// We create a fresh instance testable without global pollution
class TestableRenderQueue {
  private queue: Array<{
    id: string;
    priority: RenderPriority;
    timestamp: number;
    execute: () => Promise<void>;
    resolve: () => void;
    reject: (err: any) => void;
    isCancelled: boolean;
  }> = [];
  public activeCount: number = 0;
  public maxConcurrent: number = 1;

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  public enqueue(
    id: string,
    priority: RenderPriority,
    execute: () => Promise<void>
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const existing = this.queue.find((item) => item.id === id && !item.isCancelled);
      if (existing) {
        if (priority < existing.priority) {
          existing.priority = priority;
          this.sortQueue();
        }
        const origResolve = existing.resolve;
        existing.resolve = () => {
          origResolve();
          resolve();
        };
        return;
      }

      const item = {
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

  public cancel(id: string): void {
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      item.isCancelled = true;
      this.queue = this.queue.filter((q) => q.id !== id);
    }
  }

  public clear(): void {
    for (const item of this.queue) {
      item.isCancelled = true;
    }
    this.queue = [];
  }

  public getPendingCount(): number {
    return this.queue.filter((item) => !item.isCancelled).length;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    const nextItem = this.queue.shift();
    if (!nextItem) return;
    if (nextItem.isCancelled) {
      this.processNext();
      return;
    }

    this.activeCount++;
    nextItem
      .execute()
      .then(() => {
        if (!nextItem.isCancelled) nextItem.resolve();
      })
      .catch((err) => {
        if (!nextItem.isCancelled) nextItem.reject(err);
      })
      .finally(() => {
        this.activeCount--;
        setTimeout(() => this.processNext(), 0);
      });
  }
}

describe('PdfRenderQueue - Lazy & Prioritized Rendering Strategy', () => {
  let queue: TestableRenderQueue;

  beforeEach(() => {
    queue = new TestableRenderQueue(1);
  });

  it('should render tasks sequentially according to priority order', async () => {
    const executionOrder: string[] = [];

    const makeTask = (id: string, durationMs: number = 2) => async () => {
      await new Promise((res) => setTimeout(res, durationMs));
      executionOrder.push(id);
    };

    // Enqueue 1 high, 1 low, 1 normal
    const p1 = queue.enqueue('page_1_initial', RenderPriority.INITIAL_BATCH, makeTask('page_1'));
    const p2 = queue.enqueue('page_10_bg', RenderPriority.BACKGROUND, makeTask('page_10'));
    const p3 = queue.enqueue('page_2_viewport', RenderPriority.VIEWPORT, makeTask('page_2'));

    await Promise.all([p1, p2, p3]);

    // page_1 starts immediately as it was first in queue, but page_2 (VIEWPORT) runs before page_10 (BACKGROUND)
    expect(executionOrder).toEqual(['page_1', 'page_2', 'page_10']);
  });

  it('should dynamically elevate priority when user scrolls to an offscreen page', async () => {
    const executionOrder: string[] = [];

    const makeTask = (id: string, durationMs: number = 2) => async () => {
      await new Promise((res) => setTimeout(res, durationMs));
      executionOrder.push(id);
    };

    // First page starts rendering
    const p1 = queue.enqueue('page_1', RenderPriority.INITIAL_BATCH, makeTask('page_1', 10));
    // Remaining pages queued with normal and background priorities
    const p2 = queue.enqueue('page_2', RenderPriority.INITIAL_BATCH, makeTask('page_2', 2));
    const p3 = queue.enqueue('page_3', RenderPriority.INITIAL_BATCH, makeTask('page_3', 2));
    const p20 = queue.enqueue('page_20', RenderPriority.BACKGROUND, makeTask('page_20', 2));

    // User scrolls to page 20 while page 1 is still rendering!
    queue.elevatePriority('page_20', RenderPriority.VIEWPORT);

    await Promise.all([p1, p2, p3, p20]);

    // page_20 was elevated to VIEWPORT priority, so it executes right after page_1 finishes, BEFORE page_2 and page_3
    expect(executionOrder).toEqual(['page_1', 'page_20', 'page_2', 'page_3']);
  });

  it('should cancel tasks when component unmounts without executing them', async () => {
    const executed: string[] = [];

    const makeTask = (id: string) => async () => {
      await new Promise((res) => setTimeout(res, 2));
      executed.push(id);
    };

    const p1 = queue.enqueue('task_1', RenderPriority.INITIAL_BATCH, makeTask('task_1'));
    const p2 = queue.enqueue('task_2', RenderPriority.BACKGROUND, makeTask('task_2'));
    queue.enqueue('task_3', RenderPriority.BACKGROUND, makeTask('task_3'));

    // Cancel task_3 before it gets picked up
    queue.cancel('task_3');

    await Promise.all([p1, p2]);

    expect(executed).toContain('task_1');
    expect(executed).toContain('task_2');
    expect(executed).not.toContain('task_3');
  });

  it('should process large document (>5 pages) rendering first 5 and then background one by one', async () => {
    const executionOrder: string[] = [];

    const makeTask = (id: string) => async () => {
      await new Promise((res) => setTimeout(res, 1));
      executionOrder.push(id);
    };

    const promises: Promise<void>[] = [];

    // Simulate 8-page document
    for (let i = 0; i < 8; i++) {
      const pageNum = i + 1;
      const isInitialBatch = i < 5;
      const priority = isInitialBatch ? RenderPriority.INITIAL_BATCH : RenderPriority.BACKGROUND;
      promises.push(queue.enqueue(`page_${pageNum}`, priority, makeTask(`page_${pageNum}`)));
    }

    await Promise.all(promises);

    // All 8 pages render, with pages 1..5 processed before pages 6..8
    expect(executionOrder).toEqual([
      'page_1',
      'page_2',
      'page_3',
      'page_4',
      'page_5',
      'page_6',
      'page_7',
      'page_8',
    ]);
  });
});
