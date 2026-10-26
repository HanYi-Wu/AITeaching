import { describe, expect, it, vi } from "vitest";
import {
  getFieldSelection,
  shouldIgnoreLateValueUpdate,
} from "./asyncCallbackBridge";
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

  describe("shouldIgnoreLateValueUpdate", () => {
    it("always ignores updates during IME composition", () => {
      expect(shouldIgnoreLateValueUpdate("hello", "hello world", true, true)).toBe(true);
      expect(shouldIgnoreLateValueUpdate("hello", "hello", false, true)).toBe(true);
    });

    it("allows updates when not focused (e.g. modal confirm, question switch)", () => {
      expect(shouldIgnoreLateValueUpdate("question 2", "question 1", false, false)).toBe(false);
      expect(shouldIgnoreLateValueUpdate("inserted $x$", "original", false, false)).toBe(false);
    });

    it("blocks stale updates when editor is actively focused and user has typed newer content", () => {
      // User typed "world" -> lastEmittedValue is "hello world". Stale incoming callback is "hello"
      expect(shouldIgnoreLateValueUpdate("hello", "hello world", true, false)).toBe(true);
    });

    it("allows updates when incoming value matches the currently emitted value", () => {
      expect(shouldIgnoreLateValueUpdate("hello world", "hello world", true, false)).toBe(false);
    });

    it("allows initial value on mount when lastEmittedValue is null", () => {
      expect(shouldIgnoreLateValueUpdate("initial", null, true, false)).toBe(false);
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
