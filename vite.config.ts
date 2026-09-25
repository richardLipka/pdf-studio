import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pdfjsDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/pdfjs-dist');
// Folders pdf.js fetches by file name at runtime: wasm image decoders (JPEG 2000, JBIG2) and color
// management, standard font data, CMaps and ICC profiles
const PDFJS_ASSET_DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
// The QuickJS engine is only used by pdf.js' PDF-JavaScript sandbox, which this app does not enable
const isExcludedAsset = (name: string) => name.startsWith('quickjs');

const contentTypeFor = (file: string): string =>
  file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';

/**
 * Serves the pdf.js runtime assets under /pdfjs/ during development and copies them into the build
 * output under pdfjs/ (see src/services/pdfjsAssets.ts).
 */
function pdfjsRuntimeAssets(): Plugin {
  return {
    name: 'pdfjs-runtime-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const relative = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(pdfjsDistDir, relative);
        const isAllowed =
          PDFJS_ASSET_DIRS.includes(relative.split('/')[0]) &&
          file.startsWith(pdfjsDistDir + path.sep) &&
          !isExcludedAsset(path.basename(file));
        if (!isAllowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', contentTypeFor(file));
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const sourceDir = path.join(pdfjsDistDir, dir);
        if (!fs.existsSync(sourceDir)) continue;
        for (const name of fs.readdirSync(sourceDir)) {
          const file = path.join(sourceDir, name);
          if (fs.statSync(file).isFile() && !isExcludedAsset(name)) {
            this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(file) });
          }
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), pdfjsRuntimeAssets()],
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs', 'pdf-lib', 'signature_pad']
  },
  server: {
    port: 3000,
    open: false
  }
});
