import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemExtensionStatus } from "../api/client";
import { setupTestI18n, TestI18nProvider } from "../test/i18nTestUtils";
import { ExtensionsPanel } from "./ExtensionsPanel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  install: vi.fn(),
  ensure: vi.fn(),
  confirm: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    ensureApiBase: mocks.ensure,
    apiSystemExtensions: mocks.list,
    apiSystemExtensionInstall: mocks.install,
  };
});

vi.mock("../lib/confirmDialog", () => ({ confirmDialog: mocks.confirm }));

function extension(overrides: Partial<SystemExtensionStatus>): SystemExtensionStatus {
  return {
    id: "pandoc",
    name: "文档转换",
    description: "转换文档",
    download_url: "https://example.invalid",
    install_hint: null,
    executables: [{ name: "pandoc", on_path: false, path: null, version: null }],
    ready: false,
    can_auto_install: false,
    platform: "linux",
    winget_on_path: null,
    has_manual_paths: false,
    ...overrides,
  };
}

describe("ExtensionsPanel", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.copy },
    });
  });

  it("copies Linux package-manager guidance instead of pretending to auto-install", async () => {
    const command = "sudo apt-get install -y pandoc";
    mocks.list.mockResolvedValue({
      extensions: [extension({ install_mode: "command", install_command: command })],
    });

    render(<TestI18nProvider><ExtensionsPanel onError={vi.fn()} /></TestI18nProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "复制安装命令" }));

    expect(mocks.copy).toHaveBeenCalledWith(command);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(await screen.findByText("命令已复制，请在 Linux 终端执行后重新检测。")) .toBeInTheDocument();
  });

  it("requires explicit confirmation before launching winget", async () => {
    mocks.list.mockResolvedValue({
      extensions: [extension({
        platform: "win32",
        can_auto_install: true,
        install_mode: "winget",
        requires_confirmation: true,
      })],
    });
    mocks.install.mockResolvedValue({ ok: true, action: "launched", message: "已打开安装窗口" });

    render(<TestI18nProvider><ExtensionsPanel onError={vi.fn()} /></TestI18nProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "开始安装" }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.install).toHaveBeenCalledWith("pandoc");
  });

  it("explains how to enable Windows installation when winget is missing", async () => {
    mocks.list.mockResolvedValue({
      extensions: [extension({
        platform: "win32",
        winget_on_path: false,
        can_auto_install: false,
        install_mode: "manual",
      })],
    });

    render(<TestI18nProvider><ExtensionsPanel onError={vi.fn()} /></TestI18nProvider>);

    expect(await screen.findByText(/未检测到 Windows 系统安装器/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "获取 Windows 系统安装器" })).toBeInTheDocument();
  });
});
