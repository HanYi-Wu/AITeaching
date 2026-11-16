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
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('event: done\ndata: {"usage":{}}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiAgentChatStream({ message: "hello" }, () => undefined, { signal: controller.signal });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer teacher-token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Accept")).toBe("text/event-stream");
    expect(JSON.parse(String(init.body))).toEqual({ message: "hello" });
    expect(init.signal).toBe(controller.signal);
  });

  it("parses fragmented UTF-8, CRLF/LF frames, comments, multiline data, null and malformed payloads", async () => {
    const wire = [
      ": keepalive\r\n\r\n",
      "event: ignored\r\n\r\n",
      "event: text_delta\r\n",
      "data: {\"text\":\r\n",
      "data: \"你好\"}\r\n\r\n",
      "event: done\r\ndata: null\r\n\r\n",
      "event: invalid\ndata: {not-json}\n\n",
      "data: {\"default\":true}\n\n",
    ].join("");
    const bytes = new TextEncoder().encode(wire);
    const crBoundary = bytes.indexOf(13) + 1;
    const multibyteStart = bytes.findIndex((byte) => byte === 0xe4);
    const cuts = [crBoundary, multibyteStart + 1, multibyteStart + 2, bytes.length]
      .filter((index) => index > 0)
      .sort((a, b) => a - b);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (const end of cuts) {
      if (end > offset) chunks.push(bytes.slice(offset, end));
      offset = end;
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    const events: Array<[string, Record<string, unknown>]> = [];

    await apiAgentChatStream({ message: "hello" }, (event, data) => events.push([event, data]));

    expect(events).toEqual([
      ["text_delta", { text: "你好" }],
      ["done", { raw: "null" }],
      ["invalid", { raw: "{not-json}" }],
      ["message", { default: true }],
    ]);
  });

  it("calls the event callback once and cancels a stream when the callback throws", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: text_delta\ndata: {\"text\":\"one\"}\n\n"));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const failure = new Error("consumer stopped");
    const onEvent = vi.fn(() => {
      throw failure;
    });

    await expect(apiAgentChatStream({ message: "hello" }, onEvent)).rejects.toBe(failure);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps the shared API error formatting for rejected chat requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "chat denied" }), { status: 403, statusText: "Forbidden" })),
    );

    await expect(apiAgentChatStream({ message: "hello" }, () => undefined)).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "chat denied",
    });
  });

  it("delivers all events from a long stream", async () => {
    const frameCount = 10_000;
    const frame = 'event: text_delta\ndata: {"text":"x"}\n\n';
    const bytes = new TextEncoder().encode(frame.repeat(frameCount));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 4096) {
          controller.enqueue(bytes.slice(start, start + 4096));
        }
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    let delivered = 0;

    await apiAgentChatStream({ message: "hello" }, () => {
      delivered += 1;
    });

    expect(delivered).toBe(frameCount);
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
