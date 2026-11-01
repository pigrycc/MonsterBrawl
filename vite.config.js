import { defineConfig } from 'vite';

// Relative base so the built app loads correctly via file:// inside Electron
// (GDD §1: self-contained packaged build, no server needed to reach the lobby).
export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
