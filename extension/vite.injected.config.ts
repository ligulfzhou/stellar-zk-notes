import { resolve } from "node:path";
import { defineConfig } from "vite";

const sharedDefine = {
  "process.env.NODE_ENV": JSON.stringify("production"),
  "process.env": "{}",
  global: "globalThis",
};

export default defineConfig({
  define: sharedDefine,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, "src/injected.ts"),
      output: {
        entryFileNames: "injected.js",
        format: "iife",
        inlineDynamicImports: true,
        name: "ZkStellarWalletInjected",
      },
    },
  },
});
