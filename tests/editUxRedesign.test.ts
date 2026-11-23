import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, PDFName, rgb, StandardFonts } from 'pdf-lib';
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
import { getPageTextModel } from '../src/services/pdfLoader';
import {
  replaceTextBlockContent,
  replaceTextLineContent,
  removeTextLineContent,
} from '../src/services/pdfTextEditor';
import { PdfPageModel, SourceDocument } from '../src/types/document';

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

describe('Multi-Line PDF Elements (Voucher Columns, Custom Gaps, Mixed Fonts & Single-Line Delete)', () => {
  const buildVoucherPdf = async (streamBody: string) => {
    const doc = await PDFDocument.create();
    const courier = await doc.embedFont(StandardFonts.Courier);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([600, 800]);
    // Ensure page has /Resources /Font dictionary
    page.drawText(' ', { x: 1, y: 1, size: 1, font: helv });
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as any;
    fonts.set(PDFName.of('FC'), courier.ref);
    fonts.set(PDFName.of('FH'), helv.ref);
    fonts.set(PDFName.of('FB'), helvBold.ref);

    const stream = doc.context.register(doc.context.flateStream(streamBody));
    page.node.set(PDFName.of('Contents'), stream);

    const saved = await doc.save();
    const buf = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
    const source: SourceDocument = {
      id: `voucher_${Math.random().toString(36).slice(2, 8)}`,
      name: 'voucher.pdf',
      arrayBuffer: buf,
      updatedAt: Date.now(),
    };
    const pageModel: PdfPageModel = {
      id: 'p_voucher_0',
      sourceDocId: source.id,
      sourceType: 'pdf',
      originalPageIndex: 0,
      rotation: 0,
      width: 600,
      height: 800,
    };
    return { source, pageModel };
  };

  const VOUCHER_STREAM = [
    'BT',
    '/FC 11 Tf',
    '1 0 0 1 180 680 Tm (Lago Hotel) Tj',
    '0 -14 Td (Side - Sorgun) Tj',
    '0 -56 Td (41131187) Tj',
    '0 -70 Td (1 FRAU 40J. NATALIE SLADKOVA) Tj',
    '0 -14 Td (2 HERR 44J. PETR SLADEK) Tj',
    '-130 -286 Td (Akay Travel Service) Tj',
    'ET',
  ].join('\n');

  it('preserves exact coordinates, custom gaps, and column shifts when editing a multi-line BT...ET via Full Block edit', async () => {
    const { source, pageModel } = await buildVoucherPdf(VOUCHER_STREAM);
    const before = (await getPageTextModel(source, pageModel))!;
    expect(before.aligned).toBe(true);
    expect(before.blocks).toHaveLength(1);
    const block = before.blocks[0];
    expect(block.lines.map((l) => l.text)).toEqual([
      'Lago Hotel',
      'Side - Sorgun',
      '41131187',
      '1 FRAU 40J. NATALIE SLADKOVA',
      '2 HERR 44J. PETR SLADEK',
      'Akay Travel Service',
    ]);

    // Edit ONLY line 3 in the full-block multi-line text
    const editedFullText = block.lines
      .map((l, idx) => (idx === 3 ? '1 FRAU 40J. JANA NOVAKOVA' : l.text))
      .join('\n');
    const res = await replaceTextBlockContent(source.arrayBuffer, 0, before, block.segmentId, editedFullText);
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_after`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    expect(after.aligned).toBe(true);
    const afterBlock = after.blocks[0];
    expect(afterBlock.lines.map((l) => l.text)).toEqual([
      'Lago Hotel',
      'Side - Sorgun',
      '41131187',
      '1 FRAU 40J. JANA NOVAKOVA',
      '2 HERR 44J. PETR SLADEK',
      'Akay Travel Service',
    ]);

    // Every single line — including huge vertical gaps and X-column shift to x=50 — kept its exact position!
    for (let i = 0; i < block.lines.length; i++) {
      expect(afterBlock.lines[i].bbox.x).toBeCloseTo(block.lines[i].bbox.x, 1);
      expect(afterBlock.lines[i].bbox.y).toBeCloseTo(block.lines[i].bbox.y, 1);
    }
  });

  it('deletes a single line inside a multi-line BT...ET without moving or deleting sibling lines', async () => {
    const { source, pageModel } = await buildVoucherPdf(VOUCHER_STREAM);
    const before = (await getPageTextModel(source, pageModel))!;
    const block = before.blocks[0];
    const line4Before = block.lines[4].bbox; // 2 HERR 44J. PETR SLADEK
    const line5Before = block.lines[5].bbox; // Akay Travel Service (x=50, y=240)

    const res = await removeTextLineContent(source.arrayBuffer, 0, before, block.lines[3].id);
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_del`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    expect(after.aligned).toBe(true);
    const afterBlock = after.blocks[0];
    expect(afterBlock.lines.map((l) => l.text)).toEqual([
      'Lago Hotel',
      'Side - Sorgun',
      '41131187',
      '2 HERR 44J. PETR SLADEK',
      'Akay Travel Service',
    ]);
    // Sibling lines kept their exact X and Y coordinates!
    expect(afterBlock.lines[3].bbox.x).toBeCloseTo(line4Before.x, 1);
    expect(afterBlock.lines[3].bbox.y).toBeCloseTo(line4Before.y, 1);
    expect(afterBlock.lines[4].bbox.x).toBeCloseTo(line5Before.x, 1);
    expect(afterBlock.lines[4].bbox.y).toBeCloseTo(line5Before.y, 1);
  });

  it('clearing a line to empty string via replaceTextLineContent removes it cleanly without shifting siblings', async () => {
    const { source, pageModel } = await buildVoucherPdf(VOUCHER_STREAM);
    const before = (await getPageTextModel(source, pageModel))!;
    const block = before.blocks[0];
    const lastBefore = block.lines[5].bbox;

    const res = await replaceTextLineContent(source.arrayBuffer, 0, before, block.lines[2].id, '   ');
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_clr`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    expect(after.blocks[0].lines.map((l) => l.text)).not.toContain('41131187');
    const lastAfter = after.blocks[0].lines[after.blocks[0].lines.length - 1];
    expect(lastAfter.text).toBe('Akay Travel Service');
    expect(lastAfter.bbox.x).toBeCloseTo(lastBefore.x, 1);
    expect(lastAfter.bbox.y).toBeCloseTo(lastBefore.y, 1);
  });

  it('preserves bold/regular fonts on untouched lines inside a mixed-font multi-line BT...ET', async () => {
    const mixedStream = [
      'BT',
      '/FB 12 Tf',
      '1 0 0 1 60 700 Tm (Online Check-In) Tj',
      '/FH 11 Tf',
      '0 -18 Td (Bitte erscheinen Sie rechtzeitig am Gate.) Tj',
      'ET',
    ].join('\n');
    const { source, pageModel } = await buildVoucherPdf(mixedStream);
    const before = (await getPageTextModel(source, pageModel))!;
    const block = before.blocks[0];

    const res = await replaceTextBlockContent(
      source.arrayBuffer,
      0,
      before,
      block.segmentId,
      'Online Check-In\nUpdated boarding instructions.'
    );
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_mix`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    const afterBlock = after.blocks[0];
    expect(afterBlock.lines.map((l) => l.text)).toEqual([
      'Online Check-In',
      'Updated boarding instructions.',
    ]);
    // Line 0 must STILL be Helvetica-Bold!
    expect(afterBlock.lines[0].runs[0].fontName).toMatch(/Bold/i);
  });

  it('splits distant same-row columns inside one BT...ET into independently editable entries', async () => {
    const twoColStream = [
      'BT',
      '/FH 11 Tf',
      '1 0 0 1 50 680 Tm (Hotelname) Tj',
      '170 0 Td (Lago Hotel) Tj',
      'ET',
    ].join('\n');
    const { source, pageModel } = await buildVoucherPdf(twoColStream);
    const before = (await getPageTextModel(source, pageModel))!;
    const block = before.blocks[0];
    expect(block.lines.map((l) => l.text)).toEqual(['Hotelname', 'Lago Hotel']);

    const col0Before = block.lines[0].bbox;
    const col1Before = block.lines[1].bbox;
    const res = await replaceTextLineContent(source.arrayBuffer, 0, before, block.lines[1].id, 'Grand Resort');
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_col`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    expect(after.blocks[0].lines.map((l) => l.text)).toEqual(['Hotelname', 'Grand Resort']);
    expect(after.blocks[0].lines[0].bbox.x).toBeCloseTo(col0Before.x, 1);
    expect(after.blocks[0].lines[1].bbox.x).toBeCloseTo(col1Before.x, 1);
  });

  it('appends newly added lines below a multi-line BT...ET while keeping existing lines pinned', async () => {
    const { source, pageModel } = await buildVoucherPdf(VOUCHER_STREAM);
    const before = (await getPageTextModel(source, pageModel))!;
    const block = before.blocks[0];

    const appended = [...block.lines.map((l) => l.text), '+90 530 6098849'].join('\n');
    const res = await replaceTextBlockContent(source.arrayBuffer, 0, before, block.segmentId, appended);
    expect(res.error).toBeUndefined();

    const afterSource: SourceDocument = { ...source, id: `${source.id}_add`, arrayBuffer: res.updatedPdfBytes };
    const after = (await getPageTextModel(afterSource, { ...pageModel, sourceDocId: afterSource.id }))!;
    const afterLines = after.blocks[0].lines;
    expect(afterLines).toHaveLength(7);
    expect(afterLines[6].text).toBe('+90 530 6098849');
    expect(afterLines[6].bbox.y).toBeGreaterThan(afterLines[5].bbox.y + 5);
    expect(afterLines[5].bbox.x).toBeCloseTo(block.lines[5].bbox.x, 1);
    expect(afterLines[5].bbox.y).toBeCloseTo(block.lines[5].bbox.y, 1);
  });
});
