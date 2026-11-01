import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BankFileGrid } from "./BankFileGrid";

describe("BankFileGrid range keyboard selection", () => {
  it("selects the visible range with Shift+Space after a keyboard anchor", () => {
    const onSelectIds = vi.fn();
    render(
      <BankFileGrid
        folders={[]}
        questions={[
          { qualified_id: "q1", content_preview: "Question 1" },
          { qualified_id: "q2", content_preview: "Question 2" },
          { qualified_id: "q3", content_preview: "Question 3" },
        ]}
        selectedFolder=""
        focusedFolder=""
        dropHighlight={null}
        selectedIds={[]}
        busy={false}
        clipboard={null}
        onSelectIds={onSelectIds}
        onSetFocusedFolder={vi.fn()}
        onOpenFolder={vi.fn()}
        onContextMenu={vi.fn()}
        onStartDrag={vi.fn()}
        onDrop={vi.fn()}
        onCut={vi.fn()}
        onPaste={vi.fn()}
        onToggleAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("checkbox", { name: "q1 Question 1" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "q3 Question 3" }), { key: " ", shiftKey: true });

    expect(onSelectIds).toHaveBeenLastCalledWith(["q1", "q2", "q3"]);
  });
});
