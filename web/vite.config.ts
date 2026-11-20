import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The web app is served at /app from the static output directory (public/), next to the API.
// `npm run build` writes it to public/app; nothing in public/ is committed.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../public/app", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    target: "es2020",
  },
  server: {
    port: 5173,
    // Local development against a running Greenlight server (GREENLIGHT_DEV_API, default :8787).
    proxy: {
      "/app/api": { target: process.env.GREENLIGHT_DEV_API ?? "http://127.0.0.1:8787", changeOrigin: false },
      "/approve": { target: process.env.GREENLIGHT_DEV_API ?? "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
});
