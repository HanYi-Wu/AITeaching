import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformLogin } from "../PlatformLogin";

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
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password");
    expect(onError).toHaveBeenCalledWith("Invalid username or password");
    expect(onAuthenticated).not.toHaveBeenCalled();
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
});
