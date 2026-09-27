// Copies the third-party browser files the app needs from node_modules into
// public/vendor, so the frontend works fully offline (no CDN at the counter).
// Run after `npm install`:  npm run vendor
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

const files = [
  [nm('qrcode-generator', 'dist', 'qrcode.mjs'), out('qrcode.mjs')],
  [nm('jsbarcode', 'dist', 'JsBarcode.all.min.js'), out('JsBarcode.all.min.js')],
  [nm('html5-qrcode', 'html5-qrcode.min.js'), out('html5-qrcode.min.js')],
  [nm('@fontsource', 'cinzel', 'files', 'cinzel-latin-500-normal.woff2'), out('fonts', 'cinzel-500.woff2')],
  [nm('@fontsource', 'cinzel', 'files', 'cinzel-latin-600-normal.woff2'), out('fonts', 'cinzel-600.woff2')],
  [nm('@fontsource', 'cinzel', 'files', 'cinzel-latin-700-normal.woff2'), out('fonts', 'cinzel-700.woff2')],
  [nm('@fontsource-variable', 'manrope', 'files', 'manrope-latin-wght-normal.woff2'), out('fonts', 'manrope-latin.woff2')],
  [nm('@fontsource-variable', 'manrope', 'files', 'manrope-latin-ext-wght-normal.woff2'), out('fonts', 'manrope-latin-ext.woff2')],
  [nm('@fontsource', 'amiri', 'files', 'amiri-arabic-400-normal.woff2'), out('fonts', 'amiri-arabic-400.woff2')],
  [nm('@fontsource', 'amiri', 'files', 'amiri-arabic-700-normal.woff2'), out('fonts', 'amiri-arabic-700.woff2')],
  [nm('@fontsource', 'jetbrains-mono', 'files', 'jetbrains-mono-latin-500-normal.woff2'), out('fonts', 'jetbrains-mono-500.woff2')],
];

let copied = 0;
for (const [src, dst] of files) {
  if (!fs.existsSync(src)) {
    console.error('Missing:', path.relative(root, src), '- run `npm install` first.');
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
console.log(`Vendored ${copied}/${files.length} files into public/vendor`);
