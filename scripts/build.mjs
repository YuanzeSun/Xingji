import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { extensionArchive } from './package-extension.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist');
if (relative(root, out) !== 'dist') throw new Error('Refusing to clean outside the build directory');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
await cp(join(root, 'LICENSE'), join(out, 'LICENSE'));
await mkdir(join(out, 'licenses'), { recursive: true });
for (const name of ['SOARING-SYMBOLS-MIT.txt', 'airline-logos.json']) await cp(join(root, 'licenses', name), join(out, 'licenses', name));
await mkdir(join(out, 'downloads'), { recursive: true });
await writeFile(join(out, 'downloads/xingji-variflight-extension.zip'), await extensionArchive(root));
await mkdir(join(out, 'src'), { recursive: true });
const styles = await readFile(join(root, 'src/styles.css'));
const cssPath = `src/styles-${createHash('sha256').update(styles).digest('hex').slice(0, 12)}.css`;
await writeFile(join(out, cssPath), styles);
const bundled = await build({ entryPoints: [join(root, 'src/app.js')], bundle: true, splitting: true, format: 'esm', outdir: join(out, 'src'), entryNames: '[name]-[hash]', metafile: true, minify: true, target: 'es2022', chunkNames: 'chunks/[name]-[hash]', logLevel: 'info' });
const entry = Object.entries(bundled.metafile.outputs).find(([, metadata]) => metadata.entryPoint && resolve(root, metadata.entryPoint) === join(root, 'src/app.js'));
if (!entry) throw new Error('Application entry point is missing from the build');
const appPath = relative(out, resolve(root, entry[0])).replaceAll('\\', '/');
const html = (await readFile(join(root, 'index.html'), 'utf8')).replace('./src/app.js', './' + appPath).replace('./src/styles.css', './' + cssPath);
await writeFile(join(out, 'index.html'), html);
await mkdir(join(out, 'vendor'), { recursive: true });
const copyVendorFile = (source, name) => cp(join(root, source), join(out, 'vendor', name));
await copyVendorFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'zxing_reader.wasm');
await copyVendorFile('node_modules/bwip-js/LICENSE', 'BWIP-JS-LICENSE.txt');
await copyVendorFile('node_modules/zxing-wasm/LICENSE', 'ZXING-WASM-LICENSE.txt');
await copyVendorFile('licenses/ZXING-CPP-LICENSE.txt', 'ZXING-CPP-LICENSE.txt');
await copyVendorFile('node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js');
const core = join(root, 'node_modules/tesseract.js-core');
for (const file of await readdir(core)) if (file.endsWith('.wasm') || file.endsWith('.wasm.js')) await cp(join(core, file), join(out, 'vendor', file));
await copyVendorFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs');
await cp(join(root, 'node_modules/pdfjs-dist/cmaps'), join(out, 'vendor/cmaps'), { recursive: true });
await cp(join(root, 'node_modules/pdfjs-dist/standard_fonts'), join(out, 'vendor/standard_fonts'), { recursive: true });
for (const [name, source] of [['FFLATE-LICENSE.txt', 'node_modules/fflate/LICENSE'], ['PDF-LIB-LICENSE.txt', 'node_modules/pdf-lib/LICENSE.md'], ['TESSERACT-LICENSE.txt', 'node_modules/tesseract.js/LICENSE.md'], ['TESSERACT-CORE-LICENSE.txt', 'node_modules/tesseract.js-core/LICENSE'], ['PDFJS-LICENSE.txt', 'node_modules/pdfjs-dist/LICENSE']]) {
  await copyVendorFile(source, name);
}
async function files(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) result.push(...await files(p));
    else result.push('./' + relative(out, p).replaceAll('\\', '/'));
  }
  return result;
}
const shell = (await files(out)).filter(p => !p.startsWith('./vendor/') && !p.startsWith('./ocr/') && !p.endsWith('sw.js'));
const hash = createHash('sha256');
for (const file of shell) hash.update(await readFile(join(out, file)));
const version = hash.digest('hex').slice(0, 12);
const sw = (await readFile(join(root, 'src/sw.template.js'), 'utf8')).replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell));
await writeFile(join(out, 'sw.js'), sw);
console.log(`Built ${shell.length} offline app files (${version}). OCR assets are cached when first used.`);
