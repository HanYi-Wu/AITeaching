import { describe, expect, it } from "vitest";
import {
  buildRangeCandidates,
  clampRangeNumber,
  getAvailableCandidates,
  parseCustomCandidates,
  pickRandomCandidates,
} from "./rollCallEngine";

describe("rollCallEngine", () => {
  it("clamps numeric range values safely", () => {
    expect(clampRangeNumber("25", 1)).toBe(25);
    expect(clampRangeNumber(-8, 1)).toBe(0);
    expect(clampRangeNumber(50000, 40)).toBe(9999);
    expect(clampRangeNumber("abc", 40)).toBe(40);
  });

  it("builds contiguous range candidates regardless of input order", () => {
    const forward = buildRangeCandidates(1, 3);
    expect(forward.map((item) => item.label)).toEqual(["1", "2", "3"]);

    const reversed = buildRangeCandidates(5, 3);
    expect(reversed.map((item) => item.label)).toEqual(["3", "4", "5"]);
  });

  it("parses custom candidates with line breaks, commas, or whitespace and deduplicates", () => {
    expect(parseCustomCandidates("")).toEqual([]);
    expect(parseCustomCandidates("张一, 李二\n王三\n张一\n2024001 赵四")).toEqual([
      { id: "custom:张一", label: "张一" },
      { id: "custom:李二", label: "李二" },
      { id: "custom:王三", label: "王三" },
      { id: "custom:2024001 赵四", label: "2024001 赵四" },
    ]);
    expect(parseCustomCandidates("Alice   Bob  Alice")).toEqual([
      { id: "custom:Alice", label: "Alice" },
      { id: "custom:Bob", label: "Bob" },
    ]);
  });

  it("filters picked ids in no-repeat mode and picks distinct entries in batch mode", () => {
    const pool = buildRangeCandidates(1, 5);
    const picked = new Set(["range:2", "range:4"]);
    const remaining = getAvailableCandidates(pool, picked, true);
    expect(remaining.map((c) => c.label)).toEqual(["1", "3", "5"]);
    expect(getAvailableCandidates(pool, picked, false)).toHaveLength(5);

    const sampled = pickRandomCandidates(remaining, 2, () => 0);
    expect(sampled.map((c) => c.label)).toEqual(["1", "3"]);
    expect(pickRandomCandidates(remaining, 10, () => 0).map((c) => c.label)).toEqual(["1", "3", "5"]);
  });
});
