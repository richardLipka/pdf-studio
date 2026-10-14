// Development: the vite dev server of the web app (hot reload) inside the Electron window.
// Usage: npm run dev (in desktop/)
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const port = Number(process.env.PORT || 3000);
const url = `http://localhost:${port}`;
const isWindows = process.platform === 'win32';

execSync('node scripts/build.mjs --skip-web --dev', { cwd: desktopDir, stdio: 'inherit' });

const vite = spawn(isWindows ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: isWindows,
});

const waitForServer = () =>
  new Promise((resolve) => {
    const ping = () =>
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => setTimeout(ping, 300));
    ping();
  });

await waitForServer();
const electronBinary = (await import('electron')).default;
const electron = spawn(electronBinary, ['.'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const stop = () => {
  vite.kill();
  electron.kill();
};
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
