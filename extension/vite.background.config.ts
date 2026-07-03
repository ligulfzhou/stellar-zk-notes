import { resolve } from "node:path";
import { defineConfig } from "vite";

/** Minimal MV3 service worker — no crypto / WASM. */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, "src/background.ts"),
      output: {
        entryFileNames: "background.js",
        inlineDynamicImports: true,
        format: "iife",
      },
    },
  },
  publicDir: false,
});
