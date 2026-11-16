import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagementSettingsPanel } from "./ManagementSettingsPanel";

const mocks = vi.hoisted(() => ({
  getManagementSettings: vi.fn(), listManagementDictionary: vi.fn(), updateManagementSettings: vi.fn(),
  createManagementDictionaryItem: vi.fn(), updateManagementDictionaryItem: vi.fn(),
}));
vi.mock("../../../platform/managementApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/managementApi")>()),
  getManagementSettings: mocks.getManagementSettings,
  listManagementDictionary: mocks.listManagementDictionary,
  updateManagementSettings: mocks.updateManagementSettings,
  createManagementDictionaryItem: mocks.createManagementDictionaryItem,
  updateManagementDictionaryItem: mocks.updateManagementDictionaryItem,
}));
vi.mock("../../../platform/useManagementOptions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/useManagementOptions")>()),
  notifyManagementOptionsChanged: vi.fn(),
}));

const user = { id: "school", role: "school" as const, school_id: "s1", username: "school_a", display_name: "学校管理员", status: "active" };
const settings = {
  settings: { default_page_size: 20, activity_default_days: 30 },
  overrides: { default_page_size: null, activity_default_days: null },
  inherited_settings: { default_page_size: 10, activity_default_days: 30 },
  sources: { default_page_size: "platform" as const, activity_default_days: "platform" as const },
};
const dictionary = {
  category: "subjects" as const,
  items: [{ id: "builtin-math", category: "subjects" as const, value: "math", label: "数学", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const }],
  effective_items: [{ id: "builtin-math", category: "subjects" as const, value: "math", label: "数学", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const }],
};

describe("ManagementSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getManagementSettings.mockResolvedValue(settings);
    mocks.listManagementDictionary.mockResolvedValue(dictionary);
    mocks.updateManagementSettings.mockResolvedValue({ ...settings, overrides: { default_page_size: 50, activity_default_days: null }, settings: { default_page_size: 50, activity_default_days: 30 }, sources: { ...settings.sources, default_page_size: "school" } });
    mocks.updateManagementDictionaryItem.mockResolvedValue({ item: { ...dictionary.items[0], label: "数学（本校）", source: "school" } });
    mocks.createManagementDictionaryItem.mockResolvedValue({ item: dictionary.items[0] });
  });

  it("explains subject renaming in plain language and omits technical fields", async () => {
    const actor = userEvent.setup();
    render(<ManagementSettingsPanel user={user} scope="school" />);

    expect(await screen.findByText("数学")).toBeInTheDocument();
    expect(screen.getByText(/可在此修改学科名称、添加新学科或停用不需要的学科/)).toBeInTheDocument();
    expect(screen.queryByText("参数值")).not.toBeInTheDocument();
    expect(screen.queryByText("排序")).not.toBeInTheDocument();
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(screen.getByText("当前启用 1 个学科")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "修改名称" }));
    expect(screen.queryByLabelText("参数值")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("排序值")).not.toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: "学科名称" });
    await actor.clear(nameInput);
    await actor.type(nameInput, "数学（本校）");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.updateManagementDictionaryItem).toHaveBeenCalledWith("school", "builtin-math", { category: "subjects", label: "数学（本校）", sort_order: 10, status: "active" }));
    expect(await screen.findByRole("status")).toHaveTextContent("学科名称已更新");
  });

  it("lets users add a new subject with just its name and toggle status inline", async () => {
    const actor = userEvent.setup();
    render(<ManagementSettingsPanel user={user} scope="school" />);

    expect(await screen.findByText("数学")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "添加学科" }));
    await actor.type(screen.getByRole("textbox", { name: "学科名称" }), "劳动教育");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.createManagementDictionaryItem).toHaveBeenCalledWith("school", { category: "subjects", value: "劳动教育", label: "劳动教育", sort_order: 20, status: "active" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已添加学科“劳动教育”");

    await actor.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(mocks.updateManagementDictionaryItem).toHaveBeenCalledWith("school", "builtin-math", { category: "subjects", label: "数学", sort_order: 10, status: "disabled" }));
  });

  it("lets administrators rename a built-in subject while switching between subjects and grades", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    render(<ManagementSettingsPanel user={admin} scope="admin" />);

    expect(await screen.findByText("数学")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "修改名称" }));
    await actor.clear(screen.getByRole("textbox", { name: "学科名称" }));
    await actor.type(screen.getByRole("textbox", { name: "学科名称" }), "数学（平台）");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.updateManagementDictionaryItem).toHaveBeenCalledWith("admin", "builtin-math", { category: "subjects", label: "数学（平台）", sort_order: 10, status: "active" }));
    expect(await screen.findByRole("status")).toHaveTextContent("学科名称已更新");

    await actor.click(screen.getByRole("tab", { name: "年级名称" }));
    await waitFor(() => expect(mocks.listManagementDictionary).toHaveBeenCalledWith("admin", "grades"));
  });

  it("saves inherited settings and exposes current source", async () => {
    const actor = userEvent.setup();
    const legacySettings = { settings: settings.settings, overrides: settings.overrides, sources: settings.sources };
    mocks.getManagementSettings.mockResolvedValue(legacySettings);
    render(<ManagementSettingsPanel user={user} scope="school" />);

    await screen.findByRole("combobox", { name: "列表默认每页数量" });
    expect(screen.getByRole("option", { name: /沿用上级默认.*20 条/ })).toBeInTheDocument();
    expect(await screen.findAllByText("当前来源：平台默认")).toHaveLength(2);
    await actor.selectOptions(screen.getByRole("combobox", { name: "列表默认每页数量" }), "50");
    await actor.click(screen.getByRole("button", { name: "保存参数" }));

    await waitFor(() => expect(mocks.updateManagementSettings).toHaveBeenCalledWith("school", { default_page_size: 50, activity_default_days: null }));
  });

  it("labels school inheritance with the platform value even when this school overrides it", async () => {
    const actor = userEvent.setup();
    mocks.getManagementSettings.mockResolvedValue({
      ...settings,
      settings: { default_page_size: 50, activity_default_days: 90 },
      overrides: { default_page_size: 50, activity_default_days: 90 },
      inherited_settings: { default_page_size: 20, activity_default_days: 30 },
      sources: { default_page_size: "school" as const, activity_default_days: "school" as const },
    });
    render(<ManagementSettingsPanel user={user} scope="school" />);

    const pageSize = await screen.findByRole("combobox", { name: "列表默认每页数量" });
    const activityDays = screen.getByRole("combobox", { name: "管理活动默认时间范围" });
    expect(screen.getByRole("option", { name: /沿用上级默认.*20 条/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /沿用上级默认.*30 天/ })).toBeInTheDocument();
    expect(pageSize).toHaveValue("50");
    expect(activityDays).toHaveValue("90");

    await actor.selectOptions(pageSize, "inherit");
    await actor.click(screen.getByRole("button", { name: "保存参数" }));
    await waitFor(() => expect(mocks.updateManagementSettings).toHaveBeenCalledWith("school", { default_page_size: null, activity_default_days: 90 }));
  });

  it("resets administrator overrides to the built-in defaults by saving null", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    mocks.getManagementSettings.mockResolvedValue({
      settings: { default_page_size: 50, activity_default_days: 90 },
      overrides: { default_page_size: 50, activity_default_days: 90 },
      sources: { default_page_size: "platform" as const, activity_default_days: "platform" as const },
    });
    render(<ManagementSettingsPanel user={admin} scope="admin" />);

    const pageSize = await screen.findByRole("combobox", { name: "列表默认每页数量" });
    const activityDays = screen.getByRole("combobox", { name: "管理活动默认时间范围" });
    expect(screen.getByRole("option", { name: /沿用系统默认.*10 条/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /沿用系统默认.*30 天/ })).toBeInTheDocument();
    await actor.selectOptions(pageSize, "inherit");
    await actor.selectOptions(activityDays, "inherit");
    await actor.click(screen.getByRole("button", { name: "保存参数" }));

    await waitFor(() => expect(mocks.updateManagementSettings).toHaveBeenCalledWith("admin", { default_page_size: null, activity_default_days: null }));
  });

  it("prefetches grades and keeps cached rows visible without flashing zero-count loading state on tab switch", async () => {
    const actor = userEvent.setup();
    const gradesDict = {
      ...dictionary,
      category: "grades" as const,
      items: [{ id: "builtin-g1", category: "grades" as const, value: "一年级", label: "高一", sort_order: 10, status: "active" as const, source: "builtin" as const }],
      effective_items: [{ id: "builtin-g1", category: "grades" as const, value: "一年级", label: "高一", sort_order: 10, status: "active" as const, source: "builtin" as const }],
    };
    mocks.listManagementDictionary.mockImplementation(async (_scope: string, cat: string) =>
      cat === "grades" ? gradesDict : dictionary
    );

    render(<ManagementSettingsPanel user={user} scope="school" />);

    expect(await screen.findByText("数学")).toBeInTheDocument();
    await waitFor(() => expect(mocks.listManagementDictionary).toHaveBeenCalledWith("school", "grades"));

    const tablist = screen.getByRole("tablist", { name: "名称管理分类" });
    expect(tablist).toHaveClass("management-section-nav");
    const gradeTab = screen.getByRole("tab", { name: "年级名称" });
    expect(gradeTab).toHaveClass("!transition-none");

    let resolveSlowRefresh!: (v: typeof gradesDict) => void;
    mocks.listManagementDictionary.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSlowRefresh = resolve; })
    );

    await actor.click(gradeTab);
    expect(screen.getByText("高一")).toBeInTheDocument();
    expect(screen.queryByText("正在加载…")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前启用 0 个年级/)).not.toBeInTheDocument();
    expect(screen.getByText("当前启用 1 个年级")).toBeInTheDocument();

    resolveSlowRefresh(gradesDict);
    await waitFor(() => expect(screen.getByText("当前启用 1 个年级")).toBeInTheDocument());
  });

  it("reuses in-flight prefetch on rapid tab switch and blocks renaming to an existing label", async () => {
    const actor = userEvent.setup();
    const subjectsDict = {
      category: "subjects" as const,
      items: [
        { id: "builtin-math", category: "subjects" as const, value: "math", label: "数学", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const },
        { id: "builtin-phys", category: "subjects" as const, value: "physics", label: "物理", sort_order: 20, status: "active" as const, school_id: null, source: "builtin" as const },
      ],
      effective_items: [
        { id: "builtin-math", category: "subjects" as const, value: "math", label: "数学", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const },
        { id: "builtin-phys", category: "subjects" as const, value: "physics", label: "物理", sort_order: 20, status: "active" as const, school_id: null, source: "builtin" as const },
      ],
    };
    const gradesDict = {
      category: "grades" as const,
      items: [{ id: "builtin-g1", category: "grades" as const, value: "一年级", label: "高一", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const }],
      effective_items: [{ id: "builtin-g1", category: "grades" as const, value: "一年级", label: "高一", sort_order: 10, status: "active" as const, school_id: null, source: "builtin" as const }],
    };

    let resolveGrades!: (v: typeof gradesDict) => void;
    let gradesCallCount = 0;
    mocks.listManagementDictionary.mockImplementation((_scope: string, cat: string) => {
      if (cat === "subjects") return Promise.resolve(subjectsDict);
      gradesCallCount += 1;
      return new Promise<typeof gradesDict>((resolve) => {
        resolveGrades = resolve;
      });
    });

    render(<ManagementSettingsPanel user={user} scope="school" />);
    expect(await screen.findByText("数学")).toBeInTheDocument();

    // Switch to grades while initial prefetch is still pending
    await actor.click(screen.getByRole("tab", { name: "年级名称" }));
    expect(gradesCallCount).toBe(1);

    resolveGrades(gradesDict);
    expect(await screen.findByText("高一")).toBeInTheDocument();

    // Renaming 数学 to 物理 should fail inline duplicate check without API PUT
    await actor.click(screen.getByRole("tab", { name: "学科名称" }));
    const editButtons = await screen.findAllByRole("button", { name: "修改名称" });
    await actor.click(editButtons[0]);
    const input = screen.getByRole("textbox", { name: "学科名称" });
    await actor.clear(input);
    await actor.type(input, "物理");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("“物理”已存在，请使用其他名称。");
    expect(mocks.updateManagementDictionaryItem).not.toHaveBeenCalled();
  });
});
