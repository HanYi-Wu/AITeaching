import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeStudentTextDraft, clearStudentTextDraft, markStudentTextDraftSent,
  persistStudentTextDraft, restoreStudentTextDraft, studentDraftKey,
  type StudentDraftScope,
} from "./studentTextDraft";

const scope: StudentDraftScope = {
  accountId: "student-1", projectScope: "project-1", publicationId: "publication-1",
  attemptId: "attempt-1", snapshotVersion: "snapshot-1",
};

describe("student text draft recovery", () => {
  beforeEach(() => localStorage.clear());

  it("restores unconfirmed text and explicit clearing without storing image data", () => {
    expect(persistStudentTextDraft(scope, { q1: "new", q2: "" }, { q1: "old", q2: "clear me" })).toBeNull();
    const restored = restoreStudentTextDraft(scope, { q1: "old", q2: "clear me" }, ["q1", "q2"]);
    expect(restored.answers).toEqual({ q1: "new", q2: "" });
    expect(restored.restored).toBe(true);
    expect(localStorage.getItem(studentDraftKey(scope)!)).not.toContain("data_url");
  });

  it.each(["accountId", "projectScope", "publicationId", "attemptId", "snapshotVersion"] as const)("isolates %s", (dimension) => {
    persistStudentTextDraft(scope, { q1: "private" }, {});
    expect(restoreStudentTextDraft({ ...scope, [dimension]: "another" }, {}, ["q1"]).answers).toEqual({});
  });

  it("retains edits and a revert made while an older value is being saved", () => {
    persistStudentTextDraft(scope, { q1: "sent" }, { q1: "baseline" });
    markStudentTextDraftSent(scope, { q1: "sent" });
    persistStudentTextDraft(scope, { q1: "baseline" }, { q1: "baseline" }, { q1: "sent" });
    acknowledgeStudentTextDraft(scope, { q1: "sent" });
    expect(restoreStudentTextDraft(scope, { q1: "sent" }, ["q1"]).answers.q1).toBe("baseline");
    acknowledgeStudentTextDraft(scope, { q1: "baseline" });
    expect(localStorage.getItem(studentDraftKey(scope)!)).toBeNull();
  });

  it("can recover a newer edit when an unacknowledged request reached the server", () => {
    persistStudentTextDraft(scope, { q1: "newest" }, { q1: "old" }, { q1: "sent" });
    expect(restoreStudentTextDraft(scope, { q1: "sent" }, ["q1"]).answers.q1).toBe("newest");
  });

  it("keeps server conflicts for explicit recovery while other answers are edited", () => {
    persistStudentTextDraft(scope, { q1: "local" }, { q1: "old" });
    const restored = restoreStudentTextDraft(scope, { q1: "other device" }, ["q1", "q2"]);
    expect(restored.answers.q1).toBe("other device");
    expect(restored.conflicts).toEqual({ q1: "local" });
    persistStudentTextDraft(scope, { q1: "other device", q2: "new" }, { q1: "other device" }, {}, undefined, ["q1"]);
    markStudentTextDraftSent(scope, { q2: "new" });
    acknowledgeStudentTextDraft(scope, { q2: "new" });
    expect(restoreStudentTextDraft(scope, { q1: "other device", q2: "new" }, ["q1", "q2"]).conflicts).toEqual({ q1: "local" });
  });

  it("ignores unknown questions and handles corruption, capacity and unavailable storage", () => {
    persistStudentTextDraft(scope, { foreign: "private" }, {});
    expect(restoreStudentTextDraft(scope, {}, ["q1"]).answers).toEqual({});
    localStorage.setItem(studentDraftKey(scope)!, "{broken");
    expect(restoreStudentTextDraft(scope, {}, ["q1"]).issue).toBe("corrupt");
    expect(persistStudentTextDraft(scope, { q1: "x".repeat(100_001) }, {})).toBe("too_large");
    const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
    expect(persistStudentTextDraft(scope, { q1: "text" }, {}, {}, unavailable)).toBe("unavailable");
    expect(restoreStudentTextDraft(scope, {}, ["q1"], unavailable).issue).toBe("unavailable");
  });

  it("keeps failed text writes in account-scoped memory for the current tab", () => {
    const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
    expect(persistStudentTextDraft(scope, { q1: "local" }, { q1: "server" }, {}, unavailable)).toBe("unavailable");
    expect(restoreStudentTextDraft(scope, { q1: "server" }, ["q1"], unavailable)).toMatchObject({
      answers: { q1: "local" }, restored: true, issue: "unavailable",
    });
    expect(restoreStudentTextDraft({ ...scope, accountId: "student-2" }, {}, ["q1"], unavailable).answers).toEqual({});
  });

  it("prefers dirty memory over stale storage and remembers a failed clear", () => {
    persistStudentTextDraft(scope, { q1: "old" }, {});
    const blockedWrite = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem() { throw new Error("quota exceeded"); },
      removeItem() { throw new Error("storage blocked"); },
    };
    expect(persistStudentTextDraft(scope, { q1: "new" }, {}, {}, blockedWrite)).toBe("unavailable");
    expect(restoreStudentTextDraft(scope, {}, ["q1"], blockedWrite).answers.q1).toBe("new");
    expect(clearStudentTextDraft(scope, blockedWrite)).toBe("unavailable");
    expect(restoreStudentTextDraft(scope, {}, ["q1"], blockedWrite)).toMatchObject({ answers: {}, issue: "unavailable" });
  });

  it("clears only the exact confirmed submission scope", () => {
    const other = { ...scope, attemptId: "attempt-2" };
    persistStudentTextDraft(scope, { q1: "one" }, {});
    persistStudentTextDraft(other, { q1: "two" }, {});
    clearStudentTextDraft(scope);
    expect(restoreStudentTextDraft(scope, {}, ["q1"]).answers).toEqual({});
    expect(restoreStudentTextDraft(other, {}, ["q1"]).answers.q1).toBe("two");
  });
});
