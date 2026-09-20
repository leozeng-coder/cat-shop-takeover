import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: '../assets/**/*.{png,jpg,jpeg,webp,json,mp3,ogg,wav,ttf,woff2}',
          dest: 'assets',
          rename: { stripBase: 1 },
        },
      ],
      watch: { reloadPageOnChange: true },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/api': 'http://127.0.0.1:8787',
      '/assets/audio': 'http://127.0.0.1:8787',
    },
  },
  build: { target: 'es2022', rollupOptions: { input: ['index.html', 'preview/index.html'] } },
});
