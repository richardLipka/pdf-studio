import { EditorTab, ToolType } from '../types/annotations';

export type EditSidePanelTab = 'remove' | 'replace' | 'stream';

export interface EditNotice {
  id: number;
  type: 'success' | 'error';
  text: string;
  canUndo?: boolean;
}

export const EDIT_PANEL_MIN_WIDTH = 320;
export const EDIT_PANEL_MAX_WIDTH = 680;
export const EDIT_PANEL_DEFAULT_WIDTH = 416;

const EDIT_TOOLS: ReadonlySet<ToolType> = new Set<ToolType>([
  'streamReplace',
  'removeElements',
  'whiteout',
]);

/**
 * Determines whether interactive PDF element overlays (text blocks & images) should be rendered
 * on the page canvas. Overlays belong strictly to the Edit tab and MUST yield to the Whiteout
 * tool so users can draw visual rewrite boxes without pointer interception.
 */
export function isEditCanvasOverlayActive(
  activeTab: EditorTab,
  activeTool: ToolType
): boolean {
  return activeTab === 'edit' && activeTool !== 'whiteout';
}

/**
 * Global Delete / Backspace page-deletion shortcut guard.
 * Never allows deleting an entire PDF page while working inside the Edit tab, where pressing
 * Delete is expected to delete a selected text block or image (never the whole page).
 */
export function shouldAllowGlobalPageDelete(
  activeTab: EditorTab,
  selectedAnnotationId: string | null,
  selectedPageIdsLength: number
): boolean {
  return activeTab !== 'edit' && !selectedAnnotationId && selectedPageIdsLength > 0;
}

/**
 * Resolves the safe active tool when switching top-level workspace tabs.
 * Entering Edit mode defaults to non-destructive element inspection/editing (`streamReplace`)
 * instead of a destructive removal mode; leaving Edit mode restores `select`.
 */
export function getDefaultToolForTab(tab: EditorTab, currentTool: ToolType): ToolType {
  if (tab === 'edit') {
    return EDIT_TOOLS.has(currentTool) ? currentTool : 'streamReplace';
  }
  return EDIT_TOOLS.has(currentTool) ? 'select' : currentTool;
}

/**
 * Clamps the resizable EditSidePanel width to ergonomic bounds.
 */
export function clampEditPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return EDIT_PANEL_DEFAULT_WIDTH;
  return Math.max(EDIT_PANEL_MIN_WIDTH, Math.min(EDIT_PANEL_MAX_WIDTH, Math.round(width)));
}

/**
 * Computes the next selected element id after one or more elements are deleted, keeping the
 * user's focus on the closest surviving neighbour rather than jumping to the top of the page.
 */
export function getNextSelectionAfterRemoval(
  remainingIds: string[],
  removedIds: ReadonlySet<string>,
  previousSelectedId: string | null,
  previousOrderedIds: string[]
): string | null {
  if (remainingIds.length === 0) return null;
  const remainingSet = new Set(remainingIds);
  if (previousSelectedId && remainingSet.has(previousSelectedId) && !removedIds.has(previousSelectedId)) {
    return previousSelectedId;
  }
  if (!previousSelectedId) return null;

  const oldIdx = previousOrderedIds.indexOf(previousSelectedId);
  if (oldIdx === -1) return null;

  for (let i = oldIdx + 1; i < previousOrderedIds.length; i++) {
    const candidate = previousOrderedIds[i];
    if (remainingSet.has(candidate) && !removedIds.has(candidate)) {
      return candidate;
    }
  }
  for (let i = oldIdx - 1; i >= 0; i--) {
    const candidate = previousOrderedIds[i];
    if (remainingSet.has(candidate) && !removedIds.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Clamps inline text line editor coordinates inside the rendered page viewport so neither the
 * text input nor its action buttons clip outside the page edges.
 */
export function clampInlineEditorPosition(
  box: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  scale: number
): { left: number; top: number; width: number; height: number; placeControlsAbove: boolean } {
  const maxPageW = Math.max(200, pageWidth * scale);
  const maxPageH = Math.max(120, pageHeight * scale);
  const editorWidth = Math.min(
    Math.max(box.width * scale + 64, 180),
    Math.max(180, maxPageW - 12)
  );
  const editorHeight = Math.max(box.height * scale + 8, 26);

  const rawLeft = box.x * scale - 4;
  const rawTop = box.y * scale - 4;

  const left = Math.max(4, Math.min(rawLeft, maxPageW - editorWidth - 4));
  const top = Math.max(4, Math.min(rawTop, maxPageH - editorHeight - 4));
  const placeControlsAbove = top + editorHeight + 36 > maxPageH && top > 36;

  return { left, top, width: editorWidth, height: editorHeight, placeControlsAbove };
}
