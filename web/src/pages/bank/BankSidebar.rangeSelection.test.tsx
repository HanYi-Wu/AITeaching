import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { BankListItem } from "./bankModel";
import { BankSidebar } from "./BankSidebar";

const makeItem = (id: string): BankListItem => ({
  id,
  qualified_id: `数学/default/${id}`,
  collection: "数学/default",
  subject: "数学",
  type: "single_choice",
  content_preview: `题目 ${id}`,
  metadata: {},
  storage_path: `resource/${id}.yaml`,
  storage_kind: "single",
});

describe("BankSidebar range selection", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  function StatefulBankSidebar({ items }: { items: BankListItem[] }) {
    const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
    return (
      <TestI18nProvider>
        <output data-testid="export-selection-count">{selectedExportIds.length}</output>
        <BankSidebar
          folders={{
            folders: ["文件夹"],
            assignments: Object.fromEntries(items.map((item) => [item.qualified_id, "文件夹"])),
          }}
          setFolders={vi.fn()}
          filteredItems={items}
          allItems={items}
          selectedExportIds={selectedExportIds}
          onSelectExportIds={setSelectedExportIds}
          selectedId={null}
          onOpenItem={vi.fn()}
          onRefresh={vi.fn()}
          onError={vi.fn()}
          busy={false}
          graphLinkIndex={{}}
          taggedItems={{}}
          onRequestDelete={vi.fn()}
        />
      </TestI18nProvider>
    );
  }

  it("keeps DOM checked state in sync after Shift+click and allows a normal toggle", async () => {
    const items = [makeItem("q1"), makeItem("q2"), makeItem("q3")];
    const user = userEvent.setup();
    render(<StatefulBankSidebar items={items} />);

    const q1 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q1" });
    const q2 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" });
    const q3 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q3" });
    await user.click(q1);
    await user.keyboard("{Shift>}");
    await user.click(q3);
    await user.keyboard("{/Shift}");

    expect(q1).toBeChecked();
    expect(q2).toBeChecked();
    expect(q3).toBeChecked();
    expect(screen.getByTestId("export-selection-count")).toHaveTextContent("3");

    await user.click(q3);
    expect(q1).toBeChecked();
    expect(q2).toBeChecked();
    expect(q3).not.toBeChecked();
    expect(screen.getByTestId("export-selection-count")).toHaveTextContent("2");
  });

  it("keeps Shift+Space range selection keyboard-only", async () => {
    const items = [makeItem("q1"), makeItem("q2"), makeItem("q3")];
    render(<StatefulBankSidebar items={items} />);

    const q1 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q1" });
    const q2 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q2" });
    const q3 = screen.getByRole("checkbox", { name: "选择导出 数学/default/q3" });
    await userEvent.click(q1);
    q3.focus();
    await userEvent.keyboard("{Shift>}{Space}{/Shift}");

    expect(q1).toBeChecked();
    expect(q2).toBeChecked();
    expect(q3).toBeChecked();
  });
});
