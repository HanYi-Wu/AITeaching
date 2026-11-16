import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolBarProvider, useToolBar } from "../../contexts/ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { TemplateRow } from "../../types/compose";
import type { DuplicateReport } from "../../types/autoCompose";
import { ComposeWorkspace } from "./ComposeWorkspace";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  download: vi.fn(),
  sync: vi.fn(),
  onError: vi.fn(),
  setPageContext: vi.fn(),
  listContentFolders: vi.fn(),
  moveContentItemsToFolder: vi.fn(),
  listClasses: vi.fn(),
  listPracticeHistory: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock("../../contexts/AgentContext", () => ({ useAgentActions: () => ({ setPageContext: mocks.setPageContext }) }));
vi.mock("../../components/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("./composeHelpers", async (importOriginal) => ({
  ...await importOriginal<typeof import("./composeHelpers")>(),
  downloadExportedBundle: mocks.download,
}));
vi.mock("../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../platform/auth")>(),
  listContentFolders: mocks.listContentFolders,
  listFolderItems: async () => ({ items: {} }),
  listTaggedItems: async () => ({ items: {} }),
  listTeacherAssignedClasses: mocks.listClasses,
  listClassPracticeHistory: mocks.listPracticeHistory,
  getAccountProfile: mocks.getProfile,
  moveContentItemsToFolder: mocks.moveContentItemsToFolder,
  syncPlatformPaperFromExam: mocks.sync,
}));

function Toolbar() {
  const { left, right } = useToolBar();
  return <div>{left}{right}</div>;
}

const template: TemplateRow = {
  id: "original",
  path: "templates/original.yaml",
  layout: "single_column",
  sections: [{ section_id: "选择", type: "single_choice", required_count: 1, score_per_item: 5 }],
};
let templates: TemplateRow[];

const exam = {
  exam_id: "Draft/Math",
  name: "Draft math",
  export_label: "Draft math",
  subject: "数学",
  template_ref: "original",
  template_path: "templates/original.yaml",
  selected_items: [{ section_id: "选择", question_ids: ["数学/main/q1"], score_per_item: 5 }],
};

const question = {
  id: "q1",
  qualified_id: "数学/main/q1",
  namespace: "数学/main",
  collection: "数学/main",
  subject: "数学",
  type: "single_choice",
  answer: "A",
  content_preview: "求 $x+1=2$ 中 x 的值。",
  content: "求 $x+1=2$ 中 x 的值。",
  analysis: "",
  metadata: {},
};
const secondQuestion = {
  ...question,
  id: "q2",
  qualified_id: "数学/main/q2",
  content_preview: "求 $x+2=4$ 中 x 的值。",
  content: "求 $x+2=4$ 中 x 的值。",
};

const duplicateReport: DuplicateReport = {
  method: "text_ngram_v1",
  threshold: 0.85,
  summary: { question_count: 1, flagged_count: 1, exact_count: 1, similar_count: 0, history_count: 0, within_paper_count: 0 },
  questions: [{
    qualified_id: "数学/main/q1",
    occurrences: 1,
    match_count: 1,
    truncated: false,
    matches: [{
      source: "bank",
      kind: "exact",
      similarity: 1,
      qualified_id: "数学/other/old-copy",
      content_preview: "同一道题的旧题面。",
    }],
  }],
  warnings: [],
};

describe("ComposeWorkspace automatic composition and duplicate scope", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    templates = [template];
    mocks.listContentFolders.mockResolvedValue({ folders: [] });
    mocks.listClasses.mockResolvedValue({ classes: [] });
    mocks.listPracticeHistory.mockResolvedValue({ publications: [] });
    mocks.getProfile.mockResolvedValue({ profile: { id: "teacher-a", subjects: ["数学"] } });
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/templates") return { templates };
      if (path === "/api/questions") return { questions: [question, secondQuestion] };
      if (path === "/api/bank/subjects") return { subjects: ["数学"] };
      if (path === "/api/exams") return { exams: [{ exam_id: exam.exam_id, name: exam.name, status: "draft" }] };
      if (path === `/api/exams/${encodeURIComponent(exam.exam_id)}`) return { exam };
      if (path.startsWith("/api/exam/export-tasks?")) return { tasks: [] };
      if (path === "/api/graph/question-bindings-index") return { index: {} };
      return {};
    });
    mocks.apiPost.mockResolvedValue(duplicateReport);
  });

  it("resets manual duplicate loading and ignores an old result when score edits change the full paper state", async () => {
    let finishCheck!: (report: DuplicateReport) => void;
    mocks.apiPost.mockReturnValue(new Promise<DuplicateReport>((resolve) => { finishCheck = resolve; }));
    const user = userEvent.setup();
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <ComposeWorkspace
            onError={mocks.onError}
            accountId="teacher-a"
            projectRoot="C:/project-a"
            openExamId={exam.exam_id}
          />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^查重$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/exam/check-duplicates", {
      question_ids: ["数学/main/q1"],
      exclude_exam_id: "Draft/Math",
      similarity_threshold: 0.85,
    }));
    expect(screen.getByRole("status")).toHaveTextContent("正在检查当前试卷");

    // The report is a modal, so update the underlying editor through its native
    // input event while the request is pending. The edit changes paper state
    // without changing the selected question IDs.
    const score = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("每题分值"))
      ?.querySelector<HTMLInputElement>("input");
    expect(score).not.toBeNull();
    fireEvent.change(score!, { target: { value: "6" } });
    expect(await screen.findByText("暂无查重报告。选择“查重”开始检查。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始查重" })).toBeEnabled();

    await act(async () => { finishCheck(duplicateReport); });

    expect(screen.queryByText("数学/other/old-copy")).toBeNull();
    expect(screen.getByText("暂无查重报告。选择“查重”开始检查。")).toBeInTheDocument();
    expect(screen.queryByText("正在检查当前试卷…")).toBeNull();
  });

  it("shows check errors in the report and allows a retry", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("查重服务暂不可用")).mockResolvedValueOnce(duplicateReport);
    const user = userEvent.setup();
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <ComposeWorkspace onError={mocks.onError} accountId="teacher-a" projectRoot="C:/project-a" openExamId={exam.exam_id} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^查重$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("查重失败：查重服务暂不可用");
    expect(within(dialog).queryByText("暂无查重报告。选择“查重”开始检查。")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "开始查重" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost.mock.calls[1][1]).toEqual(expect.objectContaining({ similarity_threshold: 0.85 }));
    expect(await within(dialog).findByText("数学/other/old-copy")).toBeInTheDocument();
  });

  it("reuses the existing report threshold when checking a changed question list", async () => {
    mocks.apiPost.mockResolvedValue({ ...duplicateReport, threshold: 0.95 });
    const user = userEvent.setup();
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <ComposeWorkspace onError={mocks.onError} accountId="teacher-a" projectRoot="C:/project-a" openExamId={exam.exam_id} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^查重$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/阈值 95%/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "关闭查重报告" }));

    const count = screen.getByLabelText("选择题目数量");
    await user.clear(count);
    await user.type(count, "2");
    await user.click(screen.getByRole("button", { name: "题库" }));
    await user.click(screen.getAllByRole("button", { name: "补齐空缺" })[0]);
    const checkButton = await screen.findByRole("button", { name: /查重，报告已失效/ });
    await user.click(checkButton);
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));

    expect(mocks.apiPost.mock.calls[1][1]).toEqual(expect.objectContaining({
      question_ids: ["数学/main/q1", "数学/main/q2"],
      similarity_threshold: 0.95,
    }));
  });

  it("renders centered action buttons with two-character Chinese labels and omits 按目标组卷", async () => {
    const user = userEvent.setup();
    render(
      <TestI18nProvider>
        <ToolBarProvider>
          <Toolbar />
          <ComposeWorkspace onError={mocks.onError} accountId="teacher-a" projectRoot="C:/project-a" openExamId={exam.exam_id} />
        </ToolBarProvider>
      </TestI18nProvider>,
    );

    const checkBtn = await screen.findByRole("button", { name: /^查重$/ });
    expect(screen.queryByRole("button", { name: "按目标组卷" })).toBeNull();
    expect(checkBtn.className).toContain("justify-center");
    expect(checkBtn.className).toContain("text-center");

    const removeBtn = screen.getByRole("button", { name: "删除" });
    const upBtn = screen.getByRole("button", { name: "上移" });
    const downBtn = screen.getByRole("button", { name: "下移" });
    expect(upBtn).toBeDisabled();
    expect(downBtn).toBeDisabled();

    // Selecting the item in the paper enables move controls and allows removing via 删除
    const paperPanel = upBtn.closest(".or-g49-compose-paper-content") as HTMLElement;
    await user.click(within(paperPanel).getByText("数学/main/q1"));
    expect(upBtn).toBeEnabled();
    expect(downBtn).toBeEnabled();
    await user.click(removeBtn);
    expect(within(paperPanel).queryByText("数学/main/q1")).toBeNull();
  });
});
