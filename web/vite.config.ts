import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev backend: `traceriver start` binds Fastify to 127.0.0.1:7580 by default
// (docs/architecture.md § Port strategy). The Vite dev server proxies /api
// and /ws to it so `npm run dev` gets HMR while real data comes from the
// real backend (docs/phases/phase-1-core.md §1.1 "Dev ergonomics").
const BACKEND_DEV_TARGET = "http://127.0.0.1:7580";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: BACKEND_DEV_TARGET,
        changeOrigin: true,
      },
      "/ws": {
        target: BACKEND_DEV_TARGET,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    // Single-package layout (docs/architecture.md § Packaging & distribution):
    // the frontend is pre-built into dist/web and shipped in the npm tarball.
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
