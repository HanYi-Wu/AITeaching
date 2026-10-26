/**
 * Platform session token storage and root adaptation.
 *
 * Platform session is global across projects (solaire.platform.session).
 * Switching projects must not log out the user.
 */

export const LEGACY_SESSION_STORAGE_KEY = "solaire.platform.session";
export const PROJECT_SESSION_STORAGE_PREFIX = "solaire.platform.session:";

export function sessionStorageKeyForProject(_projectRoot: string | null): string {
  return LEGACY_SESSION_STORAGE_KEY;
}

export function setPlatformProjectRoot(_projectRoot: string | null): void {
  // Platform sessions are global. Project roots only affect content workspaces.
}

export function clearProjectScopedSessionTokens(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PROJECT_SESSION_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore localStorage access errors */
  }
}

export function saveSessionToken(token: string): void {
  try {
    localStorage.setItem(LEGACY_SESSION_STORAGE_KEY, token);
    clearProjectScopedSessionTokens();
  } catch {
    /* ignore */
  }
}

export function loadSessionToken(): string | null {
  try {
    return localStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    clearProjectScopedSessionTokens();
  } catch {
    /* ignore */
  }
}
