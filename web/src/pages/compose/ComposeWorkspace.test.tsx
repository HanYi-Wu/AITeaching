import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { ComposeWorkspace } from "./ComposeWorkspace";
import type { TemplateRow } from "../../types/compose";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), onError: vi.fn(), setPageContext: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/client")>(), apiGet: mocks.apiGet, apiPost: mocks.apiPost }));
vi.mock("../../contexts/AgentContext", () => ({ useAgentContext: () => ({ setPageContext: mocks.setPageContext }) }));
vi.mock("../../components/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../platform/auth")>(),
  listContentFolders: async () => ({ folders: [] }), listFolderItems: async () => ({ items: {} }), listTaggedItems: async () => ({ items: {} }),
}));

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

const template = (id: string): TemplateRow => ({ id, path: `templates/${id}.yaml`, layout: "single_column", sections: [{ section_id: "选择", type: "single_choice", required_count: 1, score_per_item: 5 }] });
let templates: TemplateRow[];

function renderWorkspace() {
  return render(<TestI18nProvider><ToolBarProvider><Toolbar /><ComposeWorkspace onError={mocks.onError} /></ToolBarProvider></TestI18nProvider>);
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^新建试卷$/ }));
  return user;
}

describe("new paper template selection", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks();
    templates = [template("original")];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates };
      if (path === "/api/questions") return { questions: [] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: [] };
      return {};
    });
    mocks.apiPost.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ exam: { ...body, exam_id: "期中/数学" } }));
  });

  it("refreshes deleted or renamed templates before opening a new paper", async () => {
    renderWorkspace();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/templates"));
    templates = [template("replacement")];
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveValue("templates/replacement.yaml");
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/replacement.yaml", auto_rename: true })));
    expect(mocks.onError).not.toHaveBeenCalledWith("请先选择模板后再保存草稿");
  });

  it("submits the same template shown after the library changes while the dialog is open", async () => {
    renderWorkspace();
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveValue("templates/original.yaml");
    templates = [template("current")];
    act(() => notifyContentLibraryChanged("template"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模板" })).toHaveValue("templates/current.yaml"));
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/current.yaml" })));
  });

  it("can create a paper after the first template is added to an initially empty library", async () => {
    templates = [];
    renderWorkspace();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/templates"));
    templates = [template("first")];
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveValue("templates/first.yaml");
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/first.yaml" })));
  });

  it("keeps the current template when an older library request finishes late", async () => {
    let finishOld!: (value: { templates: TemplateRow[] }) => void;
    const oldRequest = new Promise<{ templates: TemplateRow[] }>((resolve) => { finishOld = resolve; });
    const normalGet = mocks.apiGet.getMockImplementation()!;
    let templateRequests = 0;
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/api/templates" && ++templateRequests === 1) return oldRequest;
      return normalGet(path);
    });
    renderWorkspace();
    await waitFor(() => expect(templateRequests).toBe(1));
    templates = [template("latest")];
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveValue("templates/latest.yaml");
    await act(async () => { finishOld({ templates: [template("outdated")] }); });
    expect(screen.getByRole("combobox", { name: "模板" })).toHaveValue("templates/latest.yaml");
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/latest.yaml" })));
  });
});
