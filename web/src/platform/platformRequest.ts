import { resolveApiUrl } from "../api/address";
import { logApiCall } from "../lib/appLog";
import { loadSessionToken } from "./session";

export class PlatformRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PlatformRequestError";
  }
}

export function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

export async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }
  const message = await readErrorMessage(response);
  throw new PlatformRequestError(message, response.status);
}

export async function readErrorMessage(response: Response): Promise<string> {
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.clone().json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      message = body.detail;
    }
  } catch {
    /* ignore */
  }
  return message;
}

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toString().toUpperCase();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const token = loadSessionToken();
  const headers = new Headers(init.headers);
  const bodyIsFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body != null && !bodyIsFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const url = await resolveApiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
    const detail = error instanceof Error ? error.message : String(error);
    logApiCall({ path, method, ok: false, status: 0, ms, detail });
    throw error;
  }
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  if (!response.ok) {
    const detail = await readErrorMessage(response);
    logApiCall({ path, method, ok: false, status: response.status, ms, detail });
    throw new PlatformRequestError(detail, response.status);
  }
  if (method !== "GET") {
    logApiCall({ path, method, ok: true, status: response.status, ms });
  }
  return readJson<T>(response);
}

export async function downloadAuthorizedBlob(path: string): Promise<Blob> {
  const token = loadSessionToken();
  const url = await resolveApiUrl(path);
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    await readJson(response);
  }
  return response.blob();
}
