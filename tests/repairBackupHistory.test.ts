import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream } from 'pdf-lib';
import { repairPdfDefects, containsAscii } from '../src/services/pdfRepair';
import {
  createSettingsBackup,
  parseSettingsBackup,
  mergeSignatures,
  sanitizeRasterSettings,
  backupFileName,
  BACKUP_FORMAT,
} from '../src/services/settingsBackup';
import { trimHistory, historyBufferBytes, HISTORY_BUFFER_BUDGET } from '../src/context/DocumentContext';
import { SignatureStamp } from '../src/types/stamp';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * A page with an 8x8 all-white CCITT G4 image (eight V0 codes = 0xFF) whose /DecodeParms /Rows is
 * garbage, like the scans that rendered blank in pdf.js 6. `asArray` puts the parameters in an
 * array, `shared` makes two images share one parameter dictionary.
 */
async function buildCcittPdf(options: { rows: number; asArray?: boolean; shared?: boolean }): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;
  const parms = ctx.register(ctx.obj({ K: -1, Columns: 8, Rows: options.rows }));
  const makeImage = (height: number) =>
    ctx.register(
      ctx.stream(new Uint8Array(height / 8).fill(0xff), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 8,
        Height: height,
        BitsPerComponent: 1,
        ColorSpace: 'DeviceGray',
        Filter: options.asArray ? ['CCITTFaxDecode'] : 'CCITTFaxDecode',
        DecodeParms: options.asArray ? [parms] : parms,
      })
    );
  const imA = makeImage(8);
  const imB = options.shared ? makeImage(16) : undefined;
  page.node.Resources()!.set(PDFName.of('XObject'), ctx.obj(imB ? { ImA: imA, ImB: imB } : { ImA: imA }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('q 100 0 0 100 50 50 cm /ImA Do Q')));
  return toArrayBuffer(await doc.save({ useObjectStreams: true }));
}

const imageParms = async (buffer: ArrayBuffer) => {
  const doc = await PDFDocument.load(buffer);
  const out: Array<{ height: number; rows: number | undefined }> = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const value = obj.dict.lookup(PDFName.of('DecodeParms'));
    const parms = value instanceof PDFArray ? value.lookup(0, PDFDict) : (value as PDFDict);
    out.push({
      height: (obj.dict.lookup(PDFName.of('Height')) as PDFNumber).asNumber(),
      rows: (parms.lookup(PDFName.of('Rows')) as PDFNumber | undefined)?.asNumber(),
    });
  }
  return out.sort((a, b) => a.height - b.height);
};

describe('PDF repair: CCITT /Rows larger than the image', () => {
  it('sets /Rows to the image height (parameters inside a compressed object stream)', async () => {
    const broken = await buildCcittPdf({ rows: 1084690432 });
    expect(containsAscii(new Uint8Array(broken), '/Rows 1084690432')).toBe(false); // not patchable as bytes
    const { buffer, repairs } = await repairPdfDefects(broken);
    expect(repairs).toHaveLength(1);
    expect(await imageParms(buffer)).toEqual([{ height: 8, rows: 8 }]);
  });

  it('handles parameter arrays and dictionaries shared by images of different heights', async () => {
    const { buffer } = await repairPdfDefects(await buildCcittPdf({ rows: 999999, asArray: true, shared: true }));
    expect(await imageParms(buffer)).toEqual([
      { height: 8, rows: 8 },
      { height: 16, rows: 16 },
    ]);
  });

  it('returns valid documents and documents without CCITT images unchanged (same buffer)', async () => {
    const valid = await buildCcittPdf({ rows: 8 });
    expect((await repairPdfDefects(valid)).buffer).toBe(valid);
    const plain = toArrayBuffer(await (await PDFDocument.create()).save());
    const result = await repairPdfDefects(plain);
    expect(result.buffer).toBe(plain);
    expect(result.repairs).toEqual([]);
  });

  it('never throws on garbage', async () => {
    const garbage = toArrayBuffer(new TextEncoder().encode('%PDF-1.7 /CCITTFaxDecode not really a pdf'));
    expect((await repairPdfDefects(garbage)).buffer).toBe(garbage);
  });
});

describe('Settings backup', () => {
  const stamp = (id: string, title = id): SignatureStamp => ({ id, title, imageDataUrl: 'data:image/png;base64,AAAA', createdAt: 1 });

  it('round-trips settings and signatures', () => {
    const backup = createSettingsBackup({
      appVersion: '2.0.0',
      edition: 'desktop',
      settings: {
        language: 'en',
        theme: 'lcars',
        rasterSettings: { scale: 3, format: 'image/png', jpegQuality: 0.9 },
        reopenLastFileOnStartup: false,
        confirmOverwrite: true,
      },
      signatures: [stamp('a'), stamp('b')],
      now: new Date('2026-10-14T10:00:00Z'),
    });
    const parsed = parseSettingsBackup(JSON.stringify(backup));
    expect('backup' in parsed && parsed.backup).toEqual(backup);
    expect(backupFileName(new Date('2026-10-14T10:00:00Z'))).toBe('pdf-studio-settings-2026-10-14.json');
  });

  it('drops invalid values instead of applying them', () => {
    const parsed = parseSettingsBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        settings: { language: 'de', theme: 'neon', rasterSettings: { scale: 7, format: 'image/png', jpegQuality: 0.9 }, confirmOverwrite: 'yes' },
        signatures: [stamp('ok'), { id: 'x', imageDataUrl: 'javascript:alert(1)' }, { title: 'no id' }],
      })
    );
    if (!('backup' in parsed)) throw new Error('expected a backup');
    expect(parsed.backup.settings).toEqual({});
    expect(parsed.backup.signatures.map((s) => s.id)).toEqual(['ok']);
    expect(sanitizeRasterSettings({ scale: 1.5, format: 'image/jpeg', jpegQuality: 0.75 })).toEqual({ scale: 1.5, format: 'image/jpeg', jpegQuality: 0.75 });
  });

  it('rejects other files and newer formats, accepts the stamp library export', () => {
    expect(parseSettingsBackup('not json')).toEqual({ error: 'invalid-json' });
    expect(parseSettingsBackup('{"hello":1}')).toEqual({ error: 'not-a-backup' });
    expect(parseSettingsBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99 }))).toEqual({ error: 'newer-version' });
    const stampsPackage = { app: 'PDF Studio', version: '2.0.0', exportedAt: '2026-01-01T00:00:00.000Z', stampsCount: 1, stamps: [stamp('s1')] };
    const parsed = parseSettingsBackup(JSON.stringify(stampsPackage));
    expect('backup' in parsed && parsed.backup.signatures.map((s) => s.id)).toEqual(['s1']);
  });

  it('merges restored signatures into the current library without losing any', () => {
    const merged = mergeSignatures([stamp('a', 'old a'), stamp('b')], [stamp('a', 'new a'), stamp('c')]);
    expect(merged.map((s) => `${s.id}:${s.title}`)).toEqual(['a:new a', 'b:b', 'c:c']);
  });
});

describe('Undo history memory budget', () => {
  const entry = (...buffers: ArrayBuffer[]) => ({ sources: buffers.map((arrayBuffer, i) => ({ id: `s${i}`, name: 'x', arrayBuffer })) });

  it('counts each distinct PDF version once', () => {
    const a = new ArrayBuffer(100);
    const b = new ArrayBuffer(50);
    expect(historyBufferBytes([entry(a), entry(a), entry(a, b)])).toBe(150);
  });

  it('drops the oldest steps once the distinct versions exceed the budget, keeping the newest', () => {
    const versions = Array.from({ length: 6 }, () => new ArrayBuffer(100));
    const trimmed = trimHistory(versions.map((v) => entry(v)), 350);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[2].sources[0].arrayBuffer).toBe(versions[5]);
    // A single entry over budget is kept: the current state can never be dropped
    expect(trimHistory([entry(new ArrayBuffer(1000))], 10)).toHaveLength(1);
    expect(HISTORY_BUFFER_BUDGET).toBeGreaterThan(100 * 1024 * 1024);
  });

  it('keeps edits that do not create new PDF versions (annotations, rotations) up to the step limit', () => {
    const shared = new ArrayBuffer(10 * 1024 * 1024);
    expect(trimHistory(Array.from({ length: 150 }, () => entry(shared)))).toHaveLength(100);
  });
});
