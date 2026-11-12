import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProvider } from "../../contexts/AgentContext";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { selectOption } from "../../test/selectOption";

const mocks = vi.hoisted(() => ({
  apiAgentLlmSettingsGet: vi.fn(),
  apiAgentSafetyModeGet: vi.fn(),
  apiAgentSafetyModePut: vi.fn(),
  getAccountProfile: vi.fn(),
  updateAccountCredentials: vi.fn(),
  updateAccountProfile: vi.fn(),
}));

vi.mock("../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../platform/auth")>();
  return {
    ...actual,
    getAccountProfile: mocks.getAccountProfile,
    updateAccountCredentials: mocks.updateAccountCredentials,
    updateAccountProfile: mocks.updateAccountProfile,
  };
});

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    apiAgentLlmSettingsGet: mocks.apiAgentLlmSettingsGet,
    apiAgentSafetyModeGet: mocks.apiAgentSafetyModeGet,
    apiAgentSafetyModePut: mocks.apiAgentSafetyModePut,
  };
});

vi.mock("../../components/settings/AgentModelSettingsForm", () => ({
  AgentModelSettingsForm: () => <div data-testid="model-settings-form" />,
}));

vi.mock("../../components/ExtensionsPanel", () => ({
  ExtensionsPanel: () => <div data-testid="extensions-panel" />,
}));

vi.mock("../log/LogWorkspace", () => ({
  LogWorkspace: () => <div data-testid="settings-log" />,
}));

function renderSettings(userRole: "admin" | "teacher", onError = vi.fn(), onProfileUpdated = vi.fn()) {
  return render(
    <AgentProvider>
      <SettingsWorkspace userRole={userRole} onError={onError} onProfileUpdated={onProfileUpdated} />
    </AgentProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("SettingsWorkspace role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.getAccountProfile.mockResolvedValue({ profile: { id: "t1", role: "teacher", username: "teacher", display_name: "教师", status: "active" } });
    mocks.updateAccountCredentials.mockResolvedValue({ user: { id: "t1", role: "teacher", username: "teacher", display_name: "教师", status: "active" } });
    mocks.updateAccountProfile.mockImplementation(async (payload) => ({
      profile: {
        id: "t1",
        role: "teacher",
        username: "teacher",
        display_name: "教师",
        status: "active",
        preferences: payload.preferences,
      },
    }));
    localStorage.clear();
    document.documentElement.removeAttribute("data-or-accent");
    document.documentElement.removeAttribute("data-or-login-accent");
  });

  it("hides model and extension configuration for teachers and keeps logs inside settings", async () => {
    renderSettings("teacher");

    expect(await screen.findByTestId("settings-log")).toBeInTheDocument();
    expect(screen.queryByTestId("extensions-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-settings-form")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.apiAgentLlmSettingsGet).not.toHaveBeenCalled());
  });

  it("keeps model configuration available to admins", async () => {
    renderSettings("admin");

    expect(await screen.findByTestId("model-settings-form")).toBeInTheDocument();
    expect(screen.getByTestId("settings-log")).toBeInTheDocument();
    expect(mocks.apiAgentLlmSettingsGet).toHaveBeenCalled();
  });

  it("lets a teacher change their own password", async () => {
    renderSettings("teacher");
    await userEvent.type(await screen.findByLabelText("当前密码"), "oldpass1");
    await userEvent.type(screen.getByLabelText("新密码"), "newpass2");
    await userEvent.type(screen.getByLabelText("确认新密码"), "newpass2");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    await waitFor(() => expect(mocks.updateAccountCredentials).toHaveBeenCalledWith({ current_password: "oldpass1", new_password: "newpass2" }));
  });

  it("loads density and saves the selected density to the account profile", async () => {
    mocks.getAccountProfile.mockResolvedValueOnce({
      profile: {
        id: "t1",
        role: "teacher",
        username: "teacher",
        display_name: "教师",
        status: "active",
        preferences: { density: "compact" },
      },
    });
    renderSettings("teacher");

    const density = await screen.findByLabelText("界面密度");
    await waitFor(() => expect(document.documentElement.dataset.ehDensity).toBe("compact"));
    expect(density).toHaveTextContent("紧凑");

    await selectOption(density, "comfortable");
    expect(density).toHaveTextContent("舒适");
    expect(screen.queryByRole("button", { name: "保存个性化设置" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ density: "comfortable" }),
    })));
    await waitFor(() => expect(document.documentElement.dataset.ehDensity).toBe("comfortable"));
  });

  it("saves black as the account and anonymous login accent", async () => {
    const profile = { id: "black-settings-test", role: "teacher" as const, username: "teacher", display_name: "教师", status: "active", preferences: {} };
    mocks.getAccountProfile.mockResolvedValueOnce({ profile });
    mocks.updateAccountProfile.mockResolvedValueOnce({ profile: { ...profile, preferences: { theme: "classic" } } });
    const user = userEvent.setup();
    renderSettings("teacher");

    await user.click(await screen.findByRole("radio", { name: "黑色" }));

    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ theme: "classic" }),
    })));
    expect(JSON.parse(localStorage.getItem("or-appearance:black-settings-test") || "null")).toEqual({ mode: "system", accent: "black" });
    expect(JSON.parse(localStorage.getItem("or-login-appearance") || "null")).toEqual({ mode: "system", accent: "black" });
    await waitFor(() => expect(document.documentElement.dataset.orLoginAccent).toBe("black"));
  });

  it("serializes appearance autosaves and does not let an old response revert the latest preview", async () => {
    const profile = {
      id: "appearance-race-settings-test",
      role: "teacher" as const,
      username: "teacher",
      display_name: "教师",
      status: "active",
      preferences: { theme: "classic", density: "comfortable", font_scale: 1 },
    };
    const first = deferred<{ profile: typeof profile }>();
    const second = deferred<{ profile: typeof profile }>();
    mocks.getAccountProfile.mockResolvedValueOnce({ profile });
    mocks.updateAccountProfile.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();
    const onProfileUpdated = vi.fn();
    renderSettings("teacher", vi.fn(), onProfileUpdated);

    await user.click(await screen.findByRole("radio", { name: "深色" }));
    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("radio", { name: "浅色" }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    const overlapping = mocks.updateAccountProfile.mock.calls.length > 1;
    if (overlapping) {
      await act(async () => {
        second.resolve({ profile: { ...profile, preferences: { ...profile.preferences, theme: "classic" } } });
      });
      await waitFor(() => expect(JSON.parse(localStorage.getItem(`or-appearance:${profile.id}`) || "null")).toEqual({ mode: "light", accent: "blue" }));
      await act(async () => {
        first.resolve({ profile: { ...profile, preferences: { ...profile.preferences, theme: "night" } } });
      });
    } else {
      await act(async () => {
        first.resolve({ profile: { ...profile, preferences: { ...profile.preferences, theme: "night" } } });
      });
      await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(2));
      expect(mocks.updateAccountProfile.mock.calls[1][0]).toEqual(expect.objectContaining({
        preferences: expect.objectContaining({ theme: "classic" }),
      }));
      await act(async () => {
        second.resolve({ profile: { ...profile, preferences: { ...profile.preferences, theme: "classic" } } });
      });
    }

    expect(overlapping).toBe(false);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(`or-appearance:${profile.id}`) || "null")).toEqual({ mode: "light", accent: "blue" });
      expect(JSON.parse(localStorage.getItem("or-login-appearance") || "null")).toEqual({ mode: "light", accent: "blue" });
      expect(document.documentElement.dataset.ehTheme).toBe("classic");
    });
    expect(onProfileUpdated).toHaveBeenCalledTimes(1);
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ preferences: expect.objectContaining({ theme: "classic" }) }));
  });

  it("retries a failed autosave when leaving settings with unsaved changes", async () => {
    const onError = vi.fn();
    mocks.updateAccountProfile.mockRejectedValueOnce(new Error("暂时无法保存"));
    const { unmount } = renderSettings("teacher", onError);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: "深色" }));
    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("暂时无法保存"));

    unmount();

    await waitFor(() => expect(mocks.updateAccountProfile).toHaveBeenCalledTimes(2));
    expect(mocks.updateAccountProfile.mock.calls[1][0]).toEqual(expect.objectContaining({
      preferences: expect.objectContaining({ theme: "night" }),
    }));
  });
});
