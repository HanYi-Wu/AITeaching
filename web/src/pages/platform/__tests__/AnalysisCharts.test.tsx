import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformPaperAnalysisCharts } from "../AnalysisCharts";

const analysis = {
  paper: { paper_id: "p1", exam_id: "e1", title: "线上测试", subject: "数学", delivery_mode: "online", status: "published" },
  summary: { total_students: 2, completed_students: 1, in_progress_students: 1, not_started_students: 0, completion_rate: 50, average_score: 50, average_time_seconds: 600, publication_count: 1 },
  proctoring: { event_count: 0, event_type_counts: {}, screen_switch_count: 0, screen_switch_duration_ms: 0, flagged_student_count: 0, exceeded_student_count: 0 },
  modules: [],
  questions: [],
  classes: [],
  students: [],
  radar: [
    { id: "completion", label: "Completion", value: 50 },
    { id: "score", label: "Score", value: 50 },
    { id: "time_efficiency", label: "Time Efficiency", value: 0 },
    { id: "proctoring", label: "Proctoring", value: 100 },
    { id: "module_mastery", label: "Module Mastery", value: 50 },
  ],
} as const;

describe("PlatformPaperAnalysisCharts", () => {
  it("uses Chinese radar labels, usage guidance, and a shrink-safe radar layout", () => {
    render(<PlatformPaperAnalysisCharts analysis={analysis as never} />);

    expect(screen.getByText("查看未开始、答题中和已完成人数，及时提醒未完成学生。")).toBeInTheDocument();
    expect(screen.queryByText(/PublicQ/)).not.toBeInTheDocument();
    expect(screen.getAllByText("时间效率").length).toBeGreaterThan(0);
    expect(screen.getAllByText("考试行为稳定度").length).toBeGreaterThan(0);
    expect(screen.getAllByText("模块掌握度").length).toBeGreaterThan(0);
    expect(screen.queryByText("Time Efficiency")).not.toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-radar")).toHaveClass("min-w-0", "overflow-hidden");
  });
});
