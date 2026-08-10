import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdaptivePracticeSelector } from "../AdaptivePracticeSelector";

const history = Array.from({ length: 3 }, (_, index) => ({
  id: `pub-${index + 1}`,
  paper_id: `paper-${index + 1}`,
  title: `历史试卷 ${index + 1}`,
  subject: "数学",
  created_at: `2026-08-${String(index + 1).padStart(2, "0")}`,
  submitted_student_count: 5,
  wrong_answer_count: index + 1,
}));

describe("AdaptivePracticeSelector", () => {
  it("supports one historical source, a personal limit, and gates reinforcement until three sources are selected", async () => {
    const onModeChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onMaxQuestionsChange = vi.fn();
    const { rerender } = render(
      <AdaptivePracticeSelector
        mode="wrong_questions"
        history={history}
        selectedIds={[]}
        loading={false}
        maxQuestionsPerStudent={20}
        onModeChange={onModeChange}
        onSelectionChange={onSelectionChange}
        onMaxQuestionsChange={onMaxQuestionsChange}
      />,
    );

    expect(screen.getByRole("radio", { name: "历史错题卷" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "历史试卷 1" }));
    expect(onSelectionChange).toHaveBeenCalledWith(["pub-1"]);
    fireEvent.change(screen.getByRole("spinbutton", { name: "每名学生最多题数" }), { target: { value: "8" } });
    expect(onMaxQuestionsChange).toHaveBeenLastCalledWith(8);
    fireEvent.change(screen.getByRole("spinbutton", { name: "每名学生最多题数" }), { target: { value: "8.9" } });
    expect(onMaxQuestionsChange).toHaveBeenLastCalledWith(8);

    rerender(
      <AdaptivePracticeSelector
        mode="reinforcement"
        history={history}
        selectedIds={history.slice(0, 2).map((item) => item.id)}
        loading={false}
        maxQuestionsPerStudent={5}
        onModeChange={onModeChange}
        onSelectionChange={onSelectionChange}
        onMaxQuestionsChange={onMaxQuestionsChange}
      />,
    );
    expect(screen.getByText("已选择 2 / 至少 3 份")).toBeInTheDocument();
    expect(screen.getByText("还需选择 1 份历史试卷")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "历史试卷 3" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(history.map((item) => item.id));
  });
});
