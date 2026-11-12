import {
  DEFAULT_CALIBRATION,
  DEFAULT_THRESHOLDS,
  SCHEMA_VERSION,
  dhash,
  fold,
  inkRatio,
  IDENTITY,
  normalize,
  openPdf,
  renderPage,
  toGray,
  validateDniNie,
  validateIban,
  type Anchor,
  type Env,
  type GrayImage,
  type Profile,
  type ProfileField,
} from 'docmatch/internal';
import { analyzeTemplate, type TemplateAnalysis } from './analyze';
import { proposeFields, slugify, type ProposedField } from './propose';

export const BUILDER_VERSION = '0.1.0';

export interface BuildOptions {
  id?: string;
  name?: string;
  version?: string;
  issuer?: string;
  examples?: Uint8Array[];
  expect?: Profile['expect'];
  /** Ajustes del dueño sobre los campos propuestos (renombrar, obligatoriedad, tipo, añadir…). */
  edit?: (fields: ProposedField[], analysis: TemplateAnalysis) => ProposedField[];
}

export interface BuildResult {
  profile: Profile;
  analysis: TemplateAnalysis;
  fields: ProposedField[];
  /** Imágenes renderizadas de la plantilla vacía (para el paso visual). */
  images: GrayImage[];
  warnings: string[];
}

const SECTION_RE = /^(\d+[.)]|[a-z][.)]|[ivx]+[.)])\s/;

/**
 * Marca como distintivas las líneas que identifican la plantilla: título (letra más grande),
 * código del modelo y las líneas de subtítulo/finalidad justo debajo del título.
 */
export function markDistinctive(anchors: Anchor[], sizes: number[]): void {
  const first = anchors.map((a, i) => ({ a, i, size: sizes[i]! })).filter((x) => x.a.page === 0);
  if (!first.length) return;
  const top = first.filter((x) => x.a.box.y < 0.5);
  const maxSize = Math.max(...top.map((x) => x.size));
  const titles = top.filter((x) => x.size >= maxSize * 0.92 && x.a.norm.length >= 6);
  const tY0 = Math.min(...titles.map((x) => x.a.box.y));
  const tY1 = Math.max(...titles.map((x) => x.a.box.y + x.a.box.h));
  for (const x of titles) {
    x.a.distinctive = true;
    x.a.weight = 3 + Math.min(2, x.a.norm.length / 30);
  }
  for (const x of first) {
    if (x.a.distinctive) continue;
    const isCode =
      /^(modelo|mod|impreso|ref|referencia|formulario|form|codigo|cod)\b/.test(x.a.norm) &&
      x.a.norm.length < 30 &&
      /\d/.test(x.a.text) &&
      x.a.box.y < tY0 + 0.02;
    const below = x.a.box.y > tY1 - 0.002 && x.a.box.y < tY1 + 0.09;
    const section =
      SECTION_RE.test(normalize(x.a.text)) ||
      x.a.text.trim().endsWith(':') ||
      (x.a.text === x.a.text.toUpperCase() && x.a.norm.length < 40 && !below);
    if (isCode) {
      x.a.distinctive = true;
      x.a.weight = 2;
    } else if (below && !section && x.a.norm.length >= 12) {
      x.a.distinctive = true;
      x.a.weight = 1.2;
    }
  }
}

/** Datos personales reales en el texto fijo de la plantilla (no deberían estar en un perfil público). */
export function findPersonalData(texts: string[]): string[] {
  const found: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(/\b([XYZ]?\d{7,8}[\s-]?[A-Z])\b/gi))
      if (!validateDniNie(m[1]!)) found.push(`DNI/NIE: ${m[1]}`);
    for (const m of t.matchAll(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){4,7})\b/g))
      if (!validateIban(m[1]!)) found.push(`IBAN: ${m[1]}`);
    for (const m of t.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g))
      if (!/(example|ejemplo|sede|registro|info)/i.test(m[0])) found.push(`email: ${m[0]}`);
    for (const m of t.matchAll(/(?:\+34\s?)?\b[67]\d{2}\s?\d{3}\s?\d{3}\b/g)) found.push(`teléfono: ${m[0]}`);
  }
  return [...new Set(found)];
}

const prettyName = (s: string) => {
  const t = s.trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

export async function renderTemplateImages(bytes: Uint8Array, env: Env, dpi = 150): Promise<GrayImage[]> {
  const pdf = await openPdf(bytes, env);
  const out: GrayImage[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++)
      out.push(toGray(await renderPage(await pdf.getPage(i), dpi / 72, env)));
  } finally {
    await pdf.destroy();
  }
  return out;
}

/** Genera un perfil a partir de la plantilla vacía (y, opcionalmente, ejemplos rellenos ficticios). */
export async function buildProfile(
  template: Uint8Array,
  env: Env,
  o: BuildOptions = {},
): Promise<BuildResult> {
  const warnings: string[] = [];
  const analysis = await analyzeTemplate(template, env);
  if (analysis.textChars < 40)
    warnings.push('La plantilla casi no tiene texto: ¿es un escaneo? Usa la plantilla PDF original.');
  const examples = await Promise.all((o.examples ?? []).map((e) => analyzeTemplate(e, env)));
  let fields = proposeFields(analysis, { examples });
  if (o.edit) fields = o.edit(fields, analysis);

  // Anclas: con la plantilla vacía, todo el texto es fijo.
  const anchors: Anchor[] = [];
  const sizes: number[] = [];
  const segIndex = new Map<string, number>();
  for (const p of analysis.pages) {
    p.segments.forEach((s, i) => {
      const norm = fold(s.text);
      if (norm.replace(/\s/g, '').length < 2) return;
      segIndex.set(`${p.index}:${i}`, anchors.length);
      anchors.push({ page: p.index, text: s.text, norm, box: s.box });
      sizes.push(s.box.h * p.height);
    });
  }
  markDistinctive(anchors, sizes);
  const pii = findPersonalData(anchors.map((a) => a.text));
  if (pii.length)
    warnings.push(
      `La plantilla parece contener datos personales reales: ${pii.join('; ')}. No publiques el perfil sin revisarlo.`,
    );

  // Estadísticas de tinta de las regiones vacías (para detectar campos rellenos en escaneos).
  const images = await renderTemplateImages(template, env);
  const pfields: ProfileField[] = fields.map((f) => {
    const img = images[f.page]!;
    const kind = f.type === 'checkbox' ? 0.3 : f.type === 'signature' ? 0.08 : 0.18;
    return {
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      page: f.page,
      box: round(f.box),
      anchor: f.labelSeg !== undefined ? segIndex.get(`${f.page}:${f.labelSeg}`) : undefined,
      acroName: f.acroName,
      blank: { ink: +inkRatio(img, f.box, IDENTITY, kind).toFixed(4) },
    };
  });

  const title = anchors
    .filter((a) => a.distinctive && a.page === 0 && (a.weight ?? 0) >= 3)
    .sort((a, b) => a.box.y - b.box.y);
  const name = o.name ?? (title.length ? prettyName(title.map((a) => a.text).join(' ')) : 'Documento');
  const profile: Profile = {
    schemaVersion: SCHEMA_VERSION,
    id: o.id ?? slugify(name).replace(/_/g, '-'),
    name,
    version: o.version ?? '1.0.0',
    issuer: o.issuer,
    pageCount: analysis.pages.length,
    pages: analysis.pages.map((p) => ({ width: +p.width.toFixed(2), height: +p.height.toFixed(2) })),
    anchors: anchors.map((a) => ({
      ...a,
      box: round(a.box),
      weight: a.weight !== undefined ? +a.weight.toFixed(2) : undefined,
    })),
    acroFields: analysis.acro.length
      ? analysis.acro.map((a) => ({ name: a.name, type: acroType(a.type), page: a.page }))
      : undefined,
    fields: pfields,
    visual: {
      modelId: 'none',
      modelVersion: '0',
      input: { width: 0, height: 0 },
      pages: images.map((img) => ({ dhash: dhash(img), prototypes: [] })),
    },
    calibration: structuredClone(DEFAULT_CALIBRATION),
    expect: o.expect,
    thresholds: { ...DEFAULT_THRESHOLDS },
    generator: {
      name: 'docmatch-builder',
      version: BUILDER_VERSION,
      date: new Date().toISOString().slice(0, 10),
    },
  };
  return { profile, analysis, fields, images, warnings };
}

function acroType(t: string): NonNullable<Profile['acroFields']>[number]['type'] {
  if (t === 'checkbox') return 'checkbox';
  if (t === 'radiobutton') return 'radio';
  if (t === 'combobox' || t === 'listbox') return 'choice';
  if (t === 'signature') return 'signature';
  if (t === 'button') return 'button';
  return 'text';
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
function round<T extends { x: number; y: number; w: number; h: number }>(b: T): T {
  return { ...b, x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) };
}
