import { describe, expect, it, vi } from "vitest";

const { MockMathfieldElement } = vi.hoisted(() => {
  class MockMathfieldElement extends HTMLElement {
    latexValue = "";
    className = "";

    getValue() {
      return this.latexValue;
    }
    setValue(val: string) {
      this.latexValue = val;
    }
    focus = vi.fn();
  }

  if (typeof customElements !== "undefined" && !customElements.get("mock-math-field")) {
    customElements.define("mock-math-field", MockMathfieldElement);
  }

  return { MockMathfieldElement };
});

vi.mock("mathlive", () => ({
  MathfieldElement: MockMathfieldElement,
}));

import {
  createMathLiveBridge,
  DEFAULT_MATH_MODAL_CLASS,
  DEFAULT_MATH_POPUP_CLASS,
} from "./mathLiveBridge";

describe("mathLiveBridge", () => {
  it("mounts MathfieldElement into host and initializes properties", () => {
    const host = document.createElement("div");
    const bridge = createMathLiveBridge({
      host,
      initialLatex: "\\alpha + 1",
      className: DEFAULT_MATH_POPUP_CLASS,
    });

    const el = bridge.getElement();
    expect(el).not.toBeNull();
    expect(host.contains(el!)).toBe(true);
    expect(el?.className).toBe(DEFAULT_MATH_POPUP_CLASS);
    expect(bridge.getValue()).toBe("\\alpha + 1");

    bridge.destroy();
    expect(bridge.getElement()).toBeNull();
    expect(host.innerHTML).toBe("");
  });

  it("handles Enter keydown and triggers onConfirm with canonicalized LaTeX", () => {
    const host = document.createElement("div");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const bridge = createMathLiveBridge({
      host,
      initialLatex: "x + y",
      onConfirm,
      onCancel,
    });

    const el = bridge.getElement()!;
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(enterEvent);

    expect(onConfirm).toHaveBeenCalledWith("x + y");
    expect(onCancel).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("does not trigger onConfirm when Shift+Enter is pressed", () => {
    const host = document.createElement("div");
    const onConfirm = vi.fn();
    const bridge = createMathLiveBridge({
      host,
      initialLatex: "x + y",
      onConfirm,
    });

    const el = bridge.getElement()!;
    const shiftEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(shiftEnter);

    expect(onConfirm).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("handles Escape keydown and triggers onCancel", () => {
    const host = document.createElement("div");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const bridge = createMathLiveBridge({
      host,
      onConfirm,
      onCancel,
    });

    const el = bridge.getElement()!;
    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("ignores Enter keydown during Chinese IME composition (keyCode 229 / isComposing)", () => {
    const host = document.createElement("div");
    const onConfirm = vi.fn();
    const bridge = createMathLiveBridge({
      host,
      initialLatex: "x",
      onConfirm,
    });

    const el = bridge.getElement()!;
    const imeEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(imeEvent);

    expect(onConfirm).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("safely handles null host with no-op instance", () => {
    const bridge = createMathLiveBridge({
      host: null,
      className: DEFAULT_MATH_MODAL_CLASS,
    });

    expect(bridge.getElement()).toBeNull();
    expect(bridge.getValue()).toBe("");
    expect(bridge.getCanonicalLatex()).toBe("");
    expect(() => bridge.setValue("123")).not.toThrow();
    expect(() => bridge.focus()).not.toThrow();
    expect(() => bridge.destroy()).not.toThrow();
  });
});
