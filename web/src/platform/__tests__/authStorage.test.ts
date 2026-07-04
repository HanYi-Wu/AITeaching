import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSessionToken,
  loadSessionToken,
  saveSessionToken,
  sessionStorageKeyForProject,
  setPlatformProjectRoot,
} from "../auth";

describe("platform session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    setPlatformProjectRoot(null);
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
});
