import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

import { AgentProvider, useAgentContext } from "../../contexts/AgentContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { AnalysisWorkspace } from "./AnalysisWorkspace";

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

  function wsTree(allowHostTools = false, ownerId = "teacher-a", projectId = "project-a") {
    return (
      <TestI18nProvider>
        <AgentProvider>
          <AnalysisWorkspace allowHostTools={allowHostTools} ownerId={ownerId} projectId={projectId} />
          <PageContextProbe />
        </AgentProvider>
      </TestI18nProvider>
    );
  }

  function renderWs(allowHostTools = false, ownerId = "teacher-a", projectId = "project-a") {
    return render(wsTree(allowHostTools, ownerId, projectId));
  }

  it("shows empty state before exam is selected", async () => {
    renderWs();
    expect(await screen.findByText("从左侧选择一个历史考试")).toBeInTheDocument();
  });

  it("does not request administrator script and tool endpoints for teachers", async () => {
    renderWs();
    await waitFor(() => expect(mocks.apiAnalysisListJobs).toHaveBeenCalled());
    expect(mocks.apiAnalysisListFolderScripts).not.toHaveBeenCalled();
    expect(mocks.apiAnalysisListTools).not.toHaveBeenCalled();
  });

  it("loads custom scripts when host tools are explicitly enabled", async () => {
    renderWs(true);
    await waitFor(() => expect(mocks.apiAnalysisListFolderScripts).toHaveBeenCalledTimes(1));
    expect(mocks.apiAnalysisListTools).toHaveBeenCalledTimes(1);
  });

  it("ignores metadata responses from the previous account and project", async () => {
    let resolveOldJobs!: (value: { jobs: Array<{ job_id: string; kind: string; status: string }> }) => void;
    let resolveCurrentJobs!: (value: { jobs: Array<{ job_id: string; kind: string; status: string }> }) => void;
    let resolveOldScripts!: (value: { scripts: Array<{ path: string; name: string; updated_at: number }> }) => void;
    let resolveOldTools!: (value: { tools: Array<{ name: string }> }) => void;
    let resolveCurrentScripts!: (value: { scripts: Array<{ path: string; name: string; updated_at: number }> }) => void;
    mocks.apiAnalysisListJobs
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldJobs = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCurrentJobs = resolve; }));
    mocks.apiAnalysisListFolderScripts
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldScripts = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCurrentScripts = resolve; }));
    mocks.apiAnalysisListTools.mockImplementationOnce(() => new Promise((resolve) => { resolveOldTools = resolve; }));

    const view = renderWs(true, "admin-a", "project-a");
    await waitFor(() => expect(resolveOldJobs).toBeDefined());
    view.rerender(wsTree(false, "teacher-b", "project-b"));
    await waitFor(() => expect(resolveCurrentJobs).toBeDefined());
    fireEvent.click(await screen.findByRole("button", { name: /期末考试/ }));

    await act(async () => resolveCurrentJobs({ jobs: [{ job_id: "current1-job", kind: "builtin", status: "succeeded" }] }));
    expect(await screen.findByText(/current1/)).toBeInTheDocument();
    await act(async () => {
      resolveOldJobs({ jobs: [{ job_id: "oldmeta1-job", kind: "script", status: "succeeded" }] });
      resolveOldScripts({ scripts: [{ path: "old-project.py", name: "old-project.py", updated_at: 1 }] });
      resolveOldTools({ tools: [{ name: "old-project.tool" }] });
    });
    expect(screen.getByText(/current1/)).toBeInTheDocument();
    expect(screen.queryByText(/oldmeta1/)).not.toBeInTheDocument();
    expect(mocks.apiAnalysisListFolderScripts).toHaveBeenCalledTimes(1);
    expect(mocks.apiAnalysisListTools).toHaveBeenCalledTimes(1);

    view.rerender(wsTree(true, "teacher-b", "project-b"));
    await waitFor(() => expect(mocks.apiAnalysisListFolderScripts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.apiAnalysisListTools).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("option", { name: "old-project.py" })).not.toBeInTheDocument();
    await act(async () => resolveCurrentScripts({ scripts: [{ path: "current-project.py", name: "current-project.py", updated_at: 2 }] }));
    expect(await screen.findByRole("option", { name: "current-project.py" })).toBeInTheDocument();
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
    expect(mocks.apiAnalysisListTools).not.toHaveBeenCalled();
  });

  it("shows error message when folder script run fails", async () => {
    mocks.apiAnalysisRunFolderScript.mockRejectedValueOnce(new Error("运行失败"));
    renderWs(true);

    const examButton = await screen.findByRole("button", { name: /期末考试/ });
    fireEvent.click(examButton);
    const runBtn = await screen.findByRole("button", { name: "运行选中脚本" });
    await waitFor(() => expect(runBtn).toBeEnabled());
    fireEvent.click(runBtn);

    expect(await screen.findByText("运行失败")).toBeInTheDocument();
  });

  it("does not apply a folder-script result after host-tool permission is revoked", async () => {
    let resolveRun!: (value: { job_id: string; status: string; output: { summary: { title: string; status: string } } }) => void;
    mocks.apiAnalysisRunFolderScript.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    const view = renderWs(true);

    fireEvent.click(await screen.findByRole("button", { name: /期末考试/ }));
    const runButton = await screen.findByRole("button", { name: "运行选中脚本" });
    await waitFor(() => expect(runButton).toBeEnabled());
    expect(screen.getByDisplayValue("demo.py")).toBeInTheDocument();
    fireEvent.click(runButton);
    expect(mocks.apiAnalysisRunFolderScript).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(resolveRun).toBeDefined());

    view.rerender(wsTree(false, "teacher-a", "project-a"));
    expect(screen.queryByRole("button", { name: "运行选中脚本" })).not.toBeInTheDocument();
    await act(async () => resolveRun({
      job_id: "late-job",
      status: "succeeded",
      output: { summary: { title: "STALE HOST OUTPUT", status: "succeeded" } },
    }));

    expect(screen.queryByText(/STALE HOST OUTPUT/)).not.toBeInTheDocument();
    expect(mocks.apiAnalysisRunFolderScript).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest batch analysis when switching batches out of order", async () => {
    let resolveB1!: (val: any) => void;
    let resolveB2!: (val: any) => void;
    let initialB1Resolved = false;

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
              score_batch_count: 2,
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
          score_batch_count: 2,
          has_score: true,
          latest_batch_id: "b1",
          exam_dir: "e1",
          mtime: new Date().toISOString(),
          questions: [],
          score_batches: [
            {
              batch_id: "b1",
              imported_at: "2026-10-01T10:00:00Z",
              student_count: 2,
              question_count: 3,
            },
            {
              batch_id: "b2",
              imported_at: "2026-10-02T10:00:00Z",
              student_count: 5,
              question_count: 3,
            },
          ],
        };
      }
      if (path === "/api/exams/e1/scores/b1") {
        if (!initialB1Resolved) {
          initialB1Resolved = true;
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
        return new Promise((resolve) => { resolveB1 = resolve; });
      }
      if (path === "/api/exams/e1/scores/b2") {
        return new Promise((resolve) => { resolveB2 = resolve; });
      }
      throw new Error(`unexpected apiGet path: ${path}`);
    });

    renderWs();

    const examButton = await screen.findByRole("button", { name: /期末考试/ });
    fireEvent.click(examButton);

    expect(await screen.findByText("2")).toBeInTheDocument();

    const b2Button = await screen.findByRole("button", { name: /5人/ });
    fireEvent.click(b2Button);
    await waitFor(() => expect(resolveB2).toBeDefined());

    const b1Button = screen.getByRole("button", { name: /2人/ });
    fireEvent.click(b1Button);
    await waitFor(() => expect(resolveB1).toBeDefined());

    await act(async () => {
      resolveB1({
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
      });
    });

    expect(await screen.findByText("2")).toBeInTheDocument();

    await act(async () => {
      resolveB2({
        batch_id: "b2",
        exam_id: "e1",
        student_count: 5,
        question_count: 3,
        warnings: [],
        question_stats: [],
        node_stats: [],
        student_stats: [],
        class_avg_ratio: 0.85,
        class_avg_fuzzy: 0.8,
      });
    });

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("drops a legacy exam detail response when the owner and project change", async () => {
    let resolveSummary!: (value: Record<string, unknown>) => void;
    const defaultApiGet = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation((path: string) => path === "/api/exams/e1/summary"
      ? new Promise((resolve) => { resolveSummary = resolve; })
      : defaultApiGet(path));
    const view = renderWs(false, "teacher-a", "project-a");

    fireEvent.click(await screen.findByRole("button", { name: /期末考试/ }));
    await waitFor(() => expect(resolveSummary).toBeDefined());
    view.rerender(wsTree(false, "teacher-b", "project-b"));
    await act(async () => resolveSummary({
      exam_id: "e1",
      exam_title: "旧项目迟到考试",
      subject: "数学",
      question_count: 3,
      section_count: 1,
      score_batch_count: 1,
      has_score: true,
      latest_batch_id: "b1",
      exam_dir: "e1",
      mtime: new Date().toISOString(),
      questions: [],
      score_batches: [],
    }));

    expect(screen.queryByRole("heading", { name: "旧项目迟到考试" })).not.toBeInTheDocument();
    expect(await screen.findByText("从左侧选择一个历史考试")).toBeInTheDocument();
  });
});
