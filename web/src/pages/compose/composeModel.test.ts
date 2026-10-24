import { describe, expect, it } from "vitest";
import type { QuestionRow, TemplateRow } from "../../types/compose";
import {
  addQuestionsToSectionInModel, areAllSectionsSatisfied, buildSelectedItemsForApi,
  clampSectionRequiredCount, computeTotalScore, createEmptyPaperState,
  examDocToPaperState, fillSectionGapsInModel, moveQuestionsInSectionInModel,
  removeQuestionsFromSectionInModel, resolveSelectedTemplate,
  setQuestionScoreOverrideInModel, syncPaperStateWithTemplate,
} from "./composeModel";

const template: TemplateRow = {
  id: "math", path: "templates/math.yaml", layout: "single_column",
  sections: [{ section_id: "choice", type: "single_choice", required_count: 2, score_per_item: 5 }],
};
function question(id: string, extra: Partial<QuestionRow> = {}): QuestionRow {
  return { id, qualified_id: id, namespace: "math", type: "single_choice", answer: "A", content: id, content_preview: id, analysis: "", ...extra };
}
const questions = [question("q1"), question("q2"), question("q3"), question("essay", { type: "essay" })];
const questionMap = new Map(questions.map((q) => [q.qualified_id, q]));
const initial = () => createEmptyPaperState({ templatePath: template.path, templateRef: template.id, bySection: { choice: ["q1"] } });

describe("compose business operations", () => {
  it("deduplicates a batch, skips incompatible types and keeps the original snapshot", () => {
    const state = initial();
    const result = addQuestionsToSectionInModel({ state, template, sectionId: "choice", questionIds: ["q1", "q2", "q2", "essay"], questionMap });
    expect(result).toMatchObject({ ok: true, changed: true, addedIds: ["q2"], skippedTypeCount: 1 });
    if (!result.ok) throw new Error("expected compatible selection");
    expect(result.nextState.bySection.choice).toEqual(["q1", "q2"]);
    expect(state.bySection.choice).toEqual(["q1"]);
    expect(areAllSectionsSatisfied(template, result.nextState.bySection, {})).toBe(true);
  });

  it("rejects an overfull section atomically and honors the required-count override", () => {
    const state = initial();
    const args = { state, template, sectionId: "choice", questionIds: ["q2", "q3"], questionMap };
    expect(addQuestionsToSectionInModel(args)).toEqual({ ok: false, errorCode: "sectionFull" });
    expect(state.bySection.choice).toEqual(["q1"]);
    expect(addQuestionsToSectionInModel({ ...args, state: { ...state, countBySection: { choice: 3 } } })).toMatchObject({ ok: true, changed: true });
  });

  it("removes the selected question and its score override together", () => {
    const state = { ...initial(), scoreOverrides: { choice: { q1: 9 } } };
    const result = removeQuestionsFromSectionInModel(state, "choice", ["q1"]);
    expect(result).toMatchObject({ ok: true, removedIds: ["q1"], nextState: { bySection: { choice: [] }, scoreOverrides: {} } });
    expect(state.scoreOverrides.choice.q1).toBe(9);
  });

  it("moves an adjacent question group as a unit", () => {
    const rows = [question("a"), question("b", { group_member_qualified_ids: ["b", "c"] }), question("c", { group_member_qualified_ids: ["b", "c"] }), question("d")];
    const state = createEmptyPaperState({ bySection: { choice: ["a", "b", "c", "d"] } });
    const result = moveQuestionsInSectionInModel(state, "choice", ["b"], "up", new Map(rows.map((q) => [q.id, q])));
    expect(result.nextState.bySection.choice).toEqual(["b", "c", "a", "d"]);
    expect(state.bySection.choice).toEqual(["a", "b", "c", "d"]);
  });

  it("fills only missing slots without replacing already selected questions", () => {
    const state = initial();
    const result = fillSectionGapsInModel({ state, template, candidateQuestions: questions });
    expect(result.addedCount).toBe(1);
    expect(result.nextState.bySection.choice).toEqual(["q1", "q2"]);
    expect(state.bySection.choice).toEqual(["q1"]);
  });

  it("computes section and per-question scores and supports removing an override", () => {
    let state = createEmptyPaperState({ bySection: { choice: ["q1", "q2"] }, scoreBySection: { choice: 4 } });
    state = setQuestionScoreOverrideInModel(state, "choice", "q1", "2.5");
    expect(computeTotalScore(template, state.bySection, state.scoreBySection, state.scoreOverrides)).toBe(6.5);
    state = setQuestionScoreOverrideInModel(state, "choice", "q1", "");
    expect(computeTotalScore(template, state.bySection, state.scoreBySection, state.scoreOverrides)).toBe(8);
    expect(setQuestionScoreOverrideInModel(state, "choice", "q1", "-1")).toBe(state);
  });

  it.each([["-5", 0], ["2.8", 2], ["999", 500], ["bad", 0]])("normalizes required count %s to %s", (raw, expected) => {
    expect(clampSectionRequiredCount(raw)).toBe(expected);
  });

  it("removes settings for deleted template sections and keeps live selection", () => {
    const state = createEmptyPaperState({ ...initial(), bySection: { choice: ["q1"], deleted: ["q3"] }, countBySection: { choice: 2, deleted: 5 }, scoreOverrides: { deleted: { q3: 8 } } });
    const next = syncPaperStateWithTemplate(state, template);
    expect(next.bySection).toEqual({ choice: ["q1"] });
    expect(next.countBySection).toEqual({ choice: 2 });
    expect(next.scoreOverrides).toEqual({});
  });

  it("round-trips existing documents into an independent API payload", () => {
    const { state } = examDocToPaperState({ exam_id: "Quiz/Math", export_label: "Quiz", subject: "Math", template_ref: "math", template_path: "../../../templates/math.yaml", selected_items: [{ section_id: "choice", question_ids: ["q1"], score_per_item: 3, required_count: 1, score_overrides: { q1: 2 } }] });
    const payload = buildSelectedItemsForApi(template, state);
    expect(payload).toEqual([{ section_id: "choice", question_ids: ["q1"], score_per_item: 3, required_count: 1, score_overrides: { q1: 2 } }]);
    payload[0]!.question_ids.push("q2");
    expect(state.bySection.choice).toEqual(["q1"]);
    expect(resolveSelectedTemplate([template], state)).toBe(template);
  });
});
