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

  it("lets a school override a dictionary label without changing the inherited value", async () => {
    const actor = userEvent.setup();
    render(<ManagementSettingsPanel user={user} scope="school" />);

    expect(await screen.findByText("内置默认")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "覆盖" }));
    const valueInput = screen.getByDisplayValue("math");
    expect(valueInput).toHaveValue("math");
    expect(valueInput).toHaveAttribute("readonly");
    await actor.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await actor.type(screen.getByRole("textbox", { name: "显示名称" }), "数学（本校）");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.updateManagementDictionaryItem).toHaveBeenCalledWith("school", "builtin-math", { category: "subjects", label: "数学（本校）", sort_order: 10, status: "active" }));
    expect(await screen.findByRole("status")).toHaveTextContent("参数已更新");
  });

  it("lets administrators override a built-in label while keeping its value fixed", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    render(<ManagementSettingsPanel user={admin} scope="admin" />);

    expect(await screen.findByText("内置默认")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    const valueInput = screen.getByDisplayValue("math");
    expect(valueInput).toHaveAttribute("readonly");
    await actor.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await actor.type(screen.getByRole("textbox", { name: "显示名称" }), "数学（平台）");
    await actor.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.updateManagementDictionaryItem).toHaveBeenCalledWith("admin", "builtin-math", { category: "subjects", label: "数学（平台）", sort_order: 10, status: "active" }));
    expect(await screen.findByRole("status")).toHaveTextContent("参数已更新");
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
});
