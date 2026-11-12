import { defineConfig } from 'vite';

// Worker del modelo visual (módulo ES). onnxruntime-web se importa en tiempo de ejecución desde assets/ort/.
export default defineConfig({
  build: {
    target: 'es2020',
    emptyOutDir: false,
    outDir: 'dist/assets',
    sourcemap: true,
    lib: {
      entry: 'src/browser/vision.worker.ts',
      formats: ['es'],
      fileName: () => 'docmatch-vision.worker.js',
    },
  },
});
