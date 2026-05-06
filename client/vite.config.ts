import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'client',
  base: './',
  plugins: [svelte({ preprocess: vitePreprocess() })],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/_config.js': 'http://localhost:3000',
    },
  },
});
