// End-to-end check of the desktop edition with real local files and a throw-away settings profile:
// command-line file, window title and unsaved-changes marker, Save (overwrite confirmation), Save As,
// recent files, the unsaved-changes guard on close, persisted settings, reopening the last file,
// the native menu, outline navigation after page edits and external links.
// Native dialogs are answered by stubbing Electron's dialog module in the main process.
// Usage (in desktop/): npm run build && npm run e2e      (or: npm run pack && npm run e2e -- --packaged)
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(path.join(desktopDir, '..', 'package.json'));
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFNumber } = requireFromRoot('pdf-lib');
const electronBinary = createRequire(path.join(desktopDir, 'package.json'))('electron');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-studio-e2e-'));
const profile = path.join(work, 'profile');
const docs = path.join(work, 'Dokumenty s mezerou');
fs.mkdirSync(docs, { recursive: true });

let failures = 0;
let currentApp = null;
const check = (ok, message) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
  if (!ok) failures++;
};

async function makePdf(file, pageCount, withOutline) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Chapter ${i + 1}`, { x: 60, y: 760, size: 24, font });
    page.drawText(`Body text of page ${i + 1} with the word needle.`, { x: 60, y: 700, size: 12, font });
    pages.push(page);
  }
  if (withOutline) {
    const ctx = doc.context;
    const outlineRef = ctx.nextRef();
    const refs = pages.map(() => ctx.nextRef());
    pages.forEach((page, i) => {
      const item = ctx.obj({ Title: PDFString.of(`Chapter ${i + 1}`), Parent: outlineRef, Dest: [page.ref, PDFName.of('Fit')] });
      if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < pages.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
      ctx.assign(refs[i], item);
    });
    ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(pages.length) }));
    doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  }
  fs.writeFileSync(file, await doc.save());
}

// --packaged runs the unpacked package from desktop/release (npm run pack) instead of desktop/build
const packagedExe = path.join(desktopDir, 'release', 'win-unpacked', 'PDF Studio.exe');
const usePackaged = process.argv.includes('--packaged');
if (usePackaged && !fs.existsSync(packagedExe)) {
  console.error(`${packagedExe} is missing: run npm run pack first`);
  process.exit(1);
}

/**
 * A "scan": an 8x8 black CCITT G3 (1-D) image drawn as a square, with a corrupt /DecodeParms /Rows
 * like real scans that pdf.js 6 rendered blank. Each row is white run 0 + black run 8.
 */
async function makeBrokenScan(file) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const bits = '00110101000101'.repeat(8);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7);
  const ctx = doc.context;
  const image = ctx.register(
    ctx.stream(bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 8,
      Height: 8,
      BitsPerComponent: 1,
      ColorSpace: 'DeviceGray',
      Filter: ['CCITTFaxDecode'],
      DecodeParms: [ctx.obj({ K: 0, Columns: 8, Rows: 1084690432 })],
    })
  );
  page.node.Resources().set(PDFName.of('XObject'), ctx.obj({ Scan: image }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('q 200 0 0 200 50 50 cm /Scan Do Q')));
  fs.writeFileSync(file, await doc.save());
}

const launch = async (args = []) => {
  const app = await electron.launch({
    executablePath: usePackaged ? packagedExe : electronBinary,
    args: [...(usePackaged ? [] : [desktopDir]), `--user-data-dir=${profile}`, ...args],
    cwd: work,
  });
  currentApp = app;
  const win = await app.firstWindow();
  const problems = [];
  win.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  win.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  win.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  win.on('dialog', (d) => d.accept());
  await win.waitForLoadState('domcontentloaded');
  return { app, win, problems };
};

const title = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
const settings = () => JSON.parse(fs.readFileSync(path.join(profile, 'pdf-studio-settings.json'), 'utf-8'));
const waitFor = async (fn, timeout = 15000) => {
  const start = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // retry
    }
    if (Date.now() - start > timeout) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
};
const pressShortcut = (win, key) => win.keyboard.press(key);
const clickMenu = (app, label) =>
  app.evaluate(({ Menu }, wanted) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const inner = item.submenu && find(item.submenu.items);
        if (inner) return inner;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu().items);
    if (!item) throw new Error(`menu item ${wanted} not found`);
    item.click();
  }, label);

const main = async () => {
  const fileA = path.join(docs, 'kniha s osnovou.pdf');
  const fileB = path.join(docs, 'druhy.pdf');
  await makePdf(fileA, 4, true);
  await makePdf(fileB, 1, false);
  const sizeA = fs.statSync(fileA).size;

  console.log('1. Start with a file on the command line');
  let { app, win, problems } = await launch([fileA]);
  check(await waitFor(async () => (await title(app)) === 'kniha s osnovou.pdf — PDF Studio'), `window title shows the file (${await title(app)})`);
  check(await waitFor(() => win.locator('aside [data-page-id]').count().then((n) => n === 4)), 'four page thumbnails');
  const s1 = settings();
  check(s1.recentFiles[0]?.path === fileA && s1.lastOpenFilePath === fileA, 'opened file recorded in recent files');
  check(['cs', 'en'].includes(s1.language), `language default from the system locale (${s1.language})`);

  console.log('2. Outline follows page edits');
  await win.getByRole('button', { name: /Osnova|Outline/ }).first().click();
  check(await waitFor(() => win.locator('aside').getByText('Chapter 3', { exact: true }).isVisible()), 'outline lists the chapters');
  await win.getByRole('button', { name: /Stránky|Pages/ }).first().click();
  // Delete page 1 with the Delete key and confirm
  await win.locator('aside [data-page-id]').first().click();
  await win.keyboard.press('Delete');
  await win.getByRole('button', { name: /^(Smazat|Delete|Odstranit)/ }).last().click();
  check(await waitFor(() => win.locator('aside [data-page-id]').count().then((n) => n === 3)), 'page 1 deleted');
  check(await waitFor(async () => (await title(app)).startsWith('● ')), 'title marks unsaved changes');
  await win.getByRole('button', { name: /Osnova|Outline/ }).first().click();
  const outline = win.locator('aside');
  const chapter1Row = await outline.getByText('Chapter 1', { exact: true }).locator('xpath=..').innerText();
  check(!/\d/.test(chapter1Row.replace('Chapter 1', '')), 'outline entry of the deleted page has no page number');
  const chapter3Row = await outline.getByText('Chapter 3', { exact: true }).locator('xpath=..').innerText();
  check(/\b2\b/.test(chapter3Row.replace('Chapter 3', '')), `outline "Chapter 3" shows its new page number 2 (${chapter3Row.replace(/\s+/g, ' ')})`);
  await outline.getByText('Chapter 3', { exact: true }).click();
  check(
    await waitFor(async () => /Strana 2 z 3|Page 2 of 3/.test((await win.locator('body').innerText()).replace(/\s+/g, ' '))),
    'clicking it goes to page 2 of 3'
  );
  await win.getByRole('button', { name: /Stránky|Pages/ }).first().click();

  console.log('3. Save overwrites in place after confirmation');
  await app.evaluate(({ dialog }) => {
    globalThis.__overwriteAsked = 0;
    dialog.showMessageBox = async () => {
      globalThis.__overwriteAsked++;
      return { response: 0, checkboxChecked: false };
    };
  });
  await pressShortcut(win, 'Control+S');
  check(await waitFor(async () => (await title(app)) === 'kniha s osnovou.pdf — PDF Studio'), 'title is clean after saving');
  check((await app.evaluate(() => globalThis.__overwriteAsked)) === 1, 'overwrite was confirmed once');
  const savedA = await PDFDocument.load(fs.readFileSync(fileA));
  check(savedA.getPageCount() === 3 && fs.statSync(fileA).size !== sizeA, 'file on disk has the 3 remaining pages');
  check(fs.readdirSync(docs).every((f) => !f.endsWith('.tmp')), 'no temporary files left next to the document');

  console.log('4. Save As writes a new file and switches to it');
  const fileC = path.join(docs, 'kopie.pdf');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, fileC);
  await clickMenu(app, (await win.evaluate(() => document.documentElement.lang)) === 'en' ? 'Save As…' : 'Uložit jako…');
  check(await waitFor(async () => (await title(app)) === 'kopie.pdf — PDF Studio'), 'title shows the new name');
  check(fs.existsSync(fileC) && settings().recentFiles[0].path === fileC, 'new file exists and leads the recent files');

  console.log('5. Unsaved changes are saved when closing with "Save"');
  await win.locator('aside button[title*="vpravo"], aside button[title*="right" i]').first().click();
  check(await waitFor(async () => (await title(app)).startsWith('● ')), 'rotation marks the document unsaved');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0; // "Save & close"
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  const closed = new Promise((resolve) => app.once('close', resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await Promise.race([closed, new Promise((r) => setTimeout(r, 15000))]);
  const rotated = await PDFDocument.load(fs.readFileSync(fileC));
  check(rotated.getPage(0).getRotation().angle === 90, 'the rotation was saved before the app closed');
  check(problems.length === 0, `no errors in the window${problems.length ? `: ${problems.join(' | ')}` : ''}`);

  console.log('6. Restart: last file reopened, settings kept');
  ({ app, win, problems } = await launch());
  check(await waitFor(async () => (await title(app)) === 'kopie.pdf — PDF Studio'), 'last file reopened on startup');
  // Switch the language and theme in the app; the shell stores them and relabels its menu
  await win.getByRole('button', { name: 'EN', exact: true }).click();
  await win.getByTitle(/Minimal/).first().click();
  check(await waitFor(() => settings().language === 'en' && settings().theme === 'minimal'), 'language and theme stored in the settings file');
  check(await waitFor(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label === 'File')), 'menu relabelled in English');

  console.log('7. Menu commands, Ctrl+O and recent files');
  await clickMenu(app, 'Find in Document…');
  check(await waitFor(() => win.getByPlaceholder(/Search|Hledat/).isVisible()), 'menu "Find" opens the search bar');
  await win.keyboard.type('needle');
  check(
    await waitFor(async () => /\b1 (of|z) 3\b/.test(await win.locator('body').innerText())),
    'search finds the word on the three pages'
  );
  await win.keyboard.press('Escape');
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, fileB);
  await pressShortcut(win, 'Control+O');
  check(await waitFor(async () => (await title(app)) === 'druhy.pdf — PDF Studio'), 'Ctrl+O opened the file picked in the dialog');
  await clickMenu(app, 'Close Document');
  check(await waitFor(() => win.getByText('Recent Files').isVisible()), 'start screen lists recent files');
  await win.getByRole('button', { name: /kopie\.pdf/ }).click();
  check(await waitFor(async () => (await title(app)) === 'kopie.pdf — PDF Studio'), 'recent file opened from the start screen');

  console.log('8. A scan with corrupt CCITT parameters is displayed');
  const scanFile = path.join(docs, 'scan.pdf');
  await makeBrokenScan(scanFile);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, scanFile);
  await pressShortcut(win, 'Control+O');
  check(await waitFor(async () => (await title(app)) === 'scan.pdf — PDF Studio'), 'scan opened');
  const darkCenter = await waitFor(() =>
    win.evaluate(() => {
      const canvas = document.querySelector('canvas[data-page-canvas]');
      if (!canvas || canvas.width < 10) return false;
      const ctx = canvas.getContext('2d');
      const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return r + g + b < 120;
    })
  );
  check(darkCenter, 'the black scanned square is drawn (it rendered white before the repair)');

  console.log('9. Settings: automatic file, backup and restore');
  const s9 = settings();
  check(s9.rasterSettings && s9.rasterSettings.scale > 0, 'raster settings are kept in the settings file');
  check(fs.existsSync(path.join(profile, 'pdf-studio-settings.json.bak')), 'last working copy of the settings file exists');
  const backupFile = path.join(work, 'zaloha.json');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, backupFile);
  await clickMenu(app, 'Back Up Settings & Signatures…');
  check(await waitFor(() => fs.existsSync(backupFile)), 'backup written through the native save dialog');
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
  check(
    backup.format === 'pdf-studio-backup' && backup.settings.theme === 'minimal' && backup.settings.language === 'en' && backup.app.edition === 'desktop',
    'backup holds the theme, language and edition'
  );
  // Change the theme, then restore the backup (the confirmation dialog is accepted)
  await win.getByTitle(/Studio \(/).first().click();
  check(await waitFor(() => settings().theme === 'default'), 'theme changed after the backup');
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, backupFile);
  await clickMenu(app, 'Restore Settings from Backup…');
  check(await waitFor(() => settings().theme === 'minimal'), 'restoring the backup brought the theme back');

  console.log('10. A file changed by another program is reloaded');
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, fileB);
  await pressShortcut(win, 'Control+O');
  check(await waitFor(async () => (await title(app)) === 'druhy.pdf — PDF Studio'), 'file opened');
  await new Promise((r) => setTimeout(r, 2500));
  await makePdf(fileB, 3, false); // another program saves a 3-page version
  check(
    await waitFor(() => win.locator('aside [data-page-id]').count().then((n) => n === 3), 15000),
    'the new 3-page version was loaded after confirming'
  );
  await app.evaluate(({ shell }) => {
    globalThis.__shown = [];
    shell.showItemInFolder = (p) => globalThis.__shown.push(p);
  });
  await clickMenu(app, 'Show in Folder');
  check((await app.evaluate(() => globalThis.__shown[0])) === fileB, '"Show in folder" reveals the opened file');

  console.log('11. External links open in the system browser');
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url);
    };
  });
  await clickMenu(app, 'About PDF Studio');
  await win.getByRole('button', { name: /GitHub/ }).click();
  const opened = await waitFor(() => app.evaluate(() => globalThis.__opened[0]));
  check(opened === 'https://github.com/richardLipka/pdf-studio', 'GitHub link handed to the system browser');
  check((await app.windows()).length === 1, 'no in-app browser window was opened');
  check(problems.length === 0, `no errors in the window${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  await app.close();

  console.log(failures === 0 ? '\nDesktop e2e: all checks passed' : `\nDesktop e2e: ${failures} check(s) failed`);
};

try {
  await main();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await currentApp?.close().catch(() => {});
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(failures === 0 ? 0 : 1);
