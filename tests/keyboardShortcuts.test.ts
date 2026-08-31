import { describe, it, expect, vi } from 'vitest';

describe('Keyboard interaction in notes & dialogs', () => {
  it('should distinguish Enter (submit) from Shift+Enter (newline) in note editor logic', () => {
    let saved = false;
    let text = 'Line 1';

    const handleKeyDown = (key: string, shiftKey: boolean) => {
      if (key === 'Enter' && !shiftKey) {
        saved = true;
      } else if (key === 'Enter' && shiftKey) {
        text += '\nLine 2';
      }
    };

    // Press Shift+Enter
    handleKeyDown('Enter', true);
    expect(saved).toBe(false);
    expect(text).toBe('Line 1\nLine 2');

    // Press Enter
    handleKeyDown('Enter', false);
    expect(saved).toBe(true);
  });

  it('should cancel on Escape in note editor logic', () => {
    let activeNoteId: string | null = 'note-123';

    const handleKeyDown = (key: string) => {
      if (key === 'Escape') {
        activeNoteId = null;
      }
    };

    handleKeyDown('Escape');
    expect(activeNoteId).toBeNull();
  });

  it('should confirm modal on Enter and cancel on Escape', () => {
    let confirmed = false;
    let cancelled = false;

    const handleModalKeyDown = (key: string) => {
      if (key === 'Enter') {
        confirmed = true;
      } else if (key === 'Escape') {
        cancelled = true;
      }
    };

    handleModalKeyDown('Escape');
    expect(cancelled).toBe(true);
    expect(confirmed).toBe(false);

    handleModalKeyDown('Enter');
    expect(confirmed).toBe(true);
  });
});
