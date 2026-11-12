import { makeSegment, union, type DocData, type Segment } from '../doc';
import { ransacAffine, IDENTITY, type Affine, type Pt } from '../geometry/affine';
import type { Anchor, Profile, RelBox } from '../profile/types';
import { containment, levRatio, trigrams } from '../text/fuzzy';
import type { MatchSignal } from './types';

export interface AnchorCandidate {
  anchor: number;
  page: number;
  sim: number;
  box: RelBox;
}

export interface PageAlignment {
  /** Página del documento que corresponde a la página `page` de la plantilla. */
  docPage: number;
  t: Affine;
  inlierRatio: number;
  rmse: number;
  n: number;
}

export interface AnchorResult {
  coverage: number;
  distinctive: number;
  layout: number;
  /** Mejor coincidencia aceptada por ancla (−1 si no se encontró). */
  hits: (AnchorCandidate | null)[];
  /** Transformación por página de la plantilla. */
  align: (PageAlignment | null)[];
  signals: MatchSignal[];
}

export const anchorWeight = (a: Anchor) =>
  a.weight ?? Math.min(3, 0.4 + a.norm.length / 25) * (a.distinctive ? 2 : 1);

const center = (b: RelBox): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Busca el ancla en un segmento, también como subsecuencia de palabras (el OCR une etiqueta y valor). */
function bestInSegment(a: Anchor, s: Segment): { sim: number; box: RelBox } {
  const aw = a.norm.split(' ').length;
  let best = { sim: levRatio(a.norm, s.fold), box: s.box };
  if (s.words.length > aw) {
    for (let k = Math.max(1, aw - 1); k <= aw + 1; k++) {
      for (let i = 0; i + k <= s.words.length; i++) {
        const sub = makeSegment(s.words.slice(i, i + k));
        const sim = levRatio(a.norm, sub.fold);
        if (sim > best.sim) best = { sim, box: union(sub.words.map((w) => w.box)) };
      }
    }
  }
  return best;
}

/** Candidatos (hasta 3) para cada ancla del perfil en el documento. */
export function anchorCandidates(profile: Profile, doc: DocData, minSim: number): AnchorCandidate[][] {
  const samePages = doc.pages.length === profile.pageCount;
  return profile.anchors.map((a, ai) => {
    const tri = trigrams(a.norm);
    const pages = samePages ? [doc.pages[a.page]].filter(Boolean) : doc.pages;
    const pre: { s: Segment; page: number; q: number }[] = [];
    for (const p of pages) {
      for (const s of p!.segments) {
        const q = containment(tri, s.tri);
        if (q >= 0.45) pre.push({ s, page: p!.index, q });
      }
    }
    pre.sort((x, y) => y.q - x.q);
    const out: AnchorCandidate[] = [];
    for (const { s, page } of pre.slice(0, 6)) {
      const m = bestInSegment(a, s);
      if (m.sim >= minSim) out.push({ anchor: ai, page, sim: m.sim, box: m.box });
    }
    out.sort((x, y) => y.sim - x.sim);
    return out.slice(0, 3);
  });
}

/** Señales de anclas de texto y de coherencia de posiciones (layout). */
export function matchAnchors(profile: Profile, doc: DocData): AnchorResult {
  const th = profile.thresholds;
  const cands = anchorCandidates(profile, doc, th.anchorSim);
  const hits: (AnchorCandidate | null)[] = profile.anchors.map(() => null);
  const align: (PageAlignment | null)[] = [];
  let inl = 0,
    tot = 0,
    rm = 0;
  for (let p = 0; p < profile.pageCount; p++) {
    // Página del documento con más candidatos para esta página de la plantilla.
    const votes = new Map<number, number>();
    cands.forEach((cs, ai) => {
      if (profile.anchors[ai]!.page !== p) return;
      for (const c of cs)
        votes.set(c.page, (votes.get(c.page) ?? 0) + c.sim * anchorWeight(profile.anchors[ai]!));
    });
    const docPage = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (docPage === undefined) {
      align.push(null);
      continue;
    }
    const src: Pt[] = [],
      dst: Pt[] = [],
      w: number[] = [],
      ref: AnchorCandidate[] = [];
    cands.forEach((cs, ai) => {
      const a = profile.anchors[ai]!;
      if (a.page !== p) return;
      for (const c of cs) {
        if (c.page !== docPage) continue;
        src.push(center(a.box));
        dst.push(center(c.box));
        w.push(c.sim * anchorWeight(a));
        ref.push(c);
      }
    });
    const r = ransacAffine(src, dst, w, 0.02);
    if (!r) {
      align.push(null);
      continue;
    }
    r.inliers.forEach((ok, i) => {
      if (!ok) return;
      const c = ref[i]!;
      const prev = hits[c.anchor];
      if (!prev || c.sim > prev.sim) hits[c.anchor] = c;
    });
    const n = new Set(ref.map((c) => c.anchor)).size;
    align.push({ docPage, t: r.t, inlierRatio: r.inlierRatio, rmse: r.rmse, n });
    inl += r.inliers.filter(Boolean).length;
    tot += r.inliers.length;
    rm += r.rmse * r.inliers.length;
  }
  let sw = 0,
    sc = 0,
    dw = 0,
    dc = 0;
  profile.anchors.forEach((a, i) => {
    const w = anchorWeight(a);
    const h = hits[i];
    sw += w;
    sc += h ? w * h.sim : 0;
    if (a.distinctive) {
      dw += w;
      const need = a.norm.length < 16 ? 0.94 : 0.84;
      dc += h && h.sim >= need ? w * h.sim : 0;
    }
  });
  const coverage = sw ? sc / sw : 0;
  const distinctive = dw ? dc / dw : coverage;
  const rmse = tot ? rm / tot : 1;
  const layout = tot ? (inl / tot) * Math.exp(-rmse / 0.012) : 0;
  return {
    coverage,
    distinctive,
    layout,
    hits,
    align: align.map((a) => a ?? null),
    signals: [
      { id: 'anchors', score: coverage, confidence: 1 },
      { id: 'distinctive', score: distinctive, confidence: dw ? 1 : 0.5 },
      { id: 'layout', score: layout, confidence: tot >= 4 ? 1 : 0.4 },
    ],
  };
}

export const identityAlign = (docPage: number): PageAlignment => ({
  docPage,
  t: IDENTITY,
  inlierRatio: 0,
  rmse: 1,
  n: 0,
});
