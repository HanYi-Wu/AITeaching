import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { LatexRichTextField } from "./LatexRichTextField";

vi.mock("mathlive", () => ({
  MathfieldElement: class MockMathfieldElement extends HTMLElement {
    getValue() {
      return "";
    }
    setValue() {}
  },
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg data-testid=\"mermaid-svg\"></svg>" })),
  },
}));

vi.mock("../lib/katexRender", () => ({
  renderMathToHtmlSimple: (latex: string) => `<span>${latex}</span>`,
}));

vi.mock("../api/client", () => ({
  resourceApiUrl: (path: string) => path,
}));

function renderField(value: string, onChange = vi.fn(), hideToolbar = false) {
  const textAreaRef = createRef<HTMLTextAreaElement>();
  const view = render(
    <LatexRichTextField
      value={value}
      onChange={onChange}
      textAreaRef={textAreaRef}
      hideToolbar={hideToolbar}
    />,
  );
  const editor = view.container.querySelector("[contenteditable='true']") as HTMLDivElement;
  return { ...view, editor, onChange };
}

describe("LatexRichTextField widget deletion", () => {
  let execCommand: ReturnType<typeof vi.fn>;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execCommand = vi.fn((command: string) => {
      if (command !== "delete") return false;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      sel.getRangeAt(0).deleteContents();
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("keeps the editor available while hiding advanced tools in simple mode", () => {
    const { editor, queryByTitle } = renderField("普通题干", vi.fn(), true);
    expect(editor).toBeInTheDocument();
    expect(queryByTitle("分数")).not.toBeInTheDocument();
  });

  it("deletes an inline math widget through the native undoable edit command", async () => {
    const { editor, onChange } = renderField("a $x$ b");
    const mathWidget = editor.querySelector(".lrt-math-widget");
    expect(mathWidget).not.toBeNull();
    const textAfter = mathWidget?.nextSibling;
    expect(textAfter?.nodeType).toBe(Node.TEXT_NODE);

    const range = document.createRange();
    range.setStart(textAfter!, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(execCommand).toHaveBeenCalledWith("delete");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("a  b"));
  });

  it("deletes a mermaid widget through the native undoable edit command", async () => {
    const mermaid = "```mermaid\ngraph TD\n  A --> B\n```";
    const { editor, onChange } = renderField(`before ${mermaid} after`);
    const mermaidWidget = editor.querySelector(".lrt-mermaid-widget");
    expect(mermaidWidget).not.toBeNull();
    const widgetIndex = Array.prototype.indexOf.call(editor.childNodes, mermaidWidget);
    expect(widgetIndex).toBeGreaterThanOrEqual(0);

    const range = document.createRange();
    range.setStart(editor, widgetIndex);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(editor, { key: "Delete" });

    expect(execCommand).toHaveBeenCalledWith("delete");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("before  after"));
  });
  it("does not overwrite active user input when a stale late-arriving value update is received while focused", () => {
    const onChange = vi.fn();
    const textAreaRef = createRef<HTMLTextAreaElement>();
    const { container, rerender } = render(
      <LatexRichTextField value="initial" onChange={onChange} textAreaRef={textAreaRef} />
    );
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    editor.focus();

    // User types additional text
    editor.textContent = "initial edited text";
    fireEvent.input(editor);
    expect(onChange).toHaveBeenCalledWith("initial edited text");

    // Stale prop from a delayed callback arrives while editor remains focused
    rerender(
      <LatexRichTextField value="initial" onChange={onChange} textAreaRef={textAreaRef} />
    );

    // Editor should not be overwritten back to stale "initial"
    expect(editor.textContent).toBe("initial edited text");
  });

  it("passes unified selection to embed requests in visual mode", () => {
    const onRequestMermaid = vi.fn();
    const textAreaRef = createRef<HTMLTextAreaElement>();
    const { getByTitle } = render(
      <LatexRichTextField
        value="0123456789"
        onChange={vi.fn()}
        textAreaRef={textAreaRef}
        onRequestMermaid={onRequestMermaid}
      />
    );

    fireEvent.click(getByTitle("插入流程图 / Mermaid 图表"));
    expect(onRequestMermaid).toHaveBeenCalled();
  });

  it("syncs source mode textarea selection to hidden sync textarea", () => {
    const textAreaRef = createRef<HTMLTextAreaElement>();
    const { container, getByText } = render(
      <LatexRichTextField
        value="0123456789"
        onChange={vi.fn()}
        textAreaRef={textAreaRef}
      />
    );

    // Switch to source mode
    fireEvent.click(getByText("源码"));
    const sourceTa = container.querySelector("textarea:not(.sr-only)") as HTMLTextAreaElement;
    expect(sourceTa).not.toBeNull();

    sourceTa.selectionStart = 4;
    sourceTa.selectionEnd = 8;
    fireEvent.keyUp(sourceTa);

    expect(textAreaRef.current?.selectionStart).toBe(4);
    expect(textAreaRef.current?.selectionEnd).toBe(8);
  });
});