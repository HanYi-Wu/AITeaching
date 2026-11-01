import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { BankSidebar } from "./BankSidebar";
import type { BankListItem } from "./bankModel";

vi.mock("../../api/client", () => ({
  apiPost: vi.fn(),
}));

describe("BankSidebar component", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  const sampleItems: BankListItem[] = [
    {
      id: "q1",
      qualified_id: "数学/default/q1",
      collection: "数学/default",
      subject: "数学",
      type: "single_choice",
      content_preview: "求极限",
      metadata: { chapter: "ch1" },
      storage_path: "resource/q1.yaml",
      storage_kind: "single",
    },
  ];

  const defaultProps = {
    folders: { folders: ["高等数学"], assignments: { "数学/default/q1": "高等数学" } },
    setFolders: vi.fn(),
    filteredItems: sampleItems,
    allItems: sampleItems,
    selectedExportIds: [],
    onSelectExportIds: vi.fn(),
    selectedId: null,
    onOpenItem: vi.fn(),
    onRefresh: vi.fn(),
    onError: vi.fn(),
    busy: false,
    graphLinkIndex: {
      "数学/default/q1": [{ id: "kp1", canonical_name: "极限概念", node_kind: "concept" }],
    },
    taggedItems: {},
    onOpenGraphNode: vi.fn(),
    onRequestDelete: vi.fn(),
  };

  it("renders sidebar with questions and handles open, select, and delete clicks", async () => {
    const onOpenItem = vi.fn();
    const onSelectExportIds = vi.fn();
    const onRequestDelete = vi.fn();
    const onOpenGraphNode = vi.fn();

    render(
      <TestI18nProvider>
        <BankSidebar
          {...defaultProps}
          onOpenItem={onOpenItem}
          onSelectExportIds={onSelectExportIds}
          onRequestDelete={onRequestDelete}
          onOpenGraphNode={onOpenGraphNode}
        />
      </TestI18nProvider>,
    );

    // Question button click
    const itemBtn = screen.getByRole("button", { name: /数学\/default\/q1/ });
    expect(itemBtn).not.toHaveAttribute("title");
    expect(screen.getByLabelText("数学/default/q1 题目详情")).toBeInTheDocument();
    await userEvent.click(itemBtn);
    expect(onOpenItem).toHaveBeenCalledWith("数学/default/q1");

    // Checkbox toggle
    const checkbox = screen.getByRole("checkbox", { name: "选择导出 数学/default/q1" });
    await userEvent.click(checkbox);
    expect(onSelectExportIds).toHaveBeenCalledWith(["数学/default/q1"]);

    // Knowledge point button click
    const kpBtn = screen.getByRole("button", { name: "极限概念" });
    await userEvent.click(kpBtn);
    expect(onOpenGraphNode).toHaveBeenCalledWith("kp1");

    // Delete button click
    const deleteBtn = screen.getByRole("button", { name: "删除" });
    await userEvent.click(deleteBtn);
    expect(onRequestDelete).toHaveBeenCalledWith(sampleItems[0]);
  });

  it("refreshes changed list, selection, and graph props through memo", () => {
    const { rerender } = render(
      <TestI18nProvider><BankSidebar {...defaultProps} /></TestI18nProvider>,
    );
    const secondItem: BankListItem = {
      ...sampleItems[0],
      id: "q2",
      qualified_id: "数学/default/q2",
      content_preview: "新题摘要",
      storage_path: "resource/q2.yaml",
    };
    rerender(
      <TestI18nProvider>
        <BankSidebar
          {...defaultProps}
          filteredItems={[...sampleItems, secondItem]}
          allItems={[...sampleItems, secondItem]}
          selectedExportIds={["数学/default/q1"]}
          selectedId="数学/default/q1"
          graphLinkIndex={{
            "数学/default/q1": [{ id: "kp2", canonical_name: "更新知识点", node_kind: "concept" }],
          }}
        />
      </TestI18nProvider>,
    );

    expect(screen.getByRole("checkbox", { name: "选择导出 数学/default/q1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新知识点" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择导出 数学/default/q1" }).closest("li")).toHaveClass("border-[var(--or-primary)]");
  });
});
