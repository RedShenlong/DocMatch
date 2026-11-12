import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** pdf.js (build "legacy") + @napi-rs/canvas para renderizar PDFs en Node. */
const require = createRequire(import.meta.url);

type PdfJs = typeof import('pdfjs-dist');
let pdfjsP: Promise<PdfJs> | undefined;

export function loadPdfjs(): Promise<PdfJs> {
  pdfjsP ??= (async () => {
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    return lib;
  })();
  return pdfjsP;
}

export function pdfjsAssetDirs() {
  const base = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
  return { standardFontDataUrl: `${base}standard_fonts/`, cMapUrl: `${base}cmaps/` };
}

/** Factoría de canvas para pdf.js basada en @napi-rs/canvas (evita mezclar con node-canvas). */
export class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc: { canvas: Canvas }, width: number, height: number) {
    cc.canvas.width = Math.max(1, width);
    cc.canvas.height = Math.max(1, height);
  }
  destroy(cc: { canvas: Canvas | null; context: unknown }) {
    if (cc.canvas) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    }
    cc.canvas = null;
    cc.context = null;
  }
}

export async function openPdf(data: Uint8Array) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data: data.slice(),
    ...pdfjsAssetDirs(),
    cMapPacked: true,
    verbosity: 0,
    CanvasFactory: NapiCanvasFactory,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
}

/** Renderiza cada página a un canvas con el DPI indicado (fondo blanco). */
export async function renderPdfPages(data: Uint8Array, dpi = 150): Promise<Canvas[]> {
  const doc = await openPdf(data);
  const out: Canvas[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
    out.push(canvas);
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export const makeCanvas = (w: number, h: number) => createCanvas(w, h);
