/**
 * Paso visual del builder (automático, sin intervención del dueño):
 *  1. Genera variantes sintéticas de la plantilla: vacía y rellena con datos ficticios (a máquina y a
 *     mano), con simulación de escaneo/fotocopia; y "primas" sintéticas (mismo diseño con otro título).
 *  2. Calcula los embeddings con el encoder congelado y crea prototipos por página.
 *  3. Entrena una cabeza lineal ligera (128→32) por aprendizaje métrico contra primas y banco de negativos.
 *  4. Entrena un clasificador "hay firma / no hay firma" sobre el encoder.
 *  5. Calibra umbrales (tinta de campos, similitud visual, fusión) con datos reservados de validación.
 */
import fontkit from '@pdf-lib/fontkit';
import {
  DEFAULT_CALIBRATION,
  FUSION_FEATURES,
  apply,
  cosine,
  encodeF16,
  encodeF32,
  fold,
  fuse,
  groupWords,
  inkRatio,
  l2norm,
  matchAnchors,
  openPdf,
  pageTensor,
  paperLevel,
  project,
  renderPage,
  textWords,
  toGray,
  dhash,
  hashSimilarity,
  type Affine,
  type DocData,
  type Env,
  type FusionWeights,
  type GrayImage,
  type PageData,
  type Profile,
  type VisionEngine,
  type Word,
  decodeF16 as decodeF16Local,
  decodeF32 as decodeF32Local,
  embedCrop,
} from 'docmatch/internal';
import {
  FOREIGN_KINDS,
  Rng,
  setHandFonts,
  degrade,
  fake,
  fillTemplate,
  randomScanParams,
  renderForeign,
  scanAffine,
  type CanvasLike as FxCanvas,
  type TemplateLayout,
} from '@docmatch/fixtures';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface VisualOptions {
  /** Variantes de relleno por página (cada una se degrada `scansPerFill` veces). */
  fills?: number;
  scansPerFill?: number;
  /** Primas sintéticas. */
  cousins?: number;
  seed?: number;
  /** Fuentes manuscritas (bytes) para simular relleno a mano. */
  handFonts?: Uint8Array[];
  onProgress?: (msg: string, frac: number) => void;
}

export interface VisualReport {
  positives: number;
  negatives: number;
  /** Tasas en validación (señal visual sola y fusión). */
  vision: { fpr: number; fnr: number; simRange: [number, number] };
  fusion: { digital: { fpr: number; fnr: number; n: number }; scan: { fpr: number; fnr: number; n: number } };
  fields: { fpr: number; fnr: number; n: number };
  signature?: { acc: number; n: number };
  estimatedAccuracy: number;
  seconds: number;
}

const OTHER_TITLES = [
  'SOLICITUD DE AYUDA ECONÓMICA',
  'DECLARACIÓN RESPONSABLE DE ACTIVIDAD',
  'INSTANCIA GENERAL',
  'SOLICITUD DE CERTIFICADO',
  'COMUNICACIÓN DE CAMBIO DE DOMICILIO',
  'SOLICITUD DE INSCRIPCIÓN',
  'RECLAMACIÓN ADMINISTRATIVA',
  'SOLICITUD DE SUBVENCIÓN',
  'AUTORIZACIÓN DE REPRESENTACIÓN',
  'SOLICITUD DE DEVOLUCIÓN',
  'ALTA EN EL SERVICIO',
  'SOLICITUD DE BAJA',
];

function layoutOf(p: Profile): TemplateLayout {
  return {
    pageCount: p.pageCount,
    pageSize: p.pages,
    fields: p.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      page: f.page,
      box: f.box,
    })),
  };
}

interface Variant {
  pdf: Uint8Array;
  filled: Set<string>;
  signed: boolean;
  kind: 'pos' | 'cousin';
}

async function makeVariants(
  template: Uint8Array,
  profile: Profile,
  o: Required<Pick<VisualOptions, 'fills' | 'cousins' | 'seed'>> & VisualOptions,
): Promise<Variant[]> {
  const r = new Rng(o.seed);
  if (o.handFonts?.length) setHandFonts(o.handFonts);
  const layout = layoutOf(profile);
  const out: Variant[] = [{ pdf: template, filled: new Set(), signed: false, kind: 'pos' }];
  for (let i = 0; i < o.fills; i++) {
    const hand = !!o.handFonts?.length && i % 2 === 1;
    const p = fake.person(r);
    const values: Record<string, string> = {};
    const filled = new Set<string>();
    for (const f of layout.fields) {
      if (f.type === 'signature') continue;
      if (r.bool(0.15)) continue; // campos que se dejan vacíos para calibrar la detección
      values[f.key] = f.type === 'checkbox' ? 'X' : fake.valueFor(f.type, f.key, r, p);
      filled.add(f.key);
    }
    const signed = r.bool(0.6);
    const doc = await PDFDocument.load(template);
    await fillTemplate(doc, layout, { values, mode: hand ? 'hand' : 'typed', signed, seed: o.seed + i * 13 });
    if (signed) for (const f of layout.fields) if (f.type === 'signature') filled.add(f.key);
    out.push({ pdf: await doc.save(), filled, signed, kind: 'pos' });
  }
  // Primas: se tapan las anclas distintivas y se escribe otro título/código/finalidad.
  const dist = profile.anchors.filter((a) => a.distinctive);
  for (let i = 0; i < o.cousins && dist.length; i++) {
    const doc = await PDFDocument.load(template);
    doc.registerFontkit(fontkit);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const title = r.pick(OTHER_TITLES);
    for (const a of dist) {
      const page = doc.getPage(a.page);
      const W = page.getWidth(),
        H = page.getHeight();
      const x = a.box.x * W,
        y = H - (a.box.y + a.box.h) * H,
        w = a.box.w * W,
        h = a.box.h * H;
      page.drawRectangle({ x: x - 1, y: y - 2, width: w + 2, height: h + 3, color: rgb(1, 1, 1) });
      const big = (a.weight ?? 1) >= 3;
      const text = big
        ? title
        : (a.weight ?? 1) >= 2
          ? `Modelo ${String.fromCharCode(65 + r.int(0, 25))}-${r.int(100, 999)}`
          : 'Mediante este impreso se solicita el trámite indicado conforme a la normativa vigente.';
      const font = big ? bold : reg;
      let size = h * 0.85;
      while (font.widthOfTextAtSize(text, size) > Math.max(w * 1.3, 120) && size > 5) size -= 0.5;
      page.drawText(text, { x, y: y + h * 0.15, size, font });
    }
    out.push({ pdf: await doc.save(), filled: new Set(), signed: false, kind: 'cousin' });
  }
  return out;
}

async function renderPdf(
  bytes: Uint8Array,
  env: Env,
  dpi: number,
): Promise<{ canvases: FxCanvas[]; pages: { words: Word[]; width: number; height: number }[] }> {
  const pdf = await openPdf(bytes, env);
  const canvases: FxCanvas[] = [];
  const pages: { words: Word[]; width: number; height: number }[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      canvases.push((await renderPage(pg, dpi / 72, env)) as unknown as FxCanvas);
      pages.push(await textWords(pg));
    }
  } finally {
    await pdf.destroy();
  }
  return { canvases, pages };
}

/** Simula el texto que leería un OCR: errores de carácter, palabras perdidas y desplazamientos. */
function noisyDoc(
  pages: { words: Word[]; width: number; height: number }[],
  r: Rng,
  cer: number,
  drop: number,
  t: Affine | null,
): DocData {
  const conf = ['o', '0', 'l', '1', 'i', 's', '5', 'e', 'c', 'n', 'm', 'rn'];
  const pd: PageData[] = pages.map((p, index) => {
    const words: Word[] = [];
    for (const w of p.words) {
      if (r.bool(drop)) continue;
      let text = '';
      // La letra grande (títulos) apenas tiene errores de OCR; la pequeña, más.
      const wcer = w.box.h > 0.014 ? cer * 0.15 : w.box.h > 0.011 ? cer * 0.5 : cer;
      for (const ch of w.text) {
        if (r.bool(wcer)) {
          const op = r.int(0, 2);
          if (op === 0) continue;
          text += op === 1 ? r.pick(conf) : ch + r.pick(conf);
        } else text += ch;
      }
      if (!text) continue;
      const c = t ? apply(t, { x: w.box.x, y: w.box.y }) : { x: w.box.x, y: w.box.y };
      words.push({
        text,
        conf: 70 + r.range(0, 30),
        box: { x: c.x + r.gauss() * 0.001, y: c.y + r.gauss() * 0.001, w: w.box.w, h: w.box.h },
      });
    }
    return {
      index,
      width: p.width,
      height: p.height,
      words,
      segments: groupWords(words, p.width / p.height, 1.8),
      source: 'ocr',
      rotation: 0,
    };
  });
  return {
    kind: 'scan',
    pages: pd,
    acro: [],
    hasDigitalSignature: false,
    textChars: 0,
    fullText: pd.map((p) => p.segments.map((s) => s.text).join('\n')).join('\n'),
  };
}

function kmeans(vs: Float32Array<ArrayBufferLike>[], k: number, r: Rng): Float32Array<ArrayBufferLike>[] {
  if (vs.length <= k) return vs.map((v) => l2norm(v));
  let cs: Float32Array<ArrayBufferLike>[] = r.sample(vs, k).map((v) => Float32Array.from(v));
  for (let it = 0; it < 15; it++) {
    const acc = cs.map(() => new Float32Array(vs[0]!.length));
    const n = cs.map(() => 0);
    for (const v of vs) {
      let bi = 0,
        bs = -2;
      cs.forEach((c, i) => {
        const s = cosine(v, c);
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      n[bi]!++;
      for (let j = 0; j < v.length; j++) acc[bi]![j]! += v[j]!;
    }
    cs = acc.map((a, i) => (n[i] ? l2norm(a) : cs[i]!));
  }
  return cs;
}

/** Cabeza lineal W (out×in) entrenada con pérdida logística sobre la similitud coseno con el centro. */
function trainHead(pos: Float32Array[], neg: Float32Array[], inDim: number, outDim: number, r: Rng) {
  const W = new Float32Array(outDim * inDim);
  for (let i = 0; i < W.length; i++) W[i] = r.gauss() / Math.sqrt(inDim);
  const lr = 0.05,
    alpha = 10,
    beta = 0.6;
  const data = [...pos.map((v) => ({ v, y: 1 })), ...neg.map((v) => ({ v, y: 0 }))];
  for (let ep = 0; ep < 60; ep++) {
    // Centro de positivos en el espacio proyectado.
    const cAcc = new Float32Array(outDim);
    for (const v of pos) {
      const z = project(W, inDim, outDim, v);
      for (let i = 0; i < outDim; i++) cAcc[i]! += z[i]!;
    }
    const c = l2norm(cAcc);
    const grad = new Float32Array(W.length);
    r.shuffle(data);
    for (const { v, y } of data) {
      // u = W v ; z = u/|u| ; s = z·c ; p = σ(α(s-β)) ; dL/ds = α(p-y)
      const u = new Float32Array(outDim);
      for (let i = 0; i < outDim; i++) {
        let s = 0;
        for (let j = 0; j < inDim; j++) s += W[i * inDim + j]! * v[j]!;
        u[i] = s;
      }
      const nu = Math.hypot(...u) || 1;
      let s = 0;
      for (let i = 0; i < outDim; i++) s += (u[i]! / nu) * c[i]!;
      const p = 1 / (1 + Math.exp(-alpha * (s - beta)));
      const g = alpha * (p - y) * (y ? 1 : 2); // los negativos pesan más (son los difíciles)
      // ds/du = (c - s·z)/|u|
      for (let i = 0; i < outDim; i++) {
        const dsdu = (c[i]! - s * (u[i]! / nu)) / nu;
        const k = g * dsdu;
        if (!k) continue;
        for (let j = 0; j < inDim; j++) grad[i * inDim + j]! += k * v[j]!;
      }
    }
    for (let i = 0; i < W.length; i++) W[i]! -= (lr * grad[i]!) / data.length + lr * 1e-4 * W[i]!;
  }
  return W;
}

/** Regresión logística con regularización hacia los pesos por defecto (evita sobreajuste). */
function fitFusion(X: number[][], y: number[], prior: FusionWeights): FusionWeights {
  const w = [...prior.w];
  let b = prior.b;
  const lam = 0.05,
    lr = 0.5;
  for (let it = 0; it < 400; it++) {
    const gw = w.map(() => 0);
    let gb = 0;
    X.forEach((x, k) => {
      const p = fuse(x, { w, b, features: prior.features });
      const e = p - y[k]!;
      x.forEach((v, i) => (gw[i]! += e * (Number.isNaN(v) ? 0.5 : v)));
      gb += e;
    });
    for (let i = 0; i < w.length; i++) w[i]! -= lr * (gw[i]! / X.length + lam * (w[i]! - prior.w[i]!));
    b -= lr * (gb / X.length + lam * (b - prior.b));
  }
  return { features: prior.features, w: w.map((v) => +v.toFixed(3)), b: +b.toFixed(3) };
}

function rates(scores: number[], y: number[], thr: number, gate?: boolean[]) {
  let fp = 0,
    fn = 0,
    np = 0,
    nn = 0;
  scores = scores.map((s, i) => (gate && !gate[i] ? 0 : s));
  scores.forEach((s, i) => {
    if (y[i]) {
      np++;
      if (s < thr) fn++;
    } else {
      nn++;
      if (s >= thr) fp++;
    }
  });
  return { fpr: nn ? fp / nn : 0, fnr: np ? fn / np : 0, n: scores.length };
}

const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] ?? 0;
};

export async function trainVisual(
  template: Uint8Array,
  profile: Profile,
  env: Env,
  engine: VisionEngine | null,
  o: VisualOptions = {},
): Promise<VisualReport> {
  const t0 = Date.now();
  const opts = { fills: 6, scansPerFill: 4, cousins: 4, seed: 4242, ...o };
  const r = new Rng(opts.seed);
  const prog = opts.onProgress ?? (() => {});
  prog('Generando variantes sintéticas', 0.02);
  const variants = await makeVariants(template, profile, opts);
  const make = (w: number, h: number) => env.createCanvas(w, h) as unknown as FxCanvas;
  const DPI = 100;
  const calib = profile.calibration ?? structuredClone(DEFAULT_CALIBRATION);

  interface Sample {
    kind: 'pos' | 'cousin' | 'foreign';
    pages: GrayImage[];
    t: Affine[];
    variant?: Variant;
    text: { words: Word[]; width: number; height: number }[];
    emb?: Float32Array[];
    sigEmb?: Map<string, Float32Array>;
  }
  const samples: Sample[] = [];
  for (const [vi, v] of variants.entries()) {
    const { canvases, pages } = await renderPdf(v.pdf, env, DPI);
    const n = vi === 0 ? opts.scansPerFill * 2 : opts.scansPerFill;
    for (let k = 0; k < n; k++) {
      const imgs: GrayImage[] = [];
      const ts: Affine[] = [];
      for (const c of canvases) {
        const p = randomScanParams(r, k === 0 ? 0.3 : 1);
        p.binarize = p.binarize && r.bool(0.5);
        imgs.push(toGray(degrade(c, p, make, r) as never));
        ts.push(scanAffine(p, c.width, c.height));
      }
      // En las primas, el texto original sigue en la capa de texto bajo el recuadro blanco: se sustituye.
      const text =
        v.kind !== 'cousin'
          ? pages
          : pages.map((pg, pi) => ({
              ...pg,
              words: pg.words.map((w) => {
                const cx = w.box.x + w.box.w / 2,
                  cy = w.box.y + w.box.h / 2;
                const inDist = profile.anchors.some(
                  (a) =>
                    a.distinctive &&
                    a.page === pi &&
                    cx >= a.box.x &&
                    cx <= a.box.x + a.box.w &&
                    cy >= a.box.y &&
                    cy <= a.box.y + a.box.h,
                );
                return inDist ? { ...w, text: r.pick(OTHER_TITLES.join(' ').split(' ')) } : w;
              }),
            }));
      samples.push({ kind: v.kind, pages: imgs, t: ts, variant: v, text });
    }
    prog('Simulando escaneos', 0.05 + (0.35 * (vi + 1)) / variants.length);
  }
  // Documentos ajenos (para calibrar texto y visión); el banco de negativos completa los visuales.
  for (let i = 0; i < 6; i++) {
    const { canvases, pages } = await renderPdf(
      await renderForeign(FOREIGN_KINDS[i % FOREIGN_KINDS.length]!, opts.seed + i),
      env,
      DPI,
    );
    const p = randomScanParams(r, 1);
    samples.push({
      kind: 'foreign',
      pages: canvases.map((c) => toGray(degrade(c, p, make, r) as never)),
      t: [scanAffine(p, 1, 1)],
      text: pages,
    });
  }

  // Huella rápida (dHash) de la plantilla limpia ya está en el perfil; aquí embeddings.
  let simRange: [number, number] = [0.5, 0.9];
  let visionRates = { fpr: 0, fnr: 0 };
  let sigReport: VisualReport['signature'];
  if (engine) {
    prog('Calculando embeddings', 0.45);
    let done = 0;
    for (const s of samples) {
      s.emb = [];
      for (const img of s.pages.slice(0, profile.pageCount))
        s.emb.push(l2norm(await engine.embed(pageTensor(img, engine.input.width, engine.input.height))));
      if (++done % 8 === 0) prog('Calculando embeddings', 0.45 + (0.3 * done) / samples.length);
    }
    const negBank = (await engine.negatives?.()) ?? null;
    // Entrenamiento / validación (20 % reservado).
    const idx = r.shuffle(samples.map((_, i) => i));
    const nVal = Math.max(4, Math.round(samples.length * 0.2));
    const val = new Set(idx.slice(0, nVal));
    const train = samples.filter((_, i) => !val.has(i));
    const valS = samples.filter((_, i) => val.has(i));
    const pages = profile.pageCount;
    const protos: Float32Array<ArrayBufferLike>[][] = [];
    for (let p = 0; p < pages; p++)
      protos.push(
        kmeans(
          train.filter((s) => s.kind === 'pos' && s.emb![p]).map((s) => s.emb![p]!),
          3,
          r,
        ),
      );
    // Cabeza: positivos = página de la plantilla; negativos = primas, ajenos, banco y otras páginas.
    const inDim = samples[0]!.emb![0]!.length;
    const outDim = 32;
    const posV = train.filter((s) => s.kind === 'pos').flatMap((s) => s.emb!.slice(0, 1));
    const negV = [
      ...train.filter((s) => s.kind !== 'pos').flatMap((s) => s.emb!.slice(0, 1)),
      ...(negBank?.vectors ?? []),
      ...(pages > 1
        ? train
            .filter((s) => s.kind === 'pos')
            .map((s) => s.emb![1]!)
            .filter(Boolean)
        : []),
    ];
    const W = trainHead(posV, negV, inDim, outDim, r);
    const headProtos: string[][] = [];
    for (let p = 0; p < pages; p++) {
      const ps = train
        .filter((s) => s.kind === 'pos' && s.emb![p])
        .map((s) => project(W, inDim, outDim, s.emb![p]!));
      headProtos.push(kmeans(ps, 3, r).map((v) => encodeF16(v)));
    }
    profile.visual = {
      modelId: engine.modelId,
      modelVersion: engine.modelVersion,
      input: engine.input,
      pages:
        profile.visual?.pages.map((vp, p) => ({
          dhash: vp.dhash,
          prototypes: (protos[p] ?? []).map((v) => encodeF16(v)),
        })) ?? [],
      head: { inDim, outDim, weights: encodeF32(W), prototypes: headProtos },
    };
    profile.modelId = engine.modelId;
    profile.modelVersion = engine.modelVersion;
    // Similitud visual en validación → rango para escalar la puntuación.
    const simOf = (s: Sample) => {
      let t = 0;
      for (let p = 0; p < Math.min(pages, s.emb!.length); p++) {
        const z = project(W, inDim, outDim, s.emb![p]!);
        let best = -1;
        for (const h of profile.visual!.head!.prototypes[p] ?? [])
          best = Math.max(best, cosine(z, decodeF16Local(h)));
        t += best;
      }
      return t / Math.max(1, Math.min(pages, s.emb!.length));
    };
    const vpos = valS.filter((s) => s.kind === 'pos').map(simOf);
    const vneg = [
      ...valS.filter((s) => s.kind !== 'pos').map(simOf),
      ...(negBank?.vectors ?? []).slice(0, 60).map((v) => {
        const z = project(W, inDim, outDim, v);
        let best = -1;
        for (const h of profile.visual!.head!.prototypes[0] ?? [])
          best = Math.max(best, cosine(z, decodeF16Local(h)));
        return best;
      }),
    ];
    const allPos = samples.filter((s) => s.kind === 'pos').map(simOf);
    // Las primas son visualmente casi iguales a la plantilla (las separa el texto distintivo): el rango
    // visual se fija con documentos ajenos y el banco de negativos.
    const allNeg = [
      ...samples.filter((s) => s.kind === 'foreign').map(simOf),
      ...(negBank?.vectors ?? []).map((v) => {
        const z = project(W, inDim, outDim, v);
        let best = -1;
        for (const h of profile.visual!.head!.prototypes[0] ?? [])
          best = Math.max(best, cosine(z, decodeF16Local(h)));
        return best;
      }),
    ];
    const lo = quantile(allNeg.length ? allNeg : vneg, 0.95);
    const hi = Math.max(lo + 0.05, quantile(allPos, 0.5));
    simRange = [+lo.toFixed(4), +hi.toFixed(4)];
    profile.visual.simRange = simRange;
    const thr = (lo + hi) / 2;
    visionRates = {
      fpr: vneg.filter((s) => s >= thr).length / Math.max(1, vneg.length),
      fnr: vpos.filter((s) => s < thr).length / Math.max(1, vpos.length),
    };

    // Clasificador de firma sobre el encoder (recorte de la región de firma).
    const sigFields = profile.fields.filter((f) => f.type === 'signature');
    if (sigFields.length) {
      prog('Entrenando el detector de firma', 0.78);
      const X: Float32Array[] = [];
      const Y: number[] = [];
      for (const s of samples.filter((s) => s.kind === 'pos')) {
        for (const f of sigFields) {
          const img = s.pages[f.page];
          if (!img) continue;
          const e = await embedCrop(engine, img, f.box, s.t[f.page]!);
          X.push(e);
          Y.push(s.variant!.filled.has(f.key) ? 1 : 0);
        }
      }
      if (Y.some((y) => y) && Y.some((y) => !y)) {
        const { w, b, acc } = logistic(X, Y);
        for (const f of sigFields)
          f.blank = { ...(f.blank ?? { ink: 0 }), sig: { w: encodeF32(w), b } } as never;
        sigReport = { acc, n: Y.length };
      }
    }
  }

  // Tinta de campos: umbral por tipo que maximiza la exactitud equilibrada.
  prog('Calibrando la detección de campos', 0.85);
  const inkData: Record<'text' | 'checkbox' | 'signature', { d: number; y: number }[]> = {
    text: [],
    checkbox: [],
    signature: [],
  };
  for (const s of samples.filter((s) => s.kind === 'pos')) {
    for (const f of profile.fields) {
      const img = s.pages[f.page];
      if (!img) continue;
      const kind = f.type === 'signature' ? 'signature' : f.type === 'checkbox' ? 'checkbox' : 'text';
      const margin = kind === 'checkbox' ? 0.3 : kind === 'signature' ? 0.08 : 0.18;
      // Error de alineación típico (~0,3 % de la página) añadido a la transformación exacta.
      const t = s.t[f.page]!;
      const jt: Affine = [t[0], t[1], t[2] + r.gauss() * 0.002, t[3], t[4], t[5] + r.gauss() * 0.002];
      const ink = inkRatio(img, f.box, jt, margin, paperLevel(img));
      inkData[kind].push({ d: ink - (f.blank?.ink ?? 0), y: s.variant!.filled.has(f.key) ? 1 : 0 });
    }
  }
  let fErr = 0,
    fN = 0,
    fFp = 0,
    fFn = 0,
    nNeg = 0,
    nPos = 0;
  for (const kind of ['text', 'checkbox', 'signature'] as const) {
    const d = inkData[kind];
    if (!d.some((x) => x.y) || !d.some((x) => !x.y)) continue;
    const cands = [...new Set(d.map((x) => +x.d.toFixed(4)))].sort((a, b) => a - b);
    let best = calib.ink[kind],
      bestAcc = -1;
    for (const c of cands) {
      const tp = d.filter((x) => x.y && x.d > c).length / d.filter((x) => x.y).length;
      const tn = d.filter((x) => !x.y && x.d <= c).length / d.filter((x) => !x.y).length;
      // Se favorece no dar falsos "falta" (prioridad: no molestar al usuario).
      const acc = tp * 1.5 + tn;
      if (acc > bestAcc) {
        bestAcc = acc;
        best = c;
      }
    }
    // Margen: entre el umbral óptimo y el valor por defecto, nunca por debajo del ruido observado.
    const negMax = quantile(
      d.filter((x) => !x.y).map((x) => x.d),
      0.98,
    );
    // Acotado: por encima del ruido de las regiones vacías, pero sin subir tanto que un valor corto
    // (un dígito, una «X») parezca vacío. Un falso «falta» molesta más que un vacío no detectado.
    const cap = { text: 0.025, checkbox: 0.08, signature: 0.02 }[kind];
    const floor = { text: 0.012, checkbox: 0.03, signature: 0.01 }[kind];
    calib.ink[kind] = +Math.min(cap, Math.max(floor, Math.min(best, negMax + 0.004))).toFixed(4);
    for (const x of d) {
      const pred = x.d > calib.ink[kind] ? 1 : 0;
      if (pred !== x.y) fErr++;
      if (x.y) {
        nPos++;
        if (!pred) fFn++;
      } else {
        nNeg++;
        if (pred) fFp++;
      }
      fN++;
    }
  }

  // Fusión: características de texto simuladas (OCR ruidoso) + visuales reales.
  prog('Calibrando la fusión', 0.92);
  const Xs: number[][] = [],
    ys: number[] = [],
    Xd: number[][] = [],
    yd: number[] = [];
  for (const s of samples) {
    const y = s.kind === 'pos' ? 1 : 0;
    for (const scan of [true, false]) {
      const cer = scan ? r.range(0.01, 0.1) : 0;
      const doc = noisyDoc(s.text, r, cer, scan ? r.range(0, 0.05) : 0, scan ? s.t[0]! : null);
      const ar = matchAnchors(profile, doc);
      const x = FUSION_FEATURES.map(() => NaN);
      x[0] = ar.coverage;
      x[1] = ar.distinctive;
      x[2] = ar.layout;
      x[3] =
        doc.pages.length === profile.pageCount
          ? 1
          : Math.max(0, 1 - Math.abs(doc.pages.length - profile.pageCount) / profile.pageCount);
      if (scan) {
        const vp = profile.visual?.pages;
        if (vp?.length) {
          let hs = 0;
          for (let i = 0; i < Math.min(vp.length, s.pages.length); i++)
            hs += hashSimilarity(dhash(s.pages[i]!), vp[i]!.dhash);
          x[4] = Math.max(0, Math.min(1, (hs / Math.min(vp.length, s.pages.length) - 0.62) / 0.3));
        }
        if (engine && s.emb && profile.visual?.head) {
          const h = profile.visual.head;
          const Wm = decodeF32Local(h.weights);
          let t = 0;
          for (let p = 0; p < Math.min(profile.pageCount, s.emb.length); p++) {
            const z = project(Wm, h.inDim, h.outDim, s.emb[p]!);
            let best = -1;
            for (const pr of h.prototypes[p] ?? []) best = Math.max(best, cosine(z, decodeF16Local(pr)));
            t += best;
          }
          const sim = t / Math.max(1, Math.min(profile.pageCount, s.emb.length));
          x[5] = Math.max(0, Math.min(1, (sim - simRange[0]) / Math.max(1e-3, simRange[1] - simRange[0])));
        }
        Xs.push(x);
        ys.push(y);
      } else {
        Xd.push(x);
        yd.push(y);
      }
    }
  }
  if ((globalThis as { DOCMATCH_DEBUG?: unknown }).DOCMATCH_DEBUG)
    Xs.forEach((x, i) => console.log('[fusion]', ys[i], x.map((v) => v.toFixed(2)).join(' ')));
  calib.fusion.scan = fitFusion(Xs, ys, DEFAULT_CALIBRATION.fusion.scan);
  calib.fusion.digital = fitFusion(Xd, yd, DEFAULT_CALIBRATION.fusion.digital);
  const thr = profile.thresholds.match;
  const hasDist = profile.anchors.some((a) => a.distinctive);
  const gate = (X: number[][]) => X.map((x) => !hasDist || x[1]! >= profile.thresholds.distinctive);
  const scanR = rates(
    Xs.map((x) => fuse(x, calib.fusion.scan)),
    ys,
    thr,
    gate(Xs),
  );
  const digR = rates(
    Xd.map((x) => fuse(x, calib.fusion.digital)),
    yd,
    thr,
    gate(Xd),
  );
  const fieldR = { fpr: nNeg ? fFp / nNeg : 0, fnr: nPos ? fFn / nPos : 0, n: fN };
  const acc = 1 - (scanR.fpr + scanR.fnr + digR.fpr + digR.fnr + (fN ? fErr / fN : 0) * 2) / 6;
  calib.metrics = { digital: digR, scan: scanR, fields: fieldR, estimatedAccuracy: +acc.toFixed(4) };
  profile.calibration = calib;
  prog('Listo', 1);
  return {
    positives: samples.filter((s) => s.kind === 'pos').length,
    negatives: samples.filter((s) => s.kind !== 'pos').length,
    vision: { ...visionRates, simRange },
    fusion: { digital: digR, scan: scanR },
    fields: fieldR,
    signature: sigReport,
    estimatedAccuracy: acc,
    seconds: (Date.now() - t0) / 1000,
  };
}

function logistic(X: Float32Array[], Y: number[]) {
  const d = X[0]!.length;
  const w = new Float32Array(d);
  let b = 0;
  for (let it = 0; it < 300; it++) {
    const gw = new Float32Array(d);
    let gb = 0;
    X.forEach((x, k) => {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * x[j]!;
      const e = 1 / (1 + Math.exp(-z)) - Y[k]!;
      for (let j = 0; j < d; j++) gw[j]! += e * x[j]!;
      gb += e;
    });
    for (let j = 0; j < d; j++) w[j]! -= (2 * gw[j]!) / X.length + 1e-3 * w[j]!;
    b -= (2 * gb) / X.length;
  }
  let ok = 0;
  X.forEach((x, k) => {
    let z = b;
    for (let j = 0; j < d; j++) z += w[j]! * x[j]!;
    if ((z > 0 ? 1 : 0) === Y[k]) ok++;
  });
  return { w, b: +b.toFixed(4), acc: ok / X.length };
}

export { fold };
