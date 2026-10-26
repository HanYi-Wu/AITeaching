import { describe, expect, it, vi } from "vitest";
import { getFieldSelection } from "./asyncCallbackBridge";
import { renderMermaidToElement } from "./contentPreview";

vi.mock("../../lib/mermaidInit", () => {
  return {
    initMermaid: vi.fn(async () => {
      return {
        render: vi.fn(async (id: string, source: string) => {
          // If source contains "SLOW", delay to simulate late arrival
          if (source.includes("SLOW")) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { svg: `<svg id="${id}" data-source="${source}"></svg>` };
        }),
      };
    }),
  };
});

describe("asyncCallbackBridge", () => {
  describe("getFieldSelection", () => {
    it("reads selection from source textarea and syncs to hidden textarea in source mode", () => {
      const hiddenTa = document.createElement("textarea");
      hiddenTa.value = "0123456789";
      const sourceTa = document.createElement("textarea");
      sourceTa.value = "0123456789";
      sourceTa.selectionStart = 3;
      sourceTa.selectionEnd = 7;

      const getOffsetMock = vi.fn();
      const sel = getFieldSelection(null, hiddenTa, sourceTa, "source", getOffsetMock);

      expect(sel).toEqual({ start: 3, end: 7 });
      expect(hiddenTa.selectionStart).toBe(3);
      expect(hiddenTa.selectionEnd).toBe(7);
      expect(getOffsetMock).not.toHaveBeenCalled();
    });

    it("falls back to hidden textarea when no active selection in DOM", () => {
      const hiddenTa = document.createElement("textarea");
      hiddenTa.value = "abcdef";
      hiddenTa.selectionStart = 2;
      hiddenTa.selectionEnd = 4;

      const sel = getFieldSelection(null, hiddenTa, null, "visual", vi.fn());
      expect(sel).toEqual({ start: 2, end: 4 });
    });
  });

  describe("renderMermaidToElement sequence guard", () => {
    it("drops stale render when a newer render sequence is active", async () => {
      const container = document.createElement("div");

      // Start slow render (seq 1)
      const slowPromise = renderMermaidToElement("SLOW graph TD", container, 1);
      // Immediately start fast render (seq 2)
      const fastPromise = renderMermaidToElement("FAST graph LR", container, 2);

      await Promise.all([slowPromise, fastPromise]);

      // Container should have the FAST render, not overwritten by SLOW
      expect(container.innerHTML).toContain("FAST graph LR");
      expect(container.innerHTML).not.toContain("SLOW graph TD");
    });
  });
});
