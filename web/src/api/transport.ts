import i18n from "../i18n/i18n";
import { logApiCall } from "../lib/appLog";
import { loadSessionToken } from "../platform/session";
import { ensureApiBase, joinApi } from "./address";
import { ApiError, filenameFromContentDisposition, parseDetailFromResponse } from "./errors";

export function isHeavyApiPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return (
    p === "/api/exam/export" ||
    p === "/api/exam/validate" ||
    p === "/api/bank/import-bundle" ||
    p === "/api/bank/import" ||
    p === "/api/bank/export-bundle"
  );
}

export async function fetchWithLog(path: string, init?: RequestInit): Promise<Response> {
  await ensureApiBase();
  const url = joinApi(path);
  const t0 = performance.now();
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    const token = loadSessionToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    logApiCall({
      path,
      method,
      ok: false,
      status: 0,
      ms,
      detail: i18n.t("networkError", { ns: "common", detail: msg }),
    });
    throw e instanceof Error ? e : new Error(msg);
  }
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) {
    const parsed = await parseDetailFromResponse(r);
    logApiCall({ path, method, ok: false, status: r.status, ms, detail: parsed.message });
    throw new ApiError(parsed.message, r.status, { examSaved: parsed.examSaved });
  }
  if (method !== "GET" || isHeavyApiPath(path)) {
    logApiCall({ path, method, ok: true, status: r.status, ms });
  }
  return r;
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetchWithLog(path);
  return r.json() as Promise<T>;
}

/** Fetch a protected binary resource through the same authenticated request path as JSON APIs. */
export async function apiGetBlob(path: string): Promise<Blob> {
  const r = await fetchWithLog(path);
  const blob = await r.blob();
  if (blob.size === 0) {
    throw new ApiError(i18n.t("emptyFileResponse", { ns: "common" }), r.status);
  }
  return blob;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithLog(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

/** multipart/form-data POST — do not set Content-Type (browser sets boundary). */
export async function apiPostFormData<T>(path: string, formData: FormData, headers?: Record<string, string>): Promise<T> {
  const r = await fetchWithLog(path, { method: "POST", body: formData, ...(headers ? { headers } : {}) });
  return r.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const r = await fetchWithLog(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const r = await fetchWithLog(path, { method: "DELETE" });
  return r.json() as Promise<T>;
}

/** Download an authenticated API response without opening a popup (which browsers may block). */
export async function apiDownloadBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetchWithLog(path);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
  };
}

/** Download strict bank exchange ZIP (POST /api/bank/export-bundle — 避免 GET 查询串中 namespace 含 / 时的编码问题). */
export async function downloadBankExportBundle(namespace: string): Promise<void> {
  const path = `/api/bank/export-bundle`;
  const method = "POST";
  await ensureApiBase();
  const requestUrl = joinApi(path);
  const t0 = performance.now();
  let r: Response;
  try {
    r = await fetch(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace }),
    });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    logApiCall({
      path,
      method: "POST",
      ok: false,
      status: 0,
      ms,
      detail: i18n.t("networkError", { ns: "common", detail: msg }),
    });
    throw e instanceof Error ? e : new Error(msg);
  }
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) {
    const parsed = await parseDetailFromResponse(r);
    logApiCall({ path, method, ok: false, status: r.status, ms, detail: parsed.message });
    throw new ApiError(parsed.message, r.status, { examSaved: parsed.examSaved });
  }
  logApiCall({ path, method, ok: true, status: r.status, ms });
  const cd = r.headers.get("Content-Disposition");
  const filename = filenameFromContentDisposition(cd) ?? "bank-export.bank.zip";
  const blob = await r.blob();
  const { saveBlobToDisk } = await import("../lib/saveBlobToDisk");
  await saveBlobToDisk(blob, {
    defaultFileName: filename,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
}
