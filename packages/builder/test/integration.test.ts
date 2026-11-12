/**
 * Integración: todos los fixtures digitales y especiales con su estado esperado (sin OCR, rápido).
 * Los escaneados (OCR) se evalúan con `pnpm --filter @docmatch/builder accuracy` (tarda varios minutos).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeEnv, terminateOcr } from 'docmatch/node';
import { buildAllProfiles, FIXTURES, loadBuiltProfiles, loadManifest, runCase } from '../src/node/harness';

const has = existsSync(join(FIXTURES, 'manifest.json'));
describe.skipIf(!has)('fixtures digitales', async () => {
  const env = nodeEnv({ ocr: false });
  const m = loadManifest();
  const built = loadBuiltProfiles() ?? (await buildAllProfiles(env, m)).profiles;
  afterAll(() => terminateOcr());
  for (const c of m.cases.filter((c) => ['digital', 'special', 'holdout-digital'].includes(c.group))) {
    it(`${c.file} → ${c.expected.status}`, async () => {
      const o = await runCase(env, m, built, c);
      expect({
        status: o.r.status,
        profileId: o.r.profileId,
        missing: o.r.missingFields.map((f) => f.key).sort(),
        invalid: o.r.invalidFields.map((f) => f.key).sort(),
      }).toMatchObject({
        status: c.expected.status,
        ...(c.expected.profileId ? { profileId: c.expected.profileId } : {}),
        ...(c.expected.missing ? { missing: [...c.expected.missing].sort() } : {}),
        ...(c.expected.invalid ? { invalid: [...c.expected.invalid].sort() } : {}),
      });
      if (c.expected.warnings) expect(o.r.warnings.sort()).toEqual([...c.expected.warnings].sort());
      // Rendimiento: un PDF digital de 2 páginas en menos de 1 s.
      expect(o.ms).toBeLessThan(1000);
    });
  }
});
