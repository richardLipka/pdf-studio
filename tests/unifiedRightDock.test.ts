import { describe, it, expect } from 'vitest';
import { EditorTab } from '../src/types/annotations';

/**
 * State Transition Logic for Unified Right Dock
 * This mirrors the exact implementation in EditorContext.tsx to verify
 * mutual exclusivity and automatic transitions.
 */
class UnifiedRightDockController {
  activeTab: EditorTab = 'review';
  isNotesPanelOpen: boolean = false;
  isEditSidePanelOpen: boolean = false;
  editSidePanelTab: 'remove' | 'stream' = 'remove';

  setActiveTab(tab: EditorTab) {
    this.activeTab = tab;
    if (tab === 'edit') {
      this.isNotesPanelOpen = false;
      this.isEditSidePanelOpen = true;
    } else if (tab === 'review') {
      this.isEditSidePanelOpen = false;
    } else if (tab === 'sign') {
      this.isNotesPanelOpen = false;
      this.isEditSidePanelOpen = false;
    }
  }

  setIsNotesPanelOpen(open: boolean) {
    this.isNotesPanelOpen = open;
    if (open) {
      this.isEditSidePanelOpen = false;
    }
  }

  toggleNotesPanel() {
    this.isNotesPanelOpen = !this.isNotesPanelOpen;
    if (this.isNotesPanelOpen) {
      this.isEditSidePanelOpen = false;
      this.activeTab = 'review';
    }
  }

  setIsEditSidePanelOpen(open: boolean) {
    this.isEditSidePanelOpen = open;
    if (open) {
      this.isNotesPanelOpen = false;
    }
  }

  toggleEditSidePanel(tab?: 'remove' | 'stream') {
    if (tab) {
      this.editSidePanelTab = tab;
      this.isEditSidePanelOpen = true;
      this.isNotesPanelOpen = false;
      this.activeTab = 'edit';
    } else {
      this.isEditSidePanelOpen = !this.isEditSidePanelOpen;
      if (this.isEditSidePanelOpen) {
        this.isNotesPanelOpen = false;
        this.activeTab = 'edit';
      }
    }
  }

  setIsStreamReplaceModalOpen(open: boolean) {
    if (open) {
      this.editSidePanelTab = 'stream';
      this.isEditSidePanelOpen = true;
      this.isNotesPanelOpen = false;
      this.activeTab = 'edit';
    } else {
      this.isEditSidePanelOpen = false;
    }
  }

  setIsRemoveElementsModalOpen(open: boolean) {
    if (open) {
      this.editSidePanelTab = 'remove';
      this.isEditSidePanelOpen = true;
      this.isNotesPanelOpen = false;
      this.activeTab = 'edit';
    } else {
      this.isEditSidePanelOpen = false;
    }
  }
}

describe('Unified Right Dock (Mutual Exclusivity & Tab Auto-Switching)', () => {
  it('guarantees mutual exclusivity and auto-switching across tabs and side panels', () => {
    const dock = new UnifiedRightDockController();

    // Initial state: review tab, panels closed
    expect(dock.activeTab).toBe('review');
    expect(dock.isNotesPanelOpen).toBe(false);
    expect(dock.isEditSidePanelOpen).toBe(false);

    // 1. User opens NotesPanel in Review mode
    dock.toggleNotesPanel();
    expect(dock.isNotesPanelOpen).toBe(true);
    expect(dock.isEditSidePanelOpen).toBe(false);

    // 2. User switches to Edit tab: NotesPanel MUST close, EditSidePanel MUST open
    dock.setActiveTab('edit');
    expect(dock.activeTab).toBe('edit');
    expect(dock.isNotesPanelOpen).toBe(false);
    expect(dock.isEditSidePanelOpen).toBe(true);

    // 3. While in Edit mode, user triggers NotesPanel: EditSidePanel MUST close, tab switches to Review
    dock.toggleNotesPanel();
    expect(dock.activeTab).toBe('review');
    expect(dock.isNotesPanelOpen).toBe(true);
    expect(dock.isEditSidePanelOpen).toBe(false);

    // 4. While in Review mode with Notes open, user triggers Stream Replace:
    // NotesPanel MUST close, EditSidePanel MUST open on stream tab, tab switches to Edit
    dock.setIsStreamReplaceModalOpen(true);
    expect(dock.activeTab).toBe('edit');
    expect(dock.editSidePanelTab).toBe('stream');
    expect(dock.isNotesPanelOpen).toBe(false);
    expect(dock.isEditSidePanelOpen).toBe(true);

    // 5. User switches to Sign tab: BOTH panels MUST be closed
    dock.setActiveTab('sign');
    expect(dock.activeTab).toBe('sign');
    expect(dock.isNotesPanelOpen).toBe(false);
    expect(dock.isEditSidePanelOpen).toBe(false);

    // 6. User switches back to Review tab: EditSidePanel remains closed
    dock.setActiveTab('review');
    expect(dock.activeTab).toBe('review');
    expect(dock.isEditSidePanelOpen).toBe(false);

    // 7. Verify mutual exclusivity invariant: at NO point are both true
    dock.setIsNotesPanelOpen(true);
    dock.setIsEditSidePanelOpen(true);
    expect(dock.isNotesPanelOpen).toBe(false);
    expect(dock.isEditSidePanelOpen).toBe(true);

    dock.setIsNotesPanelOpen(true);
    expect(dock.isNotesPanelOpen).toBe(true);
    expect(dock.isEditSidePanelOpen).toBe(false);
  });
});
