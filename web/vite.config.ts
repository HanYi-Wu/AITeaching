import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
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
    name: 'precompressed-static-assets-and-build-stamp',
    apply: 'build',
    closeBundle() {
      const root = path.resolve('.');
      const repoRoot = path.resolve('..');
      const excludedDirs = new Set(['dist', 'node_modules', '.git', '.turbo', '.vite', '.cache', 'coverage', '__pycache__', 'pdfjs']);
      const excludedFiles = new Set(['build-stamp.json', '.build-stamp.json', '.DS_Store', 'Thumbs.db']);

      function collectFiles(directory: string, excluded: Set<string>) {
        const items: { path: string; sha256: string }[] = [];
        function walk(current: string) {
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            const relative = path.relative(directory, full).split(path.sep).join('/');
            if (entry.isDirectory()) {
              if (!excluded.has(entry.name)) walk(full);
            } else if (entry.isFile() && !excludedFiles.has(entry.name)) {
              const hash = crypto.createHash('sha256').update(readFileSync(full)).digest('hex');
              items.push({ path: relative, sha256: hash });
            }
          }
        }
        walk(directory);
        items.sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
        return items;
      }

      const sourceItems = collectFiles(root, excludedDirs);
      const sourceComposite = crypto.createHash('sha256');
      for (const item of sourceItems) {
        sourceComposite.update(item.path + ':' + item.sha256 + '\n', 'utf8');
      }
      const fingerprint = sourceComposite.digest('hex');

      const distDir = path.resolve('dist');
      function compress(directory: string) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) compress(file);
          else if (entry.isFile() && /\.(js|css|svg|json)$/.test(entry.name)) {
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
      compress(distDir);

      // Hash the final tree after all server-side .gz/.br variants exist.
      const outputItems: { path: string; sha256: string }[] = [];
      function walkOutput(directory: string) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const full = path.join(directory, entry.name);
          const relative = path.relative(distDir, full).split(path.sep).join('/');
          if (entry.isDirectory()) walkOutput(full);
          else if (entry.isFile() && relative !== 'build-stamp.json') {
            const hash = crypto.createHash('sha256').update(readFileSync(full)).digest('hex');
            outputItems.push({ path: relative, sha256: hash });
          }
        }
      }
      walkOutput(distDir);
      outputItems.sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
      const outputComposite = crypto.createHash('sha256');
      for (const item of outputItems) {
        outputComposite.update(item.path + ':' + item.sha256 + '\n', 'utf8');
      }

      let revision = 'unknown';
      let gitDirty: boolean | string = 'unknown';
      try {
        revision = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // git unavailable
      }
      try {
        const out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', 'web'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        gitDirty = out.length > 0;
      } catch {
        // git unavailable
      }

      const stamp = {
        schema: 'sol-edu-frontend-build-stamp',
        format_version: 2,
        revision,
        git_dirty: gitDirty,
        fingerprint,
        input_count: sourceItems.length,
        inputs: sourceItems,
        output_fingerprint: outputComposite.digest('hex'),
        output_count: outputItems.length,
        outputs: outputItems,
      };
      mkdirSync(distDir, { recursive: true });
      writeFileSync(path.join(distDir, 'build-stamp.json'), JSON.stringify(stamp, null, 2) + '\n', 'utf8');
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
