import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiAgentChatStream, apiAgentSessionContextMeter, apiAgentSessionGet } from "../../api/client";
import { useAgentChatStream, type UseAgentChatStreamOptions } from "./useAgentChatStream";

vi.mock("../../api/client", () => ({
  apiAgentChatStream: vi.fn(), apiAgentSessionCancel: vi.fn().mockResolvedValue({}),
  apiAgentSessionContextMeter: vi.fn(), apiAgentSessionGet: vi.fn(),
}));
vi.mock("../../lib/contentEvents", () => ({ notifyAgentContentChanged: vi.fn() }));

type PendingRun = {
  emit: Parameters<typeof apiAgentChatStream>[1];
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
};
let runs: PendingRun[];
let options: UseAgentChatStreamOptions;

beforeEach(() => {
  vi.clearAllMocks();
  runs = [];
  options = { sidebarOpen: true, activeSkillId: null, setActiveSkillId: vi.fn(),
    notifyAgentBackground: vi.fn(), refreshSessionList: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(apiAgentChatStream).mockImplementation((_body, emit, settings) => new Promise<void>((resolve, reject) => {
    runs.push({ emit, resolve, reject, signal: settings?.signal });
  }));
  vi.mocked(apiAgentSessionContextMeter).mockResolvedValue({ context_tokens_est: 42, context_limit: 1000 } as never);
});

describe("chat stream lifecycle", () => {
  it("flushes text before tools and terminal events without merging assistant segments", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    let pending: Promise<void>;
    act(() => { pending = result.current.runStream({ session_id: "s", message: "question" }); });
    act(() => {
      runs[0].emit("text_delta", { text: "first " });
      runs[0].emit("text_delta", { text: "segment" });
      runs[0].emit("tool_start", { tool_name: "bank.search", tool_call_id: "read" });
      runs[0].emit("tool_result", { tool_name: "bank.search", tool_call_id: "read", summary: "found" });
      runs[0].emit("text_delta", { text: "answer" });
      runs[0].emit("done", {});
    });
    expect(result.current.lines.map((line) => line.kind)).toEqual(["assistant", "tool", "assistant"]);
    expect(result.current.lines[0]).toMatchObject({ text: "first segment" });
    expect(result.current.lines[2]).toMatchObject({ text: "answer" });
    await act(async () => { runs[0].resolve(); await pending!; });
    expect(result.current.busy).toBe(false);
  });

  it("ignores old stream events and completion after a new chat starts", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    let previous: Promise<void>;
    let next: Promise<void>;
    act(() => { previous = result.current.runStream({ session_id: "old", message: "old" }); });
    act(() => { runs[0].emit("text_delta", { text: "buffered old text" }); result.current.newChat(); });
    expect(runs[0].signal?.aborted).toBe(true);
    act(() => { next = result.current.runStream({ session_id: "new", message: "new" }); });
    await act(async () => {
      runs[0].emit("session", { session_id: "old" });
      runs[0].emit("error", { message: "old error" });
      runs[0].reject(new DOMException("aborted", "AbortError"));
      await previous!;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.lines).toEqual([]);
    act(() => { runs[1].emit("text_delta", { text: "new text" }); runs[1].emit("done", {}); });
    await act(async () => { runs[1].resolve(); await next!; });
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toMatchObject({ kind: "assistant", text: "new text" });
  });

  it("does not restore a late history response after starting a new chat", async () => {
    let complete: (value: Awaited<ReturnType<typeof apiAgentSessionGet>>) => void;
    vi.mocked(apiAgentSessionGet).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { result } = renderHook(() => useAgentChatStream(options));
    let pending: Promise<void>;
    act(() => { pending = result.current.loadHistorySession("old"); });
    act(() => result.current.newChat());
    await act(async () => {
      complete!({ session: { messages: [{ role: "user", content: "old history" }] } } as never);
      await pending!;
    });
    expect(result.current.sessionId).toBeNull();
    expect(result.current.lines).toEqual([]);
  });

  it("keeps the new stream busy when a replaced stream finishes late", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    let previous: Promise<void>;
    let current: Promise<void>;
    act(() => { previous = result.current.runStream({ session_id: "old", message: "old" }); });
    act(() => result.current.newChat());
    act(() => { current = result.current.runStream({ session_id: "new", message: "new" }); });

    await act(async () => {
      runs[0].reject(new DOMException("aborted", "AbortError"));
      await previous!;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.lines).toEqual([]);

    await act(async () => {
      runs[1].resolve();
      await current!;
    });
    expect(result.current.busy).toBe(false);
  });

  it("ignores stream callbacks that arrive after unmount", async () => {
    const { result, unmount } = renderHook(() => useAgentChatStream(options));
    let pending: Promise<void>;
    act(() => { pending = result.current.runStream({ session_id: "s", message: "question" }); });
    act(() => runs[0].emit("text_delta", { text: "buffered" }));

    unmount();
    expect(runs[0].signal?.aborted).toBe(true);
    await act(async () => {
      runs[0].emit("error", { message: "late event" });
      runs[0].reject(new Error("late completion"));
      await pending!;
    });
  });

  it("ignores a late history response after unmount", async () => {
    let complete!: (value: Awaited<ReturnType<typeof apiAgentSessionGet>>) => void;
    vi.mocked(apiAgentSessionGet).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { result, unmount } = renderHook(() => useAgentChatStream(options));
    let pending: Promise<void>;
    act(() => { pending = result.current.loadHistorySession("old"); });
    unmount();

    await act(async () => {
      complete({ session: { messages: [{ role: "user", content: "late history" }] } } as never);
      await pending!;
    });
  });

  it("ignores stale confirm and plan session failures after new chat, but preserves current errors", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    let rejectConfirm!: (error: Error) => void;
    let confirmPending: Promise<void>;
    act(() => {
      result.current.setLines([{ kind: "confirm", action_id: "act-1", tool_name: "test", description: "confirm" }]);
      confirmPending = result.current.confirm("act-1", true, () => new Promise<string>((_resolve, reject) => { rejectConfirm = reject; }));
    });
    act(() => result.current.newChat());
    await act(async () => {
      rejectConfirm(new DOMException("conversation replaced", "AbortError"));
      await confirmPending!;
    });
    expect(result.current.lines).toEqual([]);
    expect(apiAgentChatStream).not.toHaveBeenCalled();

    let rejectPlan!: (error: Error) => void;
    let planPending: Promise<void>;
    act(() => {
      result.current.setLines([{ kind: "plan_ready", plan_file_path: "plan.md", content: "plan" }]);
      planPending = result.current.planAction("cancel", "plan.md", () => new Promise<string>((_resolve, reject) => { rejectPlan = reject; }));
    });
    act(() => result.current.newChat());
    await act(async () => {
      rejectPlan(new DOMException("conversation replaced", "AbortError"));
      await planPending!;
    });
    expect(result.current.lines).toEqual([]);
    expect(apiAgentChatStream).not.toHaveBeenCalled();

    let sameEpochFailure!: Promise<void>;
    act(() => {
      sameEpochFailure = result.current.confirm("act-current", true, async () => { throw new Error("session creation failed"); });
    });
    await expect(sameEpochFailure!).rejects.toThrow("session creation failed");
  });

  it("accepts a reused tool call id in a later stream round", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    let first: Promise<void>;
    act(() => { first = result.current.runStream({ session_id: "s", message: "first" }); });
    act(() => {
      runs[0].emit("tool_start", { tool_name: "read", tool_call_id: "call_0", label: "Read" });
      runs[0].emit("tool_result", { tool_name: "read", tool_call_id: "call_0", summary: "first result" });
    });
    await act(async () => { runs[0].resolve(); await first!; });

    let second: Promise<void>;
    act(() => { second = result.current.runStream({ session_id: "s", message: "second" }); });
    act(() => {
      runs[1].emit("tool_start", { tool_name: "read", tool_call_id: "call_0", label: "Read again" });
      runs[1].emit("tool_result", { tool_name: "read", tool_call_id: "call_0", summary: "second result" });
    });
    await act(async () => { runs[1].resolve(); await second!; });

    expect(result.current.lines.filter((line) => line.kind === "tool")).toMatchObject([
      { tool_call_id: "call_0", summary: "first result" },
      { tool_call_id: "call_0", summary: "second result" },
    ]);
  });

  it("keeps action callbacks stable while messages change", async () => {
    const { result } = renderHook(() => useAgentChatStream(options));
    const actions = [result.current.confirm, result.current.planAction, result.current.runStream];
    act(() => result.current.setLines([{ kind: "assistant", text: "new text" }]));
    expect([result.current.confirm, result.current.planAction, result.current.runStream]).toEqual(actions);
  });
});
