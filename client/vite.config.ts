import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true }, '/api': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022' },
});
