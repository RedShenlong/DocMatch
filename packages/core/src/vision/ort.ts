import type { VisionEngine } from '../env';
import { decodeF16 } from './tensor';

/** Metadatos del modelo (model.json, junto a model.onnx). */
export interface ModelMeta {
  modelId: string;
  modelVersion: string;
  input: { width: number; height: number; name?: string };
  output?: { name?: string; dim?: number };
  /** Archivo del modelo dentro de la carpeta (por defecto model.onnx). */
  file?: string;
}

export interface NegativeBank {
  modelId: string;
  modelVersion: string;
  labels: string[];
  /** Vectores en base64 float16. */
  vectors: string[];
}

interface OrtLike {
  InferenceSession: { create(b: Uint8Array | ArrayBuffer, o?: unknown): Promise<OrtSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}

/** Motor de visión sobre onnxruntime-web (sirve en Node, en el hilo principal o en un Worker). */
export async function createOrtVision(
  ort: OrtLike,
  model: Uint8Array | ArrayBuffer,
  meta: ModelMeta,
  neg: NegativeBank | null,
  providers: string[] = ['wasm'],
): Promise<VisionEngine> {
  const session = await ort.InferenceSession.create(model, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
  });
  const inName = meta.input.name ?? session.inputNames[0]!;
  const outName = meta.output?.name ?? session.outputNames[0]!;
  const { width, height } = meta.input;
  let negDecoded: { labels: string[]; vectors: Float32Array[] } | null | undefined;
  return {
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
    input: { width, height },
    async embed(pixels) {
      const t = new ort.Tensor('float32', pixels, [1, 1, height, width]);
      const out = await session.run({ [inName]: t });
      return new Float32Array(out[outName]!.data);
    },
    async negatives() {
      if (negDecoded === undefined) {
        negDecoded =
          neg && neg.modelId === meta.modelId && neg.modelVersion === meta.modelVersion
            ? { labels: neg.labels, vectors: neg.vectors.map(decodeF16) }
            : null;
      }
      return negDecoded;
    },
  };
}
