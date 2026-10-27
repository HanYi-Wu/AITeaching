import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockMathfieldElement, mathfieldConstructed } = vi.hoisted(() => {
  const mathfieldConstructed = vi.fn();
  class MockMathfieldElement extends HTMLElement {
    latexValue = "";
    constructor() {
      super();
      mathfieldConstructed();
    }
    getValue() {
      return this.latexValue;
    }
    setValue(val: string) {
      this.latexValue = val;
    }
    focus = vi.fn();
  }

  if (typeof customElements !== "undefined" && !customElements.get("mock-math-field-p")) {
    customElements.define("mock-math-field-p", MockMathfieldElement);
  }

  return { MockMathfieldElement, mathfieldConstructed };
});

vi.mock("mathlive", () => ({
  MathfieldElement: MockMathfieldElement,
}));

import { MathSymbolsDropdown, SYMBOL_GROUPS } from "./MathSymbolsPanel";
import { MathEditPopup } from "./MathEditPopup";
import { MathInsertOverlay } from "../MathInsertOverlay";

describe("MathSymbolsPanel and MathEditPopup", () => {
  beforeEach(() => mathfieldConstructed.mockClear());

  it("renders MathSymbolsDropdown and selects symbols", () => {
    const onSelect = vi.fn();
    const { getByTitle, getByText, queryByText } = render(
      <MathSymbolsDropdown onSelectSymbol={onSelect} />
    );

    const trigger = getByTitle("常用符号");
    expect(trigger).toBeInTheDocument();
    expect(queryByText("希腊字母")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(getByText("希腊字母")).toBeInTheDocument();
    expect(getByText("运算符")).toBeInTheDocument();
    expect(getByText("常用")).toBeInTheDocument();

    const alphaBtn = getByTitle("\\alpha");
    fireEvent.click(alphaBtn);

    expect(onSelect).toHaveBeenCalledWith("\\alpha");
    expect(queryByText("希腊字母")).not.toBeInTheDocument();
  });

  it("contains complete symbol definitions matching original spec", () => {
    expect(SYMBOL_GROUPS.map((g) => g.label)).toEqual(["希腊字母", "运算符", "常用"]);
    const greek = SYMBOL_GROUPS.find((g) => g.label === "希腊字母")!;
    expect(greek.symbols.map((s) => s.label)).toContain("α");
    expect(greek.symbols.map((s) => s.label)).toContain("π");
  });

  it("renders MathEditPopup with new/edit title and handles confirm/cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { container, getByText, rerender } = render(
      <MathEditPopup
        open={true}
        isNew={true}
        position={{ top: 100, left: 200 }}
        initialLatex="x^2"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    await waitFor(() => expect(container.querySelector("#lrt-math-popup math-field, #lrt-math-popup mock-math-field-p")).not.toBeNull());
    const field = container.querySelector("#lrt-math-popup mock-math-field-p") as InstanceType<typeof MockMathfieldElement>;
    await waitFor(() => expect(field.focus).toHaveBeenCalled());
    expect(getByText("插入公式")).toBeInTheDocument();
    expect(getByText("Enter 确认 · Esc 取消")).toBeInTheDocument();

    const cancelBtn = getByText("取消");
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();

    const confirmBtn = getByText("确认");
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith("x^2");

    rerender(
      <MathEditPopup
        open={true}
        isNew={false}
        position={{ top: 120, left: 220 }}
        initialLatex="x^2"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(getByText("编辑公式")).toBeInTheDocument();
  });

  it("preserves MathEditPopup input when parent callbacks change", async () => {
    const initialConfirm = vi.fn();
    const initialCancel = vi.fn();
    const { container, rerender } = render(
      <MathEditPopup
        open={true}
        isNew={true}
        position={{ top: 100, left: 200 }}
        initialLatex="x^2"
        onConfirm={initialConfirm}
        onCancel={initialCancel}
      />
    );

    await waitFor(() => expect(container.querySelector("#lrt-math-popup mock-math-field-p")).not.toBeNull());
    const popup = container.querySelector("#lrt-math-popup")!;
    const host = popup.firstElementChild!.children[1] as HTMLDivElement;
    const field = host.firstElementChild as InstanceType<typeof MockMathfieldElement>;
    field.latexValue = "typed formula";

    const nextConfirm = vi.fn();
    const nextCancel = vi.fn();
    rerender(
      <MathEditPopup
        open={true}
        isNew={true}
        position={{ top: 120, left: 220 }}
        initialLatex="x^2"
        onConfirm={nextConfirm}
        onCancel={nextCancel}
      />
    );

    expect(host.firstElementChild).toBe(field);
    expect(field.latexValue).toBe("typed formula");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(nextConfirm).toHaveBeenCalledWith("typed formula");
  });

  it("preserves MathInsertOverlay input when parent callbacks change", async () => {
    const initialConfirm = vi.fn();
    const initialClose = vi.fn();
    const { getByRole, rerender } = render(
      <MathInsertOverlay open onConfirm={initialConfirm} onClose={initialClose} />
    );

    await waitFor(() => expect(getByRole("dialog").querySelector("mock-math-field-p")).not.toBeNull());
    const dialog = getByRole("dialog");
    const host = dialog.firstElementChild!.children[2] as HTMLDivElement;
    const field = host.firstElementChild as InstanceType<typeof MockMathfieldElement>;
    field.latexValue = "typed formula";

    const nextConfirm = vi.fn();
    const nextClose = vi.fn();
    rerender(<MathInsertOverlay open onConfirm={nextConfirm} onClose={nextClose} />);

    expect(host.firstElementChild).toBe(field);
    expect(field.latexValue).toBe("typed formula");
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(nextClose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledOnce();
    nextClose.mockClear();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(nextConfirm).toHaveBeenCalledWith("$typed formula$");
    expect(nextClose).toHaveBeenCalledOnce();
  });

  it("does not construct MathLive while both formula editors are closed", async () => {
    const { rerender } = render(
      <>
        <MathEditPopup open={false} isNew position={{ top: 0, left: 0 }} initialLatex="" onConfirm={vi.fn()} onCancel={vi.fn()} />
        <MathInsertOverlay open={false} onConfirm={vi.fn()} onClose={vi.fn()} />
      </>,
    );
    await Promise.resolve();
    expect(mathfieldConstructed).not.toHaveBeenCalled();

    rerender(
      <>
        <MathEditPopup open isNew position={{ top: 0, left: 0 }} initialLatex="" onConfirm={vi.fn()} onCancel={vi.fn()} />
        <MathInsertOverlay open onConfirm={vi.fn()} onClose={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(mathfieldConstructed).toHaveBeenCalledTimes(2));
  });
});
