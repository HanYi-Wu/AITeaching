import { describe, expect, it } from "vitest";
import {
  buildMetadataFilterDefinitions,
  compileMetadataFilters,
  hasActiveMetadataFilters,
  matchesMetadataFilters,
  type MetadataFilters,
} from "./metadataFilters";

describe("metadataFilters", () => {
  it("builds enum and numeric filter definitions from metadata", () => {
    const definitions = buildMetadataFilterDefinitions([
      { metadata: { difficulty: "high", source: "mock", novelty: 0.7 } },
      { metadata: { difficulty: "low", source: "mock", novelty: 0.2 } },
      { metadata: { difficulty: "high", ignored: { nested: true } } },
    ]);

    expect(definitions).toEqual([
      { key: "difficulty", kind: "enum", values: ["high", "low"] },
      { key: "novelty", kind: "number", min: 0.2, max: 0.7 },
      { key: "source", kind: "enum", values: ["mock"] },
    ]);
  });

  it("matches enum and numeric filters as an intersection", () => {
    const filters: MetadataFilters = {
      difficulty: { kind: "enum", selected: ["high"] },
      novelty: { kind: "number", min: "0.3", max: "0.8" },
    };

    expect(matchesMetadataFilters({ difficulty: "high", novelty: 0.5 }, filters)).toBe(true);
    expect(matchesMetadataFilters({ difficulty: "low", novelty: 0.5 }, filters)).toBe(false);
    expect(matchesMetadataFilters({ difficulty: "high", novelty: 0.9 }, filters)).toBe(false);
    expect(matchesMetadataFilters({ difficulty: "high" }, filters)).toBe(false);
  });

  it("ignores inactive and invalid numeric filters", () => {
    expect(hasActiveMetadataFilters({ novelty: { kind: "number", min: "", max: "" } })).toBe(false);
    expect(matchesMetadataFilters({ novelty: 0.5 }, { novelty: { kind: "number", min: "abc" } })).toBe(true);
  });

  it("matches explicit missing metadata filters", () => {
    expect(matchesMetadataFilters({}, { difficulty: { kind: "enum", selected: [], includeMissing: true } })).toBe(true);
    expect(matchesMetadataFilters({ difficulty: "high" }, { difficulty: { kind: "enum", selected: [], includeMissing: true } })).toBe(false);
    expect(matchesMetadataFilters({}, { novelty: { kind: "number", includeMissing: true } })).toBe(true);
    expect(matchesMetadataFilters({ novelty: 0.5 }, { novelty: { kind: "number", includeMissing: true } })).toBe(false);
  });

  it("compiles the filter clauses once and preserves nested primitive matching", () => {
    const filters: MetadataFilters = {
      topic: { kind: "enum", selected: ["代数"] },
      score: { kind: "number", min: "3", max: "5" },
    };
    const matcher = compileMetadataFilters(filters);

    expect(matcher).not.toBeNull();
    expect(matcher?.({ topic: [["几何", "代数"]], score: [[2, [4]], "5"] })).toBe(true);
    expect(matcher?.({ topic: ["代数"], score: [2, "4"] })).toBe(false);
    expect(compileMetadataFilters({ topic: { kind: "enum", selected: [] } })).toBeNull();
    expect(compileMetadataFilters({ score: { kind: "number", min: "invalid" } })).toBeNull();
  });

  it("builds numeric bounds from large repeated-key inputs without spreading into Math.min/max", () => {
    const items = Array.from({ length: 140_000 }, () => ({ metadata: { score: 0.5 } }));

    expect(buildMetadataFilterDefinitions(items)).toEqual([
      { key: "score", kind: "number", min: 0.5, max: 0.5 },
    ]);
  });

  it("preserves signed zero when finding numeric bounds", () => {
    const definitions = buildMetadataFilterDefinitions([
      { metadata: { score: -0 } },
      { metadata: { score: 0 } },
    ]);
    const numeric = definitions[0];

    expect(numeric).toEqual({ key: "score", kind: "number", min: -0, max: 0 });
    if (numeric?.kind === "number") {
      expect(Object.is(numeric.min, -0)).toBe(true);
      expect(Object.is(numeric.max, 0)).toBe(true);
    }
  });

});
