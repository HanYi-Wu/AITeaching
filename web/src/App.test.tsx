import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memo, StrictMode, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformUser } from "./platform/auth";
import { setupTestI18n, TestI18nProvider } from "./test/i18nTestUtils";
import App from "./App";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(), getCurrentUser: vi.fn(), getPlatformStatus: vi.fn(),
  logoutPlatform: vi.fn(), setPlatformProjectRoot: vi.fn(), setSidebarOpen: vi.fn(),
  resetAgentContext: vi.fn(),
  loadSchoolWorkspace: vi.fn(),
  composeRender: vi.fn(),
  bankRender: vi.fn(),
  analysisRender: vi.fn(),
  invalidateWarmCaches: vi.fn(),
  scheduleWarmup: vi.fn((_options?: unknown) => () => undefined),
  failStudentWorkspaceRender: false,
  sidebarOpen: false,
}));
const school: PlatformUser = { id: "school-user", username: "school", role: "school", display_name: "学校", status: "active" };
const admin: PlatformUser = { ...school, id: "admin-user", username: "admin", role: "admin" };

vi.mock("./api/client", () => ({ apiGet: mocks.apiGet }));
vi.mock("./platform/auth", () => ({
  getCurrentUser: mocks.getCurrentUser, getPlatformStatus: mocks.getPlatformStatus,
  logoutPlatform: mocks.logoutPlatform, setPlatformProjectRoot: mocks.setPlatformProjectRoot,
}));
vi.mock("./contexts/AgentContext", () => ({
  AgentProvider: ({ children }: { children: ReactNode }) => children,
  useAgentSidebar: () => ({ sidebarOpen: mocks.sidebarOpen, toggleSidebar: vi.fn(), setSidebarOpen: mocks.setSidebarOpen, resetAgentContext: mocks.resetAgentContext }),
}));
vi.mock("./contexts/ToolBarContext", () => ({
  ToolBarProvider: ({ children }: { children: ReactNode }) => children,
  useToolBar: () => ({ left: null, right: null }),
}));
vi.mock("./components/DesktopTitleBar", () => ({ DesktopTitleBar: () => null }));
vi.mock("./components/AgentSidebar", () => ({ AgentSidebar: () => <div data-testid="assistant-panel" /> }));
vi.mock("./components/TeacherFirstUseGuide", () => ({ TeacherFirstUseGuide: () => null }));
vi.mock("./pages/platform/papers/PapersWorkspace", () => ({
  PapersWorkspace: ({ projectScope }: { projectScope?: unknown }) => <div data-testid="paper-project-scope">{JSON.stringify(projectScope)}</div>,
}));
vi.mock("./app/preloadTeacherModules", () => ({
  preloadTeacherWorkspaceChunks: () => [],
  scheduleTeacherWorkspaceWarmup: (options: unknown) => mocks.scheduleWarmup(options),
  invalidateTeacherWarmCaches: () => mocks.invalidateWarmCaches(),
}));
vi.mock("./app/routes", () => ({
  BankRoute: memo(function MockBankRoute({ active }: { active?: boolean }) {
    mocks.bankRender(active);
    return <div data-testid="mock-bank" data-active={String(Boolean(active))} />;
  }),
  ComposeRoute: memo(function MockComposeRoute({ onRefreshInfo }: { onRefreshInfo: () => Promise<void> }) {
    mocks.composeRender();
    return <button onClick={() => void onRefreshInfo()}>刷新项目范围</button>;
  }),
  GraphRoute: () => null,
  TemplateRoute: () => null,
}));
vi.mock("./pages/analysis/AnalysisWorkspace", () => ({
  AnalysisWorkspace: memo(function MockAnalysisWorkspace({ active }: { active?: boolean }) {
    mocks.analysisRender(active);
    return <div data-testid="mock-analysis" data-active={String(Boolean(active))} />;
  }),
}));
vi.mock("./pages/tools/ClassroomToolsWorkspace", () => ({
  ClassroomToolsWorkspace: memo(function MockClassroomToolsWorkspace({ active }: { active?: boolean }) {
    return <div data-testid="mock-tools" data-active={String(Boolean(active))} />;
  }),
}));
vi.mock("./pages/platform/school/SchoolWorkspace", async () => {
  await mocks.loadSchoolWorkspace();
  return {
    SchoolWorkspace: ({ onError, onLogout }: { onError: (message: string | null) => void; onLogout: () => void }) => (
      <div>
        学校工作区
        <button onClick={() => onError("学校数据加载失败：班级名单暂时不可用")}>触发学校错误</button>
        <button onClick={onLogout}>退出登录</button>
      </div>
    ),
  };
});
vi.mock("./pages/platform/student/StudentWorkspace", () => ({
  StudentWorkspace: () => {
    if (mocks.failStudentWorkspaceRender) throw new Error("student workspace chunk failed");
    return <div>学生工作区</div>;
  },
}));
vi.mock("./pages/platform/admin/AdminWorkspace", () => ({
  AdminWorkspace: ({ onError, onLogout }: { onError: (message: string | null) => void; onLogout: () => void }) => (
    <div>
      管理员工作区
      <button onClick={() => onError("管理员读取失败：学校列表暂时不可用")}>触发管理员错误</button>
      <button onClick={onLogout}>退出登录</button>
    </div>
  ),
}));
vi.mock("./pages/platform/login/PlatformLogin", () => ({
  PlatformLogin: ({ mode, onAuthenticated }: { mode: "bootstrap" | "login"; onAuthenticated: (user: PlatformUser) => void }) => (
    <div>{mode === "bootstrap" ? "初始化页" : "登录页"}<button onClick={() => onAuthenticated(mode === "bootstrap" ? admin : school)}>{mode === "bootstrap" ? "创建管理员" : "以学校身份登录"}</button></div>
  ),
}));

function renderApp() {
  return render(<TestI18nProvider><App /></TestI18nProvider>);
}

describe("role-specific project requests", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarOpen = false;
    mocks.failStudentWorkspaceRender = false;
    mocks.getPlatformStatus.mockResolvedValue({ admin_exists: true, public_mode: true });
    mocks.apiGet.mockResolvedValue({ bound: true, root: "/teacher-project" });
    mocks.logoutPlatform.mockResolvedValue({});
    mocks.loadSchoolWorkspace.mockResolvedValue(undefined);
  });

  it("keeps the active editor out of navigation-only renders", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, id: "teacher-user", role: "teacher" } });
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "刷新项目范围" });
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/teacher-project"));
    mocks.composeRender.mockClear();
    await user.click(screen.getByRole("button", { name: "收起导航" }));
    expect(screen.getByRole("button", { name: "展开导航" })).toBeInTheDocument();
    expect(mocks.composeRender).not.toHaveBeenCalled();
  });

  it("does not re-render the hidden compose route when graph navigates to papers", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, id: "teacher-user", role: "teacher" } });
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "刷新项目范围" });
    await waitFor(() => expect(mocks.composeRender).toHaveBeenCalled());
    mocks.composeRender.mockClear();

    await user.click(screen.getByRole("button", { name: "知识图谱" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "知识图谱" })).toHaveAttribute("aria-current", "page"));
    expect(mocks.composeRender).toHaveBeenCalledTimes(1); // only toolBarActive true -> false

    await user.click(screen.getByTestId("nav-papers"));
    await screen.findByTestId("paper-project-scope");
    expect(mocks.composeRender).toHaveBeenCalledTimes(1); // false -> false keeps the hidden editor stable
  });

  it("keeps the login screen up until the authenticated workspace chunk is ready", async () => {
    let releaseWorkspace!: () => void;
    mocks.getCurrentUser.mockResolvedValue({ user: null });
    mocks.loadSchoolWorkspace.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseWorkspace = resolve; }));
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "以学校身份登录" }));
    await waitFor(() => expect(mocks.loadSchoolWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByText("登录页")).toBeInTheDocument();
    expect(screen.queryByText(/加载工作区/)).not.toBeInTheDocument();

    await act(async () => { releaseWorkspace(); });
    await screen.findByText("学校工作区");
  });

  it.each([
    ["school", true], ["school", false], ["student", true], ["student", false],
  ] as const)("does not request a teacher project as %s (public mode: %s)", async (role, publicMode) => {
    mocks.getPlatformStatus.mockResolvedValue({ admin_exists: true, public_mode: publicMode });
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role } });
    mocks.apiGet.mockRejectedValue(new Error(`${role} role cannot access this endpoint`));
    mocks.failStudentWorkspaceRender = role === "student";
    const consoleError = role === "student"
      ? vi.spyOn(console, "error").mockImplementation(() => {})
      : null;
    try {
      renderApp();
      await screen.findByText(role === "school" ? "学校工作区" : "此工作区暂时无法加载");
      if (role === "student") {
        expect(screen.getByRole("alert")).toHaveTextContent("此工作区暂时无法加载");
      }
      expect(mocks.apiGet).not.toHaveBeenCalled();
      expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith(null);
    } finally {
      consoleError?.mockRestore();
    }
  });

  it.each([
    { role: "管理员", user: admin, workspace: "管理员工作区", trigger: "触发管理员错误", message: "管理员读取失败：学校列表暂时不可用" },
    { role: "学校", user: school, workspace: "学校工作区", trigger: "触发学校错误", message: "学校数据加载失败：班级名单暂时不可用" },
  ])("shows readable workspace errors for the $role role", async ({ user, workspace, trigger, message }) => {
    mocks.getCurrentUser.mockResolvedValue({ user });
    renderApp();

    await screen.findByText(workspace);
    await userEvent.click(screen.getByRole("button", { name: trigger }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert.querySelector("[tabindex='0']")).toHaveTextContent(message);
    expect(alert.querySelector("[tabindex='0']")).toHaveClass("overflow-y-auto");
    expect(alert).toHaveTextContent("完整说明见运行日志");
  });

  it("clears workspace errors after logout and a role change", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: admin });
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("管理员工作区");
    await user.click(screen.getByRole("button", { name: "触发管理员错误" }));
    expect(screen.getByRole("alert")).toHaveTextContent("管理员读取失败：学校列表暂时不可用");

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    await screen.findByText("登录页");
    await user.click(screen.getByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("管理员读取失败：学校列表暂时不可用")).not.toBeInTheDocument();
  });

  it.each(["teacher", "admin"] as const)("loads project information for %s", async (role) => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role } });
    renderApp();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/project/info"));
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/teacher-project"));
  });

  it("does not request a protected project before public login", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: null });
    renderApp();
    await screen.findByText("登录页");
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it("mounts the assistant on first opening and keeps its session while closed", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role: "teacher" } });
    const view = renderApp();
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/teacher-project"));
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
    mocks.sidebarOpen = true;
    view.rerender(<TestI18nProvider><App /></TestI18nProvider>);
    const panel = await screen.findByTestId("assistant-panel");
    mocks.sidebarOpen = false;
    view.rerender(<TestI18nProvider><App /></TestI18nProvider>);
    expect(screen.getByTestId("assistant-panel")).toBe(panel);
  });

  it("shares project scope with papers only after the current account's lookup completes", async () => {
    let finish!: (value: { bound: boolean; root: string }) => void;
    mocks.apiGet.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role: "teacher" } });
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-papers"));
    expect(await screen.findByTestId("paper-project-scope")).toHaveTextContent('{"ready":false,"value":null}');
    await act(async () => { finish({ bound: true, root: "/teacher-project" }); });
    expect(screen.getByTestId("paper-project-scope")).toHaveTextContent('{"ready":true,"value":"/teacher-project"}');
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it("offers reconnection when restoring the session temporarily fails", async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error("Temporarily unavailable")).mockResolvedValue({ user: school });
    renderApp();
    await screen.findByText("平台服务暂时不可用");
    await userEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await screen.findByText("学校工作区");
  });

  it("ignores an old startup response after a new login", async () => {
    let resolveOld!: (value: { admin_exists: boolean; public_mode: boolean }) => void;
    mocks.getPlatformStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    mocks.getCurrentUser.mockResolvedValue({ user: null });
    render(<TestI18nProvider><StrictMode><App /></StrictMode></TestI18nProvider>);
    await screen.findByText("登录页");
    await userEvent.click(screen.getByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    await act(async () => { resolveOld({ admin_exists: false, public_mode: true }); });
    expect(screen.getByText("学校工作区")).toBeInTheDocument();
    expect(screen.queryByText("初始化页")).not.toBeInTheDocument();
  });

  it.each([true, false])("returns to login after administrator initialization and logout (public mode: %s)", async (publicMode) => {
    mocks.getPlatformStatus.mockResolvedValue({ admin_exists: false, public_mode: publicMode });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "创建管理员" }));
    await screen.findByText("管理员工作区");
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    await screen.findByText("登录页");
    expect(screen.queryByText("初始化页")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith(null);
  });

  it("clears the teacher project when switching to a school account", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role: "teacher" } });
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/teacher-project"));
    await user.click(screen.getByRole("button", { name: "退出" }));
    await user.click(await screen.findByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith(null);
  });

  it("ignores a delayed teacher project response after switching to school", async () => {
    let finish!: (value: { bound: boolean; root: string }) => void;
    mocks.apiGet.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role: "teacher" } });
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: "退出" }));
    await user.click(await screen.findByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    await act(async () => { finish({ bound: true, root: "/previous-teacher-project" }); });
    expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith(null);
  });

  it("remounts the assistant and resets its context when the bound project scope changes", async () => {
    mocks.sidebarOpen = true;
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role: "teacher" } });
    mocks.apiGet.mockResolvedValueOnce({ bound: true, root: "/project-a" }).mockResolvedValueOnce({ bound: true, root: "/project-b" });
    const user = userEvent.setup();
    renderApp();
    const originalPanel = await screen.findByTestId("assistant-panel");
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/project-a"));
    const resetsBeforeScopeChange = mocks.resetAgentContext.mock.calls.length;

    await user.click(await screen.findByRole("button", { name: "刷新项目范围" }));
    await waitFor(() => expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith("/project-b"));
    await waitFor(() => expect(mocks.resetAgentContext.mock.calls.length).toBeGreaterThan(resetsBeforeScopeChange));
    const scopedPanel = await screen.findByTestId("assistant-panel");
    expect(scopedPanel).not.toBe(originalPanel);
  });

  it("applies account density and resets it when the account logs out", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: {
      ...school,
      role: "teacher",
      preferences: { density: "compact" },
    } });
    const user = userEvent.setup();
    renderApp();

    await screen.findByRole("button", { name: "退出" });
    await waitFor(() => expect(document.documentElement.dataset.ehDensity).toBe("compact"));

    await user.click(screen.getByRole("button", { name: "退出" }));
    await screen.findByText("登录页");
    expect(document.documentElement.dataset.ehDensity).toBe("comfortable");

    await user.click(screen.getByRole("button", { name: "以学校身份登录" }));
    await screen.findByText("学校工作区");
    expect(document.documentElement.dataset.ehDensity).toBe("comfortable");
  });

  it("keeps visited bank and analysis workspaces mounted across tab switches and triggers teacher warmup", async () => {
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, id: "teacher-user", role: "teacher" } });
    const user = userEvent.setup();
    renderApp();

    await waitFor(() =>
      expect(mocks.scheduleWarmup).toHaveBeenCalledWith({
        ownerId: "teacher-user",
        projectId: "/teacher-project",
        warmBank: true,
      }),
    );

    expect(screen.queryByTestId("mock-bank")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-analysis")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-tools")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "题库" }));
    const bankEl = await screen.findByTestId("mock-bank");
    expect(bankEl).toHaveAttribute("data-active", "true");

    await user.click(screen.getByRole("button", { name: "分析" }));
    const analysisEl = await screen.findByTestId("mock-analysis");
    expect(analysisEl).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mock-bank")).toBe(bankEl);
    expect(screen.getByTestId("mock-bank")).toHaveAttribute("data-active", "false");

    await user.click(screen.getByRole("button", { name: "课堂工具" }));
    const toolsEl = await screen.findByTestId("mock-tools");
    expect(toolsEl).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mock-analysis")).toBe(analysisEl);
    expect(screen.getByTestId("mock-analysis")).toHaveAttribute("data-active", "false");

    await user.click(screen.getByRole("button", { name: "题库" }));
    expect(screen.getByTestId("mock-bank")).toBe(bankEl);
    expect(screen.getByTestId("mock-bank")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mock-analysis")).toBe(analysisEl);
    expect(screen.getByTestId("mock-analysis")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("mock-tools")).toBe(toolsEl);
    expect(screen.getByTestId("mock-tools")).toHaveAttribute("data-active", "false");

    await user.click(screen.getByRole("button", { name: "退出" }));
    await screen.findByText("登录页");
    expect(mocks.invalidateWarmCaches).toHaveBeenCalled();
    expect(screen.queryByTestId("mock-bank")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-analysis")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-tools")).not.toBeInTheDocument();
  });
});
