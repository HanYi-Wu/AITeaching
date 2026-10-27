import i18n from "../i18n/i18n";
import { hasTauriOrigin, isTauriShell, waitForTauriShell } from "../lib/tauriEnv";

let apiBaseResolved: string | null = null;
let apiBasePromise: Promise<string> | null = null;

/** Packaged WebViews may execute the entry script before Tauri injects its API. */
const TAURI_INJECT_WAIT_MS = 5000;

/** 桌面壳内等待本地服务就绪（事件 + 非阻塞 invoke 竞态 + 超时）。 */
const SHELL_BACKEND_WAIT_MS = 120_000;

async function waitForShellBackendPort(): Promise<number> {
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let unlistenReady: (() => void) | undefined;
    let unlistenFail: (() => void) | undefined;

    const cleanup = () => {
      for (const t of timeouts) clearTimeout(t);
      try {
        unlistenReady?.();
      } catch {
        /* ignore */
      }
      try {
        unlistenFail?.();
      } catch {
        /* ignore */
      }
    };

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const ok = (port: number) => {
      if (settled) return;
      if (!Number.isFinite(port) || port <= 0) {
        fail(i18n.t("localServiceFailed", { ns: "common" }));
        return;
      }
      settled = true;
      cleanup();
      resolve(port);
    };

    timeouts.push(
      setTimeout(() => {
        fail(i18n.t("localServiceStartTimeout", { ns: "common" }));
      }, SHELL_BACKEND_WAIT_MS),
    );

    void (async () => {
      try {
        const stopReady = await listen<unknown>("backend-ready", (event) => {
          const p = event.payload;
          let port = 0;
          if (typeof p === "object" && p !== null && "port" in p) {
            port = Number((p as { port: number }).port);
          } else if (typeof p === "number") {
            port = p;
          }
          if (port > 0) ok(port);
        });
        if (settled) {
          stopReady();
          return;
        }
        unlistenReady = stopReady;

        const stopFail = await listen<{ message: string }>("backend-failed", (event) => {
          const m = event.payload?.message;
          if (typeof m === "string" && m.trim()) {
            fail(m);
          } else {
            fail(i18n.t("localServiceFailed", { ns: "common" }));
          }
        });
        if (settled) {
          stopFail();
          return;
        }
        unlistenFail = stopFail;

        try {
          const port = await invoke<number>("get_backend_port");
          if (port > 0) ok(port);
        } catch {
          /* 尚未就绪，依赖事件 */
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    })();

  });
}

async function resolveApiBase(): Promise<string> {
  if (apiBaseResolved !== null) return apiBaseResolved;

  let inShell = isTauriShell();
  if (!inShell && hasTauriOrigin()) {
    inShell = await waitForTauriShell(TAURI_INJECT_WAIT_MS);
    if (!inShell) throw new Error(i18n.t("localServiceFailed", { ns: "common" }));
  }

  if (inShell) {
    try {
      const port = await waitForShellBackendPort();
      apiBaseResolved = `http://127.0.0.1:${port}`;
      return apiBaseResolved;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      throw new Error(msg);
    }
  }
  apiBaseResolved = "";
  return apiBaseResolved;
}

/** 桌面壳（Tauri）下解析后端端口；浏览器开发环境为空字符串（走 Vite 代理）。 */
export async function ensureApiBase(): Promise<void> {
  if (!apiBasePromise) {
    apiBasePromise = resolveApiBase().catch((error) => {
      apiBasePromise = null;
      throw error;
    });
  }
  await apiBasePromise;
}

export function joinApi(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = apiBaseResolved ?? "";
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 用于少数直接 `fetch` 的场景（如下载流）。 */
export async function resolveApiUrl(path: string): Promise<string> {
  await ensureApiBase();
  return joinApi(path);
}

/**
 * `resource/` 下文件的 HTTP 路径（桌面壳下需带后端 origin，见 main.tsx 中 `ensureApiBase` 已先完成）。
 */
export function resourceApiUrl(resourceRel: string): string {
  const rel = resourceRel
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return joinApi(`/api/resource/${rel}`);
}

/**
 * 手册 Markdown、富文本里以 `/api/...` 开头的绝对路径（如 `/api/help/asset/...`），
 * 在 Tauri 壳下需拼上后端 origin，否则图片会请求到 WebView 自身页面而显示损坏。
 */
export function apiAbsoluteUrl(path: string): string {
  const p = path.trim();
  if (!p) return p;
  if (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("data:") ||
    p.startsWith("blob:")
  ) {
    return p;
  }
  if (p.startsWith("//")) return p;
  const normalized = p.startsWith("/") ? p : `/${p}`;
  return joinApi(normalized);
}
