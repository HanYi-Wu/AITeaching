import { describe, expect, it, vi } from "vitest";
import { appendAssistantText, createTextDeltaBuffer, finishToolLine, startToolLine } from "./streamUpdates";
import type { ChatLine } from "./types";

describe("stream text updates", () => {
  it("commits a burst once and flushes all text at an event boundary", () => {
    const commit = vi.fn();
    const schedule = vi.fn(() => 7);
    const cancel = vi.fn();
    const buffer = createTextDeltaBuffer(commit, schedule, cancel);
    for (let index = 0; index < 1000; index++) buffer.push(String(index));
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    buffer.flush();
    expect(commit).toHaveBeenCalledExactlyOnceWith(Array.from({ length: 1000 }, (_, i) => String(i)).join(""));
    expect(cancel).toHaveBeenCalledWith(7);
    buffer.flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("discards text belonging to a replaced conversation", () => {
    let frame: (() => void) | undefined;
    const commit = vi.fn();
    const buffer = createTextDeltaBuffer(commit, (callback) => { frame = callback; return 1; }, vi.fn());
    buffer.push("old conversation");
    buffer.discard();
    frame?.();
    expect(commit).not.toHaveBeenCalled();
    buffer.push("new conversation");
    buffer.flush();
    expect(commit).toHaveBeenCalledExactlyOnceWith("new conversation");
  });

  it("preserves historical objects and assistant card identity", () => {
    const history: ChatLine = { kind: "user", text: "question", key: "user" };
    const original: ChatLine[] = [history, { kind: "assistant", text: "first", key: "segment" }];
    const appended = appendAssistantText(original, " second", false, "unused");
    expect(appended[0]).toBe(history);
    expect(appended[1]).toEqual({ kind: "assistant", text: "first second", key: "segment" });
    expect(original[1]).toMatchObject({ text: "first" });
    const nextSegment = appendAssistantText(appended, "third", true, "next");
    expect(nextSegment).toHaveLength(3);
    expect(nextSegment[2]).toEqual({ kind: "assistant", text: "third", key: "next" });
  });
});

describe("tool result projection", () => {
  it("accepts a reused gateway call id after its previous tool has completed", () => {
    let lines: ChatLine[] = [{ kind: "tool", tool_name: "read", tool_call_id: "call_0", summary: "first", key: "first" }];
    lines = startToolLine(lines, { kind: "tool_pending", tool_name: "read", tool_call_id: "call_0", label: "second", key: "second" });
    lines = finishToolLine(lines, { kind: "tool", tool_name: "read", tool_call_id: "call_0", summary: "second" });
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.key)).toEqual(["first", "second"]);
    expect(lines[1]).toMatchObject({ summary: "second" });
  });
  it("keeps completion order and stable cards when tools finish in reverse order", () => {
    let lines: ChatLine[] = [{ kind: "assistant", text: "working", key: "before" }];
    const first = { kind: "tool_pending", key: "first", tool_name: "read", tool_call_id: "a", label: "A" } as const;
    const second = { kind: "tool_pending", key: "second", tool_name: "read", tool_call_id: "b", label: "B" } as const;
    lines = startToolLine(startToolLine(lines, first), second);
    expect(startToolLine(lines, first)).toBe(lines);
    lines = finishToolLine(lines, { kind: "tool", key: "ignored", tool_name: "read", tool_call_id: "b", summary: "B done" });
    lines = finishToolLine(lines, { kind: "tool", key: "ignored", tool_name: "read", tool_call_id: "a", summary: "A done" });
    expect(lines.map((line) => line.key)).toEqual(["before", "second", "first"]);
    expect(lines.filter((line) => line.kind === "tool").map((line) => line.summary)).toEqual(["B done", "A done"]);
    expect(finishToolLine(lines, { kind: "tool", tool_name: "read", tool_call_id: "a", summary: "duplicate" })).toBe(lines);
  });
});
