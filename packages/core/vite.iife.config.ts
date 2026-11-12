import { defineConfig } from 'vite';

// IIFE para <script src="docmatch.min.js">: window.DocMatch y activación automática de [data-docmatch].
export default defineConfig({
  build: {
    target: 'es2020',
    emptyOutDir: false,
    sourcemap: true,
    lib: { entry: 'src/auto.ts', formats: ['iife'], name: 'DocMatch', fileName: () => 'docmatch.min.js' },
    rollupOptions: { output: { exports: 'default' } },
  },
});
