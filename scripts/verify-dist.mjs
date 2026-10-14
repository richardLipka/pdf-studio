// Checks that the production build in dist/ is self-contained and location-independent, as both
// editions need it: GitHub Pages serves it under /pdf-studio/, the offline web bundle runs from any
// folder and the desktop edition loads it from file:// without a network connection.
// Usage: npm run build && npm run verify:dist
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, process.argv[2] || 'dist');
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const indexPath = path.join(dist, 'index.html');
check(fs.existsSync(indexPath), `missing ${indexPath} (run npm run build first)`);

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf-8');
  check(/src="\.\/assets\/index-[^"]+\.js"/.test(html), 'index.html must load the app script with a relative ./assets/ URL');
  check(/href="\.\/assets\/index-[^"]+\.css"/.test(html), 'index.html must load the stylesheet with a relative ./assets/ URL');
  const rootAbsolute = html.match(/(?:src|href)="\/[^/"][^"]*"/g) || [];
  check(rootAbsolute.length === 0, `root-absolute URLs break under /pdf-studio/ and file://: ${rootAbsolute.join(', ')}`);
  const remote = (html.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || []).concat(
    html.match(/<link[^>]+rel="stylesheet"[^>]+href="https?:\/\/[^"]+"/g) || []
  );
  check(remote.length === 0, `remote scripts/styles do not work offline: ${remote.join(', ')}`);
}

const assetsDir = path.join(dist, 'assets');
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
check(assets.some((f) => /^pdf\.worker.*\.mjs$/.test(f)), 'the pdf.js worker must be bundled into assets/');

// Root-absolute public files referenced from the bundle (e.g. "/fav-logo.svg") miss under /pdf-studio/
for (const file of assets.filter((f) => f.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
  const publicFiles = fs.readdirSync(path.join(root, 'public')).filter((f) => fs.statSync(path.join(root, 'public', f)).isFile());
  for (const name of publicFiles) {
    check(!code.includes(`"/${name}"`) && !code.includes(`'/${name}'`), `${file} references /${name} with a root-absolute URL`);
  }
}

const pdfjs = path.join(dist, 'pdfjs');
const list = (dir) => (fs.existsSync(path.join(pdfjs, dir)) ? fs.readdirSync(path.join(pdfjs, dir)) : []);
const fonts = list('standard_fonts');
for (const font of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf']) {
  check(fonts.includes(font), `pdfjs/standard_fonts/${font} is missing (text in non-embedded fonts would not render offline)`);
}
check(list('cmaps').length > 50, 'pdfjs/cmaps is missing or incomplete (CJK text)');
check(list('wasm').some((f) => f.includes('openjpeg')), 'pdfjs/wasm has no OpenJPEG decoder (JPEG 2000 images)');
check(list('iccs').length > 0, 'pdfjs/iccs is missing (colour profiles)');
check(!list('wasm').some((f) => f.startsWith('quickjs')), 'pdfjs/wasm should not ship the unused QuickJS sandbox');

if (failures.length > 0) {
  console.error(`verify-dist: ${failures.length} problem(s) in ${dist}`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-dist: ${dist} is self-contained (${assets.length} assets, ${fonts.length} standard fonts)`);
