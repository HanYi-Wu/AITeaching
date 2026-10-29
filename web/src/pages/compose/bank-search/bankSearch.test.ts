import { describe, expect, it, vi } from "vitest";
import { matchesMetadataFilters, type MetadataFilters } from "../../../lib/metadataFilters";
import type { QuestionRow } from "../../../types/compose";
import { compileMetadataFilters } from "./metadataFilterMatcher";
import { getQuestionSearchText } from "./questionSearchIndex";

function makeQuestion(overrides: Partial<QuestionRow> = {}): QuestionRow {
  const id = overrides.id ?? "q1";
  return {
    id,
    qualified_id: `数学/代数/${id}`,
    namespace: "数学/代数",
    collection: "数学/代数",
    subject: "数学",
    type: "fill",
    content: `内容 ${id}`,
    content_preview: `预览 ${id}`,
    answer: "42",
    analysis: "",
    metadata: {},
    ...overrides,
  };
}

describe("compose bank search projection", () => {
  it("matches the existing metadata matcher for enum, number, missing, and combined filters", () => {
    const cases: Array<{
      metadata: Record<string, unknown> | undefined;
      filters: MetadataFilters;
    }> = [
      { metadata: { topic: "代数" }, filters: { topic: { kind: "enum", selected: ["代数"] } } },
      { metadata: { topic: ["几何", "代数"] }, filters: { topic: { kind: "enum", selected: ["代数"] } } },
      { metadata: {}, filters: { topic: { kind: "enum", selected: [], includeMissing: true } } },
      { metadata: { score: [2, 4, "6"] }, filters: { score: { kind: "number", min: "3", max: "5" } } },
      { metadata: { score: "4" }, filters: { score: { kind: "number", min: "3" } } },
      { metadata: undefined, filters: { topic: { kind: "enum", selected: [], includeMissing: true }, score: { kind: "number", max: "5" } } },
      { metadata: { topic: "代数", score: 4 }, filters: { topic: { kind: "enum", selected: ["代数"] }, score: { kind: "number", min: "4", max: "4" } } },
      { metadata: { score: 4 }, filters: { score: { kind: "number", min: "not-a-number" } } },
      { metadata: { score: Number.POSITIVE_INFINITY }, filters: { score: { kind: "number", includeMissing: true } } },
    ];

    for (const { metadata, filters } of cases) {
      const matcher = compileMetadataFilters(filters);
      const actual = matcher ? matcher(metadata) : true;
      expect(actual).toBe(matchesMetadataFilters(metadata, filters));
    }
  });

  it("preserves the existing ordered search projection and reuses only the supplied cache", () => {
    const question = makeQuestion({
      id: "choice-1",
      type: "choice",
      answer: "A、C",
      content_preview: "直角三角形",
      group_id: "group-a",
      group_material: "阅读材料",
      metadata: { topic: ["几何", "相似"] },
    });
    const baseline = [
      question.id,
      question.qualified_id,
      question.content_preview,
      "multiple_choice",
      question.group_id ?? "",
      question.group_material ?? "",
      JSON.stringify(question.metadata ?? {}),
    ]
      .join("\n")
      .toLowerCase();
    const firstCache = new WeakMap<QuestionRow, string>();
    const stringify = vi.spyOn(JSON, "stringify");

    expect(getQuestionSearchText(question, firstCache)).toBe(baseline);
    expect(getQuestionSearchText(question, firstCache)).toBe(baseline);
    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();

    question.content_preview = "更新後的預覽";
    const nextSnapshotCache = new WeakMap<QuestionRow, string>();
    expect(getQuestionSearchText(question, nextSnapshotCache)).toContain("更新後的預覽");
  });
});
