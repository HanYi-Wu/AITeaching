import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "../../lib/confirmDialog";
import { AnalysisFoldersPanel, ANALYSIS_ITEMS_MIME } from "./AnalysisFoldersPanel";

vi.mock("../../lib/confirmDialog", () => ({ confirmDialog: vi.fn() }));

describe("AnalysisFoldersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmDialog).mockResolvedValue(true);
  });

  it("creates, renames, and deletes folders without deleting their analysis items", async () => {
    const onCreateFolder = vi.fn(async () => true);
    const onRenameFolder = vi.fn(async () => true);
    const onDeleteFolder = vi.fn(async () => true);
    const onFilterChange = vi.fn();
    const panel = (filter: "all" | "unassigned" | string, folders = [{ id: "folder-a", name: "旧名称" }]) => (
      <AnalysisFoldersPanel
        folders={folders}
        assignments={{ "paper:p1": "folder-a" }}
        visibleItemIds={["paper:p1", "exam:e1"]}
        filter={filter}
        onFilterChange={onFilterChange}
        selectedItemIds={[]}
        busy={false}
        loading={false}
        error={null}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        onAssignItems={vi.fn(async () => undefined)}
      />
    );
    const view = render(panel("folder-a"));

    fireEvent.change(screen.getByLabelText("新建分析文件夹名称"), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "新建分析文件夹" }));
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith("新名称"));

    fireEvent.click(screen.getByRole("button", { name: "重命名 旧名称" }));
    fireEvent.change(screen.getByLabelText("重命名分析文件夹 旧名称"), { target: { value: "复习" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith("folder-a", "复习"));

    fireEvent.click(screen.getByRole("button", { name: "删除 旧名称" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(onDeleteFolder).toHaveBeenCalledWith("folder-a");
    expect(onFilterChange).toHaveBeenCalledWith("all");
    view.unmount();
  });

  it("accepts only analysis drag payloads and assigns dropped items to a folder", async () => {
    const onAssignItems = vi.fn(async () => undefined);
    render(
      <AnalysisFoldersPanel
        folders={[{ id: "folder-a", name: "复习" }]}
        assignments={{}}
        visibleItemIds={["paper:p1", "exam:e1"]}
        filter="all"
        onFilterChange={() => undefined}
        selectedItemIds={[]}
        busy={false}
        loading={false}
        error={null}
        onCreateFolder={async () => true}
        onRenameFolder={async () => true}
        onDeleteFolder={async () => true}
        onAssignItems={onAssignItems}
      />,
    );
    const dropTarget = screen.getByTestId("analysis-folder-folder-a");
    const analysisTransfer = {
      types: [ANALYSIS_ITEMS_MIME],
      getData: vi.fn(() => JSON.stringify({ scope: "analysis", ids: ["paper:p1", "exam:e1"] })),
      dropEffect: "none",
    };
    fireEvent.dragOver(dropTarget, { dataTransfer: analysisTransfer });
    fireEvent.drop(dropTarget, { dataTransfer: analysisTransfer });
    expect(onAssignItems).toHaveBeenCalledWith(["paper:p1", "exam:e1"], "folder-a");

    const otherScopeTransfer = {
      types: [ANALYSIS_ITEMS_MIME],
      getData: vi.fn(() => JSON.stringify({ scope: "compose", ids: ["paper:p1"] })),
      dropEffect: "none",
    };
    fireEvent.drop(dropTarget, { dataTransfer: otherScopeTransfer });
    expect(onAssignItems).toHaveBeenCalledTimes(1);
  });

  it("moves a dropped selection back to the unassigned view", () => {
    const onAssignItems = vi.fn(async () => undefined);
    render(
      <AnalysisFoldersPanel
        folders={[]}
        assignments={{}}
        visibleItemIds={["paper:p1"]}
        filter="unassigned"
        onFilterChange={() => undefined}
        selectedItemIds={[]}
        busy={false}
        loading={false}
        error={null}
        onCreateFolder={async () => true}
        onRenameFolder={async () => true}
        onDeleteFolder={async () => true}
        onAssignItems={onAssignItems}
      />,
    );
    const target = screen.getByTestId("analysis-folder-unassigned");
    const dataTransfer = {
      types: [ANALYSIS_ITEMS_MIME],
      getData: () => JSON.stringify({ scope: "analysis", ids: ["paper:p1"] }),
      dropEffect: "none",
    };
    fireEvent.drop(target, { dataTransfer });
    expect(onAssignItems).toHaveBeenCalledWith(["paper:p1"], null);
  });
});
