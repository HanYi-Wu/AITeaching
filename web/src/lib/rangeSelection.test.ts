import { describe, expect, it, vi } from "vitest";
import { applySelectionDelta, isShiftSpace, rangeSelection } from "./rangeSelection";

describe("rangeSelection", () => {
  it("adds the inclusive range in visible order without dropping existing selections", () => {
    expect(rangeSelection(["outside", "b"], ["a", "b", "c", "d"], "b", "d"))
      .toEqual(["outside", "b", "c", "d"]);
  });

  it("selects only the target when its anchor is not in the current visible list", () => {
    expect(rangeSelection(["hidden", "other"], ["a", "b", "c"], "hidden", "c"))
      .toEqual(["c"]);
  });

  it("applies fallback selections through a toggle-only callback", () => {
    const toggle = vi.fn();
    applySelectionDelta(["hidden", "a"], ["c"], toggle);
    expect(toggle.mock.calls).toEqual([["hidden"], ["a"], ["c"]]);
  });
});

describe("isShiftSpace", () => {
  it("recognizes a non-repeated Shift+Space key press", () => {
    expect(isShiftSpace({ key: " ", shiftKey: true, repeat: false })).toBe(true);
    expect(isShiftSpace({ key: "Space", shiftKey: true })).toBe(true);
    expect(isShiftSpace({ key: " ", shiftKey: true, repeat: true })).toBe(false);
    expect(isShiftSpace({ key: " ", shiftKey: false })).toBe(false);
  });
});
