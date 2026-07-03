import { resolve } from "node:path";
import { defineConfig } from "vite";

const sharedDefine = {
  "process.env.NODE_ENV": JSON.stringify("production"),
  global: "globalThis",
};

const browserResolve = {
  alias: {
    stream: "readable-stream",
    events: "events",
    buffer: "buffer",
  },
};

export default defineConfig({
  base: "./",
  define: sharedDefine,
  resolve: browserResolve,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, "offscreen.html"),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        inlineDynamicImports: true,
      },
    },
  },
  publicDir: "public",
});
