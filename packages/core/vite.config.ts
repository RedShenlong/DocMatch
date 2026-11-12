import { defineConfig } from 'vite';

// ESM: import { DocMatch } from 'docmatch'. pdf.js, tesseract y onnxruntime se cargan con import()
// dinámico desde assetsPath y quedan fuera del núcleo.
export default defineConfig({
  build: {
    target: 'es2020',
    emptyOutDir: true,
    sourcemap: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'docmatch.js' },
  },
});
