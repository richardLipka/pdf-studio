const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const outDir = path.resolve(__dirname, '../dist-electron');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function build() {
  console.log('[build-electron] Compiling main & preload processes...');
  try {
    // 1. Build main process
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../electron/main.ts')],
      outfile: path.join(outDir, 'main.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      external: ['electron'],
      sourcemap: true,
    });

    // 2. Build preload script
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../electron/preload.ts')],
      outfile: path.join(outDir, 'preload.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      external: ['electron'],
      sourcemap: true,
    });

    console.log('[build-electron] Build succeeded.');
  } catch (err) {
    console.error('[build-electron] Build failed:', err);
    process.exit(1);
  }
}

build();
