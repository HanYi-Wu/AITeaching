import path from "node:path";
import { cpSync, mkdirSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
    xfwd: true,
  },
};

export default defineConfig({
  plugins: [react(), {
    name: "local-pdf-font-assets",
    configResolved(config) {
      for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
        const destination = path.join(config.root, "public", "pdfjs", directory);
        mkdirSync(destination, { recursive: true });
        cpSync(path.join(config.root, "node_modules", "pdfjs-dist", directory), destination, { recursive: true });
      }
    },
  }],

  resolve: {
    alias: {
      /** 供 pdf.js worker 的 `?url` 导入解析到包内构建产物 */
      "pdfjs-dist/build/pdf.worker.min.mjs": path.resolve(
        "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      ),
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: apiProxy,
  },

  preview: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: apiProxy,
  },
});
