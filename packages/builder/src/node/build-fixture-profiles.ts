/**
 * Genera los perfiles de todas las plantillas de los fixtures (con la parte visual si hay modelo) en
 * packages/fixtures/out/profiles/. Simula la revisión del dueño con la verdad de campo del generador.
 *   tsx src/node/build-fixture-profiles.ts [--no-visual]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nodeEnv } from 'docmatch/node';
import { buildAllProfiles, FIXTURES, loadManifest } from './harness';
import { trainVisual } from '../lib/visual';
import { handFontsNode } from './fonts';
import { validateProfile } from '../lib/schema';

const noVisual = process.argv.includes('--no-visual');
const out = join(FIXTURES, 'profiles');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const env = nodeEnv({ ocr: false });
const engine = noVisual ? null : await env.vision!();
const m = loadManifest();
const report: Record<string, unknown> = {};
const { profiles, detection } = await buildAllProfiles(env, m, async (id, bytes, p) => {
  const t = Date.now();
  const rep = await trainVisual(bytes, p, env, engine, { handFonts: handFontsNode() });
  report[id] = { ...rep, buildSeconds: (Date.now() - t) / 1000 };
  process.stdout.write(
    `${id}: precisión estimada ${(rep.estimatedAccuracy * 100).toFixed(1)} % en ${rep.seconds.toFixed(0)} s\n`,
  );
});
for (const [id, p] of profiles) {
  const errs = validateProfile(p);
  if (errs.length) throw new Error(`${id}: ${errs.join('; ')}`);
  writeFileSync(join(out, `${id}.json`), JSON.stringify(p));
}
writeFileSync(
  join(out, '_build-report.json'),
  JSON.stringify(
    {
      model: engine ? `${engine.modelId} ${engine.modelVersion}` : null,
      detection: Object.fromEntries(detection),
      report,
    },
    null,
    1,
  ),
);
console.log(`${profiles.size} perfiles → ${out}`);
