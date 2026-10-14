// Renders the web app's favicon (public/favicon.svg) into resources/icon.png (512 px), the source of
// the window, taskbar and installer icons. Run with Electron: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(desktopDir, '..', 'public', 'favicon.svg'), 'utf-8');
const size = 512;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace(
    '<svg ',
    `<svg width="${size}" height="${size}" `
  )}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.mkdirSync(path.join(desktopDir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(desktopDir, 'resources', 'icon.png'), image.resize({ width: size, height: size }).toPNG());
  console.log('resources/icon.png written');
  app.quit();
});
