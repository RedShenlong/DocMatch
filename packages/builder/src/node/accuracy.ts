/**
 * Informe de precisión sobre los fixtures: matriz de confusión por grupo (digitales, escaneados y
 * hold-out), detección de campos en formularios a mano y tiempos.
 *   tsx src/node/accuracy.ts [grupos=all] [--md salida.md]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nodeEnv, terminateOcr } from 'docmatch/node';
import {
  buildAllProfiles,
  FIXTURES,
  loadBuiltProfiles,
  loadManifest,
  runCase,
  type CaseOutcome,
} from './harness';

const STATUSES = ['match', 'incomplete', 'mismatch', 'unreadable', 'error'] as const;
const SETS: Record<string, string[]> = {
  Digitales: ['digital', 'special'],
  'Escaneados (mecanografiados)': ['scan'],
  'Rellenados a mano y escaneados': ['hand'],
  'Hold-out digitales': ['holdout-digital'],
  'Hold-out escaneados': ['holdout-scan', 'holdout-hand'],
};

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--') && !a.endsWith('.md'));
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : join(FIXTURES, 'accuracy-report.md');
const env = nodeEnv({});
const m = loadManifest();
const profiles = loadBuiltProfiles() ?? (await buildAllProfiles(env, m)).profiles;
const visual = [...profiles.values()].some((p) => p.visual?.modelId && p.visual.modelId !== 'none');
const groups = only && only !== 'all' ? only.split(',') : Object.values(SETS).flat();
const outcomes: CaseOutcome[] = [];
for (const c of m.cases.filter((c) => groups.includes(c.group))) {
  const o = await runCase(env, m, profiles, c);
  outcomes.push(o);
  process.stdout.write(
    `${o.ok ? '✓' : '✗'} ${c.file.padEnd(44)} ${o.r.status.padEnd(10)} (esperado ${c.expected.status}) ${Math.round(o.ms)} ms\n`,
  );
}
await terminateOcr();

const lines: string[] = [];
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');
lines.push(
  `# Informe de precisión de DocMatch`,
  '',
  `Fecha: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · modelo visual: ${visual ? 'sí' : 'no'} · casos: ${outcomes.length}`,
  '',
);
lines.push(
  '| Conjunto | Casos | Estado correcto | Estado + campos correctos | Tiempo medio |',
  '|---|---:|---:|---:|---:|',
);
for (const [name, gs] of Object.entries(SETS)) {
  const os = outcomes.filter((o) => gs.includes(o.c.group));
  if (!os.length) continue;
  const avg = os.reduce((a, o) => a + o.ms, 0) / os.length;
  lines.push(
    `| ${name} | ${os.length} | ${pct(os.filter((o) => o.statusOk).length, os.length)} | ${pct(os.filter((o) => o.ok).length, os.length)} | ${(avg / 1000).toFixed(2)} s |`,
  );
}
for (const [name, gs] of Object.entries(SETS)) {
  const os = outcomes.filter((o) => gs.includes(o.c.group));
  if (!os.length) continue;
  lines.push(
    '',
    `## Matriz de confusión — ${name}`,
    '',
    `| esperado \\ obtenido | ${STATUSES.join(' | ')} |`,
    `|---|${STATUSES.map(() => '---:').join('|')}|`,
  );
  for (const e of STATUSES) {
    const row = os.filter((o) => o.c.expected.status === e);
    if (!row.length) continue;
    lines.push(
      `| **${e}** | ${STATUSES.map((g) => row.filter((o) => o.r.status === g).length || '·').join(' | ')} |`,
    );
  }
}
// Campos en escaneos a mano: acierto en "falta" y falsos avisos.
const hand = outcomes.filter((o) => /hand/.test(o.c.group) && o.r.profileId);
let fieldChecks = 0,
  fieldOk = 0,
  falseWarn = 0,
  sigChecks = 0,
  sigOk = 0;
for (const o of hand) {
  const exp = new Set(o.c.expected.missing ?? []);
  const got = new Set(o.r.missingFields.map((f) => f.key));
  const prof = profiles.get(o.r.profileId!)!;
  for (const f of prof.fields.filter((f) => f.required)) {
    fieldChecks++;
    if (exp.has(f.key) === got.has(f.key)) fieldOk++;
    if (!exp.has(f.key) && got.has(f.key)) falseWarn++;
    if (f.type === 'signature') {
      sigChecks++;
      if (exp.has(f.key) === got.has(f.key)) sigOk++;
    }
  }
}
lines.push(
  '',
  '## Campos en formularios rellenados a mano',
  '',
  `- Campos obligatorios evaluados: ${fieldChecks}`,
  `- Acierto (relleno / vacío): ${pct(fieldOk, fieldChecks)}`,
  `- Falsos avisos de «falta»: ${pct(falseWarn, fieldChecks)}`,
  `- Detección de firma: ${pct(sigOk, sigChecks)} (${sigChecks} firmas)`,
);
const fails = outcomes.filter((o) => !o.ok);
if (fails.length) {
  lines.push('', '## Casos fallidos', '');
  for (const o of fails)
    lines.push(
      `- \`${o.c.file}\` (${o.c.description}): esperado ${o.c.expected.status}${o.c.expected.missing ? ` falta=${o.c.expected.missing}` : ''}; obtenido ${o.r.status}${o.r.missingFields.length ? ` falta=${o.r.missingFields.map((f) => f.key)}` : ''}${o.r.invalidFields.length ? ` inválidos=${o.r.invalidFields.map((f) => f.key)}` : ''}`,
    );
}
const md = lines.join('\n') + '\n';
writeFileSync(mdOut!, md);
writeFileSync(
  mdOut!.replace(/\.md$/, '.json'),
  JSON.stringify(
    outcomes.map((o) => ({
      file: o.c.file,
      group: o.c.group,
      expected: o.c.expected,
      status: o.r.status,
      profileId: o.r.profileId,
      missing: o.r.missingFields.map((f) => f.key),
      invalid: o.r.invalidFields.map((f) => f.key),
      warnings: o.r.warnings,
      score: o.r.score,
      ok: o.ok,
      ms: Math.round(o.ms),
    })),
    null,
    1,
  ),
);
console.log('\n' + md);
