import { beforeEach, describe, expect, it } from "vitest";
import { createGradingDraft, updateGradingDraft } from "./gradingModel";
import {
  buildGradingDraftStorageKey,
  readGradingDraft,
  writeGradingDraft,
  type GradingDraftStorageScope,
} from "./gradingDraftStorage";

const scope: GradingDraftStorageScope = {
  accountId: "teacher-1",
  projectId: "project-1",
  paperId: "paper-1",
  attemptId: "attempt-1",
  questionId: "math/q1",
};

beforeEach(() => localStorage.clear());

describe("gradingDraftStorage", () => {
  it("stores only dirty fields under an account, project, and attempt scoped key", () => {
    const draft = updateGradingDraft({}, "a1:math/q1", { score: 2, feedback: "server" }, "score", "3.5")["a1:math/q1"];

    expect(writeGradingDraft(scope, draft, "revision-1")).toBe(true);
    expect(readGradingDraft(scope)).toEqual({
      draft: { version: 1, sourceVersion: "revision-1", score: "3.5" },
      status: "saved",
    });
    expect(readGradingDraft({ ...scope, accountId: "teacher-2" }).status).toBe("missing");
    expect(readGradingDraft({ ...scope, projectId: "project-2" }).status).toBe("missing");
    expect(readGradingDraft({ ...scope, attemptId: "attempt-2" }).status).toBe("missing");
    expect(buildGradingDraftStorageKey(scope)).not.toBe(buildGradingDraftStorageKey({ ...scope, questionId: "math/q2" }));
  });

  it("removes a saved entry when both fields return to their baseline", () => {
    const clean = createGradingDraft({ score: 2, feedback: "server" });
    localStorage.setItem(buildGradingDraftStorageKey(scope), JSON.stringify({ version: 1, sourceVersion: "r1", score: "3" }));

    expect(writeGradingDraft(scope, clean, "r1")).toBe(true);
    expect(readGradingDraft(scope).status).toBe("missing");
  });

  it("clears a corrupt record and degrades safely when storage access fails", () => {
    const key = buildGradingDraftStorageKey(scope);
    localStorage.setItem(key, "{");
    expect(readGradingDraft(scope).status).toBe("corrupted");
    expect(localStorage.getItem(key)).toBeNull();

    const unavailable = { getItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(readGradingDraft(scope, unavailable).status).toBe("unavailable");
    expect(writeGradingDraft(scope, createGradingDraft({}), null, {
      setItem: () => { throw new Error("quota"); },
      removeItem: () => undefined,
    })).toBe(false);
  });
});
