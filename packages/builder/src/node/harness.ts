/**
 * Utilidades para ejecutar DocMatch sobre los fixtures generados (tests de integración e informe de precisión).
 * Genera un perfil por plantilla con el builder y simula la revisión del dueño: cada campo propuesto
 * se empareja con la verdad de campo del generador (clave, tipo y obligatoriedad).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocument, type Env, type Profile, type RelBox } from 'docmatch/internal';
import type { Result } from 'docmatch/internal';
import { buildProfile, type BuildOptions } from '../lib/profile';
import type { ProposedField } from '../lib/propose';

export const FIXTURES = fileURLToPath(new URL('../../../fixtures/out/', import.meta.url));

export interface GtField {
  key: string;
  label: string;
  type: ProposedField['type'];
  required: boolean;
  page: number;
  box: RelBox;
}
export interface Case {
  file: string;
  group: string;
  input: string;
  expected: {
    status: string;
    profileId?: string;
    missing?: string[];
    invalid?: string[];
    warnings?: string[];
  };
  description: string;
}
export interface Manifest {
  inputs: Record<string, string[]>;
  templates: Record<string, { pdf: string; layout: string; holdout: boolean }>;
  cases: Case[];
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'));
}

const iou = (a: RelBox, b: RelBox) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
};

/** Empareja propuestas con la verdad de campo. Devuelve también métricas de detección de campos. */
export function applyGroundTruth(fields: ProposedField[], gt: GtField[]) {
  const used = new Set<GtField>();
  const out: ProposedField[] = [];
  for (const f of fields) {
    const m = gt
      .filter((g) => g.page === f.page && !used.has(g))
      .map((g) => ({ g, s: iou(g.box, f.box) }))
      .sort((a, b) => b.s - a.s)[0];
    if (m && m.s > 0.3) {
      used.add(m.g);
      out.push({ ...f, key: m.g.key, type: m.g.type, required: m.g.required, label: f.label || m.g.label });
    }
  }
  const missed = gt.filter((g) => !used.has(g));
  // El dueño añade a mano los que el builder no propuso.
  for (const g of missed)
    out.push({
      key: g.key,
      label: g.label,
      type: g.type,
      required: g.required,
      page: g.page,
      box: g.box,
      source: 'manual',
    });
  return {
    fields: out,
    detected: used.size,
    total: gt.length,
    spurious: fields.length - used.size,
    missed: missed.map((g) => g.key),
  };
}

export interface BuiltProfiles {
  profiles: Map<string, Profile>;
  detection: Map<string, ReturnType<typeof applyGroundTruth>>;
}

/** Carga los perfiles ya generados por build-fixture-profiles.ts (si existen). */
export function loadBuiltProfiles(): Map<string, Profile> | null {
  const dir = join(FIXTURES, 'profiles');
  if (!existsSync(join(dir, '_build-report.json'))) return null;
  const m = loadManifest();
  return new Map(
    Object.keys(m.templates).map((id) => [
      id,
      JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as Profile,
    ]),
  );
}

export async function buildAllProfiles(
  env: Env,
  m: Manifest,
  extra?: (id: string, bytes: Uint8Array, p: Profile) => Promise<void>,
  cacheDir?: string,
): Promise<BuiltProfiles> {
  const profiles = new Map<string, Profile>();
  const detection = new Map<string, ReturnType<typeof applyGroundTruth>>();
  for (const [id, t] of Object.entries(m.templates)) {
    const cached = cacheDir && join(cacheDir, `${id}.json`);
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, t.pdf)));
    const gt = JSON.parse(readFileSync(join(FIXTURES, t.layout), 'utf8')).fields as GtField[];
    let det: ReturnType<typeof applyGroundTruth> | undefined;
    if (cached && existsSync(cached)) {
      profiles.set(id, JSON.parse(readFileSync(cached, 'utf8')));
      continue;
    }
    const opts: BuildOptions = {
      id,
      expect: id.includes('empadronamiento') ? { csv: true, digitalSignature: true } : undefined,
      edit: (fields) => {
        det = applyGroundTruth(fields, gt);
        return det.fields;
      },
    };
    const { profile } = await buildProfile(bytes, env, opts);
    if (extra) await extra(id, bytes, profile);
    profiles.set(id, profile);
    detection.set(id, det!);
    if (cached) {
      mkdirSync(cacheDir!, { recursive: true });
      writeFileSync(cached, JSON.stringify(profile));
    }
  }
  return { profiles, detection };
}

export interface CaseOutcome {
  c: Case;
  r: Result;
  ok: boolean;
  statusOk: boolean;
  fieldsOk: boolean;
  ms: number;
}

export function evaluate(c: Case, r: Result): { ok: boolean; statusOk: boolean; fieldsOk: boolean } {
  const e = c.expected;
  const statusOk = r.status === e.status && (!e.profileId || r.profileId === e.profileId);
  let fieldsOk = true;
  if (statusOk && e.missing) {
    const got = new Set(r.missingFields.map((f) => f.key));
    fieldsOk &&= e.missing.every((k) => got.has(k)) && got.size === e.missing.length;
  }
  if (statusOk && e.invalid) {
    const got = r.invalidFields.map((f) => f.key);
    // En escaneos solo se valida el formato si el OCR es fiable: basta con detectar alguno de los
    // inválidos esperados y no inventar otros.
    const scanned = /scan|hand/.test(c.group);
    fieldsOk &&= scanned
      ? got.length > 0 && got.every((k) => e.invalid!.includes(k))
      : e.invalid.every((k) => got.includes(k));
  }
  if (statusOk && e.status === 'match')
    fieldsOk &&= r.missingFields.length === 0 && r.invalidFields.length === 0;
  if (statusOk && e.warnings)
    fieldsOk &&= e.warnings.length === r.warnings.length && e.warnings.every((w) => r.warnings.includes(w));
  return { ok: statusOk && fieldsOk, statusOk, fieldsOk };
}

export async function runCase(
  env: Env,
  m: Manifest,
  profiles: Map<string, Profile>,
  c: Case,
  debug = false,
): Promise<CaseOutcome> {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, c.file)));
  const ps = m.inputs[c.input]!.map((id) => profiles.get(id)!);
  const t = performance.now();
  const r = await checkDocument(bytes, ps, env, { debug });
  return { c, r, ...evaluate(c, r), ms: performance.now() - t };
}
