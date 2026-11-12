// Copia a dist/assets/ todo lo que el runtime carga bajo demanda, para alojarlo en el propio servidor:
// pdf.js (+ fuentes estándar y cmaps), tesseract.js (+ núcleo WASM + datos en español),
// onnxruntime-web (WASM) y el modelo visual con su banco de negativos.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../dist/assets');
const pkgDir = (name) => {
  let d = dirname(require.resolve(name));
  while (!existsSync(join(d, 'package.json')) || !d.includes(name.split('/').pop())) d = dirname(d);
  return d;
};
mkdirSync(out, { recursive: true });

const pdf = pkgDir('pdfjs-dist');
mkdirSync(join(out, 'pdfjs'), { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) cpSync(join(pdf, 'build', f), join(out, 'pdfjs', f));
cpSync(join(pdf, 'standard_fonts'), join(out, 'pdfjs/standard_fonts'), { recursive: true });
cpSync(join(pdf, 'cmaps'), join(out, 'pdfjs/cmaps'), { recursive: true });

const tess = pkgDir('tesseract.js');
mkdirSync(join(out, 'tesseract'), { recursive: true });
for (const f of ['tesseract.esm.min.js', 'worker.min.js'])
  cpSync(join(tess, 'dist', f), join(out, 'tesseract', f));
const core = pkgDir('tesseract.js-core');
for (const f of readdirSync(core))
  if (/^tesseract-core(-simd)?-lstm\.(js|wasm|wasm\.js)$/.test(f))
    cpSync(join(core, f), join(out, 'tesseract', f));
cpSync(join(here, '../assets/tessdata'), join(out, 'tessdata'), { recursive: true });

const ort = pkgDir('onnxruntime-web');
mkdirSync(join(out, 'ort'), { recursive: true });
for (const f of readdirSync(join(ort, 'dist')))
  if (
    process.env.DOCMATCH_WEBGPU
      ? /^ort\.(wasm|webgpu)\.min\.mjs$|^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f)
      : /^ort\.wasm\.min\.mjs$|^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)
  )
    cpSync(join(ort, 'dist', f), join(out, 'ort', f));

const model = join(here, '../assets/model');
if (existsSync(join(model, 'model.json'))) cpSync(model, join(out, 'model'), { recursive: true });
else console.warn('Aviso: no hay modelo en assets/model (el reconocimiento visual quedará desactivado).');
console.log('assets →', out);
