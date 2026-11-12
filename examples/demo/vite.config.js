import { defineConfig } from 'vite';
// La demo es HTML estático: Vite solo sirve los archivos (no empaqueta docmatch, que se carga con <script>).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
});
