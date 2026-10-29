import { describe, expect, it, vi } from "vitest";

import { CONTENT_ITEMS_MIME, CONTENT_ITEM_MIME, parseContentItemsDragData, setContentItemDragData } from "./contentSelection";

describe("content item drag selection", () => {
  it("carries the selected group when dragging a selected item and keeps the old single-item payload", () => {
    const setData = vi.fn();
    setContentItemDragData({ setData }, "paper", "paper-2", ["paper-1", "paper-2", "paper-1"]);

    expect(setData).toHaveBeenCalledWith(CONTENT_ITEMS_MIME, JSON.stringify({ scope: "paper", ids: ["paper-1", "paper-2"] }));
    expect(setData).toHaveBeenCalledWith(CONTENT_ITEM_MIME, JSON.stringify({ scope: "paper", id: "paper-2" }));
  });

  it("carries only the dragged item when it is not in the current selection", () => {
    const setData = vi.fn();
    setContentItemDragData({ setData }, "compose", "exam-3", ["exam-1", "exam-2"]);
    expect(setData).toHaveBeenCalledWith(CONTENT_ITEMS_MIME, JSON.stringify({ scope: "compose", ids: ["exam-3"] }));
  });

  it("rejects cross-scope or malformed drag payloads", () => {
    expect(() => parseContentItemsDragData(JSON.stringify({ scope: "paper", ids: ["p1"] }), "compose")).toThrow();
    expect(() => parseContentItemsDragData(JSON.stringify({ scope: "compose", ids: ["", 4] }), "compose")).toThrow();
  });
});
