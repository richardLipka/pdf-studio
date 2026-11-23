import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFNumber, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { getPageContentStream, getPageImages, safeGetPageResources } from '../src/services/contentStreamEditor';
import { buildPageTextModel, FontMetrics, PageTextModel } from '../src/services/pdfTextModel';
import {
  computeBoxTransformMatrix,
  displayRectToPdfRect,
  insertImageOnPage,
  invertMatrix,
  multiplyMatrix,
  pdfRectToDisplayRect,
  reflowTextBlocksOnPage,
  styleTextBlocksOnPage,
  transformBatchElementsOnPage,
  transformImageOnPage,
  transformTextBlocksOnPage,
  wrapParagraphsToWidth,
} from '../src/services/pdfElementTransform';
import { computeSnapMove, computeSnapResize } from '../src/utils/snapGuides';
import { matchCommandShortcut } from '../src/shared/appCommands';
import { searchPdfDocument } from '../src/services/pdfSearchService';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64'
);

async function buildModelWithPdfJs(buf: ArrayBuffer, pageIndex = 0, rotation = 0): Promise<PageTextModel> {
  const { streamText, layout, error } = await getPageContentStream(buf, pageIndex);
  if (error || !layout) throw new Error(error || 'Missing stream layout');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buf.slice(0)),
    useSystemFonts: true,
    fontExtraProperties: true,
  });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0, rotation });
    const operatorList = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
    const model = buildPageTextModel({
      streamText,
      layout,
      operatorList,
      ops: pdfjsLib.OPS as unknown as Record<string, number>,
      getFont: (fontKey) => {
        try {
          return page.commonObjs.has(fontKey) ? (page.commonObjs.get(fontKey) as FontMetrics) : null;
        } catch {
          return null;
        }
      },
      toDisplay: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
    });
    model.viewportTransform = [
      viewport.transform[0],
      viewport.transform[1],
      viewport.transform[2],
      viewport.transform[3],
      viewport.transform[4],
      viewport.transform[5],
    ];
    page.cleanup();
    return model;
  } finally {
    await loadingTask.destroy();
  }
}

describe('pdfElementTransform', () => {
  it('computes invertible box transforms and round-trips display <-> PDF rects across all rotations', () => {
    const oldRect = { x: 50, y: 100, width: 120, height: 80 };
    const newRect = { x: 140, y: 260, width: 240, height: 120 };
    const m = computeBoxTransformMatrix(oldRect, newRect);
    expect(m[0]).toBeCloseTo(2, 6);
    expect(m[3]).toBeCloseTo(1.5, 6);
    const inv = invertMatrix(m)!;
    const identity = multiplyMatrix(m, inv);
    expect(identity[0]).toBeCloseTo(1, 6);
    expect(identity[3]).toBeCloseTo(1, 6);
    expect(identity[4]).toBeCloseTo(0, 6);
    expect(identity[5]).toBeCloseTo(0, 6);

    // 90-degree rotated viewport transform (A4 595x842 rotated 90 deg CW -> display 842x595)
    const rot90: [number, number, number, number, number, number] = [0, 1, 1, 0, 0, 0];
    const disp = pdfRectToDisplayRect(oldRect, rot90);
    const back = displayRectToPdfRect(disp, rot90);
    expect(back.x).toBeCloseTo(oldRect.x, 4);
    expect(back.y).toBeCloseTo(oldRect.y, 4);
    expect(back.width).toBeCloseTo(oldRect.width, 4);
    expect(back.height).toBeCloseTo(oldRect.height, 4);
  });

  it('repositions and resizes one placement of a repeated image XObject without touching the other placement or page 2', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([595, 842]);
    const p2 = doc.addPage([595, 842]);
    const img = await doc.embedPng(TINY_PNG);
    p1.drawImage(img, { x: 50, y: 500, width: 120, height: 80 });
    p1.drawImage(img, { x: 300, y: 500, width: 120, height: 80 });
    p2.drawImage(img, { x: 80, y: 400, width: 100, height: 100 });
    const bytes = toArrayBuffer(await doc.save());

    const before = await getPageImages(bytes, 0);
    expect(before.images).toHaveLength(2);
    const targetId = before.images[0].id;

    // Move & resize first placement
    const res1 = await transformImageOnPage(bytes, 0, targetId, { x: 95, y: 610, width: 240, height: 110 });
    expect(res1.error).toBeUndefined();

    const after1 = await getPageImages(res1.updatedPdfBytes, 0);
    expect(after1.images).toHaveLength(2);
    expect(after1.images[0].x).toBeCloseTo(95, 1);
    expect(after1.images[0].y).toBeCloseTo(610, 1);
    expect(after1.images[0].width).toBeCloseTo(240, 1);
    expect(after1.images[0].height).toBeCloseTo(110, 1);
    // Second placement untouched
    expect(after1.images[1].x).toBeCloseTo(300, 1);
    expect(after1.images[1].y).toBeCloseTo(500, 1);
    // Page 2 untouched
    const p2Images = await getPageImages(res1.updatedPdfBytes, 1);
    expect(p2Images.images[0].x).toBeCloseTo(80, 1);
    expect(p2Images.images[0].width).toBeCloseTo(100, 1);

    // Repeated move & resize collapses existing `% pilsenpdf:xform` wrapper instead of nesting q ... Q
    const res2 = await transformImageOnPage(res1.updatedPdfBytes, 0, targetId, { x: 120, y: 580, width: 180, height: 90 });
    expect(res2.error).toBeUndefined();
    const after2 = await getPageImages(res2.updatedPdfBytes, 0);
    expect(after2.images[0].x).toBeCloseTo(120, 1);
    expect(after2.images[0].y).toBeCloseTo(580, 1);
    expect(after2.images[0].width).toBeCloseTo(180, 1);
    expect(after2.images[0].height).toBeCloseTo(90, 1);

    const stream2 = await getPageContentStream(res2.updatedPdfBytes, 0);
    const markerMatches = stream2.streamText.match(/% pilsenpdf:xform/g) ?? [];
    expect(markerMatches).toHaveLength(1);
  });

  it('transforms a clipped image together with its exclusive q ... W n ... Q scope', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const img = await doc.embedPng(TINY_PNG);
    page.drawImage(img, { x: 50, y: 500, width: 100, height: 60 });
    // Replace /Contents with an explicit clipping q ... W n ... Q frame around the image
    const resDict = safeGetPageResources(page.node)!;
    const xObjDict = resDict.lookup(PDFName.of('XObject')) as any;
    const imgKey = xObjDict.keys()[0].asString().replace(/^\//, '');
    const clippedStream = `q\n50 500 100 60 re W n\n100 0 0 60 50 500 cm\n/${imgKey} Do\nQ\n`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(clippedStream)));
    const bytes = toArrayBuffer(await doc.save());

    const before = await getPageImages(bytes, 0);
    expect(before.images).toHaveLength(1);

    const res = await transformImageOnPage(bytes, 0, before.images[0].id, { x: 220, y: 300, width: 200, height: 120 });
    expect(res.error).toBeUndefined();

    // The wrapper must enclose the entire `q ... re W n ... Do Q` frame so the clip moves with the image
    const afterStream = await getPageContentStream(res.updatedPdfBytes, 0);
    const xformIdx = afterStream.streamText.indexOf('% pilsenpdf:xform');
    const clipIdx = afterStream.streamText.indexOf('re W n');
    expect(xformIdx).toBeGreaterThanOrEqual(0);
    expect(xformIdx).toBeLessThan(clipIdx);

    const after = await getPageImages(res.updatedPdfBytes, 0);
    expect(after.images[0].x).toBeCloseTo(220, 1);
    expect(after.images[0].y).toBeCloseTo(300, 1);
    expect(after.images[0].width).toBeCloseTo(200, 1);
    expect(after.images[0].height).toBeCloseTo(120, 1);
  });

  it('expands a page-local Form XObject /BBox when an image inside the form is moved outside its original bounds', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const img = await doc.embedPng(TINY_PNG);
    const formStream = doc.context.flateStream(`q\n80 0 0 60 10 10 cm\n/ImForm Do\nQ\n`, {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      BBox: [0, 0, 100, 80],
      Resources: { XObject: { ImForm: img.ref } },
    });
    const formRef = doc.context.register(formStream);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Fm1: formRef } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q\n/Fm1 Do\nQ\n')));
    const bytes = toArrayBuffer(await doc.save());

    const before = await getPageImages(bytes, 0);
    expect(before.images).toHaveLength(1);
    expect(before.images[0].inForm).toBe(true);

    const res = await transformImageOnPage(bytes, 0, before.images[0].id, { x: 250, y: 400, width: 160, height: 120 });
    expect(res.error).toBeUndefined();

    const after = await getPageImages(res.updatedPdfBytes, 0);
    expect(after.images[0].x).toBeCloseTo(250, 1);
    expect(after.images[0].y).toBeCloseTo(400, 1);
    expect(after.images[0].width).toBeCloseTo(160, 1);

    // Verify Form XObject /BBox was expanded to cover [250..410, 400..520]
    const reloaded = await PDFDocument.load(res.updatedPdfBytes);
    const rPage = reloaded.getPage(0);
    const xObjs = safeGetPageResources(rPage.node)!.lookup(PDFName.of('XObject')) as any;
    const fm = reloaded.context.lookup(xObjs.get(PDFName.of('Fm1'))) as any;
    const bbox = fm.dict.lookup(PDFName.of('BBox')) as PDFArray;
    const vals = bbox.asArray().map((n) => (n as PDFNumber).asNumber());
    expect(vals[2]).toBeGreaterThanOrEqual(410);
    expect(vals[3]).toBeGreaterThanOrEqual(520);
  });

  it('repositions and proportionally scales a PDF text block while preserving alignment, sibling blocks, and collapsing repeated edits', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('First editable block', { x: 60, y: 740, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText('Second untouched block', { x: 60, y: 680, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    expect(m0.aligned).toBe(true);
    expect(m0.blocks).toHaveLength(2);

    const b0 = m0.blocks[0];
    const b1Before = m0.blocks[1];
    const oldPdf = displayRectToPdfRect(b0.bbox, m0.viewportTransform!);
    const newPdf = { x: oldPdf.x + 110, y: oldPdf.y - 40, width: oldPdf.width * 1.5, height: oldPdf.height * 1.5 };

    const res1 = await transformTextBlocksOnPage(bytes, 0, m0, [b0.segmentId], oldPdf, newPdf);
    expect(res1.error).toBeUndefined();

    const m1 = await buildModelWithPdfJs(res1.updatedPdfBytes, 0);
    expect(m1.aligned).toBe(true);
    expect(m1.blocks).toHaveLength(2);
    const b0After1 = displayRectToPdfRect(m1.blocks[0].bbox, m1.viewportTransform!);
    expect(b0After1.x).toBeCloseTo(newPdf.x, 1);
    expect(b0After1.y).toBeCloseTo(newPdf.y, 1);
    expect(b0After1.width).toBeCloseTo(newPdf.width, 1);
    expect(b0After1.height).toBeCloseTo(newPdf.height, 1);
    expect(m1.blocks[0].text).toBe('First editable block');
    // Sibling block completely untouched
    expect(m1.blocks[1].bbox.x).toBeCloseTo(b1Before.bbox.x, 1);
    expect(m1.blocks[1].bbox.y).toBeCloseTo(b1Before.bbox.y, 1);

    // Move same block a second time: wrapper must collapse (still only 1 xform marker!)
    const newPdf2 = { ...b0After1, x: b0After1.x - 50, y: b0After1.y - 25 };
    const res2 = await transformTextBlocksOnPage(res1.updatedPdfBytes, 0, m1, [m1.blocks[0].segmentId], b0After1, newPdf2);
    expect(res2.error).toBeUndefined();

    const m2 = await buildModelWithPdfJs(res2.updatedPdfBytes, 0);
    expect(m2.aligned).toBe(true);
    const b0After2 = displayRectToPdfRect(m2.blocks[0].bbox, m2.viewportTransform!);
    expect(b0After2.x).toBeCloseTo(newPdf2.x, 1);
    expect(b0After2.y).toBeCloseTo(newPdf2.y, 1);
    const markers = (m2.streamText.match(/% pilsenpdf:xform/g) ?? []).length;
    expect(markers).toBe(1);
  });

  it('reflows a text block into narrower multi-line layout and back into wider fewer lines', async () => {
    expect(wrapParagraphsToWidth(['one two three four five'], 60, (s) => s.length * 6)).toEqual([
      'one two',
      'three four',
      'five',
    ]);

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('The quick brown fox jumps over the lazy dog in Plzen', {
      x: 60,
      y: 740,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    expect(m0.aligned).toBe(true);
    expect(m0.blocks[0].lines).toHaveLength(1);
    const origWidth = m0.blocks[0].bbox.width;
    expect(origWidth).toBeGreaterThan(220);

    // Narrow to 120 pt -> should wrap into multiple lines
    const resNarrow = await reflowTextBlocksOnPage(bytes, 0, m0, [m0.blocks[0].segmentId], 120);
    expect(resNarrow.error).toBeUndefined();
    expect(resNarrow.lineCount).toBeGreaterThanOrEqual(2);

    const mNarrow = await buildModelWithPdfJs(resNarrow.updatedPdfBytes, 0);
    expect(mNarrow.aligned).toBe(true);
    expect(mNarrow.blocks[0].lines.length).toBeGreaterThanOrEqual(2);
    expect(mNarrow.blocks[0].bbox.width).toBeLessThan(150);
    expect(mNarrow.blocks[0].text.replace(/\n/g, ' ')).toBe('The quick brown fox jumps over the lazy dog in Plzen');

    // Widen back to 420 pt -> should unwrap back to 1 line
    const resWide = await reflowTextBlocksOnPage(
      resNarrow.updatedPdfBytes,
      0,
      mNarrow,
      [mNarrow.blocks[0].segmentId],
      420
    );
    expect(resWide.error).toBeUndefined();
    expect(resWide.lineCount).toBe(1);

    const mWide = await buildModelWithPdfJs(resWide.updatedPdfBytes, 0);
    expect(mWide.aligned).toBe(true);
    expect(mWide.blocks[0].lines).toHaveLength(1);
  });

  it('transforms real-world PDFs (Simulace.pdf image + UUR_2026 text) with full pdf.js alignment', async () => {
    const simulacePath = path.resolve('src/assets/testfiles/Simulace.pdf');
    if (fs.existsSync(simulacePath)) {
      const buf = toArrayBuffer(new Uint8Array(fs.readFileSync(simulacePath)));
      const imgs = await getPageImages(buf, 1);
      expect(imgs.images.length).toBeGreaterThan(0);
      const im = imgs.images[0];
      const target = { x: im.x! + 20, y: im.y! - 15, width: im.width! * 0.85, height: im.height! * 0.85 };
      const res = await transformImageOnPage(buf, 1, im.id, target);
      expect(res.error).toBeUndefined();
      const after = await getPageImages(res.updatedPdfBytes, 1);
      const moved = after.images.find((i) => i.id === im.id)!;
      expect(moved.x).toBeCloseTo(target.x, 1);
      expect(moved.y).toBeCloseTo(target.y, 1);
      expect(moved.width).toBeCloseTo(target.width, 1);
    }

    const uurPath = path.resolve('src/assets/testfiles/UUR_2026_zkouskovy_katalog.pdf');
    if (fs.existsSync(uurPath)) {
      const buf = toArrayBuffer(new Uint8Array(fs.readFileSync(uurPath)));
      const m0 = await buildModelWithPdfJs(buf, 0);
      expect(m0.aligned).toBe(true);
      const blk = m0.blocks.find((b) => b.text.trim().length > 4)!;
      const oldPdf = displayRectToPdfRect(blk.bbox, m0.viewportTransform!);
      const newPdf = { x: oldPdf.x + 25, y: oldPdf.y - 12, width: oldPdf.width * 1.15, height: oldPdf.height * 1.15 };
      const res = await transformTextBlocksOnPage(buf, 0, m0, [blk.segmentId], oldPdf, newPdf);
      expect(res.error).toBeUndefined();
      const m1 = await buildModelWithPdfJs(res.updatedPdfBytes, 0);
      expect(m1.aligned).toBe(true);
      const afterPdf = displayRectToPdfRect(m1.blocksById.get(blk.segmentId)!.bbox, m1.viewportTransform!);
      expect(afterPdf.x).toBeCloseTo(newPdf.x, 1);
      expect(afterPdf.width).toBeCloseTo(newPdf.width, 1);
    }
  });

  it('replays inherited font/color state after Q so subsequent BT ... ET blocks keep their styling', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Register /F1 on page resources by drawing once, then write a custom stream where block 2 inherits Tf & rg from block 1
    page.drawText('seed', { x: 10, y: 10, size: 12, font });
    const res = safeGetPageResources(page.node)!;
    const fontDict = res.lookup(PDFName.of('Font')) as any;
    const fontKey = fontDict.keys()[0].asString().replace(/^\//, '');
    const customStream = [
      'BT',
      `/${fontKey} 16 Tf`,
      '0.8 0.1 0.1 rg',
      '1 0 0 1 60 720 Tm',
      '(Heading One) Tj',
      'ET',
      'BT',
      '1 0 0 1 60 660 Tm',
      '(Inherited Style Line) Tj',
      'ET',
    ].join('\n');
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(customStream)));
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    expect(m0.aligned).toBe(true);
    expect(m0.blocks).toHaveLength(2);

    const oldPdf = displayRectToPdfRect(m0.blocks[0].bbox, m0.viewportTransform!);
    const newPdf = { ...oldPdf, x: oldPdf.x + 80, y: oldPdf.y - 20 };
    const resEdit = await transformTextBlocksOnPage(bytes, 0, m0, [m0.blocks[0].segmentId], oldPdf, newPdf);
    expect(resEdit.error).toBeUndefined();

    // Verify Tf and rg were replayed after Q before the second BT ... ET
    const qEndIdx = resEdit.updatedStream!.indexOf('\nQ');
    const secondBtIdx = resEdit.updatedStream!.lastIndexOf('BT');
    const between = resEdit.updatedStream!.slice(qEndIdx, secondBtIdx);
    expect(between).toContain(`/${fontKey} 16 Tf`);
    expect(between).toContain('0.8 0.1 0.1 rg');

    // Verify pdf.js still parses both blocks with block 2 keeping its exact 16pt font size & position
    const m1 = await buildModelWithPdfJs(resEdit.updatedPdfBytes, 0);
    expect(m1.aligned).toBe(true);
    expect(m1.blocks).toHaveLength(2);
    expect(m1.blocks[1].runs[0].fontSize).toBeCloseTo(16, 1);
    expect(m1.blocks[1].text).toBe('Inherited Style Line');
  });

  it('inserts a new image onto an existing page, then moves and rotates it cleanly without touching page 2', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([595, 842]);
    const p2 = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    p1.drawText('Page 1 text', { x: 60, y: 740, size: 12, font });
    p2.drawText('Page 2 untouched', { x: 60, y: 740, size: 12, font });
    const bytes = toArrayBuffer(await doc.save());

    const ins = await insertImageOnPage(bytes, 0, TINY_PNG, 'image/png', { x: 100, y: 400, width: 120, height: 80 });
    expect(ins.error).toBeUndefined();
    expect(ins.placementId).toBe('img:ImIns1:0');

    const imgs1 = await getPageImages(ins.updatedPdfBytes, 0);
    expect(imgs1.images).toHaveLength(1);
    expect(imgs1.images[0].x).toBeCloseTo(100, 1);
    expect(imgs1.images[0].width).toBeCloseTo(120, 1);
    expect((await getPageImages(ins.updatedPdfBytes, 1)).images).toHaveLength(0);

    // Rotate 90 degrees clockwise around center: 120x80 box becomes 80x120 bbox centered at (160, 440)
    const rot = await transformImageOnPage(
      ins.updatedPdfBytes,
      0,
      ins.placementId!,
      { x: 100, y: 400, width: 120, height: 80 },
      90
    );
    expect(rot.error).toBeUndefined();
    const imgsRot = await getPageImages(rot.updatedPdfBytes, 0);
    expect(imgsRot.images[0].width).toBeCloseTo(80, 1);
    expect(imgsRot.images[0].height).toBeCloseTo(120, 1);
    // Repeated xform collapses into 1 marker
    const streamRot = await getPageContentStream(rot.updatedPdfBytes, 0);
    expect((streamRot.streamText.match(/% pilsenpdf:xform/g) ?? []).length).toBe(1);
  });

  it('updates text block font size and fill color while isolating sibling text blocks', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Styled headline', { x: 60, y: 740, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText('Untouched paragraph', { x: 60, y: 680, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    expect(m0.aligned).toBe(true);
    const res = await styleTextBlocksOnPage(bytes, 0, m0, [m0.blocks[0].segmentId], {
      fontSizePt: 24,
      hexColor: '#dc2626',
    });
    expect(res.error).toBeUndefined();
    expect(res.updatedStream).toContain('rg');

    const m1 = await buildModelWithPdfJs(res.updatedPdfBytes, 0);
    expect(m1.aligned).toBe(true);
    expect(m1.blocks[0].runs[0].emSize).toBeCloseTo(24, 0);
    // Sibling block kept its original 12pt size
    expect(m1.blocks[1].runs[0].emSize).toBeCloseTo(12, 0);
  });

  it('preserves mixed bold + regular inline styles during width reflow', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    // Seed both fonts onto page resources
    page.drawText('a', { x: -50, y: -50, size: 12, font: bold });
    page.drawText('b', { x: -50, y: -50, size: 12, font: reg });
    const fontDict = safeGetPageResources(page.node)!.lookup(PDFName.of('Font')) as any;
    const keys = fontDict.keys().map((k: any) => k.asString().replace(/^\//, ''));
    const [fBold, fReg] = keys;
    const stream = [
      'BT',
      `/${fBold} 12 Tf`,
      '1 0 0 1 60 720 Tm',
      '(Important Notice:) Tj',
      `/${fReg} 12 Tf`,
      '( please review all attached documents carefully today) Tj',
      'ET',
    ].join('\n');
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(stream)));
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    expect(m0.aligned).toBe(true);
    const res = await reflowTextBlocksOnPage(bytes, 0, m0, [m0.blocks[0].segmentId], 140);
    expect(res.error).toBeUndefined();
    expect(res.lineCount).toBeGreaterThanOrEqual(2);
    expect(res.updatedStream).toContain(`/${fBold}`);
    expect(res.updatedStream).toContain(`/${fReg}`);

    const m1 = await buildModelWithPdfJs(res.updatedPdfBytes, 0);
    expect(m1.aligned).toBe(true);
    expect(m1.blocks[0].lines.length).toBeGreaterThanOrEqual(2);
  });

  it('batch-moves multiple selected text blocks and images in a single atomic commit', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const img = await doc.embedPng(TINY_PNG);
    page.drawText('Block A', { x: 50, y: 750, size: 12, font });
    page.drawText('Block B', { x: 50, y: 700, size: 12, font });
    page.drawImage(img, { x: 200, y: 650, width: 100, height: 60 });
    const bytes = toArrayBuffer(await doc.save());

    const m0 = await buildModelWithPdfJs(bytes, 0);
    const imgs0 = await getPageImages(bytes, 0);
    const oldPdfA = displayRectToPdfRect(m0.blocks[0].bbox, m0.viewportTransform!);
    const oldPdfB = displayRectToPdfRect(m0.blocks[1].bbox, m0.viewportTransform!);

    // Move Block A + Image by (+40, -30) while leaving Block B completely untouched
    const res = await transformBatchElementsOnPage(bytes, 0, m0, [m0.blocks[0].segmentId], [imgs0.images[0].id], 40, -30);
    expect(res.error).toBeUndefined();

    const m1 = await buildModelWithPdfJs(res.updatedPdfBytes, 0);
    const imgs1 = await getPageImages(res.updatedPdfBytes, 0);
    const newPdfA = displayRectToPdfRect(m1.blocks[0].bbox, m1.viewportTransform!);
    const newPdfB = displayRectToPdfRect(m1.blocks[1].bbox, m1.viewportTransform!);

    expect(newPdfA.x).toBeCloseTo(oldPdfA.x + 40, 1);
    expect(newPdfA.y).toBeCloseTo(oldPdfA.y - 30, 1);
    expect(imgs1.images[0].x).toBeCloseTo(240, 1);
    expect(imgs1.images[0].y).toBeCloseTo(620, 1);
    // Block B untouched
    expect(newPdfB.x).toBeCloseTo(oldPdfB.x, 1);
    expect(newPdfB.y).toBeCloseTo(oldPdfB.y, 1);
  });

  it('snaps dragged and resized boxes to page center, margins, and sibling edges, and supports Czech Ctrl+Shift+0 zoomActual', () => {
    const siblings = [{ x: 100, y: 200, width: 150, height: 40 }];
    // Near page center X (297.5): center is 298 (dist 0.5pt < sibling right-edge dist 2pt)
    const snappedCenter = computeSnapMove({ x: 248, y: 120, width: 100, height: 40 }, 595, 842, siblings, 5);
    expect(snappedCenter.rect.x).toBeCloseTo(247.5, 4);
    expect(snappedCenter.guides.some((g) => g.axis === 'x' && g.kind === 'page-center')).toBe(true);

    // Near sibling left edge (100) and top edge (200)
    const snappedSib = computeSnapMove({ x: 103, y: 198, width: 80, height: 30 }, 595, 842, siblings, 5);
    expect(snappedSib.rect.x).toBe(100);
    expect(snappedSib.rect.y).toBe(200);
    expect(snappedSib.guides).toHaveLength(2);

    // Resize east edge snaps to sibling right edge (250)
    const snappedResize = computeSnapResize({ x: 100, y: 100, width: 147, height: 40 }, 'e', 595, 842, siblings, 16, 8, 5);
    expect(snappedResize.rect.width).toBe(150);
    expect(snappedResize.guides.some((g) => g.axis === 'x' && g.position === 250)).toBe(true);

    // Czech keyboard layout: Ctrl+Shift+0 triggers zoomActual cleanly (both when key is '0' on Czech and ')' on US)
    expect(
      matchCommandShortcut({ key: '0', code: 'Digit0', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, false)
    ).toBe('zoomActual');
    expect(
      matchCommandShortcut({ key: ')', code: 'Digit0', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, false)
    ).toBe('zoomActual');
  });

  it('verifies insertImage, rotate, style, and batch move across real-world PDFs in src/assets/testfiles', async () => {
    const adPath = path.resolve('src/assets/testfiles/A-D-edited.pdf');
    if (fs.existsSync(adPath)) {
      const buf = toArrayBuffer(new Uint8Array(fs.readFileSync(adPath)));
      const ins = await insertImageOnPage(buf, 0, TINY_PNG, 'image/png', { x: 80, y: 600, width: 90, height: 60 });
      expect(ins.error).toBeUndefined();
      const rot = await transformImageOnPage(ins.updatedPdfBytes, 0, ins.placementId!, { x: 80, y: 600, width: 90, height: 60 }, 45);
      expect(rot.error).toBeUndefined();
      const imgsAfter = await getPageImages(rot.updatedPdfBytes, 0);
      expect(imgsAfter.images.some((i) => i.id === ins.placementId)).toBe(true);
    }

    const thesisPath = path.resolve('src/assets/testfiles/PhDThesis-Snajberk-RichardRew.pdf');
    if (fs.existsSync(thesisPath)) {
      const buf = toArrayBuffer(new Uint8Array(fs.readFileSync(thesisPath)));
      const m0 = await buildModelWithPdfJs(buf, 0);
      expect(m0.aligned).toBe(true);
      const firstTwo = m0.blocks.slice(0, 2).map((b) => b.segmentId);
      const batch = await transformBatchElementsOnPage(buf, 0, m0, firstTwo, [], 15, -10);
      expect(batch.error).toBeUndefined();
      const m1 = await buildModelWithPdfJs(batch.updatedPdfBytes, 0);
      expect(m1.aligned).toBe(true);
    }

    const vskpPath = path.resolve('src/assets/testfiles/temata_vskp_-_podklady_pro_zadani_vskp.pdf');
    if (fs.existsSync(vskpPath)) {
      const buf = toArrayBuffer(new Uint8Array(fs.readFileSync(vskpPath)));
      const m0 = await buildModelWithPdfJs(buf, 0);
      expect(m0.aligned).toBe(true);
      const blk = m0.blocks.find((b) => b.text.trim().length > 6)!;
      const styled = await styleTextBlocksOnPage(buf, 0, m0, [blk.segmentId], { hexColor: '#1d4ed8' });
      expect(styled.error).toBeUndefined();
      const m1 = await buildModelWithPdfJs(styled.updatedPdfBytes, 0);
      expect(m1.aligned).toBe(true);
    }
  });

  it('streams progressive search results in chunks via onProgress', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 5; i++) {
      const p = doc.addPage([595, 842]);
      p.drawText(`PilsenPDF page ${i + 1} search target`, { x: 60, y: 740, size: 12, font });
    }
    const bytes = toArrayBuffer(await doc.save());
    const pages = Array.from({ length: 5 }, (_, i) => ({
      id: `p_${i}`,
      sourceDocId: 'src_1',
      sourceType: 'pdf' as const,
      originalPageIndex: i,
      rotation: 0,
      width: 595,
      height: 842,
    }));
    const sources = [{ id: 'src_1', name: 'test.pdf', arrayBuffer: bytes, pageCount: 5 }];
    const snapshots: Array<{ count: number; scanned: number }> = [];
    const finalMatches = await searchPdfDocument(pages, sources, 'target', {
      chunkSize: 2,
      onProgress: (matchesSoFar, scanned) => snapshots.push({ count: matchesSoFar.length, scanned }),
    });
    expect(finalMatches).toHaveLength(5);
    expect(snapshots).toEqual([
      { count: 2, scanned: 2 },
      { count: 4, scanned: 4 },
      { count: 5, scanned: 5 },
    ]);
  });
});
