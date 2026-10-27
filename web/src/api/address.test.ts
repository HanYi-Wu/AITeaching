import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listen, invoke } = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../i18n/i18n", () => ({ default: { t: (key: string) => key } }));

describe("API startup address", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    listen.mockReset().mockResolvedValue(vi.fn());
    invoke.mockReset().mockResolvedValue(8765);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts an ordinary production browser without an injection timer", async () => {
    vi.stubGlobal("window", { location: new URL("https://teaching.example/") });
    const { ensureApiBase, joinApi } = await import("./address");
    await ensureApiBase();
    expect(joinApi("/api/platform/status")).toBe("/api/platform/status");
    expect(listen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["tauri://localhost/", "http://tauri.localhost/", "https://tauri.localhost/"])(
    "waits for late injection at %s and completes the backend handshake", async (url) => {
      const shell: Record<string, unknown> = { location: new URL(url) };
      vi.stubGlobal("window", shell);
      const { ensureApiBase, joinApi } = await import("./address");
      const pending = ensureApiBase();
      setTimeout(() => { shell.__TAURI_INTERNALS__ = {}; }, 48);
      await vi.advanceTimersByTimeAsync(64);
      await pending;
      expect(joinApi("/api/platform/status")).toBe("http://127.0.0.1:8765/api/platform/status");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not fall back to browser requests when packaged injection fails, and can retry", async () => {
    const shell: Record<string, unknown> = { location: new URL("http://tauri.localhost/") };
    vi.stubGlobal("window", shell);
    const { ensureApiBase, joinApi } = await import("./address");
    const rejected = expect(ensureApiBase()).rejects.toThrow("localServiceFailed");
    await vi.advanceTimersByTimeAsync(5010);
    await rejected;
    shell.__TAURI_INTERNALS__ = {};
    await ensureApiBase();
    expect(joinApi("/api/health")).toBe("http://127.0.0.1:8765/api/health");
  });

  it("releases a subscription that registers after its ready event settles startup", async () => {
    vi.stubGlobal("window", { location: new URL("http://tauri.localhost/"), __TAURI_INTERNALS__: {} });
    const stop = vi.fn();
    listen.mockImplementation(async (_name, handler) => {
      handler({ payload: { port: 9876 } });
      return stop;
    });
    const { ensureApiBase, joinApi } = await import("./address");
    await ensureApiBase();
    await Promise.resolve();
    expect(joinApi("/api/health")).toBe("http://127.0.0.1:9876/api/health");
    expect(stop).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
