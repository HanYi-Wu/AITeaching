import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLogs, getLogSnapshot } from "../../lib/appLog";

vi.mock("../../api/client", () => ({
  resolveApiUrl: (path: string) => Promise.resolve(path),
}));

describe("platformRequest network logging", () => {
  beforeEach(() => {
    clearLogs();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Question library not a directory: resource/math" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearLogs();
  });

  it("records failed platform API response details in runtime logs", async () => {
    const { platformRequest } = await import("../auth");

    await expect(platformRequest("/api/papers/p1/publish", { method: "POST", body: "{}" })).rejects.toThrow(
      "Question library not a directory",
    );

    expect(getLogSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          source: "network",
          message: expect.stringContaining("POST /api/papers/p1/publish"),
          detail: expect.stringContaining("Question library not a directory"),
        }),
      ]),
    );
  });
});
