import { describe, expect, it } from "vitest";
import { createEmptyPaperState } from "./composeModel";
import { createHistoryState, markHistorySaved, pushHistoryEdit, redoHistory, resetHistory, syncHistoryWithTemplate, undoHistory } from "./composeHistory";

describe("paper edit history", () => {
  it("undoes and redoes complete edits while retaining independent snapshots", () => {
    const baseline = createEmptyPaperState({ bySection: { s: ["q1"] } });
    const edited = { ...baseline, bySection: { s: ["q1", "q2"] }, scoreOverrides: { s: { q2: 3 } } };
    const history = pushHistoryEdit(createHistoryState(baseline), edited);
    edited.bySection.s.push("not-a-history-edit");
    const undone = undoHistory(history);
    expect(undone.present).toEqual(baseline);
    expect(redoHistory(undone).present.bySection.s).toEqual(["q1", "q2"]);
    expect(redoHistory(undone).present.scoreOverrides).toEqual({ s: { q2: 3 } });
  });

  it("clears redo on a new branch and ignores no-op edits", () => {
    const base = createEmptyPaperState();
    const history = pushHistoryEdit(createHistoryState(base), { ...base, subject: "Math" });
    const undone = undoHistory(history);
    const branch = pushHistoryEdit(undone, { ...base, subject: "Physics" });
    expect(branch.future).toEqual([]);
    expect(pushHistoryEdit(branch, { ...branch.present })).toBe(branch);
    expect(redoHistory(branch)).toBe(branch);
  });

  it("bounds memory and resets both stacks for another paper", () => {
    let history = createHistoryState(createEmptyPaperState());
    for (let i = 0; i < 70; i++) history = pushHistoryEdit(history, { ...history.present, exportLabel: `Quiz${i}` });
    expect(history.past).toHaveLength(50);
    const next = resetHistory(createEmptyPaperState({ exportLabel: "Other" }));
    expect(next.past).toEqual([]);
    expect(next.future).toEqual([]);
    expect(next.present).toEqual(next.baseline);
  });

  it("records the saved snapshot without overwriting edits made while saving", () => {
    const sent = createEmptyPaperState({ bySection: { s: ["q1"] } });
    const current = { ...sent, bySection: { s: ["q1", "q2"] } };
    const history = markHistorySaved(pushHistoryEdit(createHistoryState(sent), current), sent);
    expect(history.present.bySection.s).toEqual(["q1", "q2"]);
    expect(history.baseline.bySection.s).toEqual(["q1"]);
  });

  it("applies a template refresh to matching undo and redo snapshots", () => {
    const base = createEmptyPaperState({ templateRef: "math", templatePath: "templates/old.yaml", bySection: { kept: ["q1"], removed: ["q2"] } });
    const history = undoHistory(pushHistoryEdit(createHistoryState(base), { ...base, exportLabel: "Edited" }));
    const template = { id: "math", path: "templates/new.yaml", layout: "single_column", sections: [{ section_id: "kept", type: "single_choice", required_count: 1, score_per_item: 5 }] };
    const refreshed = syncHistoryWithTemplate(history, template);
    expect(redoHistory(refreshed).present.bySection).toEqual({ kept: ["q1"] });
    expect(redoHistory(refreshed).present.templatePath).toBe(template.path);
    expect(syncHistoryWithTemplate(refreshed, template)).toBe(refreshed);
  });
});
