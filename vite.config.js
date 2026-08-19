import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets keep the shared build portable across the storefront and
  // the first-party customer portal host.
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        storefront: resolve(process.cwd(), 'index.html'),
        portal: resolve(process.cwd(), 'app.html')
      }
    }
  }
});
