import { resolve } from "node:path";
import { defineConfig } from "vite";

/** @deprecated Use vite.background.config.ts + vite.ui.config.ts */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        "content-script": resolve(__dirname, "src/content-script.ts"),
        injected: resolve(__dirname, "src/injected.ts"),
        popup: resolve(__dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  publicDir: "public",
});
