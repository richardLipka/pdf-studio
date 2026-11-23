import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  isEditCanvasOverlayActive,
  shouldAllowGlobalPageDelete,
  getDefaultToolForTab,
  clampEditPanelWidth,
  getNextSelectionAfterRemoval,
  clampInlineEditorPosition,
  EDIT_PANEL_MIN_WIDTH,
  EDIT_PANEL_MAX_WIDTH,
  EDIT_PANEL_DEFAULT_WIDTH,
} from '../src/utils/editModeState';
import { cs } from '../src/i18n/cs';
import { en } from '../src/i18n/en';
import {
  getPageContentStream,
  parseStreamSegments,
  replaceTextInPageContentStream,
  replaceTextInAllPagesContentStream,
} from '../src/services/contentStreamEditor';

describe('Unified Edit UX State & Safety Guards (Priority 1 + 2)', () => {
  it('disables PDF element overlays whenever Whiteout tool is active or outside Edit tab', () => {
    // Priority 1 bug fix: Whiteout drawing must NEVER be blocked by stream overlays
    expect(isEditCanvasOverlayActive('edit', 'whiteout')).toBe(false);

    // Edit tab non-whiteout tools activate overlays
    expect(isEditCanvasOverlayActive('edit', 'streamReplace')).toBe(true);
    expect(isEditCanvasOverlayActive('edit', 'removeElements')).toBe(true);

    // Review and Sign tabs never render PDF stream overlays
    expect(isEditCanvasOverlayActive('review', 'select')).toBe(false);
    expect(isEditCanvasOverlayActive('review', 'streamReplace')).toBe(false);
    expect(isEditCanvasOverlayActive('sign', 'select')).toBe(false);
    expect(isEditCanvasOverlayActive('sign', 'removeElements')).toBe(false);
  });

  it('blocks global Delete-Page shortcut while in Edit tab to prevent accidental page loss', () => {
    expect(shouldAllowGlobalPageDelete('edit', null, 1)).toBe(false);
    expect(shouldAllowGlobalPageDelete('edit', null, 3)).toBe(false);
    expect(shouldAllowGlobalPageDelete('edit', 'ann-1', 1)).toBe(false);

    // Still works cleanly on Review and Sign tabs when no annotation is selected
    expect(shouldAllowGlobalPageDelete('review', null, 1)).toBe(true);
    expect(shouldAllowGlobalPageDelete('sign', null, 2)).toBe(true);
    expect(shouldAllowGlobalPageDelete('review', 'ann-1', 1)).toBe(false);
    expect(shouldAllowGlobalPageDelete('review', null, 0)).toBe(false);
  });

  it('defaults Edit tab to non-destructive element editing instead of destructive removal', () => {
    expect(getDefaultToolForTab('edit', 'select')).toBe('streamReplace');
    expect(getDefaultToolForTab('edit', 'highlight')).toBe('streamReplace');
    expect(getDefaultToolForTab('edit', 'whiteout')).toBe('whiteout');
    expect(getDefaultToolForTab('edit', 'streamReplace')).toBe('streamReplace');

    // Leaving Edit tab resets edit tools back to select, preserving review tools
    expect(getDefaultToolForTab('review', 'streamReplace')).toBe('select');
    expect(getDefaultToolForTab('review', 'removeElements')).toBe('select');
    expect(getDefaultToolForTab('review', 'whiteout')).toBe('select');
    expect(getDefaultToolForTab('review', 'highlight')).toBe('highlight');
    expect(getDefaultToolForTab('sign', 'whiteout')).toBe('select');
  });

  it('advances selection smoothly to nearest surviving neighbour after removal instead of jumping to index 0', () => {
    const ordered = ['b1', 'b2', 'b3', 'b4'];

    // Delete middle item b2 -> selects next sibling b3
    expect(
      getNextSelectionAfterRemoval(['b1', 'b3', 'b4'], new Set(['b2']), 'b2', ordered)
    ).toBe('b3');

    // Delete last item b4 -> selects previous sibling b3
    expect(
      getNextSelectionAfterRemoval(['b1', 'b2', 'b3'], new Set(['b4']), 'b4', ordered)
    ).toBe('b3');

    // Delete unselected item b1 while b3 is selected -> keeps b3
    expect(
      getNextSelectionAfterRemoval(['b2', 'b3', 'b4'], new Set(['b1']), 'b3', ordered)
    ).toBe('b3');

    // Delete all items -> returns null
    expect(
      getNextSelectionAfterRemoval([], new Set(ordered), 'b2', ordered)
    ).toBeNull();
  });

  it('clamps resizable EditSidePanel width within ergonomic bounds', () => {
    expect(clampEditPanelWidth(120)).toBe(EDIT_PANEL_MIN_WIDTH);
    expect(clampEditPanelWidth(980)).toBe(EDIT_PANEL_MAX_WIDTH);
    expect(clampEditPanelWidth(480)).toBe(480);
    expect(clampEditPanelWidth(Number.NaN)).toBe(EDIT_PANEL_DEFAULT_WIDTH);
  });

  it('clamps inline line editor inside page bounds and flips controls above near bottom edge', () => {
    // Near top-left normal position
    const topPos = clampInlineEditorPosition(
      { x: 40, y: 80, width: 120, height: 14 },
      600,
      800,
      1.0
    );
    expect(topPos.left).toBeGreaterThanOrEqual(4);
    expect(topPos.top).toBeGreaterThanOrEqual(4);
    expect(topPos.placeControlsAbove).toBe(false);

    // Near bottom-right corner -> clamped left and controls flipped above
    const bottomRightPos = clampInlineEditorPosition(
      { x: 520, y: 780, width: 120, height: 14 },
      600,
      800,
      1.0
    );
    expect(bottomRightPos.left + bottomRightPos.width).toBeLessThanOrEqual(600);
    expect(bottomRightPos.placeControlsAbove).toBe(true);
  });

  it('maintains 100% CS/EN localization key and placeholder parity for editPanel', () => {
    const csKeys = Object.keys(cs.editPanel).sort();
    const enKeys = Object.keys(en.editPanel).sort();
    expect(csKeys).toEqual(enKeys);
    expect(csKeys.length).toBeGreaterThan(70);

    const extractPlaceholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
    for (const key of csKeys as (keyof typeof cs.editPanel)[]) {
      const csVal = cs.editPanel[key];
      const enVal = en.editPanel[key];
      expect(csVal.trim().length, `cs.editPanel.${key} empty`).toBeGreaterThan(0);
      expect(enVal.trim().length, `en.editPanel.${key} empty`).toBeGreaterThan(0);
      expect(extractPlaceholders(csVal), `placeholders mismatch on ${key}`).toEqual(
        extractPlaceholders(enVal)
      );
    }
  });

  it('removes blocking window.confirm calls from Edit canvas and inspector panel', () => {
    const textLayerSrc = readFileSync(
      resolve(__dirname, '../src/components/viewer/TextLayer.tsx'),
      'utf8'
    );
    const editPanelSrc = readFileSync(
      resolve(__dirname, '../src/components/layout/EditSidePanel.tsx'),
      'utf8'
    );
    expect(textLayerSrc).not.toContain('window.confirm(');
    expect(editPanelSrc).not.toContain('window.confirm(');
    expect(editPanelSrc).toContain('applyContentStreamReplacement');
  });

  it('supports Find & Replace on current page only (leaving other pages untouched) and across all pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([500, 700]);
    p1.drawText('Contract Draft 2025', { x: 40, y: 600, size: 14, font, color: rgb(0, 0, 0) });
    const p2 = doc.addPage([500, 700]);
    p2.drawText('Appendix draft 2025', { x: 40, y: 600, size: 14, font, color: rgb(0, 0, 0) });

    const bytes = await doc.save();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const origP2 = await getPageContentStream(buf, 1);

    // 1. Replace on Page 1 only (case-sensitive)
    const singlePageRes = await replaceTextInPageContentStream(buf, 0, 'Draft', 'Final', {
      matchCase: true,
    });
    expect(singlePageRes.error).toBeUndefined();
    expect(singlePageRes.occurrencesReplaced).toBe(1);

    const p1Stream = await getPageContentStream(singlePageRes.updatedPdfBytes, 0);
    const p2Stream = await getPageContentStream(singlePageRes.updatedPdfBytes, 1);
    const p1Text = parseStreamSegments(p1Stream.streamText).map((s) => s.previewText).join(' ');
    const p2Text = parseStreamSegments(p2Stream.streamText).map((s) => s.previewText).join(' ');
    expect(p1Text).toContain('Contract Final 2025');
    expect(p2Text).toContain('Appendix draft 2025');
    expect(p2Stream.streamText).toBe(origP2.streamText); // Page 2 untouched

    // 2. Replace across all pages (case-insensitive)
    const allPagesRes = await replaceTextInAllPagesContentStream(buf, 'draft', 'Signed', {
      matchCase: false,
    });
    expect(allPagesRes.error).toBeUndefined();
    expect(allPagesRes.occurrencesReplaced).toBe(2);

    const allP1 = await getPageContentStream(allPagesRes.updatedPdfBytes, 0);
    const allP2 = await getPageContentStream(allPagesRes.updatedPdfBytes, 1);
    const allP1Text = parseStreamSegments(allP1.streamText).map((s) => s.previewText).join(' ');
    const allP2Text = parseStreamSegments(allP2.streamText).map((s) => s.previewText).join(' ');
    expect(allP1Text).toContain('Contract Signed 2025');
    expect(allP2Text).toContain('Appendix Signed 2025');
  });
});
