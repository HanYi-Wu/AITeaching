import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { StudentPracticeComparisonCard } from "./StudentPanels";
import * as lpApi from "../../../platform/learningProgress";

vi.mock("../../../platform/learningProgress", () => ({
  fetchStudentLearningProgressComparison: vi.fn(),
}));

describe("StudentPracticeComparisonCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no publicationId or empty node_comparisons", async () => {
    const { container } = render(<StudentPracticeComparisonCard publicationId="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders valid progress comparison with pre, post, and delta pp", async () => {
    const mockData: lpApi.StudentComparisonResponse = {
      practice_publication_id: "pub-prac",
      student_id: "stu-1",
      source_status: {
        status: "valid",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      comparison: {
        status: "valid",
        is_source_modified: false,
        is_source_missing: false,
        node_comparisons: [
          {
            knowledge_node_id: "math/geometry",
            status: "valid",
            is_modified: false,
            pre_score: 2.0,
            pre_max_score: 4.0,
            pre_rate: 0.5,
            pre_percentage: 50.0,
            post_score: 3.0,
            post_max_score: 4.0,
            post_rate: 0.75,
            post_percentage: 75.0,
            delta_percentage_points: 25.0,
            pre_question_count: 1,
            post_question_count: 1,
            question_difference: 0,
            incomparable_reason: null,
          },
        ],
      },
    };

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<StudentPracticeComparisonCard publicationId="pub-prac" />);

    await waitFor(() => {
      expect(screen.getByText("math/geometry")).toBeInTheDocument();
    });

    expect(screen.getByText("首考: 50.0%")).toBeInTheDocument();
    expect(screen.getByText("复练: 75.0%")).toBeInTheDocument();
    expect(screen.getByText("+25.0 pp")).toBeInTheDocument();
  });

  it("displays distinct status for unsubmitted practice, never showing fake 0%", async () => {
    const mockData: lpApi.StudentComparisonResponse = {
      practice_publication_id: "pub-unsub",
      student_id: "stu-1",
      source_status: {
        status: "valid",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      comparison: {
        status: "target_unsubmitted",
        is_source_modified: false,
        is_source_missing: false,
        node_comparisons: [
          {
            knowledge_node_id: "math/algebra",
            status: "target_unsubmitted",
            is_modified: false,
            pre_score: 2.0,
            pre_max_score: 4.0,
            pre_rate: 0.5,
            pre_percentage: 50.0,
            post_score: null,
            post_max_score: 0.0,
            post_rate: null,
            post_percentage: null,
            delta_percentage_points: null,
            pre_question_count: 1,
            post_question_count: 0,
            question_difference: -1,
            incomparable_reason: "复练答卷尚未提交",
          },
        ],
      },
    };

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<StudentPracticeComparisonCard publicationId="pub-unsub" />);

    await waitFor(() => {
      expect(screen.getByText("math/algebra")).toBeInTheDocument();
    });

    expect(screen.getByText("首考: 50.0%")).toBeInTheDocument();
    expect(screen.getByText("复练: 未提交")).toBeInTheDocument();
    expect(screen.getByText("(复练答卷尚未提交)")).toBeInTheDocument();
    // Delta must NOT be 0% or negative decrease
    expect(screen.queryByText("0.0 pp")).not.toBeInTheDocument();
    expect(screen.queryByText("-50.0 pp")).not.toBeInTheDocument();
  });

  it("displays distinct status for unreleased scores, protecting post numbers", async () => {
    const mockData: lpApi.StudentComparisonResponse = {
      practice_publication_id: "pub-unrel",
      student_id: "stu-1",
      source_status: {
        status: "valid",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      comparison: {
        status: "target_unreleased",
        is_source_modified: false,
        is_source_missing: false,
        node_comparisons: [
          {
            knowledge_node_id: "math/algebra",
            status: "target_unreleased",
            is_modified: false,
            pre_score: 2.0,
            pre_max_score: 4.0,
            pre_rate: 0.5,
            pre_percentage: 50.0,
            post_score: null,
            post_max_score: 4.0,
            post_rate: null,
            post_percentage: null,
            delta_percentage_points: null,
            pre_question_count: 1,
            post_question_count: 1,
            question_difference: 0,
            incomparable_reason: "复练成绩尚未发布",
          },
        ],
      },
    };

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<StudentPracticeComparisonCard publicationId="pub-unrel" />);

    await waitFor(() => {
      expect(screen.getByText("math/algebra")).toBeInTheDocument();
    });

    expect(screen.getByText("首考: 50.0%")).toBeInTheDocument();
    expect(screen.getByText("复练: 待发布")).toBeInTheDocument();
    expect(screen.getByText("(复练成绩尚未发布)")).toBeInTheDocument();
    expect(screen.queryByText("0.0 pp")).not.toBeInTheDocument();
  });

  it("displays missing baseline notice without forcing 0%", async () => {
    const mockData: lpApi.StudentComparisonResponse = {
      practice_publication_id: "pub-nobase",
      student_id: "stu-1",
      source_status: {
        status: "valid",
        source_type: "diagnostic_batch",
        source_ref_id: "b1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      comparison: {
        status: "missing_baseline",
        is_source_modified: false,
        is_source_missing: false,
        node_comparisons: [
          {
            knowledge_node_id: "math/functions",
            status: "missing_baseline",
            is_modified: false,
            pre_score: null,
            pre_max_score: 0.0,
            pre_rate: null,
            pre_percentage: null,
            post_score: 4.0,
            post_max_score: 5.0,
            post_rate: 0.8,
            post_percentage: 80.0,
            delta_percentage_points: null,
            pre_question_count: 0,
            post_question_count: 1,
            question_difference: 1,
            incomparable_reason: "缺少首考基线数据",
          },
        ],
      },
    };

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockResolvedValueOnce(mockData);

    render(<StudentPracticeComparisonCard publicationId="pub-nobase" />);

    await waitFor(() => {
      expect(screen.getByText("math/functions")).toBeInTheDocument();
    });

    expect(screen.getByText("首考: 无基线")).toBeInTheDocument();
    expect(screen.getByText("复练: 80.0%")).toBeInTheDocument();
    expect(screen.getByText("(缺少首考基线数据)")).toBeInTheDocument();
    expect(screen.queryByText("+80.0 pp")).not.toBeInTheDocument();
  });

  it("handles race conditions with requestIdRef", async () => {
    let resolveSlow: (v: any) => void = () => {};
    const slowPromise = new Promise((resolve) => {
      resolveSlow = resolve;
    });

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockReturnValueOnce(slowPromise as any);

    const { rerender } = render(<StudentPracticeComparisonCard publicationId="pub-slow" />);

    const fastData: lpApi.StudentComparisonResponse = {
      practice_publication_id: "pub-fast",
      student_id: "stu-1",
      source_status: {
        status: "valid",
        source_type: "exam_publication",
        source_ref_id: "p1",
        is_modified: false,
        is_missing: false,
        reason: null,
      },
      comparison: {
        status: "valid",
        is_source_modified: false,
        is_source_missing: false,
        node_comparisons: [
          {
            knowledge_node_id: "fast_node",
            status: "valid",
            is_modified: false,
            pre_score: 1.0,
            pre_max_score: 2.0,
            pre_rate: 0.5,
            pre_percentage: 50.0,
            post_score: 2.0,
            post_max_score: 2.0,
            post_rate: 1.0,
            post_percentage: 100.0,
            delta_percentage_points: 50.0,
            pre_question_count: 1,
            post_question_count: 1,
            question_difference: 0,
            incomparable_reason: null,
          },
        ],
      },
    };

    vi.mocked(lpApi.fetchStudentLearningProgressComparison).mockResolvedValueOnce(fastData);

    rerender(<StudentPracticeComparisonCard publicationId="pub-fast" />);

    await waitFor(() => {
      expect(screen.getByText("fast_node")).toBeInTheDocument();
    });

    await act(async () => {
      resolveSlow({
        practice_publication_id: "pub-slow",
        student_id: "stu-1",
        source_status: {
          status: "valid",
          source_type: "exam_publication",
          source_ref_id: "p1",
          is_modified: false,
          is_missing: false,
          reason: null,
        },
        comparison: {
          status: "valid",
          is_source_modified: false,
          is_source_missing: false,
          node_comparisons: [
            {
              knowledge_node_id: "slow_node",
              status: "valid",
              is_modified: false,
              pre_score: 1.0,
              pre_max_score: 2.0,
              pre_rate: 0.5,
              pre_percentage: 50.0,
              post_score: 1.0,
              post_max_score: 2.0,
              post_rate: 0.5,
              post_percentage: 50.0,
              delta_percentage_points: 0.0,
              pre_question_count: 1,
              post_question_count: 1,
              question_difference: 0,
              incomparable_reason: null,
            },
          ],
        },
      });
    });

    expect(screen.getByText("fast_node")).toBeInTheDocument();
    expect(screen.queryByText("slow_node")).not.toBeInTheDocument();
  });
});
