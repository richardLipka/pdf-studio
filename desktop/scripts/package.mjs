// Packages desktop/build with electron-builder into desktop/release. The version always comes from
// the repository's package.json, so both editions carry the same version number.
// Usage: node scripts/package.mjs [--dir | nsis | portable | zip ...]
import builder from 'electron-builder';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(desktopDir, '..', 'package.json'), 'utf-8'));
const args = process.argv.slice(2);
const dirOnly = args.includes('--dir');
const targets = args.filter((a) => !a.startsWith('--'));

if (!fs.existsSync(path.join(desktopDir, 'build', 'main.cjs')) || !fs.existsSync(path.join(desktopDir, 'build', 'web', 'index.html'))) {
  console.error('[desktop] desktop/build is incomplete: run "npm run build" in desktop/ first');
  process.exit(1);
}

const platformTargets =
  process.platform === 'win32'
    ? builder.Platform.WINDOWS.createTarget(dirOnly ? ['dir'] : targets.length > 0 ? targets : undefined)
    : process.platform === 'darwin'
    ? builder.Platform.MAC.createTarget(dirOnly ? ['dir'] : targets.length > 0 ? targets : undefined)
    : builder.Platform.LINUX.createTarget(dirOnly ? ['dir'] : targets.length > 0 ? targets : undefined);

await builder.build({
  projectDir: desktopDir,
  targets: platformTargets,
  publish: 'never',
  config: {
    extraMetadata: { version: rootPackage.version },
  },
});
console.log(`[desktop] Packages for version ${rootPackage.version} are in desktop/release`);
