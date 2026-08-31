import { describe, it, expect } from 'vitest';

describe('Undo/Redo History & Multi-Selection Engine', () => {
  // Test helper replicating the DocumentContext immutable history management
  interface HistorySnapshot {
    pages: string[];
    selectedPageIds: string[];
  }

  class HistoryManager {
    past: HistorySnapshot[] = [];
    present: HistorySnapshot;
    future: HistorySnapshot[] = [];
    readonly maxHistory = 100;

    constructor(initialState: HistorySnapshot) {
      this.present = initialState;
    }

    push(newSnapshot: HistorySnapshot) {
      this.past = [...this.past.slice(-this.maxHistory + 1), this.present];
      this.present = newSnapshot;
      this.future = [];
    }

    undo() {
      if (this.past.length === 0) return;
      const previous = this.past[this.past.length - 1];
      const newPast = this.past.slice(0, this.past.length - 1);
      this.future = [this.present, ...this.future];
      this.present = previous;
      this.past = newPast;
    }

    redo() {
      if (this.future.length === 0) return;
      const next = this.future[0];
      const newFuture = this.future.slice(1);
      this.past = [...this.past, this.present];
      this.present = next;
      this.future = newFuture;
    }
  }

  it('should support multi-step undo and redo with immutable snapshots', () => {
    const history = new HistoryManager({ pages: ['p1'], selectedPageIds: ['p1'] });

    // Step 1: Add page 2
    history.push({ pages: ['p1', 'p2'], selectedPageIds: ['p2'] });
    expect(history.present.pages).toEqual(['p1', 'p2']);

    // Step 2: Add page 3
    history.push({ pages: ['p1', 'p2', 'p3'], selectedPageIds: ['p3'] });
    expect(history.present.pages).toEqual(['p1', 'p2', 'p3']);

    // Undo to Step 1
    history.undo();
    expect(history.present.pages).toEqual(['p1', 'p2']);
    expect(history.future.length).toBe(1);

    // Undo to initial
    history.undo();
    expect(history.present.pages).toEqual(['p1']);

    // Redo to Step 1
    history.redo();
    expect(history.present.pages).toEqual(['p1', 'p2']);

    // Redo to Step 2
    history.redo();
    expect(history.present.pages).toEqual(['p1', 'p2', 'p3']);
  });

  it('should truncate past history when exceeding maximum limit of 100 snapshots', () => {
    const history = new HistoryManager({ pages: ['p0'], selectedPageIds: ['p0'] });
    for (let i = 1; i <= 150; i++) {
      history.push({ pages: [`p${i}`], selectedPageIds: [`p${i}`] });
    }

    expect(history.past.length).toBeLessThanOrEqual(100);
    expect(history.present.pages).toEqual(['p150']);
  });

  it('should compute correct multi-selection for Shift+Click range', () => {
    const allPageIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    
    // Select range from p2 (index 1) to p4 (index 3)
    const startIndex = 1;
    const targetIndex = 3;
    const minIdx = Math.min(startIndex, targetIndex);
    const maxIdx = Math.max(startIndex, targetIndex);

    const selectedRange = allPageIds.slice(minIdx, maxIdx + 1);
    expect(selectedRange).toEqual(['p2', 'p3', 'p4']);
  });

  it('should compute correct multi-selection for Ctrl+Click toggle', () => {
    let selected = ['p1', 'p2'];
    const togglePage = (id: string) => {
      if (selected.includes(id)) {
        selected = selected.filter((p) => p !== id);
      } else {
        selected = [...selected, id];
      }
    };

    // Toggle p3 (add)
    togglePage('p3');
    expect(selected).toEqual(['p1', 'p2', 'p3']);

    // Toggle p2 (remove)
    togglePage('p2');
    expect(selected).toEqual(['p1', 'p3']);
  });
});
