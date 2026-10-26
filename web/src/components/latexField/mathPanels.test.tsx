import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { MockMathfieldElement } = vi.hoisted(() => {
  class MockMathfieldElement extends HTMLElement {
    latexValue = "";
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

  return { MockMathfieldElement };
});

vi.mock("mathlive", () => ({
  MathfieldElement: MockMathfieldElement,
}));

import { MathSymbolsDropdown, SYMBOL_GROUPS } from "./MathSymbolsPanel";
import { MathEditPopup } from "./MathEditPopup";

describe("MathSymbolsPanel and MathEditPopup", () => {
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

  it("renders MathEditPopup with new/edit title and handles confirm/cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { getByText, rerender } = render(
      <MathEditPopup
        open={true}
        isNew={true}
        position={{ top: 100, left: 200 }}
        initialLatex="x^2"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(getByText("插入公式")).toBeInTheDocument();
    expect(getByText("Enter 确认 · Esc 取消")).toBeInTheDocument();

    const cancelBtn = getByText("取消");
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();

    const confirmBtn = getByText("确认");
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalled();

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
});
