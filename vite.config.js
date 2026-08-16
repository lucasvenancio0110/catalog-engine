import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets make the same build portable across GitHub Pages,
  // custom domains and future tenant subpaths.
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
