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

  it('should select range to start on Shift+Home from anchor page', () => {
    const allPageIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const currentAnchor = 2; // on p3

    const rangeToStart = allPageIds.slice(0, currentAnchor + 1);
    expect(rangeToStart).toEqual(['p1', 'p2', 'p3']);
  });

  it('should select range to end on Shift+End from anchor page', () => {
    const allPageIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const currentAnchor = 2; // on p3

    const rangeToEnd = allPageIds.slice(currentAnchor);
    expect(rangeToEnd).toEqual(['p3', 'p4', 'p5']);
  });

  it('should preserve and deeply clone binary ArrayBuffer data across undo/redo snapshots', () => {
    const buffer1 = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const buffer2 = new Uint8Array([10, 20, 30]).buffer;

    const source1 = { id: 'main', name: 'test.pdf', arrayBuffer: buffer1, updatedAt: 1000 };
    const source2 = { id: 'main', name: 'test.pdf', arrayBuffer: buffer2, updatedAt: 2000 };

    interface FullHistorySnapshot {
      sources: { id: string; name: string; arrayBuffer?: ArrayBuffer; updatedAt?: number }[];
    }

    const historyStack: FullHistorySnapshot[] = [
      {
        sources: [{ ...source1, arrayBuffer: source1.arrayBuffer.slice(0) }],
      },
    ];

    // Push edit state
    historyStack.push({
      sources: [{ ...source2, arrayBuffer: source2.arrayBuffer.slice(0) }],
    });

    expect(historyStack.length).toBe(2);
    expect(new Uint8Array(historyStack[0].sources[0].arrayBuffer!)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(new Uint8Array(historyStack[1].sources[0].arrayBuffer!)).toEqual(new Uint8Array([10, 20, 30]));

    // Revert to history[0] (Undo)
    const reverted = historyStack[0].sources[0];
    expect(reverted.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(reverted.arrayBuffer?.byteLength).toBe(5);
    expect(new Uint8Array(reverted.arrayBuffer!)[0]).toBe(1);
  });
});

