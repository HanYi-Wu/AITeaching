import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { build, type Plugin, type ResolvedConfig } from "vite";

const filename = "classroom-tools.html";

async function buildDownload(config: ResolvedConfig): Promise<string> {
  const result = await build({
    configFile: false,
    root: config.root,
    publicDir: false,
    logLevel: "warn",
    plugins: [react()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { dedupe: config.resolve.dedupe },
    build: {
      write: false,
      modulePreload: false,
      lib: {
        entry: path.join(config.root, "src/classroomTools.tsx"),
        name: "OriginReachClassroomTools",
        formats: ["iife"],
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !("output" in bundle)) throw new Error("Classroom tools build did not produce a bundle");
  const script = bundle.output.find((item) => item.type === "chunk");
  const styles = bundle.output.find((item) => item.type === "asset");
  if (
    bundle.output.length !== 2 || !script || script.imports.length > 0 ||
    script.dynamicImports.length > 0 || !styles?.fileName.endsWith(".css")
  ) {
    throw new Error("The offline classroom tools require one script and one stylesheet");
  }

  // Match HTML's newline normalization when hashing the inline script for CSP.
  const js = script.code
    .replace(/\r\n?/g, "\n")
    .replace(/<\/(?=script)/gi, "<\\/")
    .replace(/<!--/g, "\\x3c!--");
  const stylesheet = typeof styles.source === "string" ? styles.source : new TextDecoder().decode(styles.source);
  const css = stylesheet.replace(/<\/(?=style)/gi, "<\\/");
  const hash = createHash("sha256").update(js).digest("base64");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
  <title>源远教学平台 · 课堂工具</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>${js}</script>
</body>
</html>
`;
}

function setDownloadHeaders(response: ServerResponse) {
  response.setHeader("Content-Disposition", "attachment");
  response.setHeader("Content-Security-Policy", "sandbox allow-scripts");
}

export function classroomToolsDownload(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "classroom-tools-download",
    configResolved(resolved) {
      config = resolved;
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: filename, source: await buildDownload(config) });
    },
    configureServer(server) {
      server.middlewares.use(`${config.base}${filename}`, async (_request, response, next) => {
        try {
          const html = await buildDownload(config);
          setDownloadHeaders(response);
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(`${config.base}${filename}`, (_request, response, next) => {
        setDownloadHeaders(response);
        next();
      });
    },
  };
}
