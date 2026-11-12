import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSessionToken } from "../../../platform/session";
import { AccessPanel } from "./AccessPanel";

vi.mock("./PermissionExplorer", () => ({
  PermissionExplorer: (props: {
    onEditUserAccess?: (userId: string, username?: string) => void;
    onEditRole?: (roleId?: string) => void;
  }) => (
    <div data-testid="permission-explorer">
      图谱
      <button type="button" onClick={() => props.onEditUserAccess?.("u-target", "target_user")}>编辑跨页账号</button>
      <button type="button" onClick={() => props.onEditRole?.("r-school-a")}>编辑异步角色</button>
    </div>
  ),
}));

const mocks = vi.hoisted(() => ({
  listSchools: vi.fn(), getManagementAccess: vi.fn(), listManagementRoles: vi.fn(), listManagementUsers: vi.fn(),
  getManagementUserAccess: vi.fn(), createManagementRole: vi.fn(), updateManagementRole: vi.fn(),
  updateManagementUserAccess: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/auth")>()),
  listSchools: mocks.listSchools,
}));
vi.mock("../../../platform/managementApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/managementApi")>()),
  getManagementAccess: mocks.getManagementAccess,
  listManagementRoles: mocks.listManagementRoles,
  listManagementUsers: mocks.listManagementUsers,
  getManagementUserAccess: mocks.getManagementUserAccess,
  createManagementRole: mocks.createManagementRole,
  updateManagementRole: mocks.updateManagementRole,
  updateManagementUserAccess: mocks.updateManagementUserAccess,
}));

const catalog = [
  { key: "school.access.read", label: "权限链路查看", group: "权限", description: "查看账号权限来源", assignable: false, methods: ["GET"], paths: ["/api/school/management/access"] },
  { key: "school.students.read", label: "学生名单查看", group: "学生", description: "查看本校学生", assignable: true, methods: ["GET"], paths: ["/api/school/students"] },
  { key: "school.roles.manage", label: "角色管理", group: "权限", description: "管理角色", assignable: false, methods: ["PATCH"], paths: ["/api/school/management/roles"] },
];
const account = { id: "u1", school_id: "s1", role: "school" as const, username: "school_a", display_name: "校管 A", status: "active" };
const targetAccount = { id: "u-target", school_id: "s1", role: "school" as const, username: "target_user", display_name: "跨页目标", status: "active" };
const otherAccount = { id: "u-other", school_id: "s1", role: "school" as const, username: "target_user_alias", display_name: "相似账号", status: "active" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveSessionToken("token-1");
    mocks.listSchools.mockResolvedValue({ schools: [{ id: "s1", name: "学校 A" }, { id: "s2", name: "学校 B" }], total_pages: 1 });
    mocks.getManagementAccess.mockResolvedValue({ role: "school", school_id: "s1", full_access: false, effective_permissions: ["school.access.read"], catalog, assigned_roles: [] });
    mocks.listManagementRoles.mockResolvedValue({ roles: [] });
    mocks.listManagementUsers.mockResolvedValue({ users: [account], total: 1, page: 1, page_size: 10, total_pages: 1 });
    mocks.getManagementUserAccess.mockResolvedValue({ user: account, access: { role: "school", school_id: "s1", full_access: false, effective_permissions: ["school.access.read"], catalog, assigned_roles: [] } });
  });

  it("opens the graph by default and loads the management list only when requested", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    render(<AccessPanel user={admin} scope="admin" />);

    expect(screen.getByRole("button", { name: "溯源" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("permission-explorer")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "权限管理学校" })).toHaveValue("s1"));
    expect(mocks.listManagementRoles).not.toHaveBeenCalled();
    expect(mocks.listManagementUsers).not.toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "矩阵" }));
    expect(screen.getByRole("button", { name: "矩阵" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.listManagementUsers).not.toHaveBeenCalled();
    await actor.click(screen.getByRole("button", { name: "列表" }));
    await waitFor(() => expect(mocks.listManagementRoles).toHaveBeenCalledWith("admin", "s1"));
    expect(screen.queryByTestId("permission-explorer")).not.toBeInTheDocument();
  });

  it("uses the self access endpoint for a custom school account's own permission chain", async () => {
    render(<AccessPanel user={{ ...account, school_access_mode: "custom", management_permissions: ["school.access.read"] }} scope="school" requestedView="list" />);

    expect(await screen.findByText("权限链路查看")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getManagementAccess).toHaveBeenCalledWith("school"));
    expect(screen.getByText("校管 A")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.listManagementRoles).not.toHaveBeenCalled();
    expect(mocks.listManagementUsers).not.toHaveBeenCalled();
    expect(mocks.getManagementUserAccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /新建.*角色/ })).not.toBeInTheDocument();
    expect(screen.queryByText("学生名单查看")).not.toBeInTheDocument();
  });

  it("reloads a custom account's own permission detail when refreshed permissions change", async () => {
    const schoolUser = { ...account, school_access_mode: "custom" as const, management_permissions: ["school.access.read"] };
    let effectivePermissions = ["school.access.read"];
    mocks.getManagementAccess.mockImplementation(() => Promise.resolve({
      role: "school",
      school_id: "s1",
      full_access: false,
      effective_permissions: effectivePermissions,
      catalog,
      assigned_roles: [],
    }));
    const { rerender } = render(<AccessPanel user={schoolUser} scope="school" requestedView="list" />);

    await waitFor(() => expect(mocks.getManagementAccess).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("学生名单查看")).not.toBeInTheDocument();

    effectivePermissions = ["school.access.read", "school.students.read"];
    rerender(<AccessPanel user={{ ...schoolUser, management_permissions: effectivePermissions }} scope="school" requestedView="list" />);

    expect(await screen.findByText("学生名单查看")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getManagementAccess).toHaveBeenCalledTimes(4));
  });

  it("uses its own school selector when an administrator manages school roles", async () => {
    const actor = userEvent.setup();
    const user = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    render(<AccessPanel user={user} scope="admin" requestedView="list" />);

    await waitFor(() => expect(mocks.listManagementRoles).toHaveBeenCalledWith("admin", "s1"));
    const selector = screen.getByRole("combobox", { name: "权限管理学校" });
    await actor.selectOptions(selector, "s2");
    await waitFor(() => expect(mocks.listManagementUsers).toHaveBeenLastCalledWith("admin", { q: undefined, page: 1, pageSize: 10 }, "s2"));
    await waitFor(() => expect(mocks.getManagementUserAccess).toHaveBeenCalledWith("admin", "u1", "s2"));
  });

  it("starts in the help school context and reports a manual school change", async () => {
    const actor = userEvent.setup();
    const onSchoolChange = vi.fn();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    render(<AccessPanel user={admin} scope="admin" preferredSchoolId="s2" onSchoolChange={onSchoolChange} />);

    const selector = screen.getByRole("combobox", { name: "权限管理学校" });
    await waitFor(() => expect(selector).toHaveValue("s2"));
    await actor.selectOptions(selector, "s1");
    await waitFor(() => expect(onSchoolChange).toHaveBeenLastCalledWith("s1"));
    expect(selector).toHaveValue("s1");
  });

  it("clears a pending permission detail when switching to a school with no accounts", async () => {
    const actor = userEvent.setup();
    const user = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    const staleAccess = { user: account, access: { role: "school" as const, school_id: "s1", full_access: false, effective_permissions: ["school.access.read"], catalog, assigned_roles: [] } };
    let resolveStaleAccess: (value: typeof staleAccess) => void = () => undefined;
    const staleAccessRequest = new Promise<typeof staleAccess>((resolve) => { resolveStaleAccess = resolve; });
    mocks.listManagementUsers
      .mockResolvedValueOnce({ users: [account], total: 1, page: 1, page_size: 10, total_pages: 1 })
      .mockResolvedValueOnce({ users: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.getManagementUserAccess.mockReturnValueOnce(staleAccessRequest);
    render(<AccessPanel user={user} scope="admin" requestedView="list" />);

    expect(await screen.findByRole("status")).toHaveTextContent("正在加载权限链");
    await actor.selectOptions(screen.getByRole("combobox", { name: "权限管理学校" }), "s2");

    expect(await screen.findByText("没有匹配的账号。")).toBeInTheDocument();
    expect(await screen.findByText("选择账号查看权限。")).toBeInTheDocument();
    expect(screen.queryByText(/正在加载权限链/)).not.toBeInTheDocument();

    await act(async () => {
      resolveStaleAccess(staleAccess);
      await staleAccessRequest;
    });
    expect(screen.queryByText("校管 A")).not.toBeInTheDocument();
    expect(screen.queryByText(/正在加载权限链/)).not.toBeInTheDocument();
  });

  it("keeps a chart target selected when it is outside the current account page and filter", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    const targetAccess = {
      user: targetAccount,
      access: { role: "school" as const, school_id: "s1", full_access: false, effective_permissions: ["school.students.read"], catalog, assigned_roles: [] },
    };
    mocks.listManagementUsers.mockImplementation((_scope, params) => {
      const users = params.q === "target_user" ? [otherAccount] : [account];
      return Promise.resolve({ users, total: params.q === "target_user" ? 11 : 1, page: params.page ?? 1, page_size: 10, total_pages: params.q === "target_user" ? 2 : 1 });
    });
    mocks.getManagementUserAccess.mockImplementation((_scope, userId) =>
      Promise.resolve(userId === targetAccount.id ? targetAccess : { user: account, access: targetAccess.access }),
    );
    render(<AccessPanel user={admin} scope="admin" />);

    const selector = screen.getByRole("combobox", { name: "权限管理学校" });
    await waitFor(() => expect(selector).toHaveValue("s1"));
    await actor.click(screen.getByRole("button", { name: "列表" }));
    const search = await screen.findByRole("textbox", { name: "搜索权限账号" });
    await actor.type(search, "stale-filter");
    await waitFor(() => expect(mocks.listManagementUsers).toHaveBeenLastCalledWith("admin", { q: "stale-filter", page: 1, pageSize: 10 }, "s1"));

    await actor.click(screen.getByRole("button", { name: "溯源" }));
    await actor.click(await screen.findByRole("button", { name: "编辑跨页账号" }));

    expect(await screen.findByText("跨页目标")).toBeInTheDocument();
    expect(screen.getByText(/当前筛选页未显示此账号/)).toBeInTheDocument();
    expect(mocks.listManagementUsers).toHaveBeenLastCalledWith("admin", { q: "target_user", page: 1, pageSize: 10 }, "s1");
    expect(mocks.getManagementUserAccess).toHaveBeenCalledWith("admin", "u-target", "s1");
  });

  it("shows a lookup error without falling back to another account when the chart target is unavailable", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    mocks.getManagementUserAccess.mockImplementation((_scope, userId) =>
      userId === targetAccount.id
        ? Promise.reject(new Error("目标账号不属于当前学校"))
        : Promise.resolve({ user: account, access: { role: "school" as const, school_id: "s1", full_access: false, effective_permissions: [], catalog, assigned_roles: [] } }),
    );
    mocks.listManagementUsers.mockResolvedValue({ users: [otherAccount], total: 1, page: 1, page_size: 10, total_pages: 1 });
    render(<AccessPanel user={admin} scope="admin" />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "权限管理学校" })).toHaveValue("s1"));
    await actor.click(await screen.findByRole("button", { name: "编辑跨页账号" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目标账号不属于当前学校");
    expect(screen.getByText(/未能加载，请查看错误提示/)).toBeInTheDocument();
    expect(mocks.getManagementUserAccess).toHaveBeenCalledWith("admin", "u-target", "s1");
  });

  it("ignores an asynchronous role lookup after the administrator switches schools", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    const pending = deferred<{ roles: Array<{ id: string; school_id: string; name: string; description: string; status: "active"; permissions: string[]; user_count: number; created_at: string; updated_at: string }> }>();
    mocks.listManagementRoles.mockReturnValue(pending.promise);
    render(<AccessPanel user={admin} scope="admin" />);

    const selector = screen.getByRole("combobox", { name: "权限管理学校" });
    await waitFor(() => expect(selector).toHaveValue("s1"));
    await actor.click(screen.getByRole("button", { name: "编辑异步角色" }));
    expect(mocks.listManagementRoles).toHaveBeenCalledWith("admin", "s1");

    await actor.selectOptions(selector, "s2");
    await waitFor(() => expect(selector).toHaveValue("s2"));
    await act(async () => {
      pending.resolve({ roles: [{ id: "r-school-a", school_id: "s1", name: "学校 A 角色", description: "", status: "active", permissions: ["school.students.read"], user_count: 1, created_at: "", updated_at: "" }] });
      await pending.promise;
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("permission-explorer")).toBeInTheDocument();
  });

  it("ignores an asynchronous role lookup after the session changes", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    const pending = deferred<{ roles: Array<{ id: string; school_id: string; name: string; description: string; status: "active"; permissions: string[]; user_count: number; created_at: string; updated_at: string }> }>();
    mocks.listManagementRoles.mockReturnValue(pending.promise);
    const { rerender } = render(<AccessPanel user={admin} scope="admin" />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "权限管理学校" })).toHaveValue("s1"));
    await actor.click(screen.getByRole("button", { name: "编辑异步角色" }));
    expect(mocks.listManagementRoles).toHaveBeenCalledWith("admin", "s1");

    saveSessionToken("token-2");
    rerender(<AccessPanel user={admin} scope="admin" />);
    await act(async () => {
      pending.resolve({ roles: [{ id: "r-school-a", school_id: "s1", name: "旧会话角色", description: "", status: "active", permissions: ["school.students.read"], user_count: 1, created_at: "", updated_at: "" }] });
      await pending.promise;
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("permission-explorer")).toBeInTheDocument();
  });

  it("keeps the newest role lookup result when an older lookup resolves later", async () => {
    const actor = userEvent.setup();
    const admin = { id: "admin", role: "admin" as const, username: "admin", display_name: "管理员", status: "active" };
    const first = deferred<{ roles: Array<{ id: string; school_id: string; name: string; description: string; status: "active"; permissions: string[]; user_count: number; created_at: string; updated_at: string }> }>();
    const second = deferred<{ roles: Array<{ id: string; school_id: string; name: string; description: string; status: "active"; permissions: string[]; user_count: number; created_at: string; updated_at: string }> }>();
    mocks.listManagementRoles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<AccessPanel user={admin} scope="admin" />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "权限管理学校" })).toHaveValue("s1"));
    const editRole = screen.getByRole("button", { name: "编辑异步角色" });
    await actor.click(editRole);
    await actor.click(editRole);
    expect(mocks.listManagementRoles).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve({ roles: [{ id: "r-school-a", school_id: "s1", name: "较新角色", description: "", status: "active", permissions: ["school.students.read"], user_count: 1, created_at: "", updated_at: "" }] });
      await second.promise;
    });
    expect(await screen.findByLabelText("角色名称")).toHaveValue("较新角色");

    await act(async () => {
      first.resolve({ roles: [{ id: "r-school-a", school_id: "s1", name: "过期角色", description: "", status: "active", permissions: ["school.students.read"], user_count: 1, created_at: "", updated_at: "" }] });
      await first.promise;
    });
    expect(screen.getByLabelText("角色名称")).toHaveValue("较新角色");
  });
});
