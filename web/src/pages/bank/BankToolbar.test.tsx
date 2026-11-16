import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { BankToolbar } from "./BankToolbar";

function Consumer() {
  const { left, right } = useToolBar();
  return (
    <div>
      <div data-testid="left">{left}</div>
      <div data-testid="right">{right}</div>
    </div>
  );
}

describe("BankToolbar component", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  const defaultProps = {
    busy: false,
    selectedExportIds: [],
    onExport: vi.fn(),
    subjects: ["数学"],
    items: [],
    filterSubject: "__all__",
    setFilterSubject: vi.fn(),
    setFilterCollection: vi.fn(),
    filterType: "__all__",
    setFilterType: vi.fn(),
    filterCategory: "__all__",
    setFilterCategory: vi.fn(),
    metadataFilters: {},
    setMetadataFilters: vi.fn(),
    metadataFilterDefinitions: [],
    searchInput: "",
    setSearchInput: vi.fn(),
    commitSearch: vi.fn(),
    bankFilterSummary: "全部科目",
    importSubjectList: ["数学"],
    newSubject: "数学",
    setNewSubject: vi.fn(),
    newSubjectSelectValue: "数学",
    newCollection: "默认",
    newId: "q1",
    setNewId: vi.fn(),
    newType: "single_choice",
    setNewType: vi.fn(),
    newGroupUnified: "single_choice",
    setNewGroupUnified: vi.fn(),
    newGroupMaterial: "",
    setNewGroupMaterial: vi.fn(),
    onCreateQuestion: vi.fn().mockResolvedValue(true),
    importSubject: "数学",
    setImportSubject: vi.fn(),
    importSubjectSelectValue: "数学",
    importSummaryHint: "数学 → 默认",
    importYaml: "",
    setImportYaml: vi.fn(),
    onImportFile: vi.fn().mockResolvedValue(true),
    onImportYaml: vi.fn().mockResolvedValue(true),
    selectedId: null,
    hasDetail: false,
    dirty: false,
    onSave: vi.fn(),
  };

  it("registers left and right toolbar items into context", () => {
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar {...defaultProps} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    expect(screen.getByRole("button", { name: /筛选/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建题目/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出已选（0）" })).toBeDisabled();
  });

  it("enables export button when items are selected and triggers onExport", async () => {
    const onExport = vi.fn();
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar {...defaultProps} selectedExportIds={["q1", "q2"]} onExport={onExport} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    const btn = screen.getByRole("button", { name: "导出已选（2）" });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("shows save button when question is selected and dirty", async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar
            {...defaultProps}
            selectedId="q1"
            hasDetail={true}
            dirty={false}
            onSave={onSave}
          />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).toBeDisabled();

    rerender(
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar
            {...defaultProps}
            selectedId="q1"
            hasDetail={true}
            dirty={true}
            onSave={onSave}
          />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    expect(screen.getByText(/未保存/)).toBeInTheDocument();
    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("opens and closes filter menu dialog", async () => {
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar {...defaultProps} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    const filterBtn = screen.getByRole("button", { name: /筛选/ });
    await userEvent.click(filterBtn);
    expect(screen.getByRole("dialog", { name: /筛选/ })).toBeInTheDocument();

    // Clicking button again closes it
    await userEvent.click(filterBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /筛选/ })).not.toBeInTheDocument();
    });
  });

  it("keeps a local search draft through toolbar updates and filter reopen, then submits on Enter or blur", async () => {
    const setSearchInput = vi.fn();
    const commitSearch = vi.fn();
    const toolbar = (summary: string) => (
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar
            {...defaultProps}
            searchInput=""
            setSearchInput={setSearchInput}
            commitSearch={commitSearch}
            bankFilterSummary={summary}
          />
        </ToolBarProvider>
      </TestI18nProvider>
    );
    const { rerender } = render(toolbar("全部题目"));

    await userEvent.click(screen.getByRole("button", { name: /筛选/ }));
    let input = screen.getByPlaceholderText("题号、题干摘要或标签") as HTMLInputElement;
    await userEvent.type(input, "draft text");
    expect(input).toHaveValue("draft text");
    expect(setSearchInput).not.toHaveBeenCalled();
    expect(commitSearch).not.toHaveBeenCalled();

    // A fresh toolbar node can arrive from a parent render while the draft is uncommitted.
    rerender(toolbar("后台状态更新"));
    await waitFor(() => expect(screen.getByPlaceholderText("题号、题干摘要或标签")).toHaveValue("draft text"));

    // Closing and reopening the filter menu must retain the in-memory draft.
    fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /筛选/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
    input = screen.getByPlaceholderText("题号、题干摘要或标签") as HTMLInputElement;
    expect(input).toHaveValue("draft text");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(setSearchInput).not.toHaveBeenCalled();
    expect(commitSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(setSearchInput).toHaveBeenNthCalledWith(1, "draft text");
    expect(commitSearch).toHaveBeenNthCalledWith(1, "draft text");

    fireEvent.change(input, { target: { value: "blur text" } });
    fireEvent.blur(input);
    expect(setSearchInput).toHaveBeenNthCalledWith(2, "blur text");
    expect(commitSearch).toHaveBeenNthCalledWith(2, "blur text");

    fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /筛选/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
    expect(screen.getByPlaceholderText("题号、题干摘要或标签")).toHaveValue("blur text");
  });

  it("shows inline alert and disables create when new question id duplicates an existing item", async () => {
    const items = [
      {
        id: "第一题",
        qualified_id: "数学/默认/第一题",
        collection: "数学/默认",
        subject: "数学",
        type: "single_choice",
        content_preview: "",
        metadata: {},
        storage_path: "resource/数学/默认/第一题.yaml",
        storage_kind: "single",
      },
    ];
    const renderToolbar = (newId: string) => (
      <TestI18nProvider>
        <ToolBarProvider>
          <Consumer />
          <BankToolbar {...defaultProps} items={items} newSubject="数学" newCollection="默认" newId={newId} />
        </ToolBarProvider>
      </TestI18nProvider>
    );

    const { rerender } = render(renderToolbar(" 第一题 "));
    await userEvent.click(screen.getByRole("button", { name: /新建题目/ }));

    const idInput = screen.getByRole("textbox", { name: "题号" });
    expect(idInput.className).not.toContain("font-mono");
    expect(screen.getByRole("alert")).toHaveTextContent("题号“第一题”已存在");
    expect(screen.getByRole("button", { name: "创建空白草稿" })).toBeDisabled();

    rerender(renderToolbar("第二题"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建空白草稿" })).toBeEnabled();
  });
});
