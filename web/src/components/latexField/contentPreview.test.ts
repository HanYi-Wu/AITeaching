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
    expect(serialized).toContain(":::EMBED_IMG_IMG:photos/pic.png:::");
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
});
