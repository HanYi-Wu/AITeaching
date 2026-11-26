import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminWorkspace } from "./AdminWorkspace";

const mocks = vi.hoisted(() => ({
  listSchools: vi.fn(),
  listSchoolUsers: vi.fn(),
  createSchool: vi.fn(),
  createSchoolUser: vi.fn(),
  updateSchoolUser: vi.fn(),
  resetSchoolUserPassword: vi.fn(),
  apiAgentLlmSettingsGet: vi.fn(),
  apiAgentSafetyModeGet: vi.fn(),
  managementOptions: null as { settings: { default_page_size: number; activity_default_days: number }; subjects: never[]; grades: never[] } | null,
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    listSchools: mocks.listSchools,
    listSchoolUsers: mocks.listSchoolUsers,
    createSchool: mocks.createSchool,
    createSchoolUser: mocks.createSchoolUser,
    updateSchoolUser: mocks.updateSchoolUser,
    resetSchoolUserPassword: mocks.resetSchoolUserPassword,
  };
});

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    apiAgentLlmSettingsGet: mocks.apiAgentLlmSettingsGet,
    apiAgentSafetyModeGet: mocks.apiAgentSafetyModeGet,
  };
});

vi.mock("../../../components/settings/AgentModelSettingsForm", () => ({
  AgentModelSettingsForm: () => <div data-testid="admin-model-settings-form" />,
}));

vi.mock("../../../components/ExtensionsPanel", () => ({
  ExtensionsPanel: () => <div data-testid="admin-extensions-panel" />,
}));

vi.mock("../../../platform/useManagementOptions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/useManagementOptions")>()),
  useManagementOptions: () => mocks.managementOptions,
}));
vi.mock("../management/AuditPanel", () => ({ AuditPanel: () => <div data-testid="admin-audit-panel" /> }));
vi.mock("../management/AccessPanel", () => ({ AccessPanel: () => <div data-testid="admin-access-panel" /> }));
vi.mock("../management/ManagementSettingsPanel", () => ({ ManagementSettingsPanel: () => <div data-testid="admin-settings-panel" /> }));
vi.mock("../management/ActivityPanel", () => ({ ActivityPanel: () => <div data-testid="admin-activity-panel" /> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function schoolList(name: string, id: string, page: number, totalPages = 2) {
  return {
    schools: [{ id, name, status: "active", ai_enabled: 0 }],
    total: 20,
    page,
    page_size: 10,
    total_pages: totalPages,
  };
}

function accountList(name: string, id: string, schoolId: string, page = 1, totalPages = 1) {
  return {
    users: [{ id, school_id: schoolId, role: "school", username: name, display_name: name, email: null, status: "active" }],
    total: 1,
    page,
    page_size: 10,
    total_pages: totalPages,
  };
}

const adminUser = (id: string) => ({
  id,
  role: "admin" as const,
  username: id,
  display_name: id,
  status: "active" as const,
});

describe("AdminWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.managementOptions = null;
    mocks.listSchools.mockReset().mockResolvedValue({ schools: [] });
    mocks.listSchoolUsers.mockReset().mockResolvedValue({ users: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.createSchool.mockReset();
    mocks.createSchoolUser.mockReset();
    mocks.updateSchoolUser.mockReset();
    mocks.resetSchoolUserPassword.mockReset();
    mocks.apiAgentLlmSettingsGet.mockResolvedValue({
      persist_available: true,
      persist_scope: "project",
      provider: "openai",
      provider_options: [{ id: "openai" }],
      main_model: "gpt-4.1",
      fast_model: "gpt-4.1-mini",
      base_url: "",
      llm_configured: true,
      api_key_masked: "********abcd",
      has_project_api_key_override: true,
      reasoning_effort: "high",
    });
    mocks.apiAgentSafetyModeGet.mockResolvedValue({
      persist_available: true,
      persist_scope: "project",
      mode: "allegro",
      options: [],
    });
  });

  it("shows admin-only AI model configuration and extension management", async () => {
    const user = userEvent.setup();
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "学校管理" });
    expect(screen.queryByTestId("admin-model-settings-form")).not.toBeInTheDocument();
    expect(mocks.apiAgentLlmSettingsGet).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "平台 AI" }));
    expect(await screen.findByTestId("admin-model-settings-form")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "系统维护" }));
    expect(screen.getByRole("heading", { name: "版本更新" })).toBeInTheDocument();
    expect(await screen.findByTestId("admin-extensions-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "教师端" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.apiAgentLlmSettingsGet).toHaveBeenCalled());
  });

  it("integrates the management audit, access, settings, and activity tabs", async () => {
    const actor = userEvent.setup();
    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);
    await screen.findByRole("heading", { name: "学校管理" });

    for (const [label, testId] of [
      ["操作日志", "admin-audit-panel"],
      ["权限管理", "admin-access-panel"],
      ["学科与设置", "admin-settings-panel"],
      ["管理活动", "admin-activity-panel"],
    ] as const) {
      await actor.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it("applies the management default page size before the administrator changes the lists", async () => {
    mocks.managementOptions = { settings: { default_page_size: 20, activity_default_days: 7 }, subjects: [], grades: [] };
    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "每页学校数" })).toHaveTextContent("20 条");
    expect(screen.getByRole("combobox", { name: "每页账号数" })).toHaveTextContent("20 条");
  });

  it("uses full-width section navigation instead of a fixed right sidebar", async () => {
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const navigation = await screen.findByRole("tablist", { name: "管理员工作区" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "学校与账号" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("admin-workspace-content")).not.toHaveClass("xl:grid-cols-[minmax(0,1fr)_440px]");
  });

  it("guides a first-time administrator to create a school and its account", async () => {
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建第一所学校" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建学校端账号" })).toBeInTheDocument();
  });

  it("keeps checklist progress when school filters and selection change", async () => {
    const user = userEvent.setup();
    const schools = {
      schools: [
        { id: "school-with-account", name: "已有账号学校", status: "active", ai_enabled: 0, school_user_count: 2 },
        { id: "school-without-account", name: "暂无账号学校", status: "active", ai_enabled: 0, school_user_count: 0 },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    };
    mocks.listSchools.mockImplementation((query) => Promise.resolve(
      query?.q ? { schools: [], total: 0, page: 1, page_size: 10, total_pages: 1 } : schools,
    ));
    mocks.listSchoolUsers.mockResolvedValue({ users: [], total: 0, page: 1, page_size: 10, total_pages: 1 });

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findByText("2/2 已完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "暂无账号学校" }));
    expect(screen.getByText("2/2 已完成")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "搜索学校" }), "不存在的学校");
    expect(await screen.findByText("没有符合条件的学校。")).toBeInTheDocument();
    expect(screen.getByText("2/2 已完成")).toBeInTheDocument();
  });

  it("localizes school status badges", async () => {
    mocks.listSchools.mockResolvedValue({
      schools: [{ id: "school1", name: "演示学校", status: "active", ai_enabled: 0 }],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByText("启用")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    for (const label of ["学校状态筛选", "每页学校数", "学校端账号状态筛选", "每页账号数"]) {
      expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    }
  });

  it("keeps the latest school page when requests and failures return out of order", async () => {
    const user = userEvent.setup();
    const stalePage = deferred<ReturnType<typeof schoolList>>();
    const latestPage = deferred<ReturnType<typeof schoolList>>();
    const staleFailure = deferred<ReturnType<typeof schoolList>>();
    const winningRefresh = deferred<ReturnType<typeof schoolList>>();
    const onError = vi.fn();
    mocks.listSchools
      .mockResolvedValueOnce(schoolList("第一页学校", "school-1", 1))
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(latestPage.promise)
      .mockReturnValueOnce(staleFailure.promise)
      .mockReturnValueOnce(winningRefresh.promise);

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={onError} />);
    expect(await screen.findAllByText("第一页学校")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "学校列表下一页" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(3));

    await act(async () => latestPage.resolve(schoolList("最新第二页", "school-fresh", 2)));
    expect(await screen.findByRole("button", { name: /最新第二页/ })).toBeInTheDocument();
    await act(async () => stalePage.resolve(schoolList("过期第二页", "school-stale", 2)));
    expect(screen.getByRole("button", { name: /最新第二页/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /过期第二页/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(4));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(5));
    await act(async () => winningRefresh.resolve(schoolList("刷新后的学校", "school-newest", 2)));
    expect(await screen.findByRole("button", { name: /刷新后的学校/ })).toBeInTheDocument();
    await act(async () => {
      staleFailure.reject(new Error("过期请求失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /刷新后的学校/ })).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalledWith("过期请求失败");
    expect(screen.getByText("第 2/2 页，共 20 所")).toBeInTheDocument();
  });

  it("ignores a school-list response from the previous admin account", async () => {
    const staleAccount = deferred<ReturnType<typeof schoolList>>();
    const currentAccount = deferred<ReturnType<typeof schoolList>>();
    const onError = vi.fn();
    mocks.listSchools.mockReturnValueOnce(staleAccount.promise).mockReturnValueOnce(currentAccount.promise);
    const view = render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={onError} />);

    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(1));
    view.rerender(<AdminWorkspace user={adminUser("admin2")} onLogout={vi.fn()} onError={onError} />);
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(2));
    await act(async () => currentAccount.resolve(schoolList("当前账号学校", "school-current", 1)));
    expect(await screen.findAllByText("当前账号学校")).not.toHaveLength(0);
    await act(async () => staleAccount.resolve(schoolList("旧账号学校", "school-old", 1)));

    expect(screen.getAllByText("当前账号学校")).not.toHaveLength(0);
    expect(screen.queryByText("旧账号学校")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("keeps school-account results scoped to the newly selected school", async () => {
    const user = userEvent.setup();
    const previousSchoolAccounts = deferred<ReturnType<typeof accountList>>();
    const selectedSchoolAccounts = deferred<ReturnType<typeof accountList>>();
    mocks.listSchools.mockResolvedValue({
      schools: [
        { id: "school-a", name: "学校一", status: "active", ai_enabled: 0 },
        { id: "school-b", name: "学校二", status: "active", ai_enabled: 0 },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    mocks.listSchoolUsers.mockReturnValueOnce(previousSchoolAccounts.promise).mockReturnValueOnce(selectedSchoolAccounts.promise);

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(mocks.listSchoolUsers).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "学校二" }));
    await waitFor(() => expect(mocks.listSchoolUsers).toHaveBeenCalledTimes(2));

    await act(async () => selectedSchoolAccounts.resolve(accountList("当前学校账号", "account-b", "school-b")));
    expect(await screen.findAllByText("当前学校账号")).toHaveLength(2);
    await act(async () => previousSchoolAccounts.resolve(accountList("过期学校账号", "account-a", "school-a")));

    expect(screen.getAllByText("当前学校账号")).toHaveLength(2);
    expect(screen.queryByText("过期学校账号")).not.toBeInTheDocument();
  });

  it("does not let a school-account operation overwrite the new school's open dialog", async () => {
    const user = userEvent.setup();
    const createAccount = deferred<void>();
    mocks.listSchools.mockResolvedValue({
      schools: [
        { id: "school-a", name: "学校一", status: "active", ai_enabled: 0 },
        { id: "school-b", name: "学校二", status: "active", ai_enabled: 0 },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    mocks.createSchoolUser.mockReturnValueOnce(createAccount.promise);

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "创建账号" })).toBeEnabled());
    await user.click(await screen.findByRole("button", { name: "创建账号" }));
    let dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("用户名"), "school_admin");
    await user.type(within(dialog).getByLabelText("显示名称"), "学校管理员");
    await user.type(within(dialog).getByLabelText("初始密码"), "password123");
    await user.click(within(dialog).getByRole("button", { name: "创建账号" }));
    await waitFor(() => expect(mocks.createSchoolUser).toHaveBeenCalledTimes(1));

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "学校二" }));
    await waitFor(() => expect(mocks.listSchoolUsers).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("学校：学校二")).toBeInTheDocument();

    await act(async () => createAccount.resolve());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("学校：学校二")).toBeInTheDocument();
    expect(screen.queryByText("学校端账号已创建")).not.toBeInTheDocument();
    expect(mocks.listSchoolUsers).toHaveBeenCalledTimes(2);
    expect(mocks.createSchoolUser).toHaveBeenCalledWith("school-a", {
      username: "school_admin",
      password: "password123",
      display_name: "学校管理员",
      email: "",
    });
  });

  it("shows a password mismatch inside the reset dialog", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    mocks.listSchools.mockResolvedValue(schoolList("学校一", "school-1", 1, 1));
    mocks.listSchoolUsers.mockResolvedValue(accountList("school-admin", "account-1", "school-1"));

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={onError} />);
    await user.click(await screen.findByRole("button", { name: "重置密码" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("新密码"), "password-one");
    await user.type(within(dialog).getByLabelText("确认新密码"), "password-two");
    await user.click(within(dialog).getByRole("button", { name: "确认重置" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(onError).toHaveBeenCalledWith("两次输入的密码不一致");
    expect(mocks.resetSchoolUserPassword).not.toHaveBeenCalled();
  });

  it("returns to page one and keeps the newly created school selected", async () => {
    const user = userEvent.setup();
    const stalePage = deferred<ReturnType<typeof schoolList>>();
    const currentCreateRefresh = deferred<ReturnType<typeof schoolList>>();
    mocks.listSchools
      .mockResolvedValueOnce(schoolList("第一页学校", "school-1", 1))
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(currentCreateRefresh.promise);
    mocks.createSchool.mockResolvedValue({
      school: { id: "school-created", name: "刚创建学校", status: "active", ai_enabled: 0 },
    });

    render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findAllByText("第一页学校")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "学校列表下一页" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "新建学校" }));
    await user.type(screen.getByPlaceholderText("输入学校名称"), "刚创建学校");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "创建学校" }));
    await waitFor(() => expect(mocks.listSchools).toHaveBeenCalledTimes(3));
    expect(mocks.listSchools).toHaveBeenNthCalledWith(3, { q: "", status: "all", page: 1, pageSize: 10 });

    await act(async () => currentCreateRefresh.resolve({
      ...schoolList("刚创建学校", "school-created", 1),
      schools: [
        { id: "school-created", name: "刚创建学校", status: "active", ai_enabled: 0 },
        { id: "school-1", name: "第一页学校", status: "active", ai_enabled: 0 },
      ],
    }));
    expect(await screen.findByText("第 1/2 页，共 20 所")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刚创建学校" }).closest("tr")).toHaveClass("is-selected");

    await act(async () => stalePage.resolve(schoolList("旧第二页", "school-old-page", 2)));
    expect(screen.getByText("第 1/2 页，共 20 所")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刚创建学校" }).closest("tr")).toHaveClass("is-selected");
    expect(screen.queryByText("旧第二页")).not.toBeInTheDocument();
  });

  it("does not refresh or report a school-account failure after unmount", async () => {
    const user = userEvent.setup();
    const createAccount = deferred<void>();
    const onError = vi.fn();
    mocks.listSchools.mockResolvedValue(schoolList("学校一", "school-1", 1, 1));
    mocks.createSchoolUser.mockReturnValueOnce(createAccount.promise);
    const view = render(<AdminWorkspace user={adminUser("admin1")} onLogout={vi.fn()} onError={onError} />);

    expect(await screen.findAllByText("学校一")).not.toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "创建账号" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("用户名"), "school_user");
    await user.type(within(dialog).getByLabelText("显示名称"), "学校账号");
    await user.type(within(dialog).getByLabelText("初始密码"), "password123");
    await user.click(within(dialog).getByRole("button", { name: "创建账号" }));
    await waitFor(() => expect(mocks.createSchoolUser).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      createAccount.reject(new Error("旧工作区错误"));
      await Promise.resolve();
    });

    expect(mocks.listSchools).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalledWith("旧工作区错误");
  });
});
