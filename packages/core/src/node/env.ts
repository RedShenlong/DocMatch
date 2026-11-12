/**
 * Entorno Node para DocMatch (tests, CLI del builder, uso en servidor).
 * Requiere: pdfjs-dist, @napi-rs/canvas, tesseract.js y (opcional) onnxruntime-web.
 */
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Env, OcrEngine, PdfJsLike, VisionEngine } from '../env';
import { createOrtVision } from '../vision/ort';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
export const CORE_ASSETS = join(HERE, '../../assets');

class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc: { canvas: Canvas }, width: number, height: number) {
    cc.canvas.width = Math.max(1, width);
    cc.canvas.height = Math.max(1, height);
  }
  destroy(cc: { canvas: Canvas | null; context: unknown }) {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

let pdfjsP: Promise<PdfJsLike> | undefined;
async function loadPdfjs(): Promise<PdfJsLike> {
  pdfjsP ??= (async () => {
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike & {
      GlobalWorkerOptions: { workerSrc: string };
    };
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    return lib;
  })();
  return pdfjsP;
}

export interface NodeEnvOptions {
  /** Carpeta con spa.traineddata (por defecto packages/core/assets/tessdata). */
  tessdata?: string;
  /** Carpeta con model.onnx + model.json (+ negatives.json). Si no existe, no hay modelo visual. */
  modelDir?: string;
  ocr?: boolean;
  vision?: boolean;
}

let ocrWorker: Promise<OcrEngine> | undefined;

export function nodeEnv(o: NodeEnvOptions = {}): Env {
  if (process.env.DOCMATCH_DEBUG) (globalThis as { DOCMATCH_DEBUG?: unknown }).DOCMATCH_DEBUG = true;
  const pdfBase = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
  const modelDir = o.modelDir ?? join(CORE_ASSETS, 'model');
  let visionP: Promise<VisionEngine | null> | undefined;
  return {
    pdfjs: loadPdfjs,
    pdfOptions: {
      standardFontDataUrl: `${pdfBase}standard_fonts/`,
      cMapUrl: `${pdfBase}cmaps/`,
      cMapPacked: true,
      CanvasFactory: NapiCanvasFactory,
    },
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<Env['createCanvas']>,
    ocr:
      o.ocr === false
        ? undefined
        : () =>
            (ocrWorker ??= (async () => {
              const T = await import('tesseract.js');
              const w = await T.createWorker('spa', 1, {
                langPath: o.tessdata ?? join(CORE_ASSETS, 'tessdata'),
                gzip: false,
                cacheMethod: 'none',
              });
              await w.setParameters({
                preserve_interword_spaces: '1',
                tessedit_pageseg_mode: process.env.DOCMATCH_PSM ?? '11',
              } as unknown as Record<string, string>);
              return {
                async recognize(canvas) {
                  const png = (canvas as unknown as Canvas).toBuffer('image/png');
                  const { data } = await w.recognize(png, {}, { blocks: true });
                  const words = (data.words ?? []).map((x) => ({
                    text: x.text,
                    conf: x.confidence,
                    bbox: x.bbox,
                  }));
                  return { words, confidence: data.confidence };
                },
                terminate: async () => {
                  await w.terminate();
                },
              };
            })()),
    vision:
      o.vision === false
        ? undefined
        : () =>
            (visionP ??= (async () => {
              if (!existsSync(join(modelDir, 'model.json'))) return null;
              const ort = await import('onnxruntime-web');
              ort.env.wasm.numThreads = 1;
              const meta = JSON.parse(readFileSync(join(modelDir, 'model.json'), 'utf8'));
              const bytes = new Uint8Array(readFileSync(join(modelDir, meta.file ?? 'model.onnx')));
              const negPath = join(modelDir, 'negatives.json');
              const neg = existsSync(negPath) ? JSON.parse(readFileSync(negPath, 'utf8')) : null;
              return createOrtVision(ort as never, bytes, meta, neg);
            })()),
    fetchJson: async (url) =>
      JSON.parse(readFileSync(url.startsWith('file:') ? fileURLToPath(url) : url, 'utf8')),
  };
}

export async function terminateOcr(): Promise<void> {
  if (ocrWorker) {
    const w = await ocrWorker;
    ocrWorker = undefined;
    await w.terminate?.();
  }
}
