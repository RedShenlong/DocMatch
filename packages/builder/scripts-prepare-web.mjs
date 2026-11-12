import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('web/public', { recursive: true });
cpSync('../core/dist/assets', 'web/public/assets', { recursive: true });
cpSync('../fixtures/fonts', 'web/public/fonts', { recursive: true });
console.log('web/public listo');
