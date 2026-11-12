// Prepara la demo estática en examples/demo/public: runtime, perfiles y PDF de ejemplo.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
const out = new URL('./public/', import.meta.url).pathname;
const core = new URL('../../packages/core/dist/', import.meta.url).pathname;
const fx = new URL('../../packages/fixtures/out/', import.meta.url).pathname;
if (!existsSync(core + 'docmatch.min.js')) throw new Error('Primero: pnpm --filter docmatch build');
if (!existsSync(fx + 'profiles'))
  throw new Error(
    'Primero: pnpm --filter @docmatch/fixtures generate && pnpm --filter @docmatch/builder profiles',
  );
mkdirSync(out + 'samples', { recursive: true });
cpSync(core, out + 'docmatch', { recursive: true, filter: (p) => !p.includes('/types') });
cpSync(fx + 'profiles', out + 'profiles', { recursive: true });
for (const f of readdirSync(fx + 'cases')) cpSync(fx + 'cases/' + f, out + 'samples/' + f);
console.log('demo lista en', out);
