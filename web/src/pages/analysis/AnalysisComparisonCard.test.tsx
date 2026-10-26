import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisComparisonCard } from "./AnalysisComparisonCard";
import * as api from "../../platform/learningProgress";

vi.mock("../../platform/learningProgress", () => ({
  fetchPracticePublications: vi.fn(), fetchTeacherLearningProgressComparison: vi.fn(),
}));

function comparison(publicationId = "practice"): api.TeacherComparisonResponse {
  return {
    practice_publication_id: publicationId,
    knowledge_names: { algebra: "一元方程" }, student_names: {},
    source_status: { status: "valid", source_type: "diagnostic_batch", source_ref_id: "batch", is_modified: false, is_missing: false, reason: null },
    class_comparison: {
      status: "valid", is_source_modified: false, is_source_missing: false, total_student_count: 2,
      node_summaries: [{
        knowledge_node_id: "algebra", status: "valid", is_modified: false,
        matched_student_count: 1, unpaired_student_count: 1, unpaired_reasons: { target_unsubmitted: 1 },
        pre_percentage: 50, post_percentage: 75, delta_percentage_points: 25,
        pre_question_count: 1, post_question_count: 1, question_difference: 0, incomparable_reason: null,
      }],
    }, student_comparisons: {},
  };
}

describe("AnalysisComparisonCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.fetchPracticePublications).mockResolvedValue({ publications: [] });
    vi.mocked(api.fetchTeacherLearningProgressComparison).mockResolvedValue(comparison());
  });

  it("finds practices from the selected diagnosis and renders the actual API fields", async () => {
    vi.mocked(api.fetchPracticePublications).mockResolvedValue({ publications: [{ id: "practice", title: "方程补练", created_at: "2026-10-27" }] });
    render(<AnalysisComparisonCard sourceExamId="exam" sourceBatchId="batch" />);
    await screen.findByText("一元方程");
    expect(api.fetchPracticePublications).toHaveBeenCalledWith("exam", "batch");
    expect(api.fetchTeacherLearningProgressComparison).toHaveBeenCalledWith({ practicePublicationId: "practice", classId: undefined, studentId: undefined });
    expect(screen.getByRole("combobox", { name: "关联复练" })).toHaveTextContent("方程补练");
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("+25.0 个百分点")).toBeInTheDocument();
    expect(screen.getByText("等待完成 1 人")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("explains when no practice has been published", async () => {
    render(<AnalysisComparisonCard sourceExamId="exam" sourceBatchId="batch" />);
    expect(await screen.findByText(/尚无已发布的关联复练/)).toBeInTheDocument();
    expect(api.fetchTeacherLearningProgressComparison).not.toHaveBeenCalled();
  });

  it("discards comparison responses after switching publication", async () => {
    let resolveOld!: (value: api.TeacherComparisonResponse) => void;
    vi.mocked(api.fetchTeacherLearningProgressComparison).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<AnalysisComparisonCard practicePublicationId="old" />);
    await waitFor(() => expect(api.fetchTeacherLearningProgressComparison).toHaveBeenCalledTimes(1));
    view.rerender(<AnalysisComparisonCard practicePublicationId="new" />);
    await screen.findByText("一元方程");
    const old = comparison("old");
    old.knowledge_names = { algebra: "旧知识点" };
    await act(async () => { resolveOld(old); });
    expect(screen.queryByText("旧知识点")).not.toBeInTheDocument();
    expect(screen.getByText("一元方程")).toBeInTheDocument();
  });

  it("allows retry after a failed comparison read", async () => {
    vi.mocked(api.fetchTeacherLearningProgressComparison).mockRejectedValueOnce(new Error("读取失败"));
    render(<AnalysisComparisonCard practicePublicationId="practice" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
    fireEvent.click(screen.getByRole("button", { name: "刷新复练对照" }));
    expect(await screen.findByText("一元方程")).toBeInTheDocument();
  });
});
