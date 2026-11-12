import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementPermissionGraph } from "../../../platform/managementGraphApi";
import { saveSessionToken } from "../../../platform/session";
import { PermissionExplorer } from "./PermissionExplorer";

const mocks = vi.hoisted(() => ({
  getManagementPermissionGraph: vi.fn(),
}));

vi.mock("../../../platform/managementGraphApi", () => ({
  getManagementPermissionGraph: mocks.getManagementPermissionGraph,
}));

const graphFixture: ManagementPermissionGraph = {
  school: { id: "s1", name: "演示学校" },
  self_only: false,
  users: [
    {
      id: "u1",
      username: "demo_school",
      display_name: "演示学校端",
      status: "active",
      mode: "full",
      role_ids: [],
      effective_permissions: ["school.overview.read", "school.students.read", "school.students.manage"],
    },
    {
      id: "u2",
      username: "demo_reader",
      display_name: "名册查看员",
      status: "active",
      mode: "custom",
      role_ids: ["r-roster"],
      effective_permissions: ["school.overview.read", "school.students.read"],
    },
  ],
  roles: [
    {
      id: "builtin:full",
      name: "完整学校管理",
      status: "active",
      builtin: true,
      kind: "full",
      permissions: [],
      effective_permissions: ["school.overview.read", "school.students.read", "school.students.manage"],
      user_count: 1,
    },
    {
      id: "r-roster",
      name: "名册管理",
      status: "active",
      builtin: false,
      kind: "custom",
      permissions: ["school.students.manage"],
      effective_permissions: ["school.students.manage", "school.students.read"],
      user_count: 1,
    },
  ],
  menus: [
    { id: "menu:overview", label: "总览", section: "overview", permission: "school.overview.read", group: "学校运营" },
    { id: "menu:students", label: "学生", section: "students", permission: "school.students.read", group: "教务名册" },
  ],
  catalog: [
    {
      key: "school.overview.read",
      label: "查看学校总览",
      group: "学校运营",
      description: "查看学校统计概览",
      assignable: true,
      methods: ["GET"],
      paths: ["/api/school/overview"],
      routes: [{ method: "GET", path: "/api/school/overview" }],
    },
    {
      key: "school.students.read",
      label: "查看学生名册",
      group: "教务名册",
      description: "查看本校学生名单",
      assignable: true,
      methods: ["GET"],
      paths: ["/api/school/students"],
      routes: [{ method: "GET", path: "/api/school/students" }],
    },
    {
      key: "school.students.manage",
      label: "管理学生名册",
      group: "教务名册",
      description: "新增或编辑本校学生",
      assignable: true,
      methods: ["POST", "PATCH"],
      paths: ["/api/school/students"],
      routes: [{ method: "POST", path: "/api/school/students" }],
    },
  ],
  assignments: [
    { user_id: "u1", role_id: "builtin:full", active: true, source: "builtin" },
    { user_id: "u2", role_id: "r-roster", active: true, source: "assigned" },
  ],
  implications: [
    { source: "school.students.manage", target: "school.students.read" },
  ],
  summary: {
    user_count: 2,
    role_count: 2,
    menu_count: 2,
    unused_roles: 0,
    unassigned_users: 0,
    unreachable_menus: 0,
  },
  page: 1,
  page_size: 50,
  total: 2,
  total_pages: 1,
  coverage: { returned_users: 2, total_users: 2, roles_truncated: false },
};

const admin = { id: "admin", role: "admin" as const, username: "demo_admin", display_name: "管理员", status: "active" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("PermissionExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveSessionToken("token-1");
    mocks.getManagementPermissionGraph.mockResolvedValue(graphFixture);
  });

  it("renders star-map hubs and expands 3-layer stage (hub -> module -> entity) tracing role sources without raw permission keys", async () => {
    const actor = userEvent.setup();
    render(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" />);

    expect(await screen.findByRole("button", { name: "角色，2 个来源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户，2 个账号" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "页面 / 操作，2 项" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "角色，2 个来源" }));
    const rosterRoleBtn = await screen.findByRole("button", { name: "角色：名册管理" });
    expect(rosterRoleBtn).toBeInTheDocument();

    await actor.click(rosterRoleBtn);
    const details = await screen.findByLabelText("授权来源详情");
    expect(within(details).getByRole("heading", { name: "名册管理" })).toBeInTheDocument();
    expect(within(details).getByText("由「管理学生名册」包含")).toBeInTheDocument();
    expect(within(details).queryByText("school.students.read")).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /返回权限全景/ }));
    await actor.click(screen.getByRole("button", { name: "页面 / 操作，2 项" }));
    expect(await screen.findByRole("button", { name: /页面 \/ 操作：学生/ })).toBeInTheDocument();
  });

  it("traces a role-menu pair when clicking a cell in the matrix view", async () => {
    const actor = userEvent.setup();
    const onViewChange = vi.fn();
    render(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="matrix" onViewChange={onViewChange} />);

    const cell = await screen.findByRole("button", { name: "名册管理 × 学生：隐含包含" });
    expect(cell).toHaveAttribute("title", "经由「管理学生名册」隐含包含");
    await actor.click(cell);

    expect(onViewChange).toHaveBeenCalledWith("trace");
  });

  it("does not offer a page jump to a school viewer without that page's read permission", async () => {
    const actor = userEvent.setup();
    const schoolViewer = {
      id: "u-viewer",
      role: "school" as const,
      username: "viewer",
      display_name: "只看权限链",
      status: "active",
      school_id: "s1",
      school_access_mode: "custom" as const,
      management_permissions: ["school.access.read"],
    };
    render(<PermissionExplorer user={schoolViewer} scope="school" view="trace" onNavigateSection={vi.fn()} />);

    const actorHub = await screen.findByRole("button", { name: "用户，2 个账号" });
    await actor.click(actorHub);
    await actor.click(await screen.findByRole("button", { name: "用户：名册查看员" }));

    expect(await screen.findByLabelText("授权来源详情")).toBeInTheDocument();
    expect(screen.queryByTitle("前往学生")).not.toBeInTheDocument();
  });

  it("allows a school viewer to jump to a page when they have its read permission", async () => {
    const actor = userEvent.setup();
    const onNavigateSection = vi.fn();
    const schoolViewer = {
      id: "u-viewer",
      role: "school" as const,
      username: "viewer",
      display_name: "可看名册权限链",
      status: "active",
      school_id: "s1",
      school_access_mode: "custom" as const,
      management_permissions: ["school.access.read", "school.students.read"],
    };
    render(<PermissionExplorer user={schoolViewer} scope="school" view="trace" onNavigateSection={onNavigateSection} />);

    await actor.click(await screen.findByRole("button", { name: "用户，2 个账号" }));
    await actor.click(await screen.findByRole("button", { name: "用户：名册查看员" }));
    await actor.click(await screen.findByTitle("前往学生"));

    expect(onNavigateSection).toHaveBeenCalledWith("students");
  });

  it("locates a deep-linked user by id when not present on the initial page", async () => {
    const secondUser = {
      id: "u-missing",
      username: "late_user",
      display_name: "跨页教师",
      status: "active",
      mode: "custom" as const,
      role_ids: ["r-roster"],
      effective_permissions: ["school.students.read"],
    };
    mocks.getManagementPermissionGraph
      .mockResolvedValueOnce(graphFixture)
      .mockResolvedValueOnce({ ...graphFixture, users: [secondUser] });

    render(
      <PermissionExplorer
        user={admin}
        scope="admin"
        schoolId="s1"
        view="trace"
        target={{ kind: "user", id: "u-missing" }}
      />,
    );

    await waitFor(() =>
      expect(mocks.getManagementPermissionGraph).toHaveBeenCalledWith("admin", {
        schoolId: "s1",
        q: "u-missing",
        page: 1,
        pageSize: 50,
      }),
    );
    expect(await screen.findByText("已定位账号：跨页教师")).toBeInTheDocument();
  });

  it("loads the permission graph when schoolId resolves after mount or switches schools", async () => {
    const { rerender } = render(<PermissionExplorer user={admin} scope="admin" schoolId={undefined} view="trace" />);
    expect(screen.getByText("选择学校后查看权限关系")).toBeInTheDocument();

    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" />);
    expect(await screen.findByRole("button", { name: "角色，2 个来源" })).toBeInTheDocument();

    mocks.getManagementPermissionGraph.mockResolvedValueOnce({
      ...graphFixture,
      school: { id: "s2", name: "第二中学" },
    });
    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s2" view="trace" />);
    await waitFor(() =>
      expect(mocks.getManagementPermissionGraph).toHaveBeenCalledWith("admin", {
        schoolId: "s2",
        q: undefined,
        page: 1,
        pageSize: 50,
      }),
    );
  });

  it("hides the previous school's graph immediately and ignores its late response", async () => {
    const actor = userEvent.setup();
    const staleSchoolRequest = deferred<ManagementPermissionGraph>();
    const schoolBGraph: ManagementPermissionGraph = {
      ...graphFixture,
      school: { id: "s2", name: "第二中学" },
      roles: graphFixture.roles.map((role) => ({ ...role, name: role.id === "r-roster" ? "第二学校角色" : role.name })),
    };
    mocks.getManagementPermissionGraph.mockImplementation((_scope, params) =>
      params.schoolId === "s1" ? staleSchoolRequest.promise : Promise.resolve(schoolBGraph),
    );
    const { rerender } = render(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" />);

    await waitFor(() => expect(mocks.getManagementPermissionGraph).toHaveBeenCalledWith("admin", {
      schoolId: "s1", q: undefined, page: 1, pageSize: 50,
    }));
    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s2" view="trace" />);
    expect(screen.queryByRole("button", { name: "角色：名册管理" })).not.toBeInTheDocument();
    expect(screen.getByText("正在加载权限星图...")).toBeInTheDocument();
    await actor.click(await screen.findByRole("button", { name: "角色，2 个来源" }));
    expect(await screen.findByRole("button", { name: "角色：第二学校角色" })).toBeInTheDocument();

    await act(async () => {
      staleSchoolRequest.resolve(graphFixture);
      await staleSchoolRequest.promise;
    });
    expect(screen.queryByRole("button", { name: "角色：名册管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "角色：第二学校角色" })).toBeInTheDocument();
  });

  it("hides the full graph and reloads when the same school account is downgraded", async () => {
    const actor = userEvent.setup();
    const fullSchoolUser = {
      id: "u1",
      role: "school" as const,
      username: "demo_school",
      display_name: "演示学校端",
      status: "active",
      school_id: "s1",
      school_access_mode: "full" as const,
    };
    const downgradedSchoolUser = {
      ...fullSchoolUser,
      school_access_mode: "custom" as const,
      management_permissions: ["school.access.read"],
    };
    const selfGraph: ManagementPermissionGraph = {
      ...graphFixture,
      self_only: true,
      users: [{ ...graphFixture.users[0], username: "demo_school", display_name: "降权后账号" }],
      roles: [],
      menus: [],
      assignments: [],
      summary: { user_count: 1, role_count: 0, menu_count: 0, unused_roles: 0, unassigned_users: 1, unreachable_menus: 0 },
      total: 1,
      coverage: { returned_users: 1, total_users: 1, roles_truncated: false },
    };
    const staleFullGraph = deferred<ManagementPermissionGraph>();
    const downgradedGraph = deferred<ManagementPermissionGraph>();
    mocks.getManagementPermissionGraph
      .mockResolvedValueOnce(graphFixture)
      .mockImplementationOnce(() => staleFullGraph.promise)
      .mockImplementationOnce(() => downgradedGraph.promise);
    const { rerender } = render(<PermissionExplorer user={fullSchoolUser} scope="school" view="trace" />);

    expect(await screen.findByRole("button", { name: "角色，2 个来源" })).toBeInTheDocument();
    rerender(<PermissionExplorer user={fullSchoolUser} scope="school" view="trace" revision={1} />);
    await waitFor(() => expect(mocks.getManagementPermissionGraph).toHaveBeenCalledTimes(2));
    rerender(<PermissionExplorer user={downgradedSchoolUser} scope="school" view="trace" revision={1} />);
    expect(screen.queryByRole("button", { name: "角色，2 个来源" })).not.toBeInTheDocument();
    expect(screen.getByText("正在加载权限星图...")).toBeInTheDocument();
    await act(async () => {
      downgradedGraph.resolve(selfGraph);
      await downgradedGraph.promise;
    });
    await actor.click(await screen.findByRole("button", { name: "用户，1 个账号" }));
    expect(await screen.findByRole("button", { name: "用户：降权后账号" })).toBeInTheDocument();

    await act(async () => {
      staleFullGraph.resolve(graphFixture);
      await staleFullGraph.promise;
    });
    expect(screen.queryByRole("button", { name: "角色，2 个来源" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户：降权后账号" })).toBeInTheDocument();
  });

  it("ignores an account locate response after the target or school changes", async () => {
    const actor = userEvent.setup();
    const targetUser = {
      id: "u-late",
      username: "late_user",
      display_name: "旧学校账号",
      status: "active",
      mode: "custom" as const,
      role_ids: ["r-roster"],
      effective_permissions: ["school.students.read"],
    };
    const staleLocate = deferred<ManagementPermissionGraph>();
    const schoolBGraph: ManagementPermissionGraph = {
      ...graphFixture,
      school: { id: "s2", name: "第二中学" },
      roles: graphFixture.roles.map((role) => ({ ...role, name: role.id === "r-roster" ? "第二学校角色" : role.name })),
    };
    mocks.getManagementPermissionGraph.mockImplementation((_scope, params) => {
      if (params.schoolId === "s1" && params.q === "u-late") return staleLocate.promise;
      return Promise.resolve(params.schoolId === "s2" ? schoolBGraph : graphFixture);
    });
    const { rerender } = render(
      <PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" target={{ kind: "user", id: "u-late" }} />,
    );

    await waitFor(() => expect(mocks.getManagementPermissionGraph).toHaveBeenCalledWith("admin", {
      schoolId: "s1", q: "u-late", page: 1, pageSize: 50,
    }));
    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s2" view="trace" target={null} />);
    await actor.click(await screen.findByRole("button", { name: "角色，2 个来源" }));
    expect(await screen.findByRole("button", { name: "角色：第二学校角色" })).toBeInTheDocument();

    await act(async () => {
      staleLocate.resolve({ ...graphFixture, users: [...graphFixture.users, targetUser] });
      await staleLocate.promise;
    });
    expect(screen.queryByText("已定位账号：旧学校账号")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用户：旧学校账号" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "角色：第二学校角色" })).toBeInTheDocument();
  });

  it("starts a fresh lookup when the same deep-linked target is selected again", async () => {
    const targetUser = {
      id: "u-late",
      username: "late_user",
      display_name: "延迟账号",
      status: "active",
      mode: "custom" as const,
      role_ids: ["r-roster"],
      effective_permissions: ["school.students.read"],
    };
    const firstLookup = deferred<ManagementPermissionGraph>();
    const secondLookup = deferred<ManagementPermissionGraph>();
    const pendingLookups = [firstLookup, secondLookup];
    const locatedGraph = { ...graphFixture, users: [...graphFixture.users, targetUser] };
    mocks.getManagementPermissionGraph.mockImplementation((_scope, params) => {
      if (!params.q) return Promise.resolve(graphFixture);
      const pending = pendingLookups.shift();
      return pending ? pending.promise : Promise.resolve(locatedGraph);
    });
    const { rerender } = render(
      <PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" target={{ kind: "user", id: "u-late" }} />,
    );

    await waitFor(() => expect(mocks.getManagementPermissionGraph).toHaveBeenCalledWith("admin", {
      schoolId: "s1", q: "u-late", page: 1, pageSize: 50,
    }));
    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" target={null} />);
    rerender(<PermissionExplorer user={admin} scope="admin" schoolId="s1" view="trace" target={{ kind: "user", id: "u-late" }} />);

    await waitFor(() => expect(mocks.getManagementPermissionGraph).toHaveBeenCalledTimes(3));
    await act(async () => {
      firstLookup.resolve({ ...graphFixture, users: [...graphFixture.users, targetUser] });
      await firstLookup.promise;
    });
    expect(screen.queryByText("已定位账号：延迟账号")).not.toBeInTheDocument();

    await act(async () => {
      secondLookup.resolve(locatedGraph);
      await secondLookup.promise;
    });
    expect(await screen.findByText("已定位账号：延迟账号")).toBeInTheDocument();
  });
});
