#!/usr/bin/env node
/**
 * docmatch-build plantilla.pdf -o perfil.json [opciones]
 *
 *   -o, --out <archivo>         perfil de salida (por defecto <plantilla>.profile.json)
 *   -e, --example <pdf>         ejemplo relleno con datos ficticios (repetible, máx. 3)
 *       --id <id> --name <nombre> --version <v> --issuer <organismo>
 *       --expect-csv            el documento debe llevar Código Seguro de Verificación
 *       --expect-signature      el documento debe llevar firma electrónica
 *       --fields <json>         campos revisados por el dueño (sustituye a los propuestos)
 *       --fields-out <json>     guarda los campos propuestos para revisarlos y editarlos
 *       --required a,b          marca campos como obligatorios   --optional c,d  como opcionales
 *       --model <dir>           carpeta del modelo (model.onnx, model.json, negatives.json)
 *       --no-visual             no entrena la parte visual (sin modelo)
 *       --strict                falla si detecta datos personales en la plantilla
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { nodeEnv, terminateOcr } from 'docmatch/node';
import { validateProfile } from './lib/schema';
import { buildProfile } from './lib/profile';
import type { ProposedField } from './lib/propose';
import { trainVisual } from './lib/visual';
import { handFontsNode } from './node/fonts';

async function main() {
  const { values: a, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      example: { type: 'string', short: 'e', multiple: true },
      id: { type: 'string' },
      name: { type: 'string' },
      version: { type: 'string' },
      issuer: { type: 'string' },
      'expect-csv': { type: 'boolean' },
      'expect-signature': { type: 'boolean' },
      fields: { type: 'string' },
      'fields-out': { type: 'string' },
      required: { type: 'string' },
      optional: { type: 'string' },
      model: { type: 'string' },
      'no-visual': { type: 'boolean' },
      strict: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (a.help || !positionals[0]) {
    console.log(
      readFileSync(new URL(import.meta.url), 'utf8')
        .split('*/')[0]!
        .replace(/^#!.*\n\/\*\*?/, '')
        .replace(/^ \* ?/gm, ''),
    );
    process.exit(a.help ? 0 : 1);
  }
  const tplPath = positionals[0];
  const out = a.out ?? tplPath.replace(/\.pdf$/i, '') + '.profile.json';
  const env = nodeEnv({ modelDir: a.model, ocr: false });
  const t0 = Date.now();
  const req = new Set((a.required ?? '').split(',').filter(Boolean));
  const opt = new Set((a.optional ?? '').split(',').filter(Boolean));
  const res = await buildProfile(new Uint8Array(readFileSync(tplPath)), env, {
    id: a.id,
    name: a.name,
    version: a.version,
    issuer: a.issuer,
    examples: (a.example ?? []).slice(0, 3).map((p) => new Uint8Array(readFileSync(p))),
    expect:
      a['expect-csv'] || a['expect-signature']
        ? { csv: !!a['expect-csv'], digitalSignature: !!a['expect-signature'] }
        : undefined,
    edit: (fields) => {
      let fs: ProposedField[] = a.fields ? JSON.parse(readFileSync(a.fields, 'utf8')) : fields;
      fs = fs.map((f) => ({ ...f, required: req.has(f.key) ? true : opt.has(f.key) ? false : f.required }));
      if (a['fields-out']) writeFileSync(a['fields-out'], JSON.stringify(fields, null, 2));
      return fs;
    },
  });
  for (const w of res.warnings) console.warn(`⚠ ${w}`);
  if (a.strict && res.warnings.some((w) => w.includes('datos personales'))) process.exit(2);
  console.log(
    `Plantilla: ${res.profile.name} (${res.profile.pageCount} pág., ${res.profile.anchors.length} anclas, ${res.profile.anchors.filter((x) => x.distinctive).length} distintivas)`,
  );
  console.log(`Campos propuestos (${res.profile.fields.length}):`);
  for (const f of res.profile.fields)
    console.log(
      `  ${f.required ? '*' : ' '} ${f.key.padEnd(28)} ${f.type.padEnd(11)} pág.${f.page + 1}  «${f.label}»`,
    );
  if (!a['no-visual']) {
    const engine = await env.vision!();
    if (!engine) console.warn('⚠ No hay modelo visual: se calibran solo el texto y la tinta.');
    const rep = await trainVisual(new Uint8Array(readFileSync(tplPath)), res.profile, env, engine, {
      handFonts: handFontsNode(),
      onProgress: (m, f) =>
        process.stdout.write(`\r  ${String(Math.round(f * 100)).padStart(3)} % ${m.padEnd(40)}`),
    });
    process.stdout.write('\n');
    console.log(
      `Precisión estimada: ${(rep.estimatedAccuracy * 100).toFixed(1)} % ` +
        `(escaneos: FP ${(rep.fusion.scan.fpr * 100).toFixed(1)} %, FN ${(rep.fusion.scan.fnr * 100).toFixed(1)} %; ` +
        `campos: FP ${(rep.fields.fpr * 100).toFixed(1)} %, FN ${(rep.fields.fnr * 100).toFixed(1)} %) en ${rep.seconds.toFixed(0)} s`,
    );
  }
  const errs = validateProfile(res.profile);
  if (errs.length) {
    console.error('El perfil no cumple el esquema:', errs);
    process.exit(3);
  }
  writeFileSync(out, JSON.stringify(res.profile));
  console.log(
    `Perfil → ${out} (${(JSON.stringify(res.profile).length / 1024).toFixed(0)} KB) en ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  await terminateOcr();
}

main().catch((e) => {
  console.error(`docmatch-build: ${(e as Error).message ?? e}`);
  process.exit(1);
});

export { basename };
