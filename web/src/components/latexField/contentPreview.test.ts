import { describe, expect, it, vi } from "vitest";
import {
  buildEditorDom,
  createDisplayMathWidget,
  createImageWidget,
  createMathWidget,
  createMermaidWidget,
  createTableWidget,
  escapeHtml,
  getSerializedCaretOffset,
  getSerializedSelectionOffsets,
  isCollapsedCaretAtEditorEnd,
  isWidget,
  renderMathHtml,
  renderTableCellHtml,
  serializeEditor,
  tableCellAlignClass,
} from "./contentPreview";

vi.mock("../../lib/katexRender", () => ({
  renderMathToHtmlSimple: (latex: string, displayMode?: boolean) =>
    `<span data-katex="${latex}" data-display="${displayMode}">katex</span>`,
}));

vi.mock("../../lib/mermaidInit", () => ({
  initMermaid: vi.fn(async () => ({
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
  })),
}));

vi.mock("../../api/client", () => ({
  resourceApiUrl: (path: string) => `http://mock.api/${path}`,
}));

describe("contentPreview", () => {
  it("escapes html characters properly", () => {
    expect(escapeHtml("<script>\"foo\" & 'bar'</script>")).toBe(
      "&lt;script&gt;&quot;foo&quot; &amp; 'bar'&lt;/script&gt;"
    );
  });

  it("renders math html and table cell html", () => {
    const inlineMath = renderMathHtml("x+1", false);
    expect(inlineMath).toContain("data-katex=\"x+1\"");
    expect(inlineMath).toContain("data-display=\"false\"");

    const dispMath = renderMathHtml("x^2", true);
    expect(dispMath).toContain("data-display=\"true\"");

    const cellHtml = renderTableCellHtml("Line 1\nLine 2 with $a$");
    expect(cellHtml).toContain("<br/>");
    expect(cellHtml).toContain("data-katex=\"a\"");
  });

  it("maps table cell alignment classes correctly", () => {
    expect(tableCellAlignClass({ text: "a", align: "center" })).toBe("text-center");
    expect(tableCellAlignClass({ text: "a", align: "right" })).toBe("text-right");
    expect(tableCellAlignClass({ text: "a", align: "left" })).toBe("text-left");
    expect(tableCellAlignClass({ text: "a" })).toBe("text-left");
  });

  it("builds and serializes DOM correctly across all widget types", () => {
    const root = document.createElement("div");
    const source =
      "Hello world\n$x+1$\n$$\\int f(x)$$\n```mermaid\ngraph TD\n  A --> B\n```\n:::EMBED_IMG:photos/pic.png:::\n```solaire-table\n| Col1 | Col2 |\n| 1 | 2 |\n```\nEnd";

    buildEditorDom(root, source);
    expect(root.childNodes.length).toBeGreaterThan(0);

    const serialized = serializeEditor(root);
    expect(serialized).toContain("Hello world");
    expect(serialized).toContain("$x+1$");
    expect(serialized).toContain("$$\\int f(x)$$");
    expect(serialized).toContain("```mermaid\ngraph TD\n  A --> B\n\n```");
    expect(serialized).toContain(":::EMBED_IMG:photos/pic.png:::");
    expect(serialized).toContain("```solaire-table\n| Col1 | Col2 |\n| 1 | 2 |\n\n```");
    expect(serialized).toContain("End");
  });

  it("creates individual widgets with correct metadata and classes", () => {
    const mathW = createMathWidget("x_1");
    expect(isWidget(mathW)).toBe(true);
    expect(mathW.dataset.latex).toBe("x_1");

    const dispW = createDisplayMathWidget("y_2");
    expect(isWidget(dispW)).toBe(true);
    expect(dispW.dataset.displayMath).toBe("true");

    const mmdW = createMermaidWidget("graph LR\n A --> B");
    expect(isWidget(mmdW)).toBe(true);
    expect(mmdW.dataset.mermaidSource).toBe("graph LR\n A --> B");

    const imgW = createImageWidget("EMBED_IMG", "assets/pic.png");
    expect(isWidget(imgW)).toBe(true);
    expect(imgW.dataset.imageKind).toBe("EMBED_IMG");
    expect(imgW.dataset.imagePath).toBe("assets/pic.png");

    const tableW = createTableWidget("| A |\n| 1 |");
    expect(isWidget(tableW)).toBe(true);
    expect(tableW.dataset.tableSource).toBe("| A |\n| 1 |");
  });

  it("handles image fallback on error", () => {
    const imgW = createImageWidget("EMBED_IMG", "nonexistent.png");
    const img = imgW.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    expect(img.style.display).toBe("none");
    expect(imgW.textContent).toContain("图片: nonexistent.png");
  });

  it("calculates serialized caret offset accurately around widgets", () => {
    const root = document.createElement("div");
    const text1 = document.createTextNode("prefix ");
    const widget = createMathWidget("x+y");
    const text2 = document.createTextNode(" suffix");
    root.appendChild(text1);
    root.appendChild(widget);
    root.appendChild(text2);

    const r1 = document.createRange();
    r1.setStart(text1, 3);
    r1.collapse(true);
    expect(getSerializedCaretOffset(root, r1)).toBe(3);

    const r2 = document.createRange();
    r2.setStart(text2, 2);
    r2.collapse(true);
    // prefix (7) + $x+y$ (5) + ' s' (2) = 14
    expect(getSerializedCaretOffset(root, r2)).toBe(14);
  });

  it("serializes content and maps both selection endpoints consistently", () => {
    const root = document.createElement("div");
    const prefix = document.createTextNode("left");
    const formula = createMathWidget("x+y");
    const lineBreak = document.createElement("br");
    const block = document.createElement("span");
    const tail = document.createTextNode("right");
    block.appendChild(tail);
    root.append(prefix, formula, lineBreak, block);

    const selection = document.createRange();
    selection.setStart(prefix, 2);
    selection.setEnd(tail, 3);

    expect(serializeEditor(root)).toBe("left$x+y$\nright");
    expect(getSerializedSelectionOffsets(root, selection)).toEqual({ start: 2, end: 13 });
  });

  it("retains widget, break, root-boundary, and generic-element caret mappings", () => {
    const root = document.createElement("div");
    const prefix = document.createTextNode("a");
    const formula = createMathWidget("x");
    const lineBreak = document.createElement("br");
    const nested = document.createElement("span");
    const tail = document.createTextNode("z");
    nested.appendChild(tail);
    root.append(prefix, formula, lineBreak, nested);

    const offsetAt = (container: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(container, offset);
      range.collapse(true);
      return getSerializedCaretOffset(root, range);
    };

    expect(offsetAt(root, 1)).toBe(1);
    expect(offsetAt(formula, 0)).toBe(1);
    expect(offsetAt(formula, 1)).toBe(4);
    expect(offsetAt(lineBreak, 0)).toBe(4);
    // Generic element endpoints retain the prior end-of-document fallback.
    expect(offsetAt(nested, 0)).toBe(6);
    expect(offsetAt(tail, 0)).toBe(5);
    expect(offsetAt(tail, 1)).toBe(6);
  });

  it("keeps the start-only caret lookup from walking to a distant selection end", () => {
    const root = document.createElement("div");
    const prefix = document.createTextNode("prefix");
    const distant = document.createElement("span");
    const tail = document.createTextNode("tail");
    distant.appendChild(tail);
    root.append(prefix, distant);
    const selection = document.createRange();
    selection.setStart(prefix, 2);
    selection.setEnd(tail, 2);
    Object.defineProperty(distant, "childNodes", {
      configurable: true,
      get() {
        throw new Error("start-only lookup traversed past its endpoint");
      },
    });

    expect(getSerializedCaretOffset(root, selection)).toBe(2);
  });

  it("recognizes only a collapsed caret at the serialized end across nested blocks, formulas, and trailing breaks", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    const prefix = document.createTextNode("题干");
    const formula = createMathWidget("x^2");
    const tail = document.createElement("span");
    const tailText = document.createTextNode("正文");
    tail.appendChild(tailText);
    block.append(prefix, formula, tail);
    root.appendChild(block);

    const atNestedEnd = document.createRange();
    atNestedEnd.setStart(tailText, tailText.length);
    atNestedEnd.collapse(true);
    expect(isCollapsedCaretAtEditorEnd(root, atNestedEnd)).toBe(true);
    expect(getSerializedCaretOffset(root, atNestedEnd)).toBe(serializeEditor(root).length);

    const trailingBreak = document.createElement("br");
    block.appendChild(trailingBreak);
    const beforeTrailingBreak = document.createRange();
    beforeTrailingBreak.setStart(tailText, tailText.length);
    beforeTrailingBreak.collapse(true);
    expect(isCollapsedCaretAtEditorEnd(root, beforeTrailingBreak)).toBe(false);
    expect(getSerializedCaretOffset(root, beforeTrailingBreak)).toBe(serializeEditor(root).length - 1);

    const afterTrailingBreak = document.createRange();
    afterTrailingBreak.setStart(block, block.childNodes.length);
    afterTrailingBreak.collapse(true);
    expect(serializeEditor(root).endsWith("\n")).toBe(true);
    expect(isCollapsedCaretAtEditorEnd(root, afterTrailingBreak)).toBe(true);
    expect(getSerializedCaretOffset(root, afterTrailingBreak)).toBe(serializeEditor(root).length);

    const formulaText = formula.querySelector("span")?.firstChild;
    expect(formulaText).not.toBeNull();
    const insideFormula = document.createRange();
    insideFormula.setStart(formulaText!, formulaText!.textContent?.length ?? 0);
    insideFormula.collapse(true);
    expect(isCollapsedCaretAtEditorEnd(root, insideFormula)).toBe(false);

    const nonCollapsed = document.createRange();
    nonCollapsed.setStart(tailText, 0);
    nonCollapsed.setEnd(tailText, 1);
    expect(isCollapsedCaretAtEditorEnd(root, nonCollapsed)).toBe(false);

    const emptyWidgetRoot = document.createElement("div");
    const emptyWidget = createMathWidget("");
    emptyWidget.replaceChildren();
    emptyWidgetRoot.appendChild(emptyWidget);
    const atEmptyWidget = document.createRange();
    atEmptyWidget.setStart(emptyWidget, 0);
    atEmptyWidget.collapse(true);
    expect(isCollapsedCaretAtEditorEnd(emptyWidgetRoot, atEmptyWidget)).toBe(false);
    expect(getSerializedCaretOffset(emptyWidgetRoot, atEmptyWidget)).toBe(0);

    const breakRoot = document.createElement("div");
    const finalBreak = document.createElement("br");
    breakRoot.appendChild(finalBreak);
    const atFinalBreak = document.createRange();
    atFinalBreak.setStart(finalBreak, 0);
    atFinalBreak.collapse(true);
    expect(isCollapsedCaretAtEditorEnd(breakRoot, atFinalBreak)).toBe(false);
    expect(getSerializedCaretOffset(breakRoot, atFinalBreak)).toBe(0);
  });
});
