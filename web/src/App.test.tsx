import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformUser } from "./platform/auth";
import { setupTestI18n, TestI18nProvider } from "./test/i18nTestUtils";
import App from "./App";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(), getCurrentUser: vi.fn(), getPlatformStatus: vi.fn(),
  logoutPlatform: vi.fn(), setPlatformProjectRoot: vi.fn(), setSidebarOpen: vi.fn(),
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
  useAgentContext: () => ({ sidebarOpen: false, toggleSidebar: vi.fn(), setSidebarOpen: mocks.setSidebarOpen }),
}));
vi.mock("./contexts/ToolBarContext", () => ({
  ToolBarProvider: ({ children }: { children: ReactNode }) => children,
  useToolBar: () => ({ left: null, right: null }),
}));
vi.mock("./components/DesktopTitleBar", () => ({ DesktopTitleBar: () => null }));
vi.mock("./components/AgentSidebar", () => ({ AgentSidebar: () => null }));
vi.mock("./components/TeacherFirstUseGuide", () => ({ TeacherFirstUseGuide: () => null }));
vi.mock("./app/routes", () => ({
  BankRoute: () => null, ComposeRoute: () => null, GraphRoute: () => null, TemplateRoute: () => null,
}));
vi.mock("./pages/platform/school/SchoolWorkspace", () => ({ SchoolWorkspace: () => <div>学校工作区</div> }));
vi.mock("./pages/platform/student/StudentWorkspace", () => ({ StudentWorkspace: () => <div>学生工作区</div> }));
vi.mock("./pages/platform/admin/AdminWorkspace", () => ({
  AdminWorkspace: ({ onLogout }: { onLogout: () => void }) => <div>管理员工作区<button onClick={onLogout}>退出登录</button></div>,
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
    mocks.getPlatformStatus.mockResolvedValue({ admin_exists: true, public_mode: true });
    mocks.apiGet.mockResolvedValue({ bound: true, root: "/teacher-project" });
    mocks.logoutPlatform.mockResolvedValue({});
  });

  it.each([
    ["school", true], ["school", false], ["student", true], ["student", false],
  ] as const)("does not request a teacher project as %s (public mode: %s)", async (role, publicMode) => {
    mocks.getPlatformStatus.mockResolvedValue({ admin_exists: true, public_mode: publicMode });
    mocks.getCurrentUser.mockResolvedValue({ user: { ...school, role } });
    mocks.apiGet.mockRejectedValue(new Error(`${role} role cannot access this endpoint`));
    renderApp();
    await screen.findByText(role === "school" ? "学校工作区" : "学生工作区");
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(mocks.setPlatformProjectRoot).toHaveBeenLastCalledWith(null);
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
});
