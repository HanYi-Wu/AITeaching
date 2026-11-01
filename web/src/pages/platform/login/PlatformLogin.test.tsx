import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformLogin } from "./PlatformLogin";

const mocks = vi.hoisted(() => ({
  bootstrapAdmin: vi.fn(),
  loginPlatform: vi.fn(),
  saveSessionToken: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    bootstrapAdmin: mocks.bootstrapAdmin,
    loginPlatform: mocks.loginPlatform,
    saveSessionToken: mocks.saveSessionToken,
  };
});

function field(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing input: ${selector}`);
  }
  return input;
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Missing submit button");
  }
  return button;
}

describe("PlatformLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows failed login API errors directly on the form", async () => {
    mocks.loginPlatform.mockRejectedValueOnce(new Error("Invalid username or password"));
    const onAuthenticated = vi.fn();
    const onError = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={onAuthenticated} onError={onError} />,
    );

    await user.type(field(container, 'input[autocomplete="username"]'), "admin");
    await user.type(field(container, 'input[type="password"]'), "wrong123");
    await user.click(submitButton(container));

    await waitFor(() =>
      expect(mocks.loginPlatform).toHaveBeenCalledWith({ username: "admin", password: "wrong123" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
    expect(onError).toHaveBeenCalledWith("用户名或密码错误");
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("can reveal the password and explains how accounts are recovered", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );
    const password = field(container, 'input[autocomplete="current-password"]');
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveClass("platform-login-password");
    const reveal = screen.getByRole("button", { name: "显示密码" });
    expect(reveal).toHaveAttribute("type", "button");
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(password).toHaveAttribute("type", "password");
    const recovery = screen.getByRole("button", { name: "忘记密码" });
    expect(recovery).toHaveAttribute("aria-expanded", "false");
    await user.click(recovery);
    expect(recovery).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/忘记密码请联系/)).toBeInTheDocument();
  });

  it("does not offer teacher, student, or administrator role shortcuts", () => {
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );

    expect(container.querySelector(".or-login-roles")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "平台适用角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "教师" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "学生" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理员" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector(".or-login-error-slot")).toHaveAttribute("aria-hidden", "true");
  });

  it("mounts the animated login in splash before revealing the desktop card", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.startsWith("(prefers-reduced-motion") ? false : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );

    const root = container.querySelector<HTMLElement>(".or-login");
    const card = container.querySelector(".or-login-form.or-login-desktop-card");
    expect(root).toHaveAttribute("data-phase", "splash");
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("or-login-desktop-card");
  });

  it("keeps the full mapped network error in the reserved alert slot", async () => {
    mocks.loginPlatform.mockRejectedValueOnce(new Error("NetworkError"));
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );

    await user.type(field(container, 'input[autocomplete="username"]'), "admin");
    await user.type(field(container, 'input[autocomplete="current-password"]'), "secret123");
    await user.click(submitButton(container));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("暂时无法连接平台服务，请稍后重试或联系系统维护人员");
    const alertSlot = container.querySelector<HTMLElement>(".or-login-error-slot");
    const loginRoot = container.querySelector<HTMLElement>(".or-login");
    const form = container.querySelector<HTMLElement>(".or-login-form");
    if (!alertSlot || !loginRoot || !form) throw new Error("Missing login error slot or form");
    expect(alertSlot).toContainElement(alert);
    expect(loginRoot).toContainElement(alertSlot);
    expect(form).not.toContainElement(alertSlot);
  });

  it("shows form validation feedback for short passwords", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );

    await user.type(field(container, 'input[autocomplete="username"]'), "admin");
    await user.type(field(container, 'input[type="password"]'), "123");
    await user.click(submitButton(container));

    expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 6 位");
    expect(mocks.loginPlatform).not.toHaveBeenCalled();
  });

  it("trims the username, saves the returned session, and then authenticates", async () => {
    const authenticatedUser = {
      id: "teacher-1",
      username: "teacher",
      display_name: "教师",
      role: "teacher" as const,
      status: "active",
    };
    const order: string[] = [];
    mocks.loginPlatform.mockResolvedValueOnce({ token: "session-token", user: authenticatedUser });
    mocks.saveSessionToken.mockImplementation(() => order.push("save"));
    const onAuthenticated = vi.fn(() => order.push("authenticated"));
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={onAuthenticated} onError={vi.fn()} />,
    );

    await user.type(field(container, 'input[autocomplete="username"]'), "  teacher  ");
    await user.type(field(container, 'input[autocomplete="current-password"]'), "secret123");
    await user.click(submitButton(container));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(authenticatedUser));
    expect(mocks.loginPlatform).toHaveBeenCalledWith({ username: "teacher", password: "secret123" });
    expect(mocks.saveSessionToken).toHaveBeenCalledWith("session-token");
    expect(order).toEqual(["save", "authenticated"]);
  });

  it("keeps bootstrap on the shared form and submits the Chinese default display name", async () => {
    const admin = {
      id: "admin-1",
      username: "admin",
      display_name: "管理员",
      role: "admin" as const,
      status: "active",
    };
    mocks.bootstrapAdmin.mockResolvedValueOnce({ token: "admin-token", user: admin });
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="bootstrap" onAuthenticated={onAuthenticated} onError={vi.fn()} />,
    );

    expect(field(container, "#platform-login-username")).toHaveValue("admin");
    expect(field(container, "#platform-login-display-name")).toHaveValue("管理员");
    await user.type(field(container, 'input[autocomplete="new-password"]'), "secret123");
    await user.click(submitButton(container));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(admin));
    expect(mocks.bootstrapAdmin).toHaveBeenCalledWith({
      username: "admin",
      password: "secret123",
      display_name: "管理员",
    });
    expect(mocks.loginPlatform).not.toHaveBeenCalled();
    expect(mocks.saveSessionToken).toHaveBeenCalledWith("admin-token");
    expect(screen.queryByRole("list", { name: "平台适用角色" })).not.toBeInTheDocument();
  });

  it("prevents duplicate submissions while the platform request is pending", async () => {
    let resolveLogin!: (value: { token: string; user: { id: string; username: string; display_name: string; role: "teacher"; status: string } }) => void;
    mocks.loginPlatform.mockReturnValueOnce(new Promise((resolve) => { resolveLogin = resolve; }));
    const user = userEvent.setup();
    const { container } = render(
      <PlatformLogin mode="login" onAuthenticated={vi.fn()} onError={vi.fn()} />,
    );

    await user.type(field(container, 'input[autocomplete="username"]'), "teacher");
    await user.type(field(container, 'input[autocomplete="current-password"]'), "secret123");
    await user.click(submitButton(container));

    const submit = submitButton(container);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).toHaveAccessibleName("正在登录");
    await user.click(submit);
    expect(mocks.loginPlatform).toHaveBeenCalledTimes(1);

    resolveLogin({
      token: "session-token",
      user: { id: "teacher-1", username: "teacher", display_name: "教师", role: "teacher", status: "active" },
    });
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
