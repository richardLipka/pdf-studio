// Builds the desktop edition into desktop/build:
//   build/web       the web app (vite build of the repository root, verified to be self-contained)
//   build/main.cjs  Electron main process, build/preload.cjs preload script (esbuild bundles)
// Usage: node scripts/build.mjs [--skip-web] [--dev]
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const outDir = path.join(desktopDir, 'build');
const args = new Set(process.argv.slice(2));
const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

fs.mkdirSync(outDir, { recursive: true });

if (!args.has('--skip-web')) {
  console.log('[desktop] Building the web app...');
  run('npm run build', repoRoot);
  run('npm run verify:dist', repoRoot);
}

const webSource = path.join(repoRoot, 'dist');
if (!args.has('--dev')) {
  if (!fs.existsSync(path.join(webSource, 'index.html'))) {
    console.error('[desktop] dist/index.html is missing: run the build without --skip-web first');
    process.exit(1);
  }
  fs.rmSync(path.join(outDir, 'web'), { recursive: true, force: true });
  fs.cpSync(webSource, path.join(outDir, 'web'), { recursive: true });
}

// Window / taskbar icon (the installer icon comes from resources/ through electron-builder)
const icon = path.join(desktopDir, 'resources', 'icon.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(outDir, 'icon.png'));

console.log('[desktop] Bundling the main process and the preload script...');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [path.join(desktopDir, 'electron/main.ts')], outfile: path.join(outDir, 'main.cjs') });
await build({ ...common, entryPoints: [path.join(desktopDir, 'electron/preload.ts')], outfile: path.join(outDir, 'preload.cjs') });
console.log('[desktop] Build ready in desktop/build');
