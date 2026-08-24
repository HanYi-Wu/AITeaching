import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const user = userEvent.setup();
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "学校管理" });
    expect(screen.queryByTestId("admin-model-settings-form")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "平台 AI" }));
    expect(await screen.findByTestId("admin-model-settings-form")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "扩展组件" }));
    expect(screen.getByTestId("admin-extensions-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "教师端" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.apiAgentLlmSettingsGet).toHaveBeenCalled());
  });

  it("uses full-width section navigation instead of a fixed right sidebar", async () => {
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const navigation = await screen.findByRole("tablist", { name: "管理员工作区" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "学校与账号" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("admin-workspace-content")).not.toHaveClass("xl:grid-cols-[minmax(0,1fr)_440px]");
  });

  it("guides a first-time administrator to create a school and its account", async () => {
    render(
      <AdminWorkspace
        user={{ id: "admin1", role: "admin", username: "admin", display_name: "Admin", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建第一所学校" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建学校端账号" })).toBeInTheDocument();
  });
});
