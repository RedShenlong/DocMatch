import type { AcroValue, DocData, GrayImage, PageData, Word } from '../doc';
import { apply, fitAffine, type Affine, type Pt } from '../geometry/affine';
import { inkRatio, paperLevel } from '../image';
import type { AnchorCandidate, PageAlignment } from '../matchers/anchors';
import { DEFAULT_CALIBRATION, type Profile, type ProfileField, type RelBox } from '../profile/types';
import { validate, type InvalidReason } from './validators';
import type { VisionEngine } from '../env';
import { embedCrop } from '../matchers/visual';
import { cosine, decodeF16, decodeF32 } from '../vision/tensor';

export interface FieldOutcome {
  key: string;
  label: string;
  state: 'ok' | 'missing' | 'invalid' | 'unknown';
  value?: string;
  reason?: InvalidReason;
  source: 'acroform' | 'text' | 'ocr' | 'ink' | 'signature';
  ink?: number;
  /** Confianza mínima del OCR en las palabras del valor. */
  conf?: number;
}

function mapBox(t: Affine, b: RelBox): RelBox {
  const ps = [
    apply(t, { x: b.x, y: b.y }),
    apply(t, { x: b.x + b.w, y: b.y }),
    apply(t, { x: b.x, y: b.y + b.h }),
    apply(t, { x: b.x + b.w, y: b.y + b.h }),
  ];
  const xs = ps.map((p) => p.x),
    ys = ps.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

const overlapFrac = (a: RelBox, b: RelBox) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1e-9, a.w * a.h);
};

/** Palabras cuyo centro cae dentro de la región (ligeramente ampliada) y que no son etiquetas. */
function wordsIn(page: PageData, region: RelBox, labelBoxes: RelBox[]): Word[] {
  const ex = { x: region.x - 0.004, y: region.y - region.h * 0.25, w: region.w + 0.008, h: region.h * 1.5 };
  return page.words
    .filter((w) => {
      const cx = w.box.x + w.box.w / 2,
        cy = w.box.y + w.box.h / 2;
      if (cx < ex.x || cx > ex.x + ex.w || cy < ex.y || cy > ex.y + ex.h) return false;
      return !labelBoxes.some((lb) => overlapFrac(w.box, lb) > 0.5);
    })
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

function acroFor(f: ProfileField, region: RelBox, docPage: number, acro: AcroValue[]): AcroValue | undefined {
  if (f.acroName) {
    const byName = acro.find((a) => a.name === f.acroName);
    if (byName) return byName;
  }
  return acro.find((a) => {
    if (a.page !== docPage || !a.box) return false;
    const cx = a.box.x + a.box.w / 2,
      cy = a.box.y + a.box.h / 2;
    return (
      cx >= region.x &&
      cx <= region.x + region.w &&
      cy >= region.y - region.h * 0.3 &&
      cy <= region.y + region.h * 1.3
    );
  });
}

/**
 * Transformación local para un campo: mínimos cuadrados ponderados con las anclas encontradas,
 * dando más peso a las cercanas. Corrige perspectiva y deformaciones que una sola afín no recoge.
 */
export function localTransform(
  profile: Profile,
  hits: (AnchorCandidate | null)[],
  al: PageAlignment,
  page: number,
  at: Pt,
  sigma = 0.12,
): Affine {
  const src: Pt[] = [],
    dst: Pt[] = [],
    w: number[] = [];
  hits.forEach((h, i) => {
    const a = profile.anchors[i]!;
    if (!h || a.page !== page || h.page !== al.docPage) return;
    const c = { x: a.box.x + a.box.w / 2, y: a.box.y + a.box.h / 2 };
    const d2 = (c.x - at.x) ** 2 + (c.y - at.y) ** 2;
    src.push(c);
    dst.push({ x: h.box.x + h.box.w / 2, y: h.box.y + h.box.h / 2 });
    w.push(Math.exp(-d2 / (2 * sigma * sigma)) + 1e-3);
  });
  if (src.length < 6) return al.t;
  const t = fitAffine(src, dst, w);
  if (!t) return al.t;
  // Seguridad: si la local se aleja mucho de la global en el centro del campo, se usa la global.
  const p1 = apply(t, at),
    p2 = apply(al.t, at);
  return Math.hypot(p1.x - p2.x, p1.y - p2.y) < 0.03 ? t : al.t;
}

export interface FieldCheckInput {
  profile: Profile;
  doc: DocData;
  align: (PageAlignment | null)[];
  hits: (AnchorCandidate | null)[];
  /** Imagen de la página del documento (escaneos o cuando hace falta tinta). */
  image: (docPage: number) => Promise<GrayImage | null>;
  /** Encoder visual (opcional): firma y casos dudosos de tinta en escaneos. */
  vision?: VisionEngine | null;
}

export async function checkFields({
  profile,
  doc,
  align,
  hits,
  image,
  vision,
}: FieldCheckInput): Promise<FieldOutcome[]> {
  const ink = profile.calibration?.ink ?? DEFAULT_CALIBRATION.ink;
  const minConf = profile.thresholds.ocrConfidence;
  const out: FieldOutcome[] = [];
  const paper = new Map<number, number>();
  const inkOf = async (f: ProfileField, al: PageAlignment, t: Affine = al.t) => {
    const img = await image(al.docPage);
    if (!img) return null;
    if (!paper.has(al.docPage)) paper.set(al.docPage, paperLevel(img));
    const kind = f.type === 'signature' ? 'signature' : f.type === 'checkbox' ? 'checkbox' : 'text';
    const margin = kind === 'checkbox' ? 0.3 : kind === 'signature' ? 0.08 : 0.18;
    const r = inkRatio(img, f.box, t, margin, paper.get(al.docPage));
    const thr = ink[kind];
    const d = r - (f.blank?.ink ?? 0);
    let filled = d > thr;
    // Con modelo visual: clasificador de firma y distancia al recorte vacío en los casos dudosos.
    const useModel =
      vision &&
      doc.kind === 'scan' &&
      profile.visual?.modelId === vision.modelId &&
      (f.blank?.sig || (f.blank?.emb && Math.abs(d - thr) < thr * 0.5));
    if (useModel) {
      const e = await embedCrop(vision!, img, f.box, t);
      if (f.blank?.sig) {
        const w = decodeF32(f.blank.sig.w);
        let z = f.blank.sig.b;
        for (let i = 0; i < w.length; i++) z += w[i]! * e[i]!;
        const p = 1 / (1 + Math.exp(-z));
        // El clasificador solo decide en los casos dudosos de tinta: veta un trazo débil o rescata uno muy tenue.
        filled = filled ? d > thr * 1.3 || p > 0.05 : p > 0.9 && d > thr * 0.3;
      } else if (f.blank?.emb) {
        filled = cosine(e, decodeF16(f.blank.emb)) < 0.9;
      }
    }
    return { r, filled };
  };

  for (const f of profile.fields) {
    const al = align[f.page];
    if (!al) {
      out.push({ key: f.key, label: f.label, state: f.required ? 'missing' : 'unknown', source: 'text' });
      continue;
    }
    const page = doc.pages[al.docPage]!;
    const T =
      page.source === 'ocr'
        ? localTransform(profile, hits, al, f.page, { x: f.box.x + f.box.w / 2, y: f.box.y + f.box.h / 2 })
        : al.t;
    const region = mapBox(T, f.box);
    const labelBoxes = hits
      .filter((h): h is AnchorCandidate => !!h && h.page === al.docPage)
      .map((h) => h.box);

    // 1) AcroForm tiene prioridad.
    const acro = doc.kind === 'digital' ? acroFor(f, region, al.docPage, doc.acro) : undefined;
    if (acro && f.type !== 'signature') {
      const v = acro.value;
      const filled = typeof v === 'boolean' ? v : v != null && String(v).trim() !== '';
      if (!filled) {
        out.push({ key: f.key, label: f.label, state: f.required ? 'missing' : 'ok', source: 'acroform' });
        continue;
      }
      if (f.type === 'checkbox') {
        out.push({ key: f.key, label: f.label, state: 'ok', source: 'acroform' });
        continue;
      }
      const reason = validate(f.type, String(v), f.pattern);
      out.push({
        key: f.key,
        label: f.label,
        state: reason ? 'invalid' : 'ok',
        reason: reason ?? undefined,
        value: String(v),
        source: 'acroform',
      });
      continue;
    }

    // 2) Firma: firma electrónica en el PDF o trazo visible en la región.
    if (f.type === 'signature') {
      if (doc.hasDigitalSignature) {
        out.push({ key: f.key, label: f.label, state: 'ok', source: 'signature' });
        continue;
      }
      const k = await inkOf(f, al, T);
      out.push({
        key: f.key,
        label: f.label,
        state: k?.filled ? 'ok' : f.required ? 'missing' : 'ok',
        source: 'ink',
        ink: k?.r,
      });
      continue;
    }

    const words = wordsIn(page, region, labelBoxes);
    const value = words
      .map((w) => w.text)
      .join(' ')
      .trim();

    // 3) PDF digital: el texto manda; si no hay texto se mira la tinta (valor dibujado como trazos).
    if (page.source === 'text') {
      if (f.type === 'checkbox') {
        if (/^[x✓✔■●]$/i.test(value)) {
          out.push({ key: f.key, label: f.label, state: 'ok', value, source: 'text' });
          continue;
        }
        const k = await inkOf(f, al, T);
        out.push({
          key: f.key,
          label: f.label,
          state: k?.filled || !f.required ? 'ok' : 'missing',
          source: 'ink',
          ink: k?.r,
        });
        continue;
      }
      if (!value) {
        const k = f.required ? await inkOf(f, al, T) : null;
        out.push({
          key: f.key,
          label: f.label,
          state: !f.required || k?.filled ? 'ok' : 'missing',
          source: k ? 'ink' : 'text',
          ink: k?.r,
        });
        continue;
      }
      const reason = validate(f.type, value, f.pattern);
      out.push({
        key: f.key,
        label: f.label,
        state: reason ? 'invalid' : 'ok',
        reason: reason ?? undefined,
        value,
        source: 'text',
      });
      continue;
    }

    // 4) Escaneo: la tinta decide si está relleno; el formato solo se valida si el OCR es fiable.
    const k = await inkOf(f, al, T);
    const filled = k ? k.filled : !!value;
    if (!filled) {
      out.push({
        key: f.key,
        label: f.label,
        state: f.required ? 'missing' : 'ok',
        source: 'ink',
        ink: k?.r,
      });
      continue;
    }
    const conf = words.length ? Math.min(...words.map((w) => w.conf)) : 0;
    const confident = words.length > 0 && conf >= minConf && value.replace(/\W/g, '').length >= 3;
    if (confident && f.type !== 'checkbox' && f.type !== 'text') {
      const reason = scanInvalid(f.type, value, conf, minConf);
      out.push({
        key: f.key,
        label: f.label,
        state: reason ? 'invalid' : 'ok',
        reason: reason ?? undefined,
        value,
        source: 'ocr',
        ink: k?.r,
        conf,
      });
    } else
      out.push({
        key: f.key,
        label: f.label,
        state: 'ok',
        value: value || undefined,
        source: 'ink',
        ink: k?.r,
        conf,
      });
  }
  return out;
}

/**
 * En escaneos solo se avisa de errores semánticos claros sobre un valor con la forma exacta esperada
 * (p. ej. la letra de un DNI de 8 dígitos no cuadra, o una fecha con mes 16). Los errores de forma
 * casi siempre son fallos del OCR (sobre todo con letra manuscrita), así que no se notifican.
 */
export function scanInvalid(
  type: ProfileField['type'],
  raw: string,
  conf: number,
  minConf: number,
): InvalidReason | null {
  const v = raw.trim();
  const c = v.replace(/[\s.-]/g, '').toUpperCase();
  if (type === 'dni_nie' || type === 'nif_cif') {
    if (conf < Math.max(90, minConf) || !/^([XYZ]\d{7}|\d{8})[A-Z]$/.test(c)) return null;
    const r = validate(type, c);
    return r === 'dni_letter' || r === 'nif_control' ? r : null;
  }
  if (type === 'iban') {
    if (conf < Math.max(90, minConf) || !/^ES\d{22}$/.test(c)) return null;
    return validate('iban', c) === 'iban_checksum' ? 'iban_checksum' : null;
  }
  if (type === 'date') {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
    if (!m) return null;
    return Number(m[1]) > 31 || Number(m[2]) > 12 || Number(m[1]) === 0 || Number(m[2]) === 0
      ? 'date_invalid'
      : null;
  }
  return null;
}
