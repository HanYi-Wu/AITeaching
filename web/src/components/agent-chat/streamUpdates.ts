import type { ChatLine } from "./types";

export function createTextDeltaBuffer(
  commit: (text: string) => void,
  schedule: (callback: () => void) => number = (callback) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : window.setTimeout(callback, 16),
  cancel: (handle: number) => void = (handle) =>
    typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(handle) : window.clearTimeout(handle),
) {
  let chunks: string[] = [];
  let scheduled: number | null = null;

  function flush() {
    if (scheduled !== null) cancel(scheduled);
    scheduled = null;
    if (!chunks.length) return;
    const text = chunks.join("");
    chunks = [];
    commit(text);
  }

  return {
    push(text: string) {
      chunks.push(text);
      if (scheduled === null) scheduled = schedule(flush);
    },
    flush,
    discard() {
      if (scheduled !== null) cancel(scheduled);
      scheduled = null;
      chunks = [];
    },
  };
}

export function appendAssistantText(lines: ChatLine[], text: string, closed: boolean, key: string): ChatLine[] {
  const last = lines[lines.length - 1];
  if (!closed && last?.kind === "assistant") {
    const next = lines.slice();
    next[next.length - 1] = { ...last, key: last.key ?? key, text: last.text + text };
    return next;
  }
  return [...lines, { kind: "assistant", key, text }];
}

export function startToolLine(lines: ChatLine[], pending: Extract<ChatLine, { kind: "tool_pending" }>): ChatLine[] {
  if (pending.tool_call_id && lines.some((line) =>
    line.kind === "tool_pending" && line.tool_call_id === pending.tool_call_id)) return lines;
  return [...lines, pending];
}

export function finishToolLine(lines: ChatLine[], result: Extract<ChatLine, { kind: "tool" }>): ChatLine[] {
  const index = lines.findIndex((line) => line.kind === "tool_pending" &&
    (result.tool_call_id ? line.tool_call_id === result.tool_call_id : line.tool_name === result.tool_name));
  if (index < 0 && result.tool_call_id && lines.some((line) => line.kind === "tool" && line.tool_call_id === result.tool_call_id)) return lines;
  if (index < 0) return [...lines, result];
  const next = lines.slice();
  const pending = next.splice(index, 1)[0];
  // Completed tools follow arrival order; their card identity survives the move.
  next.push({ ...result, key: pending.key ?? result.key });
  return next;
}
