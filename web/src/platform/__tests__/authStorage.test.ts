import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSessionToken,
  getCurrentUser,
  loadSessionToken,
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
});
