/**
 * Platform authentication, session facade, and domain API entry point.
 *
 * Retains full backward-compatible named exports for all platform domain APIs,
 * session storage methods, and shared TypeScript models.
 */

import { clearSessionToken, loadSessionToken } from "./session";
import { PlatformRequestError, platformRequest } from "./platformRequest";
import type { PlatformAuthResponse, PlatformStatus, PlatformUser } from "./authTypes";

export * from "./authTypes";
export type { PlatformRole } from "./roles";

export {
  LEGACY_SESSION_STORAGE_KEY,
  PROJECT_SESSION_STORAGE_PREFIX,
  sessionStorageKeyForProject,
  setPlatformProjectRoot,
  clearProjectScopedSessionTokens,
  saveSessionToken,
  loadSessionToken,
  clearSessionToken,
} from "./session";

export {
  platformRequest,
  buildQuery,
  readJson,
  readErrorMessage,
  downloadAuthorizedBlob,
} from "./platformRequest";

export * from "./schoolApi";
export * from "./paperApi";

export function getPlatformStatus(): Promise<PlatformStatus> {
  return platformRequest<PlatformStatus>("/api/platform/status");
}

export async function getCurrentUser(): Promise<{ user: PlatformUser | null }> {
  const token = loadSessionToken();
  if (!token) {
    return { user: null };
  }
  try {
    const data = await platformRequest<{ user: PlatformUser }>("/api/auth/me");
    if (loadSessionToken() !== token) {
      return { user: null };
    }
    return data;
  } catch (e) {
    if (loadSessionToken() !== token) return { user: null };
    if (e instanceof PlatformRequestError && e.status === 401) {
      clearSessionToken();
      return { user: null };
    }
    throw e;
  }
}

export function bootstrapAdmin(payload: {
  username: string;
  password: string;
  display_name: string;
}): Promise<PlatformAuthResponse> {
  return platformRequest<PlatformAuthResponse>("/api/auth/bootstrap-admin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginPlatform(payload: { username: string; password: string }): Promise<PlatformAuthResponse> {
  return platformRequest<PlatformAuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logoutPlatform(): Promise<void> {
  const token = loadSessionToken();
  clearSessionToken();
  if (!token) {
    return;
  }
  try {
    await platformRequest<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      body: "{}",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore network errors during logout */
  }
}
