import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DuplicateReport as DuplicateReportData } from "../../types/autoCompose";
import { DuplicateReport } from "./DuplicateReport";

const report: DuplicateReportData = {
  method: "text_ngram_v1",
  threshold: 0.85,
  complete: true,
  summary: {
    question_count: 2,
    flagged_count: 1,
    exact_count: 1,
    similar_count: 1,
    history_count: 1,
    within_paper_count: 1,
  },
  questions: [{
    qualified_id: "数学/基础题库/q1",
    occurrences: 2,
    match_count: 2,
    truncated: false,
    matches: [
      {
        source: "history",
        kind: "exact",
        similarity: 1,
        qualified_id: "数学/旧题库/removed-q",
        content_preview: "求函数的最大值。",
        exam_id: "期中/数学",
        exam_title: "期中测验",
      },
      {
        source: "paper",
        kind: "reused",
        similarity: 1,
        qualified_id: "数学/基础题库/q1",
        content_preview: "求函数的最大值。",
      },
    ],
  }],
  warnings: [],
};

describe("DuplicateReport", () => {
  it("shows match sources and stale state, refreshes, and locates a question", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onLocateQuestion = vi.fn();
    render(
      <DuplicateReport
        open
        onClose={vi.fn()}
        report={report}
        stale
        loading={false}
        onRefresh={onRefresh}
        onLocateQuestion={onLocateQuestion}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("试卷题目清单已变化，这份报告已失效");
    expect(screen.getByText("历史试卷")).toBeInTheDocument();
    expect(screen.getByText("本卷")).toBeInTheDocument();
    expect(screen.getByText("文字完全相同")).toBeInTheDocument();
    expect(screen.getByText("重复使用同题")).toBeInTheDocument();
    expect(screen.getAllByText("相似度 100%")).toHaveLength(2);
    expect(screen.getByText(/来源试卷：期中测验（期中\/数学）/)).toBeInTheDocument();
    expect(screen.getByText("本卷重复")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "重新查重" })[0]);
    await user.click(screen.getByRole("button", { name: "数学/基础题库/q1" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onLocateQuestion).toHaveBeenCalledWith("数学/基础题库/q1");
  });

  it("shows a pending state before the first report arrives", () => {
    render(
      <DuplicateReport
        open
        onClose={vi.fn()}
        report={null}
        stale={false}
        loading
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在检查当前试卷");
    expect(screen.queryByText("暂无查重报告。选择“查重”开始检查。")).toBeNull();
  });
});
