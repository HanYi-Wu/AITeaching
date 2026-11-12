import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformPaperAnalysisCharts } from "../AnalysisCharts";

const analysis = {
  paper: { paper_id: "p1", exam_id: "e1", title: "线上测试", subject: "数学", delivery_mode: "online", status: "published" },
  summary: { total_students: 2, completed_students: 1, in_progress_students: 1, not_started_students: 0, completion_rate: 50, average_score: 50, average_time_seconds: 22, publication_count: 1 },
  proctoring: { event_count: 0, event_type_counts: {}, screen_switch_count: 0, screen_switch_duration_ms: 0, flagged_student_count: 0, exceeded_student_count: 0 },
  modules: [],
  questions: [{ question_id: "q1", header: "1", section_id: "选择题", type: "single_choice", content: "1+1", score_per_item: 5, answered_count: 1, scored_count: 1, correct_count: 1, wrong_count: 0, average_score_percent: 100, accuracy_rate: 100, risk_level: "low" }],
  classes: [{ class_id: "c1", class_name: "七年级一班", class_grade: "七年级", student_count: 1, completed_count: 1, in_progress_count: 0, not_started_count: 0, completion_rate: 100, average_score: 100, average_time_seconds: 22, screen_switch_count: 0 }],
  students: [{ student_id: "s1", display_name: "学生", status: "completed", score_percent: 100, time_spent_seconds: 22, screen_switch_count: 0, screen_switch_limit: 0, class_names: ["七年级一班"] }],
  radar: [
    { id: "completion", label: "Completion", value: 50 },
    { id: "score", label: "Score", value: 50 },
    { id: "time_efficiency", label: "Time Efficiency", value: 0 },
    { id: "proctoring", label: "Proctoring", value: 100 },
    { id: "module_mastery", label: "Module Mastery", value: 50 },
  ],
} as const;

describe("PlatformPaperAnalysisCharts", () => {
  it("uses Chinese radar labels and charts while omitting the removed guidance copy", () => {
    render(<PlatformPaperAnalysisCharts analysis={analysis as never} />);

    expect(screen.queryByText("查看未开始、答题中和已完成人数，及时提醒未完成学生。")).not.toBeInTheDocument();
    const statusChart = screen.getByTestId("paper-analysis-chart-status");
    expect(within(statusChart).getByText("答题进度分布")).toBeInTheDocument();
    expect(within(statusChart).getByText("已完成")).toBeInTheDocument();
    expect(within(statusChart).getByText("答题中")).toBeInTheDocument();
    expect(within(statusChart).getByText("未开始")).toBeInTheDocument();
    expect(within(statusChart).getAllByText("1 人 · 50%")).toHaveLength(2);
    expect(within(statusChart).getByText("0 人 · 0%")).toBeInTheDocument();
    expect(screen.queryByText(/PublicQ/)).not.toBeInTheDocument();
    expect(screen.getAllByText("时间效率").length).toBeGreaterThan(0);
    expect(screen.getAllByText("考试行为稳定度").length).toBeGreaterThan(0);
    expect(screen.getAllByText("模块掌握度").length).toBeGreaterThan(0);
    expect(screen.queryByText("Time Efficiency")).not.toBeInTheDocument();
    expect(screen.getByTestId("paper-analysis-radar")).toHaveClass("min-w-0", "overflow-hidden");
    expect(screen.getAllByText("22 秒").length).toBeGreaterThan(0);
    expect(screen.getByText("低风险")).toBeInTheDocument();
    expect(screen.getAllByText("七年级一班").length).toBeGreaterThan(0);
    expect(screen.queryByText("七年级一班七年级")).not.toBeInTheDocument();
    expect(screen.getByText(/风险等级说明/)).toBeInTheDocument();
  });

  it("plots current class mean values and handles classes without scores", () => {
    const chartAnalysis = {
      ...analysis,
      classes: [
        { ...analysis.classes[0], class_id: "c1", class_name: "七年级一班", average_score: 88 },
        { ...analysis.classes[0], class_id: "c2", class_name: "七年级二班", average_score: null },
      ],
    };
    const { rerender } = render(<PlatformPaperAnalysisCharts analysis={chartAnalysis as never} />);

    const classMeans = screen.getByTestId("paper-analysis-class-means");
    expect(within(classMeans).getByText("七年级一班")).toBeInTheDocument();
    expect(within(classMeans).getByText("七年级二班")).toBeInTheDocument();
    const bars = classMeans.querySelectorAll(".analysis-class-mean-bar");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.getAttribute("style")).toContain("--analysis-chart-target-height: 88%");
    expect(bars[1]?.getAttribute("style")).toContain("--analysis-chart-target-height: 0%");

    rerender(
      <PlatformPaperAnalysisCharts
        analysis={{ ...chartAnalysis, classes: [{ ...chartAnalysis.classes[0], average_score: null }] } as never}
      />,
    );
    expect(screen.getByText("暂无班级平均分数据")).toBeInTheDocument();
  });
});
