import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProvider } from "../../contexts/AgentContext";
import { SettingsWorkspace } from "../SettingsWorkspace";

const mocks = vi.hoisted(() => ({
  apiAgentLlmSettingsGet: vi.fn(),
  apiAgentSafetyModeGet: vi.fn(),
  apiAgentSafetyModePut: vi.fn(),
}));

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

vi.mock("../LogWorkspace", () => ({
  LogWorkspace: () => <div data-testid="settings-log" />,
}));

function renderSettings(userRole: "admin" | "teacher") {
  return render(
    <AgentProvider>
      <SettingsWorkspace userRole={userRole} onError={vi.fn()} />
    </AgentProvider>,
  );
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
  });

  it("hides model configuration for teachers and keeps logs inside settings", async () => {
    renderSettings("teacher");

    expect(await screen.findByTestId("extensions-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("model-settings-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-log")).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiAgentLlmSettingsGet).not.toHaveBeenCalled());
  });

  it("keeps model configuration available to admins", async () => {
    renderSettings("admin");

    expect(await screen.findByTestId("model-settings-form")).toBeInTheDocument();
    expect(screen.getByTestId("settings-log")).toBeInTheDocument();
    expect(mocks.apiAgentLlmSettingsGet).toHaveBeenCalled();
  });
});
