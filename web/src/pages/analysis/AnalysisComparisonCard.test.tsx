import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnalysisComparisonCard } from "./AnalysisComparisonCard";
import * as lpApi from "../../platform/learningProgress";

vi.mock("../../platform/learningProgress", () => ({
  fetchTeacherLearningProgressComparison: vi.fn(),
}));

describe("AnalysisComparisonCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input and initial empty prompt", () => {
    render(<AnalysisComparisonCard />);

    expect(screen.getByText("靶向复练前后掌握率对照")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入复练批次 ID")).toBeInTheDocument();
    expect(screen.getByText(/输入关联靶向练习的发布批次 ID/)).toBeInTheDocument();
  });

  it("loads and renders comparison data with delta pp and sample size", async () => {
    const mockData: lpApi.TeacherComparisonResponse = {
      practice_publication_id: "pub-123",
      source_status: {
        status: "valid",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      class_comparison: {
        status: "valid",
        is_source_modified: false,
        is_source_missing: false,
        matched_students: ["stu-1", "stu-2"],
        node_summaries: [
          {
            knowledge_node_id: "math/algebra",
            status: "valid",
            is_modified: false,
            matched_sample_size: 2,
            pre_class_percentage: 50.0,
            post_class_percentage: 75.0,
            delta_percentage_points: 25.0,
            pre_question_count: 2,
            post_question_count: 3,
            question_difference: 1,
            incomparable_reason: null,
          },
        ],
      },
      student_comparisons: {},
    };

    vi.mocked(lpApi.fetchTeacherLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<AnalysisComparisonCard practicePublicationId="pub-123" />);

    await waitFor(() => {
      expect(screen.getByText("math/algebra")).toBeInTheDocument();
    });

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("+25.0 pp")).toBeInTheDocument();
    expect(screen.getByText("2 人")).toBeInTheDocument();
    expect(screen.getByText("2 题 / 3 题")).toBeInTheDocument();
    expect(screen.getByText("(+1)")).toBeInTheDocument();
    expect(screen.getByText("可比")).toBeInTheDocument();
  });

  it("displays warning banner when source is modified", async () => {
    const mockData: lpApi.TeacherComparisonResponse = {
      practice_publication_id: "pub-mod",
      source_status: {
        status: "source_modified",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: true,
        is_missing: false,
        reason: "Source scores regraded",
      },
      class_comparison: {
        status: "source_modified",
        is_source_modified: true,
        is_source_missing: false,
        matched_students: ["stu-1"],
        node_summaries: [
          {
            knowledge_node_id: "math/geometry",
            status: "source_modified",
            is_modified: true,
            matched_sample_size: 1,
            pre_class_percentage: 40.0,
            post_class_percentage: 60.0,
            delta_percentage_points: 20.0,
            pre_question_count: 1,
            post_question_count: 1,
            question_difference: 0,
            incomparable_reason: null,
          },
        ],
      },
      student_comparisons: {},
    };

    vi.mocked(lpApi.fetchTeacherLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<AnalysisComparisonCard practicePublicationId="pub-mod" />);

    await waitFor(() => {
      expect(screen.getByText(/来源首考成绩已被复核修改/)).toBeInTheDocument();
    });
    expect(screen.getByText("原分复核")).toBeInTheDocument();
  });

  it("displays warning banner when source is missing", async () => {
    const mockData: lpApi.TeacherComparisonResponse = {
      practice_publication_id: "pub-missing",
      source_status: {
        status: "source_missing",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: true,
        reason: "Source deleted",
      },
      class_comparison: {
        status: "source_missing",
        is_source_modified: false,
        is_source_missing: true,
        matched_students: [],
        node_summaries: [
          {
            knowledge_node_id: "math/geometry",
            status: "source_missing",
            is_modified: false,
            matched_sample_size: 0,
            pre_class_percentage: 40.0,
            post_class_percentage: null,
            delta_percentage_points: null,
            pre_question_count: 1,
            post_question_count: 0,
            question_difference: -1,
            incomparable_reason: "来源考试已被删除或撤回，历史基线不可比",
          },
        ],
      },
      student_comparisons: {},
    };

    vi.mocked(lpApi.fetchTeacherLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<AnalysisComparisonCard practicePublicationId="pub-missing" />);

    await waitFor(() => {
      expect(screen.getByText(/来源考试或批次缺失/)).toBeInTheDocument();
    });
    expect(screen.getByText("来源考试已被删除或撤回，历史基线不可比")).toBeInTheDocument();
  });

  it("handles out-of-order responses gracefully with requestIdRef", async () => {
    let resolveFirst: (v: any) => void = () => {};
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    vi.mocked(lpApi.fetchTeacherLearningProgressComparison).mockReturnValueOnce(firstPromise as any);

    const { rerender } = render(<AnalysisComparisonCard practicePublicationId="pub-slow" />);

    // Fast second call
    const fastData: lpApi.TeacherComparisonResponse = {
      practice_publication_id: "pub-fast",
      source_status: {
        status: "valid",
        source_type: "exam_publication",
        source_ref_id: "p1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      class_comparison: {
        status: "valid",
        is_source_modified: false,
        is_source_missing: false,
        matched_students: ["stu-2"],
        node_summaries: [
          {
            knowledge_node_id: "fast_node",
            status: "valid",
            is_modified: false,
            matched_sample_size: 1,
            pre_class_percentage: 60.0,
            post_class_percentage: 80.0,
            delta_percentage_points: 20.0,
            pre_question_count: 1,
            post_question_count: 1,
            question_difference: 0,
            incomparable_reason: null,
          },
        ],
      },
      student_comparisons: {},
    };

    vi.mocked(lpApi.fetchTeacherLearningProgressComparison).mockResolvedValueOnce(fastData);

    rerender(<AnalysisComparisonCard practicePublicationId="pub-fast" />);

    await waitFor(() => {
      expect(screen.getByText("fast_node")).toBeInTheDocument();
    });

    // Resolve the slow first call
    await act(async () => {
      resolveFirst({
        practice_publication_id: "pub-slow",
        source_status: {
          status: "valid",
          source_type: "exam_publication",
          source_ref_id: "p1",
          is_modified: false,
          is_missing: false,
          reason: null,
        },
        class_comparison: {
          status: "valid",
          is_source_modified: false,
          is_source_missing: false,
          matched_students: ["stu-1"],
          node_summaries: [
            {
              knowledge_node_id: "slow_node",
              status: "valid",
              is_modified: false,
              matched_sample_size: 1,
              pre_class_percentage: 10.0,
              post_class_percentage: 20.0,
              delta_percentage_points: 10.0,
              pre_question_count: 1,
              post_question_count: 1,
              question_difference: 0,
              incomparable_reason: null,
            },
          ],
        },
        student_comparisons: {},
      });
    });

    // Should still display fast_node, not slow_node
    expect(screen.getByText("fast_node")).toBeInTheDocument();
    expect(screen.queryByText("slow_node")).not.toBeInTheDocument();
  });
});
