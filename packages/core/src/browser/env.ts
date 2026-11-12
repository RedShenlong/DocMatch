import type { CanvasLike, Env, OcrEngine, PdfJsLike, VisionEngine } from '../env';

/**
 * Entorno de navegador: todo se carga bajo demanda desde `assetsPath` (alojable en el servidor del
 * dueño de la web). Nada sale del dispositivo: las únicas peticiones son a esos recursos y al perfil.
 */

let currentScriptDir = '';
try {
  const cs = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
  if (cs?.src) currentScriptDir = cs.src.replace(/[^/]*$/, '');
} catch {
  /* sin DOM */
}

export function defaultAssetsPath(): string {
  if (currentScriptDir) return `${currentScriptDir}assets/`;
  try {
    return new URL('./assets/', import.meta.url).href;
  } catch {
    return '/docmatch/assets/';
  }
}

const dynImport = (url: string) => import(/* @vite-ignore */ url);

export function createCanvas(w: number, h: number): CanvasLike {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h) as unknown as CanvasLike;
}

async function canvasToBlob(c: CanvasLike): Promise<Blob> {
  const anyC = c as unknown as {
    toBlob?: (cb: (b: Blob | null) => void, t?: string) => void;
    convertToBlob?: (o?: unknown) => Promise<Blob>;
  };
  if (anyC.convertToBlob) return anyC.convertToBlob({ type: 'image/png' });
  return new Promise((res, rej) => anyC.toBlob!((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

export interface BrowserEnvOptions {
  assetsPath?: string;
}

const cache = new Map<string, Env>();

export function browserEnv(o: BrowserEnvOptions = {}): Env {
  const base = (o.assetsPath ?? defaultAssetsPath()).replace(/\/?$/, '/');
  const hit = cache.get(base);
  if (hit) return hit;
  let pdfP: Promise<PdfJsLike> | undefined;
  let ocrP: Promise<OcrEngine> | undefined;
  let visP: Promise<VisionEngine | null> | undefined;
  const env: Env = {
    pdfjs: () =>
      (pdfP ??= dynImport(`${base}pdfjs/pdf.min.mjs`).then(
        (m: PdfJsLike & { GlobalWorkerOptions: { workerSrc: string } }) => {
          m.GlobalWorkerOptions.workerSrc = `${base}pdfjs/pdf.worker.min.mjs`;
          return m;
        },
      )),
    pdfOptions: {
      standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
      cMapUrl: `${base}pdfjs/cmaps/`,
      cMapPacked: true,
      isEvalSupported: false,
      // Nunca se descarga nada en nombre del PDF (fuentes remotas, etc.).
      disableAutoFetch: true,
      disableStream: true,
    },
    createCanvas,
    ocr: () =>
      (ocrP ??= (async () => {
        const mod = (await dynImport(`${base}tesseract/tesseract.esm.min.js`)) as Record<string, unknown> & {
          default?: unknown;
        };
        const T = (typeof mod.createWorker === 'function' ? mod : mod.default) as {
          createWorker: (
            lang: string,
            oem: number,
            o: Record<string, unknown>,
          ) => Promise<{
            setParameters(p: Record<string, string>): Promise<unknown>;
            recognize(
              img: Blob,
              o?: unknown,
              out?: unknown,
            ): Promise<{
              data: {
                words?: {
                  text: string;
                  confidence: number;
                  bbox: { x0: number; y0: number; x1: number; y1: number };
                }[];
                confidence: number;
              };
            }>;
            terminate(): Promise<unknown>;
          }>;
        };
        const w = await T.createWorker('spa', 1, {
          workerPath: `${base}tesseract/worker.min.js`,
          corePath: `${base}tesseract/`,
          langPath: `${base}tessdata/`,
          gzip: false,
          // Cachea los datos de idioma en IndexedDB del propio navegador.
          cacheMethod: 'write',
        });
        await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '11' });
        return {
          async recognize(canvas: CanvasLike) {
            const { data } = await w.recognize(await canvasToBlob(canvas), {}, { blocks: true });
            return {
              words: (data.words ?? []).map((x) => ({ text: x.text, conf: x.confidence, bbox: x.bbox })),
              confidence: data.confidence,
            };
          },
          terminate: async () => {
            await w.terminate();
          },
        };
      })()),
    vision: () =>
      (visP ??= (async () => {
        try {
          return await workerVision(base);
        } catch (e) {
          console.warn('[docmatch] modelo visual no disponible:', e);
          return null;
        }
      })()),
    fetchJson: async (url) => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    },
  };
  cache.set(base, env);
  return env;
}

/** Motor de visión en un Web Worker (onnxruntime-web; WebGPU si está disponible, si no WASM). */
async function workerVision(base: string): Promise<VisionEngine | null> {
  const meta = await fetch(`${base}model/model.json`).then((r) => (r.ok ? r.json() : null));
  if (!meta) return null;
  const worker = new Worker(`${base}docmatch-vision.worker.js`, { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { res: (v: unknown) => void; rej: (e: unknown) => void }>();
  worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; data?: unknown; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.res(ev.data.data);
    else p.rej(new Error(ev.data.error));
  };
  const call = <T>(type: string, payload?: unknown, transfer: Transferable[] = []) =>
    new Promise<T>((res, rej) => {
      const id = ++seq;
      pending.set(id, { res: res as (v: unknown) => void, rej });
      worker.postMessage({ id, type, payload }, transfer);
    });
  await call('init', { base, meta });
  let neg: { labels: string[]; vectors: Float32Array[] } | null | undefined;
  return {
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
    input: { width: meta.input.width, height: meta.input.height },
    embed: (pixels) => call<Float32Array>('embed', pixels, [pixels.buffer]),
    negatives: async () => (neg !== undefined ? neg : (neg = (await call<typeof neg>('negatives')) ?? null)),
  };
}
