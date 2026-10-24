import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiAgentChatStream, apiGetBlob } from "./client";
import { setupTestI18n } from "../test/i18nTestUtils";

const PLATFORM_SESSION_STORAGE_KEY = "solaire.platform.session";

describe("apiAgentChatStream", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("sends the current platform bearer token for protected teacher chat", async () => {
    localStorage.setItem(PLATFORM_SESSION_STORAGE_KEY, "teacher-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('event: done\ndata: {"usage":{}}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiAgentChatStream({ message: "hello" }, () => undefined);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer teacher-token");
  });
});

describe("apiGetBlob", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses the current platform bearer token for protected PDF previews", async () => {
    localStorage.setItem(PLATFORM_SESSION_STORAGE_KEY, "teacher-token");
    // Node's Response cannot consume jsdom's partial Blob implementation.
    const pdf = new TextEncoder().encode("pdf");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiGetBlob("/api/exam/preview-pdf/preview-id/file?variant=student");

    expect(result.type).toBe("application/pdf");
    expect(await result.text()).toBe("pdf");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer teacher-token");
  });

  it.each([
    [200, "/api/exam/preview-pdf/preview-id/file?variant=student"],
    [204, "/api/exam/preview-pdf/preview-id/file?variant=student"],
    [200, "/api/exams/download/Quiz?format=docx"],
    [204, "/api/exams/download/Quiz?format=docx"],
  ] as const)("rejects an empty %s response for %s instead of returning an unusable file", async (status, path) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(apiGetBlob(path)).rejects.toMatchObject({
      name: "ApiError", status, message: expect.stringContaining("未收到文件内容"),
    });
  });
});
