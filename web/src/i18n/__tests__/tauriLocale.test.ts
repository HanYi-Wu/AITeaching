import { describe, expect, it } from "vitest";

import { resolveInitialLocale } from "../tauriLocale";

describe("resolveInitialLocale", () => {
  it("defaults a first browser visit to Chinese", () => {
    expect(resolveInitialLocale(null, null)).toBe("zh");
  });

  it("keeps an explicit saved browser preference", () => {
    expect(resolveInitialLocale(null, "en")).toBe("en");
  });

  it("lets the desktop preference take priority", () => {
    expect(resolveInitialLocale("zh", "en")).toBe("en");
    expect(resolveInitialLocale("en", null)).toBe("zh");
  });
});
