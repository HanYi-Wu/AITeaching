import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BankFileGrid } from "./BankFileGrid";

describe("BankFileGrid component", () => {
  const sampleQuestions = [
    { qualified_id: "q1", content_preview: "Question 1" },
    { qualified_id: "q2", content_preview: "Question 2" },
  ];

  const defaultProps = {
    folders: ["代数", "几何"],
    questions: sampleQuestions,
    selectedFolder: "数学",
    focusedFolder: "",
    dropHighlight: null,
    selectedIds: [],
    busy: false,
    clipboard: null,
    onSelectIds: vi.fn(),
    onSetFocusedFolder: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenItem: vi.fn(),
    onContextMenu: vi.fn(),
    onStartDrag: vi.fn(),
    onDrop: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onToggleAll: vi.fn(),
    onClearSelection: vi.fn(),
  };

  it("renders folder buttons and question cards", () => {
    render(<BankFileGrid {...defaultProps} />);

    expect(screen.getByRole("button", { name: "代数" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "几何" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "q1 Question 1" })).toBeInTheDocument();
  });

  it("handles double click on folder to open it", async () => {
    const onOpenFolder = vi.fn();
    render(<BankFileGrid {...defaultProps} onOpenFolder={onOpenFolder} />);

    const folderBtn = screen.getByRole("button", { name: "代数" });
    fireEvent.doubleClick(folderBtn);
    expect(onOpenFolder).toHaveBeenCalledWith("代数");
  });

  it("handles double click on question to open item", async () => {
    const onOpenItem = vi.fn();
    render(<BankFileGrid {...defaultProps} onOpenItem={onOpenItem} />);

    const questionCard = screen.getByRole("checkbox", { name: "q1 Question 1" });
    fireEvent.doubleClick(questionCard);
    expect(onOpenItem).toHaveBeenCalledWith("q1");
  });

  it("handles keyboard shortcuts (Ctrl+A, Ctrl+X, Ctrl+V, Escape)", () => {
    const onToggleAll = vi.fn();
    const onCut = vi.fn();
    const onPaste = vi.fn();
    const onClearSelection = vi.fn();

    render(
      <BankFileGrid
        {...defaultProps}
        onToggleAll={onToggleAll}
        onCut={onCut}
        onPaste={onPaste}
        onClearSelection={onClearSelection}
      />,
    );

    const area = screen.getByLabelText("题库文件区域");

    fireEvent.keyDown(area, { key: "a", ctrlKey: true });
    expect(onToggleAll).toHaveBeenCalledWith("数学");

    fireEvent.keyDown(area, { key: "x", ctrlKey: true });
    expect(onCut).toHaveBeenCalled();

    fireEvent.keyDown(area, { key: "v", ctrlKey: true });
    expect(onPaste).toHaveBeenCalled();

    fireEvent.keyDown(area, { key: "Escape" });
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("does not start marquee box selection on input or button elements", () => {
    const onSelectIds = vi.fn();
    render(
      <div>
        <input aria-label="搜索框" defaultValue="test" />
        <BankFileGrid {...defaultProps} onSelectIds={onSelectIds} />
      </div>,
    );

    const input = screen.getByLabelText("搜索框");
    fireEvent.pointerDown(input, { button: 0, clientX: 50, clientY: 50 });
    expect(screen.queryByTestId("marquee-rectangle")).not.toBeInTheDocument();

    const folderBtn = screen.getByRole("button", { name: "代数" });
    fireEvent.pointerDown(folderBtn, { button: 0, clientX: 100, clientY: 100 });
    expect(screen.queryByTestId("marquee-rectangle")).not.toBeInTheDocument();
  });

  it("toggles question selection with Enter or Space key", () => {
    const onSelectIds = vi.fn();
    render(<BankFileGrid {...defaultProps} onSelectIds={onSelectIds} />);

    const card = screen.getByRole("checkbox", { name: "q1 Question 1" });
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelectIds).toHaveBeenCalledWith(["q1"]);

    fireEvent.keyDown(card, { key: " " });
    expect(onSelectIds).toHaveBeenCalledWith(["q1"]);
  });
});
