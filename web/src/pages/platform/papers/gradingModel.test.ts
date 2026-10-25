import { describe, expect, it } from "vitest";
import {
  applyGradingSuggestions,
  createGradingDraft,
  gradingFeedbackForSave,
  markGradingDraftSaved,
  parseGradingScore,
  reconcileGradingDrafts,
  updateGradingDraft,
  type GradingDrafts,
} from "./gradingModel";

describe("gradingModel", () => {
  it("distinguishes an empty score from zero and preserves entered precision", () => {
    expect(parseGradingScore("")).toBeNull();
    expect(parseGradingScore("  ")).toBeNull();
    expect(parseGradingScore("0")).toBe(0);
    expect(parseGradingScore("3.75")).toBe(3.75);
    expect(parseGradingScore("8e-1")).toBe(0.8);
    expect(parseGradingScore("Infinity")).toBeNull();
    expect(parseGradingScore("NaN")).toBeNull();
  });

  it("keeps a changed comment dirty across a refresh even when the server returns that text", () => {
    const initial = createGradingDraft({ score: 2, feedback: "旧评语" });
    const edited: GradingDrafts = updateGradingDraft({}, "a1:q1", {
      score: 2,
      feedback: "旧评语",
    }, "feedback", "教师修改后的评语");
    const refreshed = reconcileGradingDrafts(edited, [{
      key: "a1:q1",
      source: { score: 2, feedback: "教师修改后的评语" },
    }]);

    expect(initial.feedback.dirty).toBe(false);
    expect(refreshed["a1:q1"].feedback).toEqual({
      value: "教师修改后的评语",
      baseline: "旧评语",
      dirty: true,
    });
  });

  it("refreshes clean fields while preserving the changed field", () => {
    const edited = updateGradingDraft({}, "a1:q1", {
      score: 1,
      feedback: "原评语",
    }, "feedback", "教师评语");
    const refreshed = reconcileGradingDrafts(edited, [{
      key: "a1:q1",
      source: { score: 2, feedback: "服务器评语" },
    }]);

    expect(refreshed["a1:q1"].score).toEqual({ value: "2", baseline: "2", dirty: false });
    expect(refreshed["a1:q1"].feedback).toEqual({ value: "教师评语", baseline: "原评语", dirty: true });
  });

  it("protects a clean field edited after the refresh started", () => {
    const current = updateGradingDraft({}, "a1:q1", { score: 1 }, "score", "1");
    const refreshed = reconcileGradingDrafts(current, [{ key: "a1:q1", source: { score: 3 } }], (_key, field) => field !== "score");

    expect(refreshed["a1:q1"].score).toEqual({ value: "1", baseline: "1", dirty: false });
  });

  it("uses returned AI suggestions as the current grading draft", () => {
    const suggested = applyGradingSuggestions({}, [{
      key: "a1:q1",
      score: 2.5,
      feedback: "建议评语",
    }]);

    expect(suggested["a1:q1"]).toEqual({
      score: { value: "2.5", baseline: "2.5", dirty: false },
      feedback: { value: "建议评语", baseline: "建议评语", dirty: false },
    });
  });

  it("cleans the saved values and retains empty-versus-zero score semantics", () => {
    const edited = updateGradingDraft({}, "a1:q1", { score: null }, "score", "0");
    expect(parseGradingScore(edited["a1:q1"].score.value)).toBe(0);
    const saved = markGradingDraftSaved(edited["a1:q1"], { score: "0", feedback: "已保存" }, ["score"]);

    expect(saved.score).toEqual({ value: "0", baseline: "0", dirty: false });
    expect(saved.feedback).toEqual({ value: "", baseline: "已保存", dirty: true });
    expect(gradingFeedbackForSave(createGradingDraft({}).feedback)).toBeNull();
    expect(gradingFeedbackForSave(createGradingDraft({ feedback: "已保存" }).feedback)).toBe("已保存");
  });
});
