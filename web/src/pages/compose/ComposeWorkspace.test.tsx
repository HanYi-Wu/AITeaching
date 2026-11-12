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
import { selectOption } from "../../test/selectOption";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), download: vi.fn(), sync: vi.fn(), onError: vi.fn(), setPageContext: vi.fn(), listContentFolders: vi.fn(), moveContentItemsToFolder: vi.fn(), listClasses: vi.fn(), listPracticeHistory: vi.fn(), getProfile: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/client")>(), apiGet: mocks.apiGet, apiPost: mocks.apiPost }));
vi.mock("../../contexts/AgentContext", () => ({ useAgentActions: () => ({ setPageContext: mocks.setPageContext }) }));
vi.mock("../../components/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("./composeHelpers", async (original) => ({ ...await original<typeof import("./composeHelpers")>(), downloadExportedBundle: mocks.download }));
vi.mock("../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../platform/auth")>(),
  listContentFolders: mocks.listContentFolders, listFolderItems: async () => ({ items: {} }), listTaggedItems: async () => ({ items: {} }),
  listTeacherAssignedClasses: mocks.listClasses, listClassPracticeHistory: mocks.listPracticeHistory, getAccountProfile: mocks.getProfile,
  moveContentItemsToFolder: mocks.moveContentItemsToFolder,
  syncPlatformPaperFromExam: mocks.sync,
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
    localStorage.clear(); sessionStorage.clear();
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
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveTextContent("replacement");
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/replacement.yaml", auto_rename: true })));
    expect(mocks.onError).not.toHaveBeenCalledWith("请先选择模板后再保存草稿");
  });

  it("submits the same template shown after the library changes while the dialog is open", async () => {
    renderWorkspace();
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveTextContent("original");
    templates = [template("current")];
    act(() => notifyContentLibraryChanged("template"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "模板" })).toHaveTextContent("current"));
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/current.yaml" })));
  });

  it("can create a paper after the first template is added to an initially empty library", async () => {
    templates = [];
    renderWorkspace();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/templates"));
    templates = [template("first")];
    const user = await openDialog();
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveTextContent("first");
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
    expect(await screen.findByRole("combobox", { name: "模板" })).toHaveTextContent("latest");
    await act(async () => { finishOld({ templates: [template("outdated")] }); });
    expect(screen.getByRole("combobox", { name: "模板" })).toHaveTextContent("latest");
    await user.click(screen.getByRole("button", { name: "创建并进入编辑" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ template_path: "templates/latest.yaml" })));
  });

  it("marks an empty paper as not publishable while keeping history practice available", async () => {
    templates = [];
    mocks.listClasses.mockResolvedValue({ classes: [{ id: "class-1", name: "演示一班" }] });
    mocks.listPracticeHistory.mockResolvedValue({ publications: [] });
    mocks.getProfile.mockResolvedValue({ profile: { id: "teacher-a", subjects: ["数学"] } });
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "folder-1", kind: "category", name: "试卷" }] });
    renderWorkspace();

    const missingTemplate = await screen.findByText("未找到试卷模板文件，请将模板放入内容目录的 templates/ 目录。");
    expect(missingTemplate.closest('[role="status"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "当前小节（加入题目目标）：" }));
    expect(await screen.findByRole("option", { name: "暂无可选小节" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector("[data-or-select-content]")).not.toBeInTheDocument());
    await userEvent.click(screen.getByText("导出 ▾"));
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 Word" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "发布历史练习" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "当前试卷" })).toBeDisabled();
    expect(screen.getByText(/历史错题卷和专项巩固卷仍可选择/)).toBeInTheDocument();

    const classCheckbox = screen.getAllByRole("checkbox").find((input) =>
      input.closest("label")?.textContent?.includes("演示一班"),
    );
    expect(classCheckbox).toBeDefined();
    await userEvent.click(classCheckbox!);
    expect(screen.getByRole("radio", { name: "历史错题卷" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "专项巩固卷" })).toBeEnabled();
  });
});

describe("export result integration", () => {
  const examId = "Quiz/数学";
  const cacheKey = buildComposeDraftStorageKey({ accountId: "teacher", projectRoot: "C:/project", paperKey: `exam:${examId}` });
  const doc = () => ({ exam_id: examId, name: "Quiz", export_label: "Quiz", subject: "数学", template_ref: "original", template_path: "templates/original.yaml", selected_items: [{ section_id: "选择", question_ids: ["math/q1"] }] });
  const completed = (format: "pdf" | "docx", status = "succeeded") => ({ id: "export-task", exam_workspace_id: examId, export_label: "Quiz", subject: "数学", format, status, attempt: 1, created_at: "now", updated_at: "now", result: status === "succeeded" ? { exam_dir: `exams/${examId}`, [`student_${format}`]: `student.${format}`, [`teacher_${format}`]: `teacher.${format}` } : null, error: status === "failed" ? { status: 500, detail: { message: "Compile failed", exam_saved: { exam_id: "Recovery/数学", name: "恢复草稿" } } } : null });

  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); mocks.download.mockResolvedValue(undefined); mocks.sync.mockResolvedValue({});
    mocks.listContentFolders.mockResolvedValue({ folders: [] });
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

  it("keeps the mounted bank list unchanged while typing, then commits search and selection normally", async () => {
    const questionRows = [1, 2, 3].map((id) => ({
      id: `q${id}`,
      qualified_id: `数学/main/q${id}`,
      namespace: "main",
      collection: "main",
      subject: "数学",
      type: "single_choice",
      answer: "A",
      content_preview: `题目 ${id}：求 $x_{${id}}+1$ 的值`,
      content: `题目 ${id}：求 $x_{${id}}+1$ 的值`,
      analysis: "",
      metadata: {},
    }));
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) =>
      path === "/api/questions" ? { questions: questionRows } : normalGet(path),
    );
    const mounted = renderWorkspace();
    const getVisibleQuestionIds = () =>
      Array.from(mounted.container.querySelectorAll<HTMLSpanElement>('button[draggable="true"] span[data-question-id]'))
        .map((span) => span.getAttribute("data-question-id"));
    const getQuestionButton = (qid: string) =>
      Array.from(mounted.container.querySelectorAll<HTMLSpanElement>('button[draggable="true"] span[data-question-id]'))
        .find((span) => span.getAttribute("data-question-id") === qid)?.closest("button") ?? null;

    await waitFor(() => expect(getVisibleQuestionIds()).toEqual(questionRows.map((question) => question.qualified_id)));
    await userEvent.click(screen.getByRole("button", { name: /筛选/ }));
    const searchInput = await screen.findByPlaceholderText("id / 题干摘要…");
    await userEvent.click(searchInput);
    expect(searchInput).toHaveFocus();
    fireEvent.change(searchInput, { target: { value: "题目 2" } });
    expect(getVisibleQuestionIds()).toEqual(questionRows.map((question) => question.qualified_id));

    fireEvent.keyDown(searchInput, { key: "Enter", code: "Enter", keyCode: 229 });
    expect(getVisibleQuestionIds()).toEqual(questionRows.map((question) => question.qualified_id));
    expect(searchInput).toHaveFocus();

    fireEvent.keyDown(searchInput, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(getVisibleQuestionIds()).toEqual(["数学/main/q2"]));
    expect(searchInput).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "查看结果" }));
    await userEvent.click(screen.getByRole("button", { name: /筛选/ }));
    const reopenedSearchInput = await screen.findByPlaceholderText("id / 题干摘要…");
    expect(reopenedSearchInput).toHaveValue("题目 2");
    await userEvent.click(reopenedSearchInput);
    expect(reopenedSearchInput).toHaveFocus();

    fireEvent.change(reopenedSearchInput, { target: { value: "" } });
    fireEvent.keyDown(reopenedSearchInput, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(getVisibleQuestionIds()).toEqual(questionRows.map((question) => question.qualified_id)));
    await userEvent.click(screen.getByRole("button", { name: "查看结果" }));

    const q2Button = getQuestionButton("数学/main/q2");
    const q3Button = getQuestionButton("数学/main/q3");
    expect(q2Button).not.toBeNull();
    expect(q3Button).not.toBeNull();
    await userEvent.click(q2Button!);
    await waitFor(() => expect(getQuestionButton("数学/main/q2")).toHaveClass("border-[var(--or-primary)]"));
    fireEvent.click(q3Button!, { ctrlKey: true });
    await waitFor(() => expect(getQuestionButton("数学/main/q3")).toHaveClass("border-[var(--or-primary)]"));
    expect(getQuestionButton("数学/main/q2")).toHaveClass("border-[var(--or-primary)]");
    expect(getQuestionButton("数学/main/q3")).toHaveClass("border-[var(--or-primary)]");
    expect(getQuestionButton("数学/main/q1")).not.toHaveClass("border-[var(--or-primary)]");
  });

  it("selects compose history items, drags the selected group, and applies a successful batch move", async () => {
    const summaries = [
      { exam_id: "Draft/Math", name: "Draft math", status: "draft" },
      { exam_id: "Quiz/Science", name: "Science quiz", status: "exported" },
    ];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates };
      if (path === "/api/questions") return { questions: [] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: summaries };
      return {};
    });
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "compose-folder", owner_teacher_id: "teacher-a", scope: "compose", parent_id: null, kind: "category", name: "已归档" }] });
    mocks.moveContentItemsToFolder.mockResolvedValue({ ok: true, moved_count: 2 });
    renderWorkspace({ accountId: "teacher-a", projectRoot: "C:/project-a" });
    await userEvent.click(await screen.findByRole("button", { name: "历史" }));

    const draftCheckbox = await screen.findByRole("checkbox", { name: "选择草稿 Draft math" });
    const exportedCheckbox = await screen.findByRole("checkbox", { name: "选择试卷 Science quiz" });
    await userEvent.click(screen.getByRole("checkbox", { name: "全选当前可见" }));
    expect(draftCheckbox).toBeChecked();
    expect(exportedCheckbox).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect(draftCheckbox).not.toBeChecked();
    expect(exportedCheckbox).not.toBeChecked();
    await userEvent.click(draftCheckbox);
    await userEvent.click(exportedCheckbox);

    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: /Draft math/ }), { dataTransfer: { setData } as unknown as DataTransfer });
    expect(setData).toHaveBeenCalledWith("application/x-or-content-items", JSON.stringify({ scope: "compose", ids: ["Draft/Math", "Quiz/Science"] }));
    expect(setData).toHaveBeenCalledWith("application/x-or-content-item", JSON.stringify({ scope: "compose", id: "Draft/Math" }));

    await selectOption(screen.getByRole("combobox", { name: "批量移动到文件夹" }), "compose-folder");
    await userEvent.click(screen.getByRole("button", { name: "移动所选" }));
    await waitFor(() => expect(mocks.moveContentItemsToFolder).toHaveBeenCalledWith("compose", ["Draft/Math", "Quiz/Science"], "compose-folder"));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择草稿 Draft math" })).not.toBeChecked());
    await userEvent.click(screen.getByTitle("已归档 · 归类文件夹"));
    expect(await screen.findByRole("checkbox", { name: "选择草稿 Draft math" })).not.toBeChecked();
  });

  it("keeps compose selection after a failed batch move", async () => {
    const summaries = [{ exam_id: "Draft/Math", name: "Draft math", status: "draft" }];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates };
      if (path === "/api/questions") return { questions: [] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: summaries };
      return {};
    });
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "compose-folder", owner_teacher_id: "teacher-a", scope: "compose", parent_id: null, kind: "category", name: "已归档" }] });
    mocks.moveContentItemsToFolder.mockRejectedValue(new Error("move rejected"));
    renderWorkspace({ accountId: "teacher-a", projectRoot: "C:/project-a" });
    await userEvent.click(await screen.findByRole("button", { name: "历史" }));

    const checkbox = await screen.findByRole("checkbox", { name: "选择草稿 Draft math" });
    await userEvent.click(checkbox);
    await selectOption(screen.getByRole("combobox", { name: "批量移动到文件夹" }), "compose-folder");
    await userEvent.click(screen.getByRole("button", { name: "移动所选" }));

    await waitFor(() => expect(mocks.onError).toHaveBeenCalledWith("move rejected"));
    expect(screen.getByRole("checkbox", { name: "选择草稿 Draft math" })).toBeChecked();
    await userEvent.click(screen.getByTitle("已归档 · 归类文件夹"));
    expect(screen.queryByRole("checkbox", { name: "选择草稿 Draft math" })).not.toBeInTheDocument();
  });

  async function loadedWorkspace() {
    const mounted = renderWorkspace({ accountId: "teacher", projectRoot: "C:/project", openExamId: examId });
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "每题分值" })).toHaveValue(5));
    fireEvent.change(screen.getByRole("spinbutton", { name: "每题分值" }), { target: { value: "6" } });
    await waitFor(() => expect(localStorage.getItem(cacheKey)).toContain('"scoreBySection":{"选择":6}'));
    await userEvent.click(screen.getByText("导出 ▾"));
    return mounted;
  }

  it("offers a fresh conflict check after an offline preflight and removes the old success banner", async () => {
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => path.startsWith("/api/exam/export-tasks?") ? { tasks: [completed("docx")] } : normalGet(path));
    let checks = 0;
    mocks.apiPost.mockImplementation(async (path: string) => {
      if (path === "/api/exam/export/check-conflict") {
        if (++checks === 1) throw new TypeError("Network offline");
        return { conflict: false, existing_exam_id: null };
      }
      return { ...completed("pdf"), id: "fresh-export" };
    });
    await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    const retry = await screen.findByRole("button", { name: "重新检查并导出" });
    expect(screen.queryByText(/历史导出任务已完成/)).not.toBeInTheDocument();
    expect(mocks.apiPost.mock.calls.filter(([path]) => path === "/api/exam/export-tasks")).toHaveLength(0);
    await userEvent.click(retry);
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(examId, "pdf"));
    expect(mocks.apiPost.mock.calls.filter(([path]) => path === "/api/exam/export-tasks")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "重新检查并导出" })).not.toBeInTheDocument();
  });

  it("refreshes knowledge bindings on return without losing edits or accepting an older response", async () => {
    const normalGet = mocks.apiGet.getMockImplementation()!;
    let finishOld!: (value: { index: Record<string, { id: string; canonical_name: string; node_kind: string }[]> }) => void;
    const oldRequest = new Promise<{ index: Record<string, { id: string; canonical_name: string; node_kind: string }[]> }>((resolve) => { finishOld = resolve; });
    let requests = 0;
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/api/graph/question-bindings-index") {
        return ++requests === 1 ? oldRequest : Promise.resolve({ index: { "math/q1": [{ id: "addition", canonical_name: "基础加法", node_kind: "knowledge_point" }] } });
      }
      return normalGet(path);
    });
    const mounted = await loadedWorkspace();
    const workspace = (active: boolean) => <TestI18nProvider><ToolBarProvider><Toolbar /><ComposeWorkspace onError={mocks.onError} accountId="teacher" projectRoot="C:/project" openExamId={examId} toolBarActive={active} /></ToolBarProvider></TestI18nProvider>;
    mounted.rerender(workspace(false));
    mounted.rerender(workspace(true));
    await screen.findByText("基础加法");
    expect(screen.getByRole("spinbutton", { name: "每题分值" })).toHaveValue(6);
    await act(async () => { finishOld({ index: { "math/q1": [{ id: "stale", canonical_name: "过期关联", node_kind: "knowledge_point" }] } }); });
    expect(screen.getByText("基础加法")).toBeInTheDocument();
    expect(screen.queryByText("过期关联")).not.toBeInTheDocument();
    expect(localStorage.getItem(cacheKey)).toContain('"scoreBySection":{"选择":6}');
  });

  it.each(["pdf", "docx"] as const)("closes the export menu when choosing %s and submits that format", async (format) => {
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : completed(format));
    await loadedWorkspace();
    expect(screen.getByText("导出 ▾").closest("details")).toHaveAttribute("open");
    await userEvent.click(screen.getByRole("button", { name: format === "pdf" ? "导出 PDF" : "导出 Word" }));
    expect(screen.getByText("导出 ▾").closest("details")).not.toHaveAttribute("open");
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exam/export-tasks", expect.objectContaining({ format })));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(examId, format));
  });

  it.each(["pdf", "docx"] as const)("keeps a completed %s export available when the browser receives no download content", async (format) => {
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : completed(format));
    mocks.download.mockRejectedValueOnce(new Error("未收到文件内容"));
    await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: format === "pdf" ? "导出 PDF" : "导出 Word" }));
    await screen.findByText(/文件已保存在服务器，但浏览器下载失败：未收到文件内容/);
    expect(screen.getByTestId("compose-export-task-banner")).toHaveAttribute("data-task-status", "succeeded");
    expect(screen.queryByRole("button", { name: "重试导出" })).not.toBeInTheDocument();
    expect(mocks.apiPost.mock.calls.filter(([path]) => path === "/api/exam/export-tasks")).toHaveLength(1);
  });

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
    await userEvent.click(screen.getByText("导出 ▾"));
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

  it("does not add a replayed failure draft to a new export's cleanup request", async () => {
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => path.startsWith("/api/exam/export-tasks?") ? { tasks: [completed("pdf", "failed")] } : normalGet(path));
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : completed("pdf"));
    await loadedWorkspace();
    await waitFor(() => expect(mocks.onError).toHaveBeenCalledWith("Compile failed（已保存为草稿「恢复草稿」）"));
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalled());
    const payload = mocks.apiPost.mock.calls.find(([path]) => path === "/api/exam/export-tasks")![1];
    expect(payload.exam_ids_to_delete_on_success).toBeUndefined();
  });

  it("clears a live failure's cleanup IDs when switching papers with a nonempty task list", async () => {
    const failed = completed("pdf", "failed"), otherId = "Other/数学";
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/api/exam/export-tasks?")) return { tasks: [failed] };
      if (path === `/api/exams/${encodeURIComponent(otherId)}`) return { exam: { ...doc(), exam_id: otherId, export_label: "Other" } };
      return normalGet(path);
    });
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : failed);
    const mounted = await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exam/export-tasks", expect.anything()));
    mounted.rerender(<TestI18nProvider><ToolBarProvider><Toolbar /><ComposeWorkspace onError={mocks.onError} accountId="teacher" projectRoot="C:/project" openExamId={otherId} /></ToolBarProvider></TestI18nProvider>);
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith(`/api/exams/${encodeURIComponent(otherId)}`));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试导出" })).not.toBeInTheDocument());
    mocks.apiPost.mockClear();
    mocks.apiPost.mockImplementation(async (path: string) => path.endsWith("check-conflict") ? { conflict: false } : { ...completed("pdf"), exam_workspace_id: otherId, result: { exam_dir: `exams/${otherId}` } });
    await userEvent.click(screen.getByText("导出 ▾"));
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(otherId, "pdf"));
    const payload = mocks.apiPost.mock.calls.find(([path]) => path === "/api/exam/export-tasks")![1];
    expect(payload.exam_workspace_id).toBe(otherId);
    expect(payload.exam_ids_to_delete_on_success).toBeUndefined();
  });

  it("detaches a removed open workspace before the next save on an older server", async () => {
    mocks.apiPost.mockImplementation(async (path: string) => {
      if (path.endsWith("check-conflict")) return { conflict: false };
      if (path === "/api/exams") return { exam: doc() };
      const result = completed("pdf");
      return { ...result, result: { ...result.result, deleted_exam_ids: [examId] } };
    });
    await loadedWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "保存更改" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exams", expect.objectContaining({ export_label: "Quiz" })));
  });

  it.each(["pdf", "docx"] as const)("opening a historical %s success keeps local recovery and does not download or sync again", async (format) => {
    const first = await loadedWorkspace();
    first.unmount();
    const before = localStorage.getItem(cacheKey);
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => path.startsWith("/api/exam/export-tasks?") ? { tasks: [completed(format)] } : normalGet(path));
    renderWorkspace({ accountId: "teacher", projectRoot: "C:/project", openExamId: examId });
    await waitFor(() => expect(screen.getByTestId("compose-export-task-banner")).toHaveAttribute("data-task-status", "succeeded"));
    await act(async () => { await Promise.resolve(); });
    expect(localStorage.getItem(cacheKey)).toBe(before);
    expect(screen.getByTestId("compose-draft-recovery-banner")).toBeInTheDocument();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("does not replay a historical success matching the default scratch paper", async () => {
    const normalGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => path.startsWith("/api/exam/export-tasks?") ? { tasks: [{ ...completed("pdf"), exam_workspace_id: null, export_label: "期中考试" }] } : normalGet(path));
    renderWorkspace({ accountId: "teacher", projectRoot: "C:/project" });
    await waitFor(() => expect(screen.getByTestId("compose-export-task-banner")).toHaveAttribute("data-task-status", "succeeded"));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("keeps the recovery choice when a running task restored after refresh completes", async () => {
    const first = await loadedWorkspace();
    first.unmount();
    const before = localStorage.getItem(cacheKey);
    const normalGet = mocks.apiGet.getMockImplementation()!;
    let finishTask!: (value: ReturnType<typeof completed>) => void;
    const pending = new Promise<ReturnType<typeof completed>>((resolve) => { finishTask = resolve; });
    mocks.apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/api/exam/export-tasks?")) return { tasks: [completed("pdf", "running")] };
      if (path.startsWith("/api/exam/export-tasks/")) return pending;
      return normalGet(path);
    });
    renderWorkspace({ accountId: "teacher", projectRoot: "C:/project", openExamId: examId });
    await screen.findByTestId("compose-draft-recovery-banner");
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/exam/export-tasks/export-task"));
    await act(async () => { finishTask(completed("pdf")); });
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(cacheKey)).toBe(before);
    expect(screen.getByTestId("compose-draft-recovery-banner")).toBeInTheDocument();
  });
});

describe("compose workspace navigation", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    templates = [template("original")];
    mocks.listContentFolders.mockResolvedValue({ folders: [{ id: "compose-folder", owner_teacher_id: "teacher-a", scope: "compose", parent_id: null, kind: "category", name: "归档" }] });
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates };
      if (path === "/api/questions") return { questions: [] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: [{ exam_id: "Draft/Math", name: "Draft math", status: "draft" }] };
      if (path.startsWith("/api/exams/")) return { exam: { exam_id: "Draft/Math", name: "Draft math", export_label: "Draft math", subject: "数学", template_ref: "original", template_path: "templates/original.yaml", selected_items: [] } };
      if (path.startsWith("/api/exam/export-tasks?")) return { tasks: [] };
      return {};
    });
    mocks.apiPost.mockResolvedValue({});
  });

  it("keeps the editor reachable and hides bank tools while history is open", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const workspace = container.querySelector<HTMLElement>(".or-g49-compose-workspace");
    await screen.findByRole("button", { name: "历史" });

    expect(workspace).toHaveAttribute("data-active-panel", "paper");
    expect(screen.queryByRole("button", { name: "补齐空缺" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "题库" }));
    expect(workspace).toHaveAttribute("data-active-panel", "bank");
    expect(screen.getAllByRole("button", { name: "补齐空缺" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "历史" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: "选择草稿 Draft math" }));
    const batchMoveSelect = screen.getByRole("combobox", { name: "批量移动到文件夹" });
    await user.click(batchMoveSelect);
    expect(await screen.findByRole("option", { name: "归档" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByTitle("归档 · 归类文件夹"));
    const moveFolderSelect = screen.getByRole("combobox", { name: "移动文件夹到" });
    await user.click(moveFolderSelect);
    expect(await screen.findByRole("option", { name: "根目录" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补齐空缺" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭历史试卷" }));
    await waitFor(() => expect(workspace).toHaveAttribute("data-active-panel", "bank"));
    expect(screen.getAllByRole("button", { name: "补齐空缺" }).length).toBeGreaterThan(0);

    const mobileEditorBack = container.querySelector<HTMLButtonElement>(".or-g49-bank-actions button:last-child");
    expect(mobileEditorBack).toHaveTextContent("编辑试卷");
    fireEvent.click(mobileEditorBack!);
    expect(workspace).toHaveAttribute("data-active-panel", "paper");
    expect(screen.queryByRole("button", { name: "补齐空缺" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(screen.getByRole("button", { name: "全部内容" }));
    await user.click(await screen.findByRole("button", { name: /Draft math/ }));
    await waitFor(() => expect(workspace).toHaveAttribute("data-active-panel", "paper"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
