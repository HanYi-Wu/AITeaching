import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminWorkspace } from "../AdminWorkspace";

const mocks = vi.hoisted(() => ({
  listSchools: vi.fn(),
  createSchool: vi.fn(),
  createSchoolUser: vi.fn(),
  apiAgentLlmSettingsGet: vi.fn(),
  apiAgentSafetyModeGet: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    listSchools: mocks.listSchools,
    createSchool: mocks.createSchool,
    createSchoolUser: mocks.createSchoolUser,
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

describe("AdminWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSchools.mockResolvedValue({ schools: [] });
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
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onOpenTeacherWorkspace={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("admin-model-settings-form")).toBeInTheDocument();
    expect(screen.getByTestId("admin-extensions-panel")).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiAgentLlmSettingsGet).toHaveBeenCalled());
  });
});
