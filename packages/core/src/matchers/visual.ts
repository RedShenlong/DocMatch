import type { GrayImage } from '../doc';
import type { Affine } from '../geometry/affine';
import type { RelBox } from '../profile/types';
import type { VisionEngine } from '../env';
import { dhash, hashSimilarity, sampleRegion } from '../image';
import type { Profile } from '../profile/types';
import { cosine, decodeF16, decodeF32, l2norm, pageTensor, project } from '../vision/tensor';
import type { MatchSignal } from './types';

/** Hash perceptual: señal rápida y barata de parecido visual global. */
export function phashSignal(profile: Profile, pages: GrayImage[]): MatchSignal | null {
  const vp = profile.visual?.pages;
  if (!vp?.length || !pages.length) return null;
  let s = 0;
  const n = Math.min(vp.length, pages.length);
  for (let i = 0; i < n; i++) s += hashSimilarity(dhash(pages[i]!), vp[i]!.dhash);
  const sim = s / n;
  // Dos documentos con fondo blanco ya comparten ~60 % de bits: se reescala.
  return { id: 'phash', score: Math.max(0, Math.min(1, (sim - 0.62) / 0.3)), confidence: 0.6 };
}

export interface Embedded {
  raw: Float32Array;
}

/** Calcula los embeddings de las páginas (una sola vez por documento y modelo). */
export async function embedPages(engine: VisionEngine, pages: GrayImage[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (const p of pages)
    out.push(l2norm(await engine.embed(pageTensor(p, engine.input.width, engine.input.height))));
  return out;
}

/** Señal del modelo visual: similitud con los prototipos de la plantilla frente al banco de negativos. */
export function visionSignal(
  profile: Profile,
  embs: Float32Array[],
  engine: VisionEngine,
  negatives: { labels: string[]; vectors: Float32Array[] } | null,
): MatchSignal | null {
  const v = profile.visual;
  if (!v || !embs.length) return null;
  if (v.modelId !== engine.modelId || v.modelVersion !== engine.modelVersion) return null;
  const head = v.head;
  const W = head ? decodeF32(head.weights) : null;
  let simSum = 0;
  let negBest = -1;
  let negLabel = '';
  const n = Math.min(embs.length, v.pages.length);
  for (let i = 0; i < n; i++) {
    const e = embs[i]!;
    let best = -1;
    if (head && W) {
      const z = project(W, head.inDim, head.outDim, e);
      for (const p of head.prototypes[i] ?? []) best = Math.max(best, cosine(z, decodeF16(p)));
    } else {
      for (const p of v.pages[i]!.prototypes) best = Math.max(best, cosine(e, decodeF16(p)));
    }
    simSum += best;
    if (negatives && i === 0) {
      negatives.vectors.forEach((nv, k) => {
        const s = cosine(e, nv);
        if (s > negBest) {
          negBest = s;
          negLabel = negatives.labels[k]!;
        }
      });
    }
  }
  const sim = simSum / n;
  const [lo, hi] = v.simRange ?? [0.5, 0.9];
  const score = Math.max(0, Math.min(1, (sim - lo) / Math.max(1e-3, hi - lo)));
  return { id: 'vision', score, confidence: 1, details: { sim, negBest, negLabel } };
}

/** Embedding de un recorte (región de un campo) encajado como si fuera una página. */
export async function embedCrop(
  engine: VisionEngine,
  img: GrayImage,
  box: RelBox,
  t: Affine,
): Promise<Float32Array> {
  const cw = Math.max(16, Math.round(box.w * img.width)),
    ch = Math.max(16, Math.round(box.h * img.height));
  const crop = sampleRegion(img, box, t, cw, ch);
  return l2norm(
    await engine.embed(
      pageTensor(
        { width: cw, height: ch, data: Uint8Array.from(crop) },
        engine.input.width,
        engine.input.height,
      ),
    ),
  );
}
