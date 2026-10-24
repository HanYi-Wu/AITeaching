import path from "node:path";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function configValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const file = process.env.EH_CONFIG_FILE;
  if (!file) return undefined;
  const entry = readFileSync(file, 'utf8').split(/\r?\n/).find((line) => line.trim().startsWith(`${key}=`));
  return entry?.slice(entry.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
}

const apiProxy = {
  "/api": {
    target: configValue('EH_BACKEND_URL') || "http://127.0.0.1:8000",
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
  }, {
    name: 'precompressed-static-assets',
    apply: 'build',
    closeBundle() {
      function compress(directory: string) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) compress(file);
          else if (/\.(js|css|svg|json)$/.test(entry.name)) {
            const bytes = readFileSync(file);
            if (bytes.length > 1024) {
              const compressed = gzipSync(bytes, { level: 9 });
              if (compressed.length < bytes.length) writeFileSync(file + '.gz', compressed);
              const brotli = brotliCompressSync(bytes, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
              });
              if (brotli.length < bytes.length) writeFileSync(file + '.br', brotli);
            }
          }
        }
      }
      compress(path.resolve('dist'));
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
    // Keep jsdom workers bounded on high-core Windows hosts and CI runners.
    maxWorkers: 2,
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
