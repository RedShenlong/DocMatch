import { fold, levRatio, normalize, type FieldType, type RelBox, type Segment } from 'docmatch/internal';
import type { Shape, TemplateAnalysis, TemplatePage } from './analyze';

export interface ProposedField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  page: number;
  box: RelBox;
  /** Índice del segmento-etiqueta en la página. */
  labelSeg?: number;
  acroName?: string;
  source: 'label' | 'checkbox' | 'box' | 'acroform' | 'diff' | 'manual';
}

export function slugify(s: string): string {
  return (
    normalize(s)
      .replace(/[º°]/g, 'o')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'campo'
  );
}

/** Deduce el tipo a partir del texto de la etiqueta. */
export function inferType(label: string): FieldType {
  const l = normalize(label);
  if (/\bfirma\b/.test(l)) return 'signature';
  if (/\biban\b|cuenta bancaria|n[ºo°]? de cuenta/.test(l)) return 'iban';
  if (/\b(nif|cif)\b/.test(l) && !/\b(dni|nie)\b/.test(l)) return 'nif_cif';
  if (/\b(dni|nie|documento de identidad)\b/.test(l)) return 'dni_nie';
  if (/\bfecha\b/.test(l)) return 'date';
  if (/correo|e-?mail/.test(l)) return 'email';
  if (/telefono|movil|\btfno\b|\btlf\b/.test(l)) return 'phone';
  if (/\bc\.?\s?p\.?(\s|:|$)|codigo postal/.test(l)) return 'postal_code';
  if (/(^|\s)n\s?[ºo°.](\s|$)|\b(numero|importe|cantidad|miembros|edad)\b/.test(l)) return 'number';
  return 'text';
}

const pt = (p: TemplatePage) => ({ x: (v: number) => v * p.width, y: (v: number) => v * p.height });

function vOverlap(a: RelBox, b: RelBox) {
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / Math.min(a.h, b.h);
}

const isCheckboxShape = (s: Shape, p: TemplatePage) => {
  const w = s.box.w * p.width,
    h = s.box.h * p.height;
  return s.kind === 'rect' && w >= 6 && w <= 16 && h >= 6 && h <= 16 && Math.abs(w - h) < 3;
};

/** Regiones de valor para una etiqueta: a la derecha, debajo o, si no hay nada dibujado, el hueco libre. */
function regionForLabel(
  p: TemplatePage,
  segIdx: number,
  claimed: Set<Shape>,
  signature: boolean,
): { box: RelBox; shape?: Shape } {
  const L = p.segments[segIdx]!.box;
  const P = pt(p);
  const px = 1 / p.width,
    py = 1 / p.height;
  const free = p.shapes.filter((s) => !claimed.has(s) && !isCheckboxShape(s, p));
  const right = free
    .filter((s) => {
      const dx = (s.box.x - (L.x + L.w)) / px;
      if (dx < -3 || dx > 30) return false;
      if (s.kind === 'rect')
        return L.y + L.h / 2 >= s.box.y - 2 * py && L.y + L.h / 2 <= s.box.y + s.box.h + 2 * py;
      return s.box.y >= L.y && s.box.y - (L.y + L.h) < 8 * py;
    })
    .sort((a, b) => a.box.x - b.box.x)[0];
  const below = free
    .filter((s) => {
      const dy = (s.box.y - (L.y + L.h)) / py;
      const top = s.kind === 'hline' ? dy - 16 : dy;
      return top > -3 && top < 20 && Math.abs(s.box.x - L.x) / px < 8;
    })
    .sort((a, b) => a.box.y - b.box.y)[0];
  const pick = signature
    ? ([right, below].find((s) => s && (s.kind === 'rect' ? s.box.h / py > 25 : true)) ?? right ?? below)
    : (right ?? below);
  if (pick) {
    if (pick.kind === 'rect') return { box: pick.box, shape: pick };
    const h = (signature ? 50 : 16) * py;
    return { box: { x: pick.box.x, y: pick.box.y - h, w: pick.box.w, h: h + 2 * py }, shape: pick };
  }
  if (signature) {
    return { box: { x: L.x, y: L.y + L.h + 2 * py, w: Math.min(0.45, 1 - L.x - 40 * px), h: 60 * py } };
  }
  // Hueco libre hasta el siguiente texto de la línea o el margen derecho.
  const nextX = p.segments
    .filter((s, i) => i !== segIdx && s.box.x > L.x + L.w && vOverlap(s.box, L) > 0.4)
    .reduce((m, s) => Math.min(m, s.box.x), 1 - 40 * px);
  const h = Math.max(L.h * 1.8, 14 * py);
  void P;
  return {
    box: {
      x: L.x + L.w + 3 * px,
      y: L.y + L.h / 2 - h / 2,
      w: Math.max(20 * px, nextX - (L.x + L.w) - 8 * px),
      h,
    },
  };
}

export interface ProposeOptions {
  /** Análisis de ejemplos rellenos (con datos ficticios) para detectar regiones variables por diferencia. */
  examples?: TemplateAnalysis[];
}

export function proposeFields(t: TemplateAnalysis, opts: ProposeOptions = {}): ProposedField[] {
  const fields: ProposedField[] = [];
  for (const p of t.pages) {
    const claimed = new Set<Shape>();
    const px = 1 / p.width,
      py = 1 / p.height;
    // 1) Etiquetas terminadas en ":" y zonas de firma.
    p.segments.forEach((s, i) => {
      const txt = s.text.trim();
      if (!txt.endsWith(':')) return;
      const sig = /\bfirma\b/i.test(normalize(txt)) && txt.length < 60;
      if (txt.length > 70) return;
      const r = regionForLabel(p, i, claimed, sig);
      if (r.shape) claimed.add(r.shape);
      fields.push({
        key: slugify(txt),
        label: txt,
        type: sig ? 'signature' : inferType(txt),
        required: !/opcional/i.test(txt),
        page: p.index,
        box: r.box,
        labelSeg: i,
        source: 'label',
      });
    });
    // 2) Casillas: cuadrado pequeño con texto a la derecha.
    for (const s of p.shapes) {
      if (!isCheckboxShape(s, p) || claimed.has(s)) continue;
      const li = p.segments.findIndex(
        (g) =>
          g.box.x > s.box.x + s.box.w - 1 * px &&
          g.box.x - (s.box.x + s.box.w) < 14 * px &&
          vOverlap(g.box, s.box) > 0.3,
      );
      const label = li >= 0 ? p.segments[li]!.text : 'Casilla';
      claimed.add(s);
      fields.push({
        key: slugify(label),
        label,
        type: 'checkbox',
        required: false,
        page: p.index,
        box: s.box,
        labelSeg: li >= 0 ? li : undefined,
        source: 'checkbox',
      });
    }
    // 3) Cajas sin etiqueta asociada: etiqueta = texto más cercano encima o a la izquierda.
    for (const s of p.shapes) {
      if (claimed.has(s) || s.kind !== 'rect') continue;
      const w = s.box.w / px,
        h = s.box.h / py;
      if (w < 40 || h < 10 || h > 120 || w > p.width * 0.95) continue;
      // Ignora fondos de cabecera de sección (texto dentro de la caja).
      if (
        p.segments.some(
          (g) =>
            g.box.x >= s.box.x &&
            g.box.x + g.box.w <= s.box.x + s.box.w + px &&
            g.box.y >= s.box.y - py &&
            g.box.y + g.box.h <= s.box.y + s.box.h + 2 * py,
        )
      )
        continue;
      let li = -1,
        best = Infinity;
      p.segments.forEach((g, i) => {
        const above = (s.box.y - (g.box.y + g.box.h)) / py;
        const left = (s.box.x - (g.box.x + g.box.w)) / px;
        const d =
          above >= -2 && above < 20 && Math.abs(g.box.x - s.box.x) / px < 10
            ? above
            : left >= -2 && left < 30 && vOverlap(g.box, s.box) > 0.3
              ? left
              : Infinity;
        if (d < best) {
          best = d;
          li = i;
        }
      });
      if (li < 0) continue;
      const label = p.segments[li]!.text;
      claimed.add(s);
      fields.push({
        key: slugify(label),
        label,
        type: inferType(label),
        required: true,
        page: p.index,
        box: s.box,
        labelSeg: li,
        source: 'box',
      });
    }
  }
  // Si no hay etiqueta "Firma…:", se usa un texto que empiece por "Firma" (p. ej. "Firma y sello").
  if (!fields.some((f) => f.type === 'signature')) {
    for (const p of t.pages) {
      const i = p.segments.findIndex((s) => /^firma\b/.test(normalize(s.text)) && s.text.length < 40);
      if (i < 0) continue;
      const r = regionForLabel(p, i, new Set(), true);
      fields.push({
        key: 'firma',
        label: p.segments[i]!.text,
        type: 'signature',
        required: true,
        page: p.index,
        box: r.box,
        labelSeg: i,
        source: 'label',
      });
      break;
    }
  }
  // 4) AcroForm.
  for (const a of t.acro) {
    if (!a.box || a.page < 0) continue;
    const cx = a.box.x + a.box.w / 2,
      cy = a.box.y + a.box.h / 2;
    const f = fields.find(
      (f) =>
        f.page === a.page &&
        cx >= f.box.x &&
        cx <= f.box.x + f.box.w &&
        cy >= f.box.y &&
        cy <= f.box.y + f.box.h,
    );
    if (f) {
      f.acroName = a.name;
      continue;
    }
    const type: FieldType =
      a.type === 'checkbox' ? 'checkbox' : a.type === 'signature' ? 'signature' : 'text';
    fields.push({
      key: slugify(a.name),
      label: a.name,
      type,
      required: type !== 'checkbox',
      page: a.page,
      box: a.box,
      acroName: a.name,
      source: 'acroform',
    });
  }
  // 5) Diferencias con ejemplos rellenos: texto que no está en la plantilla y cae fuera de los campos.
  for (const ex of opts.examples ?? []) {
    for (const ep of ex.pages) {
      const tp = t.pages[ep.index];
      if (!tp) continue;
      for (const s of ep.segments) {
        const isFixed = tp.segments.some(
          (g) => Math.abs(g.box.y - s.box.y) < 0.01 && levRatio(fold(g.text), s.fold) > 0.85,
        );
        if (isFixed) continue;
        const cx = s.box.x + s.box.w / 2,
          cy = s.box.y + s.box.h / 2;
        if (
          fields.some(
            (f) =>
              f.page === ep.index &&
              cx >= f.box.x &&
              cx <= f.box.x + f.box.w &&
              cy >= f.box.y - f.box.h * 0.3 &&
              cy <= f.box.y + f.box.h * 1.3,
          )
        )
          continue;
        let li = -1,
          best = Infinity;
        tp.segments.forEach((g, i) => {
          if (vOverlap(g.box, s.box) < 0.3 || g.box.x > s.box.x) return;
          const d = s.box.x - (g.box.x + g.box.w);
          if (d >= 0 && d < best) {
            best = d;
            li = i;
          }
        });
        const label = li >= 0 ? tp.segments[li]!.text : `Campo ${fields.length + 1}`;
        fields.push({
          key: slugify(label),
          label,
          type: inferType(label),
          required: true,
          page: ep.index,
          box: {
            x: s.box.x - 0.005,
            y: s.box.y - s.box.h * 0.3,
            w: Math.max(s.box.w * 1.5, 0.15),
            h: s.box.h * 1.6,
          },
          labelSeg: li >= 0 ? li : undefined,
          source: 'diff',
        });
      }
    }
  }
  // Claves únicas.
  const seen = new Map<string, number>();
  for (const f of fields) {
    const n = seen.get(f.key) ?? 0;
    seen.set(f.key, n + 1);
    if (n) f.key = `${f.key}_${n + 1}`;
  }
  return fields;
}

export type { Segment };
