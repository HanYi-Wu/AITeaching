import { fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourceBase: "project-a",
  renderMermaid: vi.fn(async (_id: string, source: string) => ({ svg: `<svg><text>${source}</text></svg>` })),
}));

vi.mock("../../../api/client", () => ({
  resourceApiUrl: (path: string) => `/${mocks.resourceBase}/${path}`,
}));
vi.mock("../../../lib/katexRender", () => ({
  renderMathToHtmlSimple: (latex: string) => `<span>${latex}</span>`,
}));
vi.mock("../../../lib/mermaidInit", () => ({
  initMermaid: async () => ({ render: mocks.renderMermaid }),
}));
vi.mock("../MathEditPopup", () => ({
  MathEditPopup: ({ open, onConfirm }: { open: boolean; onConfirm: (latex: string) => void }) =>
    open ? <button onClick={() => onConfirm("stale")}>Confirm math</button> : null,
}));

import { LatexRichTextField } from "../../LatexRichTextField";
import { buildEditorDom, serializeEditor } from "../contentPreview";
import { NodeNotesSection } from "../../../graph/node-panel/NodeNotesSection";

const table = "```solaire-table\nversion: 1\nrows:\n  - - text: Cell\n```";
const mermaid = "```mermaid\ngraph TD\nA-->B\n```";
const image = ":::EMBED_IMG:assets/shared.png:::";
const mixed = `start\n$x+1$\n$$y^2$$\n${table}\n${mermaid}\n${image}\nend`;

beforeEach(() => {
  mocks.resourceBase = "project-a";
  mocks.renderMermaid.mockClear();
});

describe("rebuilding a visual field", () => {
  it("matches a fresh build after changes to text, widgets, and unusual syntax", () => {
    const values = [
      "", "plain\ntext", mixed, `prefix ${mixed} suffix`,
      mixed.replace("$x+1$", "$z$").replace("assets/shared.png", "assets/new.png"),
      "unclosed $formula and \\$escaped\n```primebrush\n$x$\n```",
      "\\(a+b\\)\n\\[c+d\\]\n:::MERMAID_IMG:asset/path.png:::",
    ];
    const reused = document.createElement("div");
    for (const previous of values) {
      buildEditorDom(reused, previous, false);
      for (const next of values) {
        const fresh = document.createElement("div");
        buildEditorDom(reused, next);
        buildEditorDom(fresh, next, false);
        expect(serializeEditor(reused)).toBe(serializeEditor(fresh));
      }
    }
  });

  it("retains static previews but refreshes editable nodes, diagrams, and project resources", () => {
    const root = document.createElement("div");
    buildEditorDom(root, mixed);
    const math = root.querySelector(".lrt-math-widget");
    const diagram = root.querySelector(".lrt-mermaid-widget");
    const tableNode = root.querySelector(".lrt-table-widget");
    const oldImage = root.querySelector(".lrt-image-widget");
    const lastText = root.lastChild;
    const firstBreak = root.querySelector("br");
    expect(oldImage?.querySelector("img")?.getAttribute("src")).toContain("project-a");

    mocks.resourceBase = "project-b";
    buildEditorDom(root, `new ${mixed}`);
    expect(root.querySelector(".lrt-math-widget")).toBe(math);
    expect(root.querySelector(".lrt-mermaid-widget")).not.toBe(diagram);
    expect(root.querySelector(".lrt-table-widget")).toBe(tableNode);
    expect(root.querySelector(".lrt-image-widget")).not.toBe(oldImage);
    expect(root.querySelector(".lrt-image-widget img")?.getAttribute("src")).toContain("project-b");
    expect(root.lastChild).not.toBe(lastText);
    expect(root.querySelector("br")).not.toBe(firstBreak);
  });

  it("replaces pending diagrams so a late render cannot update the new preview", async () => {
    const pending: Array<{ source: string; resolve: (value: { svg: string }) => void }> = [];
    mocks.renderMermaid.mockImplementation((_id, source) => new Promise((resolve) => pending.push({ source, resolve })));
    const root = document.createElement("div");
    buildEditorDom(root, "```mermaid\nA-->B\n```");
    await waitFor(() => expect(pending).toHaveLength(1));
    const oldWidget = root.querySelector(".lrt-mermaid-widget")!;
    buildEditorDom(root, "new ```mermaid\nA-->B\n```");
    await waitFor(() => expect(pending).toHaveLength(2));
    const currentWidget = root.querySelector(".lrt-mermaid-widget")!;
    expect(currentWidget).not.toBe(oldWidget);
    pending[1].resolve({ svg: "<svg><text>new</text></svg>" });
    await waitFor(() => expect(currentWidget.textContent).toContain("new"));
    pending[0].resolve({ svg: "<svg><text>old</text></svg>" });
    await waitFor(() => expect(oldWidget.textContent).toContain("old"));
    expect(currentWidget.textContent).not.toContain("old");
    mocks.renderMermaid.mockReset();
    mocks.renderMermaid.mockImplementation(async (_id, source) => ({ svg: `<svg><text>${source}</text></svg>` }));
  });

  it("does not let an open popup modify a newly supplied value", () => {
    const onChange = vi.fn();
    const textAreaRef = createRef<HTMLTextAreaElement>();
    const view = render(<LatexRichTextField value="before $x$ old" onChange={onChange} textAreaRef={textAreaRef} />);
    const oldWidget = view.container.querySelector(".lrt-math-widget")!;
    fireEvent.click(oldWidget);
    view.rerender(<LatexRichTextField value="before $x$ new" onChange={onChange} textAreaRef={textAreaRef} />);
    expect(view.container.querySelector(".lrt-math-widget")).not.toBe(oldWidget);
    fireEvent.click(view.getByText("Confirm math"));
    expect(onChange).toHaveBeenLastCalledWith("before $x$ new");
  });

  it.each(["visual", "source"])("cancels a pending %s composition commit on unmount", (mode) => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 123;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onChange = vi.fn();
    const view = render(
      <LatexRichTextField value="old question" onChange={onChange} textAreaRef={createRef<HTMLTextAreaElement>()} />,
    );
    if (mode === "source") fireEvent.click(view.getByText("源码"));
    const editor = mode === "source"
      ? view.container.querySelector("textarea:not(.sr-only)")!
      : view.container.querySelector("[contenteditable='true']")!;
    fireEvent.compositionStart(editor);
    fireEvent.compositionEnd(editor);
    expect(callback).toBeDefined();
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(123);
    callback?.(0);
    expect(onChange).not.toHaveBeenCalled();
    request.mockRestore();
    cancel.mockRestore();
  });

  it("remounts a note editor when its node or note changes", () => {
    const props = {
      selectedNode: { id: "node-a", canonical_name: "A" },
      busy: false,
      notesList: [],
      noteComposerOpen: true,
      setNoteComposerOpen: vi.fn(),
      noteEditingId: "note-a",
      setNoteEditingId: vi.fn(),
      noteDraftBody: "first note",
      setNoteDraftBody: vi.fn(),
      noteTextAreaRef: createRef<HTMLTextAreaElement>(),
      persistNotes: vi.fn(async () => true),
    };
    const view = render(<NodeNotesSection {...props} />);
    const first = view.container.querySelector("[contenteditable='true']");
    fireEvent.compositionStart(first!);
    view.rerender(<NodeNotesSection {...props} selectedNode={{ id: "node-b", canonical_name: "B" }} noteDraftBody="second note" />);
    const second = view.container.querySelector("[contenteditable='true']");
    expect(second).not.toBe(first);
    expect(second?.textContent).toBe("second note");
    view.rerender(<NodeNotesSection {...props} selectedNode={{ id: "node-b", canonical_name: "B" }} noteEditingId="note-b" noteDraftBody="third note" />);
    expect(view.container.querySelector("[contenteditable='true']")).not.toBe(second);
    expect(view.container.querySelector("[contenteditable='true']")?.textContent).toBe("third note");
  });
});
