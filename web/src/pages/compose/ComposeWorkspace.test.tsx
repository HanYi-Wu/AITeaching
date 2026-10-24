import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { ComposeWorkspace } from "./ComposeWorkspace";
import type { TemplateRow } from "../../types/compose";
import { ApiError } from "../../api/client";
import { buildComposeDraftStorageKey } from "./composeDraftStorage";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), download: vi.fn(), onError: vi.fn(), setPageContext: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/client")>(), apiGet: mocks.apiGet, apiPost: mocks.apiPost }));
vi.mock("../../contexts/AgentContext", () => ({ useAgentContext: () => ({ setPageContext: mocks.setPageContext }) }));
vi.mock("../../components/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("./composeHelpers", async (original) => ({ ...await original<typeof import("./composeHelpers")>(), downloadExportedBundle: mocks.download }));
vi.mock("../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../platform/auth")>(),
  listContentFolders: async () => ({ folders: [] }), listFolderItems: async () => ({ items: {} }), listTaggedItems: async () => ({ items: {} }),
  syncPlatformPaperFromExam: async () => ({}),
}));

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

const template = (id: string): TemplateRow => ({ id, path: `templates/${id}.yaml`, layout: "single_column", sections: [{ section_id: "选择", type: "single_choice", required_count: 1, score_per_item: 5 }] });
let templates: TemplateRow[];

function renderWorkspace(props: Partial<ComponentProps<typeof ComposeWorkspace>> = {}) {
  return render(<TestI18nProvider><ToolBarProvider><Toolbar /><ComposeWorkspace onError={mocks.onError} {...props} /></ToolBarProvider></TestI18nProvider>);
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
    localStorage.clear();
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

describe("export result integration", () => {
  const examId = "Quiz/数学";
  const cacheKey = buildComposeDraftStorageKey({ accountId: "teacher", projectRoot: "C:/project", paperKey: `exam:${examId}` });
  const doc = () => ({ exam_id: examId, name: "Quiz", export_label: "Quiz", subject: "数学", template_ref: "original", template_path: "templates/original.yaml", selected_items: [{ section_id: "选择", question_ids: ["math/q1"] }] });
  const completed = (format: "pdf" | "docx", status = "succeeded") => ({ id: "export-task", format, status, attempt: 1, created_at: "now", updated_at: "now", result: status === "succeeded" ? { exam_dir: `exams/${examId}`, [`student_${format}`]: `student.${format}`, [`teacher_${format}`]: `teacher.${format}` } : null, error: status === "failed" ? { status: 500, detail: { message: "Compile failed", exam_saved: { exam_id: "Recovery/数学", name: "恢复草稿" } } } : null });

  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); mocks.download.mockResolvedValue(undefined);
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates: [template("original")] };
      if (path === "/api/questions") return { questions: [{ id: "q1", qualified_id: "math/q1", namespace: "math", subject: "数学", type: "single_choice", answer: "A", content_preview: "Question", content: "Question", analysis: "" }] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: [] };
      if (path.startsWith("/api/exams/")) return { exam: doc() };
      if (path.startsWith("/api/exam/export-tasks?")) return { tasks: [] };
      if (path.startsWith("/api/exam/export-tasks/")) return completed("pdf");
      return {};
    });
  });

  async function loadedWorkspace() {
    const mounted = renderWorkspace({ accountId: "teacher", projectRoot: "C:/project", openExamId: examId });
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "每题分值" })).toHaveValue(5));
    fireEvent.change(screen.getByRole("spinbutton", { name: "每题分值" }), { target: { value: "6" } });
    await waitFor(() => expect(localStorage.getItem(cacheKey)).toContain('"scoreBySection":{"选择":6}'));
    await userEvent.click(screen.getByText("导出 ▾"));
    return mounted;
  }

  it.each([{ format: "pdf" as const, legacy: false }, { format: "docx" as const, legacy: false }, { format: "pdf" as const, legacy: true }, { format: "docx" as const, legacy: true }])("clears a successfully saved local baseline for $format, legacy=$legacy", async ({ format, legacy }) => {
    mocks.apiPost.mockImplementation(async (path: string) => {
      if (path.endsWith("check-conflict")) return { conflict: false };
      if (path === "/api/exam/export-tasks") { if (legacy) throw new ApiError("Missing", 404); return completed(format); }
      return completed(format).result;
    });
    await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: format === "pdf" ? "导出 PDF" : "导出 Word" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(examId, format));
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(screen.queryByTestId("compose-draft-recovery-banner")).not.toBeInTheDocument();
  });

  it("refreshes the sidebar and reports a recovery draft when an async export fails", async () => {
    let submissions = 0;
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : completed("pdf", ++submissions === 1 ? "failed" : "succeeded"));
    await loadedWorkspace();
    const before = mocks.apiGet.mock.calls.filter(([path]) => path === "/api/exams").length;
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.onError).toHaveBeenCalledWith("Compile failed（已保存为草稿「恢复草稿」）"));
    expect(mocks.apiGet.mock.calls.filter(([path]) => path === "/api/exams").length).toBeGreaterThan(before);
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exam/export-tasks", expect.objectContaining({ exam_ids_to_delete_on_success: ["Recovery/数学"] })));
  });

  it("retains newer edits and their recovery cache when an earlier export completes", async () => {
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : completed("pdf", "running"));
    await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "每题分值" }), { target: { value: "7" } });
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(examId, "pdf"));
    expect(screen.getByRole("spinbutton", { name: "每题分值" })).toHaveValue(7);
    expect(localStorage.getItem(cacheKey)).toContain('"scoreBySection":{"选择":7}');
  });
});
