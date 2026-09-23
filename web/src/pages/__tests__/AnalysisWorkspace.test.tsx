import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

import { AgentProvider, useAgentContext } from "../../contexts/AgentContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { AnalysisWorkspace } from "../AnalysisWorkspace";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostFormData: vi.fn(),
  apiDelete: vi.fn(),
  apiAnalysisListScripts: vi.fn(),
  apiAnalysisListFolderScripts: vi.fn(),
  apiAnalysisListJobs: vi.fn(),
  apiAnalysisListTools: vi.fn(),
  apiAnalysisRunFolderScript: vi.fn(),
  apiAnalysisRunBuiltin: vi.fn(),
  apiAnalysisDiagnosisKnowledge: vi.fn(),
  apiAnalysisDiagnosisStudent: vi.fn(),
  apiAnalysisDiagnosisHeatmap: vi.fn(),
  apiAnalysisDiagnosisSuggestions: vi.fn(),
  apiAnalysisRemediationDraftPreview: vi.fn(),
  apiAnalysisCreateRemediationDraft: vi.fn(),
  listPlatformPapers: vi.fn(),
  analyzePlatformPaper: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiPostFormData: mocks.apiPostFormData,
  apiDelete: mocks.apiDelete,
  apiAnalysisListScripts: mocks.apiAnalysisListScripts,
  apiAnalysisListFolderScripts: mocks.apiAnalysisListFolderScripts,
  apiAnalysisListJobs: mocks.apiAnalysisListJobs,
  apiAnalysisListTools: mocks.apiAnalysisListTools,
  apiAnalysisRunFolderScript: mocks.apiAnalysisRunFolderScript,
  apiAnalysisRunBuiltin: mocks.apiAnalysisRunBuiltin,
  apiAnalysisDiagnosisKnowledge: mocks.apiAnalysisDiagnosisKnowledge,
  apiAnalysisDiagnosisStudent: mocks.apiAnalysisDiagnosisStudent,
  apiAnalysisDiagnosisHeatmap: mocks.apiAnalysisDiagnosisHeatmap,
  apiAnalysisDiagnosisSuggestions: mocks.apiAnalysisDiagnosisSuggestions,
  apiAnalysisRemediationDraftPreview: mocks.apiAnalysisRemediationDraftPreview,
  apiAnalysisCreateRemediationDraft: mocks.apiAnalysisCreateRemediationDraft,
  ensureApiBase: vi.fn().mockResolvedValue(undefined),
  resolveApiUrl: async (path: string) => path,
}));

vi.mock("../../platform/auth", () => ({
  listPlatformPapers: mocks.listPlatformPapers,
  analyzePlatformPaper: mocks.analyzePlatformPaper,
}));

function primeDefaultApi() {
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/exams/analysis-list") {
      return {
        exams: [
          {
            exam_id: "e1",
            exam_title: "期末考试",
            subject: "数学",
            question_count: 3,
            section_count: 1,
            score_batch_count: 1,
            has_score: true,
            latest_batch_id: "b1",
            exam_dir: "e1",
            mtime: new Date().toISOString(),
          },
        ],
      };
    }
    if (path === "/api/exams/e1/summary") {
      return {
        exam_id: "e1",
        exam_title: "期末考试",
        subject: "数学",
        question_count: 3,
        section_count: 1,
        score_batch_count: 1,
        has_score: true,
        latest_batch_id: "b1",
        exam_dir: "e1",
        mtime: new Date().toISOString(),
        questions: [],
        score_batches: [
          {
            batch_id: "b1",
            imported_at: new Date().toISOString(),
            student_count: 2,
            question_count: 3,
          },
        ],
      };
    }
    if (path === "/api/exams/e1/scores/b1") {
      return {
        batch_id: "b1",
        exam_id: "e1",
        student_count: 2,
        question_count: 3,
        warnings: [],
        question_stats: [],
        node_stats: [],
        student_stats: [],
        class_avg_ratio: 0.7,
        class_avg_fuzzy: 0.65,
      };
    }
    throw new Error(`unexpected apiGet path: ${path}`);
  });
  mocks.apiAnalysisListScripts.mockResolvedValue({ scripts: [] });
  mocks.apiAnalysisListFolderScripts.mockResolvedValue({
    scripts: [{ path: "demo.py", name: "demo.py", updated_at: Date.now() }],
  });
  mocks.apiAnalysisListJobs.mockResolvedValue({ jobs: [] });
  mocks.apiAnalysisListTools.mockResolvedValue({ tools: [{ name: "analysis.run_builtin" }] });
  mocks.apiAnalysisRunBuiltin.mockResolvedValue({ job_id: "j1", status: "succeeded", output: { ok: true } });
  mocks.apiAnalysisRunFolderScript.mockResolvedValue({ job_id: "j2", status: "succeeded", output: { ok: false } });
  mocks.apiAnalysisDiagnosisKnowledge.mockResolvedValue({ nodes: [] });
  mocks.apiAnalysisDiagnosisStudent.mockResolvedValue({ students: [] });
  mocks.apiAnalysisDiagnosisHeatmap.mockResolvedValue({ rows: [], columns: [], matrix: [] });
  mocks.apiAnalysisDiagnosisSuggestions.mockResolvedValue({ retell_priority: [], practice_drafts: [] });
  mocks.apiAnalysisRemediationDraftPreview.mockResolvedValue({
    exam_id: "e1",
    batch_id: "b1",
    selected_count: 0,
    selected_question_ids: [],
    nodes: [],
    weak_nodes: [],
    low_count: true,
    low_count_threshold: 3,
    warnings: [],
    exclude_source_exam_questions: true,
    ai_assist_payload: {
      exam_id: "e1",
      batch_id: "b1",
      selected_count: 0,
      low_count_threshold: 3,
      nodes: [],
      prompt: "请协助补题",
    },
  });
  mocks.apiAnalysisCreateRemediationDraft.mockResolvedValue({
    exam_id: "补练/数学",
    selected_count: 0,
    weak_nodes: [],
    warnings: [],
    source_exam_id: "e1",
    batch_id: "b1",
  });
  mocks.apiPost.mockResolvedValue({});
  mocks.apiPostFormData.mockResolvedValue({});
  mocks.apiDelete.mockResolvedValue({ ok: true });
  mocks.listPlatformPapers.mockResolvedValue({
    papers: [
      {
        paper_id: "online-1",
        exam_id: "demo-online/Math",
        title: "演示线上答题",
        subject: "数学",
        delivery_mode: "online",
        status: "published",
        question_count: 2,
        section_count: 1,
        score_batch_count: 0,
        has_score: true,
        has_pdf: false,
        has_docx: false,
        publication_count: 1,
        published_class_count: 1,
        total_student_count: 5,
        submitted_student_count: 4,
        in_progress_student_count: 1,
      },
    ],
  });
  mocks.analyzePlatformPaper.mockResolvedValue({
    analysis: {
      paper: { paper_id: "online-1", title: "演示线上答题", subject: "数学", delivery_mode: "online", status: "published" },
      summary: { total_students: 5, completed_students: 4, in_progress_students: 1, not_started_students: 0, completion_rate: 80, average_score: 50, average_time_seconds: 600, publication_count: 1 },
      proctoring: { event_count: 0, event_type_counts: {}, screen_switch_count: 0, screen_switch_duration_ms: 0, flagged_student_count: 0, exceeded_student_count: 0 },
      modules: [],
      questions: [],
      classes: [],
      radar: [],
      students: [],
    },
  });
}

function PageContextProbe() {
  const { pageContext } = useAgentContext();
  return <output data-testid="page-context-probe">{JSON.stringify(pageContext)}</output>;
}

describe("AnalysisWorkspace", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    primeDefaultApi();
  });

  function renderWs() {
    return render(
      <TestI18nProvider>
        <AgentProvider>
          <AnalysisWorkspace />
          <PageContextProbe />
        </AgentProvider>
      </TestI18nProvider>,
    );
  }

  it("shows empty state before exam is selected", async () => {
    renderWs();
    expect(await screen.findByText("从左侧选择一个历史考试")).toBeInTheDocument();
  });

  it("shows online and offline papers in one history list and exposes the selected paper to AI", async () => {
    renderWs();

    expect(await screen.findByText("考试记录与分析")).toBeInTheDocument();
    expect(screen.queryByText("线上历史考试（含答题数据）")).not.toBeInTheDocument();
    expect(screen.getByText("4 份已提交 · 1 份答题中")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /演示线上答题/ }));

    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledWith("online-1", undefined, undefined));
    await waitFor(() => {
      expect(screen.getByTestId("page-context-probe")).toHaveTextContent('"selected_resource_type":"paper"');
      expect(screen.getByTestId("page-context-probe")).toHaveTextContent('"selected_resource_id":"online-1"');
    });
  });

  it("keeps imported score batches reachable from a paper that also has submissions", async () => {
    mocks.listPlatformPapers.mockResolvedValue({
      papers: [
        {
          paper_id: "mixed-1",
          exam_id: "e1",
          title: "线下月考",
          subject: "数学",
          delivery_mode: "offline",
          status: "published",
          question_count: 3,
          section_count: 1,
          score_batch_count: 1,
          has_score: true,
          has_pdf: true,
          has_docx: false,
          publication_count: 1,
          published_class_count: 1,
          submitted_student_count: 2,
          in_progress_student_count: 0,
        },
      ],
    });
    renderWs();

    fireEvent.click(await screen.findByRole("button", { name: "导入成绩" }));

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/exams/e1/summary"));
  });

  it("keeps the latest online paper analysis when requests finish out of order", async () => {
    const paper = (paperId: string, title: string) => ({
      paper_id: paperId,
      exam_id: `${paperId}/Math`,
      title,
      subject: "数学",
      delivery_mode: "online",
      status: "published",
      question_count: 2,
      section_count: 1,
      score_batch_count: 0,
      has_score: true,
      has_pdf: false,
      has_docx: false,
      publication_count: 1,
      published_class_count: 1,
    });
    const result = (paperId: string, title: string, total: number) => ({
      analysis: {
        paper: { paper_id: paperId, title, subject: "数学", delivery_mode: "online", status: "published" },
        summary: { total_students: total, completed_students: total, in_progress_students: 0, not_started_students: 0, completion_rate: 100, average_score: 80, average_time_seconds: 600, publication_count: 1 },
        proctoring: { event_count: 0, event_type_counts: {}, screen_switch_count: 0, screen_switch_duration_ms: 0, flagged_student_count: 0, exceeded_student_count: 0 },
        modules: [], questions: [], classes: [], radar: [], students: [],
      },
    });
    mocks.listPlatformPapers.mockResolvedValue({ papers: [paper("online-a", "试卷 A"), paper("online-b", "试卷 B")] });
    let resolveA!: (value: ReturnType<typeof result>) => void;
    let resolveB!: (value: ReturnType<typeof result>) => void;
    mocks.analyzePlatformPaper.mockImplementation((paperId: string) => new Promise((resolve) => {
      if (paperId === "online-a") resolveA = resolve;
      else resolveB = resolve;
    }));
    renderWs();

    fireEvent.click(await screen.findByRole("button", { name: /试卷 A/ }));
    fireEvent.click(screen.getByRole("button", { name: /试卷 B/ }));
    await waitFor(() => expect(mocks.analyzePlatformPaper).toHaveBeenCalledTimes(2));
    await act(async () => resolveB(result("online-b", "试卷 B", 9)));
    expect(await screen.findByText("9")).toBeInTheDocument();
    await act(async () => resolveA(result("online-a", "试卷 A", 2)));

    expect(screen.getByRole("heading", { name: "试卷 B" })).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("runs builtin analysis from right panel", async () => {
    renderWs();

    const examButton = await screen.findByRole("button", { name: /期末考试/ });
    fireEvent.click(examButton);

    const runBuiltinBtn = await screen.findByRole("button", { name: "运行内置分析（exam_stats_v1）" });
    fireEvent.click(runBuiltinBtn);
    await waitFor(() => expect(mocks.apiAnalysisRunBuiltin).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/工具数量：1/)).toBeInTheDocument();
  });

  it("shows error message when folder script run fails", async () => {
    mocks.apiAnalysisRunFolderScript.mockRejectedValueOnce(new Error("运行失败"));
    renderWs();

    const examButton = await screen.findByRole("button", { name: /期末考试/ });
    fireEvent.click(examButton);
    const runBtn = await screen.findByRole("button", { name: "运行选中脚本" });
    fireEvent.click(runBtn);

    expect(await screen.findByText("运行失败")).toBeInTheDocument();
  });
});
