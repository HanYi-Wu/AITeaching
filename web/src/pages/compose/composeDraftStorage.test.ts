import { beforeEach, describe, expect, it } from "vitest";
import { buildComposeDraftStorageKey, normalizeComposeDraftScope, readScopedComposeDraft, shouldIgnoreComposeShortcut, writeScopedComposeDraft } from "./composeDraftStorage";
import { createEmptyPaperState } from "./composeModel";

const scope = { accountId: "teacher-a", projectRoot: "C:/project", paperKey: "exam:Quiz/Math" };
beforeEach(() => localStorage.clear());

describe("local paper draft storage", () => {
  it("requires a reliable account and project, and separates papers and accounts", () => {
    expect(normalizeComposeDraftScope({ accountId: null, projectRoot: "C:/project" })).toBeNull();
    expect(normalizeComposeDraftScope({ accountId: "teacher-a", projectRoot: null })).toBeNull();
    const keys = [scope, { ...scope, accountId: "teacher-b" }, { ...scope, projectRoot: "C:/other" }, { ...scope, paperKey: "scratch" }].map(buildComposeDraftStorageKey);
    expect(new Set(keys).size).toBe(4);
    expect(buildComposeDraftStorageKey({ ...scope, projectRoot: "C:\\project\\" })).toBe(keys[0]);
  });

  it("persists an allowlisted paper snapshot without credentials or unrelated state", () => {
    const paper = { ...createEmptyPaperState({ bySection: { choice: ["q1"] } }), token: "private-token", authorization: "Bearer private" };
    expect(writeScopedComposeDraft(scope, paper).ok).toBe(true);
    const raw = localStorage.getItem(buildComposeDraftStorageKey(scope))!;
    expect(raw).not.toContain("private-token");
    expect(raw).not.toContain("authorization");
    expect(readScopedComposeDraft(scope).record?.paper.bySection).toEqual({ choice: ["q1"] });
    expect(readScopedComposeDraft({ ...scope, accountId: "teacher-b" }).record).toBeNull();
  });

  it.each(["{broken", JSON.stringify({ version: 9 }), JSON.stringify({ version: 1, scope: { ...scope, accountId: "other" } })])("clears unreadable or mismatched records safely", (raw) => {
    const key = buildComposeDraftStorageKey(scope);
    localStorage.setItem(key, raw);
    expect(readScopedComposeDraft(scope).status).toBe("corrupted_cleared");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("degrades on unavailable or full storage while retaining the in-memory paper", () => {
    const paper = createEmptyPaperState({ exportLabel: "Keep this" });
    const result = writeScopedComposeDraft(scope, paper, { setItem() { throw new DOMException("full", "QuotaExceededError"); } });
    expect(result).toMatchObject({ ok: false, status: "quota_exceeded" });
    expect(paper.exportLabel).toBe("Keep this");
    expect(readScopedComposeDraft(scope, null).status).toBe("storage_error");
  });

  it("respects text editing and IME when deciding whether to handle undo", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(shouldIgnoreComposeShortcut({ key: "z", target: input })).toBe(true);
    input.remove();
    expect(shouldIgnoreComposeShortcut({ key: "z", isComposing: true })).toBe(true);
    expect(shouldIgnoreComposeShortcut({ key: "z", keyCode: 229 })).toBe(true);
    expect(shouldIgnoreComposeShortcut({ key: "z", target: document.body })).toBe(false);
  });
});
