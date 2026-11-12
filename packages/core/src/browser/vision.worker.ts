/// <reference lib="webworker" />
/**
 * Worker del modelo visual. Carga onnxruntime-web y el modelo desde `assetsPath`, los guarda con la
 * Cache API (la segunda visita no descarga nada) y calcula embeddings fuera del hilo principal.
 */
import { createOrtVision, type ModelMeta, type NegativeBank } from '../vision/ort';
import type { VisionEngine } from '../env';

declare const self: DedicatedWorkerGlobalScope;

const CACHE = 'docmatch-assets-v1';

async function cachedFetch(url: string): Promise<Response> {
  try {
    const c = await caches.open(CACHE);
    const hit = await c.match(url);
    if (hit) return hit;
    const r = await fetch(url);
    if (r.ok) await c.put(url, r.clone());
    return r;
  } catch {
    return fetch(url);
  }
}

let engine: VisionEngine | null = null;

self.onmessage = async (ev: MessageEvent<{ id: number; type: string; payload: unknown }>) => {
  const { id, type, payload } = ev.data;
  try {
    if (type === 'init') {
      const { base, meta } = payload as { base: string; meta: ModelMeta & { webgpuModel?: string } };
      // WebGPU si el navegador lo ofrece y el paquete webgpu está publicado; si falla, WASM.
      let useGpu = !!(navigator as unknown as { gpu?: unknown }).gpu && !!meta.webgpuModel;
      let ort;
      try {
        ort = await import(
          /* @vite-ignore */ `${base}ort/${useGpu ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`
        );
      } catch {
        useGpu = false;
        ort = await import(/* @vite-ignore */ `${base}ort/ort.wasm.min.mjs`);
      }
      ort.env.wasm.wasmPaths = `${base}ort/`;
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;
      const file = useGpu ? meta.webgpuModel! : (meta.file ?? 'model.onnx');
      const model = await (await cachedFetch(`${base}model/${file}?v=${meta.modelVersion}`)).arrayBuffer();
      const negR = await cachedFetch(`${base}model/negatives.json`).catch(() => null);
      const neg: NegativeBank | null = negR && negR.ok ? await negR.json() : null;
      try {
        engine = await createOrtVision(ort, model, meta, neg, useGpu ? ['webgpu', 'wasm'] : ['wasm']);
      } catch (e) {
        if (!useGpu) throw e;
        engine = await createOrtVision(ort, model, meta, neg, ['wasm']);
      }
      self.postMessage({ id, ok: true });
    } else if (type === 'embed') {
      const e = await engine!.embed(payload as Float32Array);
      self.postMessage({ id, ok: true, data: e }, [e.buffer]);
    } else if (type === 'negatives') {
      self.postMessage({ id, ok: true, data: await engine!.negatives!() });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e as Error)?.message ?? e) });
  }
};
