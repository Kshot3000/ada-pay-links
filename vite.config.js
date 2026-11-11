import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Relative base so the built site works on GitHub Pages project sites
// (https://kshot3000.github.io/ada-pay-links/) and on a local preview.
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    nodePolyfills({
      include: ['crypto', 'stream', 'events', 'buffer', 'util', 'process'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
  },
});
