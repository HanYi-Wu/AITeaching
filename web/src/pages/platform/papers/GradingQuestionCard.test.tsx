import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSubmissionAnswerRecord } from "../../../platform/auth";
import GradingQuestionCard from "./GradingQuestionCard";

const mocks = vi.hoisted(() => ({ apiGetBlob: vi.fn() }));

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    apiGetBlob: mocks.apiGetBlob,
    resourceApiUrl: (path: string) => `/api/resource/${path}`,
  };
});

const answerA: PaperSubmissionAnswerRecord = {
  question_id: "q1",
  header: "第一题",
  content: "题干 $x+1$ :::PRIMEBRUSH_IMG:paper/first.png:::",
  correct_answer: "$2$",
  options: { A: "$1$", B: "$2$" },
  score_per_item: 5,
  grading_status: "pending",
  images: [],
};

const answerB: PaperSubmissionAnswerRecord = {
  question_id: "q2",
  header: "第二题",
  content: "更新后的题干 $y^2$ :::PRIMEBRUSH_IMG:paper/second.png:::",
  correct_answer: "$3$",
  options: { A: "$4$", B: "$5$" },
  score_per_item: 5,
  grading_status: "pending",
  images: [],
};

function ControlledGradingCard({
  answer,
  saving = false,
  versionChanged = false,
  onSave,
}: {
  answer: PaperSubmissionAnswerRecord;
  saving?: boolean;
  versionChanged?: boolean;
  onSave: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { score: string; feedback: string }>>({});
  const draft = drafts[answer.question_id] ?? { score: "", feedback: "" };
  const updateDraft = (field: "score" | "feedback", value: string) => {
    setDrafts((current) => ({
      ...current,
      [answer.question_id]: { ...(current[answer.question_id] ?? { score: "", feedback: "" }), [field]: value },
    }));
  };

  return (
    <GradingQuestionCard
      answer={answer}
      scoreValue={draft.score}
      feedbackValue={draft.feedback}
      statusLabel="待批改"
      studentAnswerText="学生作答内容"
      saving={saving}
      versionChanged={versionChanged}
      onScoreChange={(value) => updateDraft("score", value)}
      onFeedbackChange={(value) => updateDraft("feedback", value)}
      onSave={onSave}
    />
  );
}

describe("GradingQuestionCard rich text memo boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGetBlob
      .mockResolvedValueOnce(new Blob(["first image"], { type: "image/png" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Blob(["retry image"], { type: "image/png" }));
    let objectUrlId = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => `blob:grading-${++objectUrlId}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
  });

  it("keeps controlled drafts, focus, save state, and changed answer details while resources reload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const view = render(<ControlledGradingCard answer={answerA} versionChanged onSave={onSave} />);

    await waitFor(() => expect(mocks.apiGetBlob).toHaveBeenCalledWith("/api/resource/paper/first.png"));
    expect(await screen.findByRole("img", { name: "题目图片" })).toBeInTheDocument();
    expect(screen.getByText("学生作答内容")).toBeInTheDocument();
    expect(screen.getByText("服务器批改版本已变化，本地草稿基于较早内容；保存前会请你确认。")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".katex")).toHaveLength(4);
    const mathText = () => Array.from(view.container.querySelectorAll(".katex")).map((node) => node.querySelector(".katex-html")?.textContent);
    expect(mathText()).toEqual(expect.arrayContaining(["x+1", "2", "1"]));

    const scoreA = screen.getByTestId("paper-grade-q1");
    await user.type(scoreA, "4");
    expect(scoreA).toHaveValue("4");
    expect(scoreA).toHaveFocus();
    const feedbackA = screen.getByTestId("paper-feedback-q1");
    await user.type(feedbackA, "步骤完整");
    expect(feedbackA).toHaveValue("步骤完整");
    expect(feedbackA).toHaveFocus();
    await user.click(screen.getByTestId("paper-save-grade-q1"));
    expect(onSave).toHaveBeenCalledTimes(1);

    view.rerender(<ControlledGradingCard answer={answerB} saving onSave={onSave} />);
    expect(screen.queryByText("第一题")).not.toBeInTheDocument();
    expect(screen.getByText("第二题")).toBeInTheDocument();
    expect(screen.getByText("更新后的题干")).toBeInTheDocument();
    expect(mathText()).toEqual(expect.arrayContaining(["y2", "3", "4", "5"]));
    expect(screen.getByTestId("paper-grade-q2")).toHaveValue("");
    expect(screen.getByTestId("paper-save-grade-q2")).toBeDisabled();
    await waitFor(() => expect(mocks.apiGetBlob).toHaveBeenCalledWith("/api/resource/paper/second.png"));
    expect(await screen.findByText("图片加载失败，请检查登录状态后重试")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".katex")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "重试图片" }));
    expect(await screen.findByRole("img", { name: "题目图片" })).toBeInTheDocument();
    expect(mocks.apiGetBlob).toHaveBeenCalledTimes(3);

    view.rerender(<ControlledGradingCard answer={answerA} onSave={onSave} />);
    expect(screen.getByTestId("paper-grade-q1")).toHaveValue("4");
    expect(screen.getByTestId("paper-feedback-q1")).toHaveValue("步骤完整");
    expect(screen.getByText("题干")).toBeInTheDocument();
    expect(screen.queryByText("更新后的题干")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.apiGetBlob).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole("img", { name: "题目图片" })).toBeInTheDocument();
  });
});
