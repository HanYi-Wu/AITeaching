import { describe, expect, it } from "vitest";

import config from "./vite.config";

describe("public host access", () => {
  it("accepts IP addresses and arbitrary proxy domains", () => {
    expect(config.server?.host).toBe("0.0.0.0");
    expect(config.server?.allowedHosts).toBe(true);
    expect(config.preview?.allowedHosts).toBe(true);
  });
});
