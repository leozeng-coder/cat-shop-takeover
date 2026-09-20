import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    {
      name: "shared-character-preview",
      transformIndexHtml: {
        order: "pre",
        handler(html, context) {
          if (context.path !== "/preview/index.html") return html;
          // Build the same preview source into both clients, without embedding the running game.
          return readFileSync(
            new URL("../client/preview/index.html", import.meta.url),
            "utf8",
          )
            .replace("./preview.js", "../../client/preview/preview.js")
            .replace("./preview.css", "../../client/preview/preview.css");
        },
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
    fs: { allow: [".."] },
    proxy: {
      "/api/admin": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        headers: { Origin: "http://127.0.0.1:8790" },
      },
      "/assets": "http://127.0.0.1:8790",
    },
  },
  build: {
    target: "es2022",
    assetsDir: "admin-bundle",
    rollupOptions: { input: ["index.html", "preview/index.html"] },
  },
});
