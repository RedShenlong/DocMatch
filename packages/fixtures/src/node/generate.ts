/**
 * Genera el conjunto de fixtures de prueba en packages/fixtures/out/:
 *   templates/<id>.pdf + <id>.layout.json   plantillas vacías (para generar perfiles) y verdad de campo
 *   cases/<name>.pdf                        casos de prueba
 *   manifest.json                           estado esperado de cada caso
 * Uso: pnpm --filter @docmatch/fixtures generate
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { valueFor, person, dni, date } from '../fake';
import { renderForeign, type ForeignKind } from '../foreign';
import { renderDocument } from '../render';
import { Rng, hashSeed } from '../rng';
import { addFakeDigitalSignature, makeCorrupt, makeEncrypted, makeNotPdf } from '../special';
import type { FillOptions, TemplateLayout, TemplateSpec } from '../spec';
import {
  EMPADRONAMIENTO,
  EMPADRONAMIENTO_B,
  HOLDOUT_SEEDS,
  LICENCIA,
  LICENCIA_PRIMO,
  cousinOf,
  randomTemplate,
} from '../templates';
import { loadHandFonts } from './fonts';
import { renderPdfPages } from './pdfjs';
import { simulateScan } from './scan';

export type Status = 'match' | 'incomplete' | 'mismatch' | 'unreadable' | 'error';
export interface Case {
  file: string;
  group: 'digital' | 'scan' | 'hand' | 'special' | 'holdout-digital' | 'holdout-scan' | 'holdout-hand';
  input: string;
  expected: {
    status: Status;
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

const OUT = fileURLToPath(new URL('../../out/', import.meta.url));

function values(layout: TemplateLayout, seed: number): Record<string, string> {
  const r = new Rng(seed);
  const p = person(r);
  const v: Record<string, string> = {};
  for (const f of layout.fields) {
    if (f.type === 'checkbox') {
      if (f.required || r.bool(0.5)) v[f.key] = 'X';
    } else v[f.key] = valueFor(f.type, f.key, r, p);
  }
  return v;
}

const requiredKeys = (l: TemplateLayout, types?: string[]) =>
  l.fields.filter((f) => f.required && (!types || types.includes(f.type))).map((f) => f.key);

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}templates`, { recursive: true });
  mkdirSync(`${OUT}cases`, { recursive: true });
  loadHandFonts();
  const manifest: Manifest = { inputs: {}, templates: {}, cases: [] };
  const layouts = new Map<string, TemplateLayout>();

  async function template(spec: TemplateSpec, holdout = false) {
    const { bytes, layout } = await renderDocument(spec);
    writeFileSync(`${OUT}templates/${spec.id}.pdf`, bytes);
    writeFileSync(`${OUT}templates/${spec.id}.layout.json`, JSON.stringify(layout, null, 1));
    manifest.templates[spec.id] = {
      pdf: `templates/${spec.id}.pdf`,
      layout: `templates/${spec.id}.layout.json`,
      holdout,
    };
    layouts.set(spec.id, layout);
    return layout;
  }

  async function add(name: string, bytes: Uint8Array, c: Omit<Case, 'file'>) {
    const file = `cases/${name}.pdf`;
    writeFileSync(OUT + file, bytes);
    manifest.cases.push({ file, ...c });
    process.stdout.write('.');
  }

  async function doc(spec: TemplateSpec, fill: Partial<FillOptions> & { seed: number }) {
    const layout = layouts.get(spec.id) ?? (await renderDocument(spec)).layout;
    const vals = fill.values ?? values(layout, fill.seed);
    return (await renderDocument(spec, { mode: 'typed', signed: true, ...fill, values: vals })).bytes;
  }

  // ---------- Plantillas ----------
  const lic = await template(LICENCIA);
  await template(EMPADRONAMIENTO);
  await template(EMPADRONAMIENTO_B);
  manifest.inputs.licencia = [LICENCIA.id];
  manifest.inputs.empadronamiento = [EMPADRONAMIENTO.id, EMPADRONAMIENTO_B.id];

  const L = LICENCIA.id;
  // ---------- Digitales: licencia ----------
  await add('lic-vacia', await doc(LICENCIA, { seed: 1, values: {}, signed: false }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: requiredKeys(lic) },
    description: 'Plantilla correcta sin rellenar',
  });
  for (const s of [11, 12, 13]) {
    await add(`lic-rellena-${s}`, await doc(LICENCIA, { seed: s }), {
      group: 'digital',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Formulario correcto relleno (texto)',
    });
  }
  await add('lic-acroform', await doc(LICENCIA, { seed: 14, acroform: true }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'match', profileId: L },
    description: 'Formulario correcto relleno con campos AcroForm',
  });
  await add('lic-acroform-sin-dni', await doc(LICENCIA, { seed: 15, acroform: true, omit: ['dni'] }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: ['dni'] },
    description: 'AcroForm sin DNI',
  });
  await add('lic-sin-dni', await doc(LICENCIA, { seed: 16, omit: ['dni'] }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: ['dni'] },
    description: 'Falta el DNI/NIE',
  });
  await add(
    'lic-sin-telefono-domicilio',
    await doc(LICENCIA, { seed: 17, omit: ['telefono', 'domicilio'] }),
    {
      group: 'digital',
      input: 'licencia',
      expected: { status: 'incomplete', profileId: L, missing: ['domicilio', 'telefono'] },
      description: 'Faltan teléfono y domicilio',
    },
  );
  {
    const r = new Rng(18);
    const v = values(lic, 18);
    v.dni = dni(r, false);
    v.fecha_nacimiento = date(r, false);
    await add('lic-dni-y-fecha-invalidos', await doc(LICENCIA, { seed: 18, values: v }), {
      group: 'digital',
      input: 'licencia',
      expected: { status: 'incomplete', profileId: L, invalid: ['dni', 'fecha_nacimiento'] },
      description: 'DNI con letra incorrecta y fecha inválida',
    });
  }
  await add('lic-sin-firma', await doc(LICENCIA, { seed: 19, signed: false }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: ['firma'] },
    description: 'Sin firma manuscrita',
  });
  await add('primo-rellena', await doc(LICENCIA_PRIMO, { seed: 20 }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Formulario primo (mismo diseño, distinto título)',
  });
  await add('primo-vacia', await doc(LICENCIA_PRIMO, { seed: 21, values: {}, signed: false }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Formulario primo vacío',
  });
  const foreignKinds: ForeignKind[] = [
    'factura',
    'matrimonio',
    'nomina',
    'contrato',
    'carta',
    'recibo',
    'certificado',
  ];
  for (const k of foreignKinds) {
    await add(`ajeno-${k}`, await renderForeign(k, hashSeed('fixture', k)), {
      group: 'digital',
      input: 'licencia',
      expected: { status: 'mismatch' },
      description: `Documento ajeno: ${k}`,
    });
  }
  await add('lic-input-con-empadronamiento', await doc(EMPADRONAMIENTO, { seed: 22, csv: true }), {
    group: 'digital',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Otro formulario oficial (certificado de empadronamiento)',
  });

  // ---------- Digitales: empadronamiento (dos plantillas válidas, CSV y firma) ----------
  const E = EMPADRONAMIENTO.id;
  const EB = EMPADRONAMIENTO_B.id;
  await add(
    'emp-a-emitido',
    await addFakeDigitalSignature(await doc(EMPADRONAMIENTO, { seed: 30, csv: true, signed: false })),
    {
      group: 'digital',
      input: 'empadronamiento',
      expected: { status: 'match', profileId: E, warnings: [] },
      description: 'Certificado A con CSV y firma electrónica',
    },
  );
  await add(
    'emp-b-emitido',
    await addFakeDigitalSignature(await doc(EMPADRONAMIENTO_B, { seed: 31, csv: true, signed: false })),
    {
      group: 'digital',
      input: 'empadronamiento',
      expected: { status: 'match', profileId: EB, warnings: [] },
      description: 'Certificado B (otro ayuntamiento) con CSV y firma',
    },
  );
  await add('emp-a-sin-csv-ni-firma', await doc(EMPADRONAMIENTO, { seed: 32, signed: false }), {
    group: 'digital',
    input: 'empadronamiento',
    expected: { status: 'match', profileId: E, warnings: ['csv', 'digitalSignature'] },
    description: 'Certificado sin CSV ni firma electrónica (avisos)',
  });
  await add(
    'emp-a-sin-dni',
    await addFakeDigitalSignature(
      await doc(EMPADRONAMIENTO, { seed: 33, csv: true, signed: false, omit: ['dni'] }),
    ),
    {
      group: 'digital',
      input: 'empadronamiento',
      expected: { status: 'incomplete', profileId: E, missing: ['dni'] },
      description: 'Certificado sin DNI',
    },
  );
  await add('emp-input-con-licencia', await doc(LICENCIA, { seed: 34 }), {
    group: 'digital',
    input: 'empadronamiento',
    expected: { status: 'mismatch' },
    description: 'Licencia subida donde se pide empadronamiento',
  });
  await add('emp-input-con-factura', await renderForeign('factura', 35), {
    group: 'digital',
    input: 'empadronamiento',
    expected: { status: 'mismatch' },
    description: 'Factura donde se pide empadronamiento',
  });

  // ---------- Escaneos simulados (texto mecanografiado) ----------
  const scan = (b: Uint8Array, seed: number, override?: Parameters<typeof simulateScan>[2]) =>
    simulateScan(b, seed, override);
  for (const s of [40, 41, 42]) {
    await add(`scan-lic-rellena-${s}`, await scan(await doc(LICENCIA, { seed: s }), s), {
      group: 'scan',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Escaneo del formulario correcto',
    });
  }
  await add(
    'scan-lic-rot180',
    await scan(await doc(LICENCIA, { seed: 43 }), 43, { override: { quarterTurns: 2 } }),
    {
      group: 'scan',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Escaneo girado 180°',
    },
  );
  await add(
    'scan-lic-rot90',
    await scan(await doc(LICENCIA, { seed: 44 }), 44, { override: { quarterTurns: 1 } }),
    {
      group: 'scan',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Escaneo girado 90°',
    },
  );
  await add(
    'scan-lic-inclinado',
    await scan(await doc(LICENCIA, { seed: 45 }), 45, { override: { rotation: 2.5 } }),
    {
      group: 'scan',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Escaneo inclinado 2,5°',
    },
  );
  await add('scan-lic-sin-dni', await scan(await doc(LICENCIA, { seed: 46, omit: ['dni'] }), 46), {
    group: 'scan',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: ['dni'] },
    description: 'Escaneo sin DNI',
  });
  {
    const r = new Rng(47);
    const v = values(lic, 47);
    v.dni = dni(r, false);
    v.fecha_nacimiento = date(r, false);
    await add(
      'scan-lic-invalidos',
      await scan(await doc(LICENCIA, { seed: 47, values: v }), 47, { strength: 0.5 }),
      {
        group: 'scan',
        input: 'licencia',
        expected: { status: 'incomplete', profileId: L, invalid: ['dni', 'fecha_nacimiento'] },
        description: 'Escaneo nítido con DNI y fecha inválidos',
      },
    );
  }
  await add('scan-lic-sin-firma', await scan(await doc(LICENCIA, { seed: 48, signed: false }), 48), {
    group: 'scan',
    input: 'licencia',
    expected: { status: 'incomplete', profileId: L, missing: ['firma'] },
    description: 'Escaneo sin firma',
  });
  await add('scan-primo', await scan(await doc(LICENCIA_PRIMO, { seed: 49 }), 49), {
    group: 'scan',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Escaneo del formulario primo',
  });
  await add('scan-factura', await scan(await renderForeign('factura', 50), 50), {
    group: 'scan',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Escaneo de una factura',
  });
  await add('scan-matrimonio', await scan(await renderForeign('matrimonio', 51), 51), {
    group: 'scan',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Escaneo de un certificado de matrimonio',
  });
  await add(
    'scan-emp-a',
    await scan(await doc(EMPADRONAMIENTO, { seed: 52, csv: true, signed: false }), 52),
    {
      group: 'scan',
      input: 'empadronamiento',
      expected: { status: 'match', profileId: E },
      description: 'Escaneo del certificado A',
    },
  );
  await add(
    'scan-emp-b',
    await scan(await doc(EMPADRONAMIENTO_B, { seed: 53, csv: true, signed: false }), 53),
    {
      group: 'scan',
      input: 'empadronamiento',
      expected: { status: 'match', profileId: EB },
      description: 'Escaneo del certificado B',
    },
  );

  // ---------- Rellenados a mano y escaneados ----------
  const handRequired = requiredKeys(lic).filter((k) => !['firma'].includes(k));
  for (let i = 0; i < 6; i++) {
    const s = 100 + i;
    await add(`hand-lic-completa-${i}`, await scan(await doc(LICENCIA, { seed: s, mode: 'hand' }), s), {
      group: 'hand',
      input: 'licencia',
      expected: { status: 'match', profileId: L },
      description: 'Rellenado a mano, completo y firmado',
    });
    const r = new Rng(s);
    const miss = r.pick(handRequired);
    await add(
      `hand-lic-sin-${miss}-${i}`,
      await scan(await doc(LICENCIA, { seed: s + 50, mode: 'hand', omit: [miss] }), s + 50),
      {
        group: 'hand',
        input: 'licencia',
        expected: { status: 'incomplete', profileId: L, missing: [miss] },
        description: `Rellenado a mano sin ${miss}`,
      },
    );
    await add(
      `hand-lic-sin-firma-${i}`,
      await scan(await doc(LICENCIA, { seed: s + 80, mode: 'hand', signed: false }), s + 80),
      {
        group: 'hand',
        input: 'licencia',
        expected: { status: 'incomplete', profileId: L, missing: ['firma'] },
        description: 'Rellenado a mano sin firma',
      },
    );
  }
  await add('hand-primo', await scan(await doc(LICENCIA_PRIMO, { seed: 190, mode: 'hand' }), 190), {
    group: 'hand',
    input: 'licencia',
    expected: { status: 'mismatch' },
    description: 'Primo rellenado a mano',
  });

  // ---------- Hold-out: plantillas que el encoder nunca ve ----------
  const hold = HOLDOUT_SEEDS.map((s) => randomTemplate(s));
  for (const [i, t] of hold.entries()) {
    const lay = await template(t, true);
    const input = `holdout-${i}`;
    manifest.inputs[input] = [t.id];
    const s = 500 + i * 10;
    const other = hold[(i + 1) % hold.length] as TemplateSpec;
    const cousin = cousinOf(t, s);
    await add(`ho${i}-rellena`, await doc(t, { seed: s }), {
      group: 'holdout-digital',
      input,
      expected: { status: 'match', profileId: t.id },
      description: 'Hold-out: correcto digital',
    });
    await add(`ho${i}-primo`, await doc(cousin, { seed: s + 1 }), {
      group: 'holdout-digital',
      input,
      expected: { status: 'mismatch' },
      description: 'Hold-out: primo digital',
    });
    await add(`ho${i}-otra`, await doc(other, { seed: s + 2 }), {
      group: 'holdout-digital',
      input,
      expected: { status: 'mismatch' },
      description: 'Hold-out: otra plantilla',
    });
    await add(`ho${i}-scan-rellena`, await scan(await doc(t, { seed: s + 3 }), s + 3), {
      group: 'holdout-scan',
      input,
      expected: { status: 'match', profileId: t.id },
      description: 'Hold-out: correcto escaneado',
    });
    const miss = new Rng(s).pick(requiredKeys(lay).filter((k) => !['firma'].includes(k)));
    await add(`ho${i}-scan-sin-${miss}`, await scan(await doc(t, { seed: s + 4, omit: [miss] }), s + 4), {
      group: 'holdout-scan',
      input,
      expected: { status: 'incomplete', profileId: t.id, missing: [miss] },
      description: `Hold-out: escaneo sin ${miss}`,
    });
    await add(`ho${i}-scan-primo`, await scan(await doc(cousin, { seed: s + 5 }), s + 5), {
      group: 'holdout-scan',
      input,
      expected: { status: 'mismatch' },
      description: 'Hold-out: primo escaneado',
    });
    await add(
      `ho${i}-scan-ajeno`,
      await scan(await renderForeign(foreignKinds[i % foreignKinds.length] as ForeignKind, s + 6), s + 6),
      {
        group: 'holdout-scan',
        input,
        expected: { status: 'mismatch' },
        description: 'Hold-out: documento ajeno escaneado',
      },
    );
    await add(`ho${i}-hand-completa`, await scan(await doc(t, { seed: s + 7, mode: 'hand' }), s + 7), {
      group: 'holdout-hand',
      input,
      expected: { status: 'match', profileId: t.id },
      description: 'Hold-out: a mano completo',
    });
    await add(
      `ho${i}-hand-sin-firma`,
      await scan(await doc(t, { seed: s + 8, mode: 'hand', signed: false }), s + 8),
      {
        group: 'holdout-hand',
        input,
        expected: { status: 'incomplete', profileId: t.id, missing: ['firma'] },
        description: 'Hold-out: a mano sin firma',
      },
    );
  }

  // ---------- Archivos especiales ----------
  const base = await doc(LICENCIA, { seed: 60 });
  await add('especial-cifrado', await makeEncrypted(base, 61), {
    group: 'special',
    input: 'licencia',
    expected: { status: 'unreadable' },
    description: 'PDF protegido con contraseña',
  });
  await add('especial-corrupto', makeCorrupt(base, 62), {
    group: 'special',
    input: 'licencia',
    expected: { status: 'unreadable' },
    description: 'PDF corrupto',
  });
  const photo = (await renderPdfPages(await renderForeign('carta', 63), 40))[0]!;
  await add('especial-no-es-pdf', makeNotPdf(await photo.encode('jpeg', 70)), {
    group: 'special',
    input: 'licencia',
    expected: { status: 'unreadable' },
    description: 'Imagen JPEG con extensión .pdf',
  });

  writeFileSync(`${OUT}manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(
    `\n${manifest.cases.length} casos, ${Object.keys(manifest.templates).length} plantillas → ${OUT}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
