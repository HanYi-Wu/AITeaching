import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef, useRef, useState } from "react";

import { LatexRichTextField } from "./LatexRichTextField";
import { createMathWidget, serializeEditor } from "./latexField/contentPreview";

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
  return { ...view, editor, onChange, textAreaRef };
}

function ControlledLintField() {
  const [value, setValue] = useState("题干");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  return <LatexRichTextField value={value} onChange={setValue} textAreaRef={textAreaRef} />;
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

  it("waits for typing to pause before linting the updated content", async () => {
    const { container, queryByRole, findByRole } = render(<ControlledLintField />);
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;

    editor.focus();
    editor.textContent = "题干%正文";
    fireEvent.input(editor, { inputType: "insertText", data: "%正文" });

    expect(queryByRole("alert")).not.toBeInTheDocument();
    expect(await findByRole("alert")).toHaveTextContent("未转义的 `%`");
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
  it("applies a new question value while the visual editor remains focused", () => {
    const onChange = vi.fn();
    const textAreaRef = createRef<HTMLTextAreaElement>();
    const { container, rerender, getByText } = render(
      <LatexRichTextField value="question one" onChange={onChange} textAreaRef={textAreaRef} />
    );
    const editor = container.querySelector("[contenteditable='true']") as HTMLDivElement;
    editor.focus();

    // The parent selects another question without blurring this field.
    rerender(
      <LatexRichTextField value="question two" onChange={onChange} textAreaRef={textAreaRef} />
    );

    expect(editor.textContent).toBe("question two");

    fireEvent.click(getByText("源码"));
    rerender(
      <LatexRichTextField value="question three" onChange={onChange} textAreaRef={textAreaRef} />
    );
    const source = container.querySelector("textarea:not(.sr-only)") as HTMLTextAreaElement;
    expect(source.value).toBe("question three");

    fireEvent.click(getByText("可视化"));
    expect(container.querySelector("[contenteditable='true']")?.textContent).toBe("question three");
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

  it("uses the serialized length at a collapsed nested editor end and falls back before a trailing break", () => {
    const { editor, textAreaRef } = renderField("初始值");
    const block = document.createElement("div");
    const prefix = document.createTextNode("题干");
    const formula = document.createElement("span");
    formula.className = "lrt-math-widget";
    formula.dataset.latex = "x^2";
    formula.contentEditable = "false";
    const tail = document.createTextNode("正文");
    block.append(prefix, formula, tail);
    editor.replaceChildren(block);

    const setSelectionRange = vi.spyOn(textAreaRef.current!, "setSelectionRange");
    const select = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    select(tail, tail.length);
    fireEvent.input(editor, { inputType: "insertText", data: "" });
    const serializedBeforeBreak = serializeEditor(editor);
    expect(setSelectionRange).toHaveBeenLastCalledWith(
      serializedBeforeBreak.length,
      serializedBeforeBreak.length,
    );

    block.appendChild(document.createElement("br"));
    select(tail, tail.length);
    fireEvent.input(editor, { inputType: "insertText", data: "" });
    const serializedWithBreak = serializeEditor(editor);
    expect(serializedWithBreak).toBe(`${serializedBeforeBreak}\n`);
    expect(setSelectionRange).toHaveBeenLastCalledWith(
      serializedWithBreak.length - 1,
      serializedWithBreak.length - 1,
    );
  });

  it("projects edited markup and both native selection endpoints together", () => {
    const { editor, onChange, textAreaRef } = renderField("0123456789012345");
    const block = document.createElement("div");
    const prefix = document.createTextNode("left");
    const formula = createMathWidget("x+y");
    const lineBreak = document.createElement("br");
    const tail = document.createTextNode("right");
    block.append(prefix, formula, lineBreak, tail);
    editor.replaceChildren(block);

    const range = document.createRange();
    range.setStart(prefix, 2);
    range.setEnd(tail, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.input(editor, { inputType: "insertText", data: "!" });

    expect(onChange).toHaveBeenLastCalledWith("left$x+y$\nright");
    expect(textAreaRef.current?.selectionStart).toBe(2);
    expect(textAreaRef.current?.selectionEnd).toBe(13);
  });

  it("keeps intermediate pinyin and commits Chinese text during source-mode IME composition", () => {
    const onChange = vi.fn();
    function ControlledSourceField() {
      const [val, setVal] = useState("初始");
      const textAreaRef = useRef<HTMLTextAreaElement>(null);
      return (
        <LatexRichTextField
          value={val}
          onChange={(next) => {
            setVal(next);
            onChange(next);
          }}
          textAreaRef={textAreaRef}
        />
      );
    }
    const { container, getByText } = render(<ControlledSourceField />);

    fireEvent.click(getByText("源码"));
    const sourceTa = container.querySelector("textarea:not(.sr-only)") as HTMLTextAreaElement;

    fireEvent.compositionStart(sourceTa);
    fireEvent.change(sourceTa, { target: { value: "初始ti" } });
    expect(sourceTa.value).toBe("初始ti");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(sourceTa, { target: { value: "初始题干" } });
    expect(sourceTa.value).toBe("初始题干");
    expect(onChange).toHaveBeenLastCalledWith("初始题干");
  });
});
