import type { GrayImage } from './doc';
import type { Env, VisionEngine } from './env';
import { checkFields, type FieldOutcome } from './fields/check';
import { featureVector, fuse, fusionFor } from './fusion';
import { fmt, messagesFor, type MessageKey, type Messages } from './i18n';
import { toGray } from './image';
import { matchAnchors, type AnchorResult } from './matchers/anchors';
import type { MatchSignal } from './matchers/types';
import { embedPages, phashSignal, visionSignal } from './matchers/visual';
import { basicChecks } from './pdf/basic';
import { extract, PdfOpenError, type DocContext } from './pdf/extract';
import type { Profile } from './profile/types';
import { fold } from './text/normalize';
import type { Options, Result, Status } from './types';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface Candidate {
  profile: Profile;
  score: number;
  signals: MatchSignal[];
  anchors: AnchorResult;
  gated: boolean;
}

function result(
  status: Status,
  key: MessageKey,
  m: Messages,
  vars: Record<string, string>,
  extra: Partial<Result> = {},
): Result {
  return {
    status,
    score: 0,
    missingFields: [],
    invalidFields: [],
    warnings: [],
    messages: [fmt(m[key], vars)],
    timings: {},
    messageKey: key,
    ...extra,
  };
}

const CSV_RE = /(codigo seguro de verificacion|c\s?s\s?v)\s*(csv)?\s*[a-z0-9]{8,}/;

export async function checkDocument(
  bytes: Uint8Array,
  profiles: Profile[],
  env: Env,
  opts: Options = {},
): Promise<Result> {
  const m = messagesFor(opts.lang, opts.messages);
  const timings: Record<string, number> = {};
  const t0 = now();
  const names = [...new Set(profiles.map((p) => p.name))].join(' / ');
  const basic = basicChecks(bytes);
  if (basic)
    return result(
      basic === 'empty' || basic === 'not_pdf' ? 'unreadable' : 'unreadable',
      basic === 'empty' ? 'not_pdf' : basic,
      m,
      { name: names },
      { timings: { total: now() - t0 } },
    );

  let ctx: DocContext;
  try {
    ctx = await extract(bytes, env, {
      ocr: opts.ocr ?? 'auto',
      textChars: Math.min(...profiles.map((p) => p.thresholds.textChars)),
      portrait: (profiles[0]?.pages[0]?.height ?? 1) >= (profiles[0]?.pages[0]?.width ?? 0),
    });
  } catch (e) {
    if (e instanceof PdfOpenError)
      return result('unreadable', e.kind, m, { name: names }, { timings: { total: now() - t0 } });
    throw e;
  }
  timings.extract = now() - t0;
  try {
    const doc = ctx.data;
    const isScan = doc.kind === 'scan';
    const gray = new Map<number, GrayImage>();
    const image = async (i: number) => {
      if (!gray.has(i)) gray.set(i, toGray(await ctx.pageImage(i)));
      return gray.get(i)!;
    };

    // Calidad del OCR: si apenas hay texto legible, el documento no se puede leer.
    if (isScan) {
      const words = doc.pages.flatMap((p) => p.words);
      const good = words.filter((w) => w.conf >= 60).length;
      if (good < 12)
        return result(
          'unreadable',
          'unreadable',
          m,
          { name: names },
          { timings: { ...timings, total: now() - t0 } },
        );
    }

    // Señales visuales (siempre en escaneos si el perfil las tiene; opcional en digitales).
    const wantVisual = (isScan || opts.visualOnDigital) && profiles.some((p) => p.visual);
    const pagesGray: GrayImage[] = [];
    let engine: VisionEngine | null = null;
    let embs: Float32Array[] = [];
    let negatives: { labels: string[]; vectors: Float32Array[] } | null = null;
    if (wantVisual) {
      const tv = now();
      const n = Math.min(doc.pages.length, Math.max(...profiles.map((p) => p.pageCount)));
      for (let i = 0; i < n; i++) pagesGray.push(await image(i));
      try {
        engine = env.vision ? await env.vision() : null;
        if (engine) {
          embs = await embedPages(engine, pagesGray);
          negatives = engine.negatives ? await engine.negatives() : null;
        }
      } catch (e) {
        engine = null;
        if (opts.debug) console.warn('[docmatch] modelo visual no disponible', e);
      }
      timings.visual = now() - tv;
    }

    const tm = now();
    const cands: Candidate[] = profiles.map((profile) => {
      const anchors = matchAnchors(profile, doc);
      const signals = [...anchors.signals];
      signals.push({
        id: 'pages',
        score:
          doc.pages.length === profile.pageCount
            ? 1
            : Math.max(0, 1 - Math.abs(doc.pages.length - profile.pageCount) / profile.pageCount),
        confidence: 1,
      });
      if (wantVisual && profile.visual) {
        const ph = phashSignal(profile, pagesGray);
        if (ph) signals.push(ph);
        if (engine) {
          const vs = visionSignal(profile, embs, engine, negatives);
          if (vs) signals.push(vs);
        }
      }
      const score = fuse(featureVector(signals), fusionFor(profile, doc.kind));
      const hasDistinctive = profile.anchors.some((a) => a.distinctive);
      const gated = hasDistinctive && anchors.distinctive < profile.thresholds.distinctive;
      return { profile, score, signals, anchors, gated };
    });
    timings.match = now() - tm;
    cands.sort((a, b) => Number(a.gated) - Number(b.gated) || b.score - a.score);
    const best = cands[0]!;
    const debug = opts.debug
      ? {
          kind: doc.kind,
          candidates: cands.map((c) => ({
            id: c.profile.id,
            score: c.score,
            gated: c.gated,
            signals: c.signals,
          })),
          rotation: doc.pages.map((p) => p.rotation),
        }
      : undefined;

    if (best.gated || best.score < best.profile.thresholds.match) {
      const v = best.signals.find((s) => s.id === 'vision')?.details as
        { negLabel?: string; negBest?: number; sim?: number } | undefined;
      const likeKey =
        v?.negLabel && (v.negBest ?? 0) > (v.sim ?? 1) ? (`like_${v.negLabel}` as MessageKey) : undefined;
      const like = likeKey && m[likeKey];
      return result(
        'mismatch',
        like ? 'mismatch_like' : 'mismatch',
        m,
        { name: names, like: like ?? '' },
        { score: best.score, timings: { ...timings, total: now() - t0 }, debug },
      );
    }

    // Campos.
    const tf = now();
    const fields: FieldOutcome[] = await checkFields({
      profile: best.profile,
      doc,
      align: best.anchors.align,
      hits: best.anchors.hits,
      image,
      vision: engine,
    });
    timings.fields = now() - tf;
    const missing = fields.filter((f) => f.state === 'missing').map(({ key, label }) => ({ key, label }));
    const invalid = fields
      .filter((f) => f.state === 'invalid')
      .map(({ key, label, reason }) => ({ key, label, reason: reason! }));

    // Firma electrónica y CSV (solo si el perfil los espera).
    const warnings: string[] = [];
    const exp = best.profile.expect ?? {};
    if (exp.csv && !CSV_RE.test(fold(doc.fullText).replace(/\s+(?=[a-z0-9]{8,})/g, ' ')))
      warnings.push('csv');
    if (exp.digitalSignature && !doc.hasDigitalSignature) warnings.push('digitalSignature');

    const name = best.profile.name;
    const messages: string[] = [];
    let status: Status = 'match';
    let key: MessageKey = 'match';
    const lbl = (s: string) => s.replace(/\s*:\s*$/, '');
    if (missing.length) {
      status = 'incomplete';
      key = 'incomplete_missing';
      messages.push(fmt(m.incomplete_missing, { fields: missing.map((f) => lbl(f.label)).join(', ') }));
    }
    if (invalid.length) {
      status = 'incomplete';
      if (!missing.length) key = 'incomplete_invalid';
      messages.push(
        fmt(m.incomplete_invalid, {
          fields: invalid
            .map((f) => `${lbl(f.label)} (${m[`r_${f.reason}` as MessageKey] ?? f.reason})`)
            .join(', '),
        }),
      );
    }
    if (status === 'match') messages.push(fmt(m.match, { name }));
    for (const w of warnings) messages.push(m[`warn_${w}` as MessageKey]);
    timings.total = now() - t0;
    return {
      status,
      profileId: best.profile.id,
      score: best.score,
      missingFields: missing,
      invalidFields: invalid,
      warnings,
      messages,
      timings,
      messageKey: key,
      debug: debug && { ...debug, fields },
    };
  } finally {
    await ctx.close();
  }
}
