import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAnalysisDiagnosis } from "./useAnalysisDiagnosis";

const mocks = vi.hoisted(() => ({
  knowledge: vi.fn(),
  heatmap: vi.fn(),
  suggestions: vi.fn(),
  students: vi.fn(),
  preview: vi.fn(),
  createDraft: vi.fn(),
  requestAgentPrefill: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  apiAnalysisDiagnosisKnowledge: mocks.knowledge,
  apiAnalysisDiagnosisHeatmap: mocks.heatmap,
  apiAnalysisDiagnosisSuggestions: mocks.suggestions,
  apiAnalysisDiagnosisStudent: mocks.students,
  apiAnalysisRemediationDraftPreview: mocks.preview,
  apiAnalysisCreateRemediationDraft: mocks.createDraft,
}));

vi.mock("../../contexts/AgentContext", () => ({
  useAgentContext: () => ({ requestAgentPrefill: mocks.requestAgentPrefill }),
}));

const emptyPreview = {
  exam_id: "exam-a",
  batch_id: "batch-a",
  selected_count: 0,
  selected_question_ids: [],
  nodes: [],
  weak_nodes: [],
  low_count: true,
  low_count_threshold: 3,
  warnings: [],
  exclude_source_exam_questions: true,
  ai_assist_payload: { exam_id: "exam-a", batch_id: "batch-a", selected_count: 0, low_count_threshold: 3, nodes: [], prompt: "诊断提示" },
};

type DiagnosisOptions = Parameters<typeof useAnalysisDiagnosis>[0];

function makeOptions(overrides: Partial<DiagnosisOptions> = {}): DiagnosisOptions {
  return {
    selectedExamId: "exam-a",
    selectedBatchId: "batch-a",
    scopeKey: "owner-a::project-a",
    scopeReady: true,
    tab: "diagnosis",
    loadExams: vi.fn().mockResolvedValue(undefined),
    setImportError: vi.fn(),
    ...overrides,
  };
}

describe("useAnalysisDiagnosis request scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.knowledge.mockResolvedValue({ nodes: [] });
    mocks.heatmap.mockResolvedValue({ rows: [], columns: [], matrix: [] });
    mocks.suggestions.mockResolvedValue({ retell_priority: [], practice_drafts: [] });
    mocks.students.mockResolvedValue({ students: [] });
    mocks.preview.mockResolvedValue(emptyPreview);
    mocks.createDraft.mockResolvedValue({
      exam_id: "remediation-a",
      selected_count: 0,
      weak_nodes: [],
      warnings: [],
      source_exam_id: "exam-a",
      batch_id: "batch-a",
    });
  });

  it("ignores diagnosis results after the account, project, exam, or batch scope changes", async () => {
    let resolveKnowledge!: (value: { nodes: Array<{ node_id: string; canonical_name: string; error_rate: number }> }) => void;
    mocks.knowledge.mockImplementationOnce(() => new Promise((resolve) => { resolveKnowledge = resolve; }));
    const initial = makeOptions();
    const { result, rerender } = renderHook((options) => useAnalysisDiagnosis(options), { initialProps: initial });
    await waitFor(() => expect(resolveKnowledge).toBeDefined());

    rerender({ ...initial, scopeKey: "owner-b::project-b", scopeReady: false, selectedExamId: null, selectedBatchId: null });
    await act(async () => resolveKnowledge({ nodes: [{ node_id: "old", canonical_name: "OLD SCOPE NODE", error_rate: 1 }] }));

    expect(result.current.diagKd).toBeNull();
    expect(result.current.diagLoading).toBe(false);
  });

  it("does not open a remediation exam after its source scope changes", async () => {
    let resolveDraft!: (value: { exam_id: string; selected_count: number; weak_nodes: unknown[]; warnings: unknown[]; source_exam_id: string; batch_id: string }) => void;
    mocks.createDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveDraft = resolve; }));
    const onOpenExamInCompose = vi.fn();
    const initial = makeOptions({ tab: "overview", onOpenExamInCompose });
    const { result, rerender } = renderHook((options) => useAnalysisDiagnosis(options), { initialProps: initial });

    let pending!: Promise<void>;
    act(() => { pending = result.current.handleCreateRemediationDraft(); });
    await waitFor(() => expect(resolveDraft).toBeDefined());
    rerender({ ...initial, scopeKey: "owner-b::project-b", scopeReady: false, selectedExamId: null, selectedBatchId: null });
    await act(async () => {
      resolveDraft({
        exam_id: "late-remediation",
        selected_count: 0,
        weak_nodes: [],
        warnings: [],
        source_exam_id: "exam-a",
        batch_id: "batch-a",
      });
      await pending;
    });

    expect(onOpenExamInCompose).not.toHaveBeenCalled();
    expect(result.current.remediationResult).toBeNull();
    expect(initial.loadExams).not.toHaveBeenCalled();
  });

  it.each(["scope change", "unmount"])("does not navigate when %s happens while refreshing after draft creation", async (change) => {
    let finishRefresh!: () => void;
    const loadExams = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const onOpenExamInCompose = vi.fn();
    const initial = makeOptions({ tab: "overview", loadExams, onOpenExamInCompose });
    const { result, rerender, unmount } = renderHook((options) => useAnalysisDiagnosis(options), { initialProps: initial });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleCreateRemediationDraft(); });
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    if (change === "unmount") unmount();
    else rerender({ ...initial, scopeKey: "owner-b::project-b", scopeReady: false });
    await act(async () => { finishRefresh(); await pending; });
    expect(onOpenExamInCompose).not.toHaveBeenCalled();
  });
});
