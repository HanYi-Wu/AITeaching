import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSessionToken,
  getCurrentUser,
  loadSessionToken,
  logoutPlatform,
  saveSessionToken,
  sessionStorageKeyForProject,
  setPlatformProjectRoot,
} from "../auth";

vi.mock("../../api/client", () => ({
  resolveApiUrl: (path: string) => Promise.resolve(path),
}));

describe("platform session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    setPlatformProjectRoot(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores one platform session token across project root changes", () => {
    setPlatformProjectRoot("C:/projects/a");
    saveSessionToken("token-a");

    setPlatformProjectRoot("C:/projects/b");
    expect(loadSessionToken()).toBe("token-a");
  });

  it("clears the global platform token", () => {
    setPlatformProjectRoot("C:/projects/a");
    saveSessionToken("token-a");
    setPlatformProjectRoot("C:/projects/b");

    clearSessionToken();

    expect(loadSessionToken()).toBeNull();
    setPlatformProjectRoot("C:/projects/a");
    expect(loadSessionToken()).toBeNull();
  });

  it("uses a stable global storage key", () => {
    expect(sessionStorageKeyForProject("G:/PyCharm 2025.2.4/project/AITeaching")).toBe(
      "solaire.platform.session",
    );
  });

  it("does not resurrect or return stale user when getCurrentUser resolves after logout or token change", async () => {
    saveSessionToken("old-token");
    let resolveMe!: (value: Response) => void;
    const pendingMe = new Promise<Response>((resolve) => {
      resolveMe = resolve;
    });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => pendingMe));

    const pendingUserCall = getCurrentUser();

    // User logs out before the request completes
    clearSessionToken();
    expect(loadSessionToken()).toBeNull();

    // Late response comes back with old account
    resolveMe(
      new Response(JSON.stringify({ user: { id: "u1", username: "old_user", role: "teacher" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await pendingUserCall;
    expect(result.user).toBeNull();
    expect(loadSessionToken()).toBeNull();
  });

  it.each([500, 503])("keeps the session retryable after auth/me returns %s", async (status) => {
    saveSessionToken("valid-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Temporarily unavailable"}', { status })));
    await expect(getCurrentUser()).rejects.toThrow("Temporarily unavailable");
    expect(loadSessionToken()).toBe("valid-token");

    vi.mocked(fetch).mockResolvedValue(new Response('{"user":{"id":"u1"}}'));
    await expect(getCurrentUser()).resolves.toEqual({ user: { id: "u1" } });
  });

  it("keeps the session on a network failure and clears only a rejected session", async () => {
    saveSessionToken("valid-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getCurrentUser()).rejects.toThrow("Failed to fetch");
    expect(loadSessionToken()).toBe("valid-token");

    vi.mocked(fetch).mockResolvedValue(new Response('{"detail":"Authentication required"}', { status: 401 }));
    await expect(getCurrentUser()).resolves.toEqual({ user: null });
    expect(loadSessionToken()).toBeNull();
  });

  it("does not clear a replacement session on a late unauthorized response", async () => {
    saveSessionToken("old-token");
    let resolveMe!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveMe = resolve; })));
    const pending = getCurrentUser();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    saveSessionToken("new-token");
    resolveMe(new Response("{}", { status: 401 }));
    await expect(pending).resolves.toEqual({ user: null });
    expect(loadSessionToken()).toBe("new-token");
  });

  it("revokes the captured session after removing it locally", async () => {
    saveSessionToken("logout-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const pending = logoutPlatform();
    expect(loadSessionToken()).toBeNull();
    await pending;
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer logout-token");
  });
});
