import { defineConfig } from 'vite';

// App web estática del builder. `pnpm web:prepare` copia los recursos del runtime (pdf.js, OCR, modelo)
// y las fuentes manuscritas a web/public para que funcione sin conexión.
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: 'public',
  build: { outDir: '../dist-web', emptyOutDir: true, target: 'es2022' },
  server: { port: 5174 },
  worker: { format: 'es' },
});
