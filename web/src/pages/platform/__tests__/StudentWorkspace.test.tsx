import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentWorkspace } from "../StudentWorkspace";

const mocks = vi.hoisted(() => ({
  updateStudentAccount: vi.fn(),
  listStudentPapers: vi.fn(),
  startStudentPaper: vi.fn(),
  saveStudentAnswers: vi.fn(),
  submitStudentAttempt: vi.fn(),
  listStudentResults: vi.fn(),
  recordStudentProctorEvent: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    updateStudentAccount: mocks.updateStudentAccount,
    listStudentPapers: mocks.listStudentPapers,
    startStudentPaper: mocks.startStudentPaper,
    saveStudentAnswers: mocks.saveStudentAnswers,
    submitStudentAttempt: mocks.submitStudentAttempt,
    listStudentResults: mocks.listStudentResults,
    recordStudentProctorEvent: mocks.recordStudentProctorEvent,
  };
});

describe("StudentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("solaire.platform.session", "test-token");
    mocks.listStudentPapers.mockResolvedValue({
      papers: [
        {
          publication_id: "pub1",
          attempt_id: "attempt1",
          exam_id: "midterm/Math",
          title: "Online Midterm",
          subject: "Math",
          status: "not_started",
          question_count: 2,
          screen_switch_count: 0,
          screen_switch_limit: 2,
          time_spent_seconds: 0,
          time_limit_minutes: 30,
          show_results: true,
        },
      ],
    });
    mocks.listStudentResults.mockResolvedValue({
      results: [
        {
          attempt_id: "done1",
          publication_id: "pub0",
          exam_id: "quiz/Math",
          title: "Old Quiz",
          subject: "Math",
          status: "submitted",
          score: 8,
          max_score: 10,
          score_percent: 80,
          screen_switch_count: 1,
          screen_switch_limit: 2,
          time_spent_seconds: 300,
          show_results: true,
          analysis: { correct_count: 1, wrong_count: 1, answered_count: 2, screen_switch_count: 1 },
          answers: [],
        },
      ],
    });
  });

  it("lets a student change password and username separately", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: { id: "s1", role: "student", username: "student_custom", display_name: "Student", status: "active" },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("student-page-home")).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId("student-page-account"));
    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: null,
        current_password: "initial123",
        new_password: "changed123",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "修改用户名" }));
    await userEvent.type(screen.getByTestId("student-account-username"), "student_custom");
    await userEvent.type(screen.getByTestId("student-account-current-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenLastCalledWith({
        username: "student_custom",
        current_password: "changed123",
        new_password: null,
      }),
    );
  });

  it("shows a student getting-started checklist derived from real progress", async () => {
    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    expect(screen.getByText("完成改密、查看待答试卷并提交第一份答卷")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(2);
  });

  it("shows every graded question and can filter the review to wrong answers", async () => {
    mocks.listStudentResults.mockResolvedValue({
      results: [{
        attempt_id: "done1", publication_id: "pub0", exam_id: "quiz/Math", title: "Old Quiz", subject: "Math",
        status: "submitted", score: 8, max_score: 10, score_percent: 80, time_spent_seconds: 300, show_results: true,
        analysis: { correct_count: 1, wrong_count: 1, answered_count: 2 },
        answers: [
          { question_id: "q1", header: "1", content: "1+1=?", answer: "A", correct_answer: "A", analysis: "因为 1+1=2", score: 5, score_per_item: 5, is_correct: true, feedback: "回答正确。" },
          { question_id: "q2", header: "2", content: "2+2=?", answer: "3", correct_answer: "4", analysis: "两个 2 相加等于 4", score: 0, score_per_item: 5, is_correct: false, feedback: "注意基本运算。" },
        ],
      }],
    });

    render(<StudentWorkspace user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }} onLogout={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("student-page-results"));

    expect(await screen.findByText("逐题复盘")).toBeInTheDocument();
    expect(screen.getByText("回答正确。")).toBeInTheDocument();
    expect(screen.getByText("因为 1+1=2")).toBeInTheDocument();
    expect(screen.getByText("正确答案：A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "只看错题" }));
    expect(screen.queryByText("回答正确。")).not.toBeInTheDocument();
    expect(screen.getByText("注意基本运算。")).toBeInTheDocument();
  });

  it("forces first-login students to change password before entering papers", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: {
        id: "s1",
        role: "student",
        username: "stu_abcd",
        display_name: "Student",
        status: "active",
        must_change_password: false,
      },
    });

    render(
      <StudentWorkspace
        user={{
          id: "s1",
          role: "student",
          username: "stu_abcd",
          display_name: "Student",
          status: "active",
          must_change_password: true,
        }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByText("首次登录必须先修改密码，完成后才能进入答题和成绩页面。")).toBeInTheDocument();
    expect(screen.getByTestId("student-page-home")).toBeDisabled();
    expect(screen.getByTestId("student-page-papers")).toBeDisabled();
    expect(screen.queryByTestId("student-account-username")).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: null,
        current_password: "initial123",
        new_password: "changed123",
      }),
    );
  });

  it("lets a student answer an online paper and see result analysis", async () => {
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        screen_switch_count: 0,
        screen_switch_limit: 2,
        time_limit_minutes: 30,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?",
          options: { A: "2", B: "3" },
        },
        {
          question_id: "math/q2",
          header: "1.2",
          section_id: "Choice",
          score_per_item: 5,
          type: "fill",
          content: "计算 $2+2$",
          options: null,
        },
        {
          question_id: "math/q3",
          header: "1.3",
          section_id: "Choice",
          score_per_item: 5,
          type: "multiple_choice",
          content: "Select primes",
          options: { A: "2", B: "4", C: "5" },
        },
      ],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 2 });
    mocks.submitStudentAttempt.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "submitted",
        score: 5,
        max_score: 10,
        score_percent: 50,
        time_spent_seconds: 120,
        screen_switch_count: 0,
        screen_switch_limit: 2,
        show_results: true,
      },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("student-page-papers"));
    expect(await screen.findByText("Online Midterm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    expect(await screen.findByText("1+1=?")).toBeInTheDocument();
    expect(document.querySelector(".katex")).not.toBeNull();
    expect(screen.getByText("30:00")).toBeInTheDocument();
    expect(screen.queryByText("返回待答")).not.toBeInTheDocument();
    expect(screen.queryByText("退出登录")).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByLabelText("A. 2")[0]!);
    await userEvent.type(screen.getByTestId("student-answer-math/q2"), "4");
    await userEvent.click(screen.getAllByLabelText("A. 2")[1]!);
    await userEvent.click(screen.getByLabelText("C. 5"));
    await userEvent.click(screen.getByTestId("student-submit-attempt"));

    expect(mocks.saveStudentAnswers).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "提交前确认" })).toBeInTheDocument();
    expect(screen.getByText("已答 3 题")).toBeInTheDocument();
    expect(screen.getByText("未答 0 题")).toBeInTheDocument();
    expect(screen.getByText("有未保存修改，将随提交一并保存")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() =>
      expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
        "attempt1",
        expect.objectContaining({
          time_spent_seconds: expect.any(Number),
          answers: [
            { question_id: "math/q1", answer: "A", images: [] },
            { question_id: "math/q2", answer: "4", images: [] },
            { question_id: "math/q3", answer: "AC", images: [] },
          ],
        }),
      ),
    );
    await waitFor(() => expect(screen.getAllByText("Old Quiz").length).toBeGreaterThan(0));
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/切屏/)).not.toBeInTheDocument();
  });

  it("submits image answers when the publication requires image upload", async () => {
    mocks.listStudentPapers.mockResolvedValue({
      papers: [
        {
          publication_id: "pub-img",
          attempt_id: "attempt-img",
          exam_id: "image/Math",
          title: "Image Exam",
          subject: "Math",
          status: "not_started",
          question_count: 1,
          screen_switch_count: 0,
          screen_switch_limit: 0,
          time_spent_seconds: 0,
          show_results: false,
          submission_mode: "image_ai",
        },
      ],
    });
    mocks.listStudentResults.mockResolvedValue({ results: [] });
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt-img",
        publication_id: "pub-img",
        exam_id: "image/Math",
        title: "Image Exam",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        screen_switch_count: 0,
        screen_switch_limit: 0,
        show_results: false,
        submission_mode: "image_ai",
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Work",
          score_per_item: 5,
          type: "short_answer",
          content: "Show your work.",
          options: null,
        },
      ],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 1 });
    mocks.submitStudentAttempt.mockResolvedValue({
      attempt: {
        id: "attempt-img",
        publication_id: "pub-img",
        exam_id: "image/Math",
        title: "Image Exam",
        subject: "Math",
        status: "submitted",
        score: null,
        max_score: 5,
        score_percent: null,
        time_spent_seconds: 120,
        screen_switch_count: 0,
        screen_switch_limit: 0,
        show_results: false,
        submission_mode: "image_ai",
      },
    });

    const originalReadAsDataURL = FileReader.prototype.readAsDataURL;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function readAsDataURL(this: FileReader) {
      Object.defineProperty(this, "result", { value: "data:image/png;base64,ZmFrZQ==", configurable: true });
      this.onload?.({ target: this } as ProgressEvent<FileReader>);
    });

    try {
      render(
        <StudentWorkspace
          user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
          onLogout={vi.fn()}
        />,
      );

      await userEvent.click(await screen.findByTestId("student-page-papers"));
      expect(await screen.findByText("Image Exam")).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("student-start-pub-img"));
      const file = new File(["fake"], "answer.png", { type: "image/png" });
      await userEvent.upload(await screen.findByTestId("student-image-math/q1"), file);
      await userEvent.click(screen.getByTestId("student-submit-attempt"));
      await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

      await waitFor(() =>
        expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
          "attempt-img",
          expect.objectContaining({
            answers: [
              {
                question_id: "math/q1",
                answer: "",
                images: [{ name: "answer.png", mime_type: "image/png", data_url: "data:image/png;base64,ZmFrZQ==" }],
              },
            ],
          }),
        ),
      );
    } finally {
      FileReader.prototype.readAsDataURL = originalReadAsDataURL;
    }
  });

  it("restores a draft, shows progress, saves without submitting on page hide, and confirms unanswered questions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Online Midterm",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 0,
        time_limit_minutes: 30,
        remaining_seconds: 1234,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?",
          options: { A: "2", B: "3" },
        },
        {
          question_id: "math/q2",
          header: "1.2",
          section_id: "Choice",
          score_per_item: 5,
          type: "fill",
          content: "2+2=?",
          options: null,
        },
      ],
      saved_answers: [{ question_id: "math/q1", answer: "A", images: [] }],
    });
    mocks.saveStudentAnswers.mockResolvedValue({ answer_count: 2 });
    mocks.submitStudentAttempt.mockResolvedValue({ attempt: { id: "attempt1", status: "submitted" } });
    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));

    expect(await screen.findByText("20:34")).toBeInTheDocument();
    expect(screen.getByText("已作答 1 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("A. 2")).toBeChecked();
    expect(screen.getByText("草稿已恢复")).toBeInTheDocument();

    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.submitStudentAttempt).not.toHaveBeenCalled();
    await waitFor(() => {
      const keepaliveCall = fetchSpy.mock.calls.find(([, init]) => init?.keepalive === true);
      expect(keepaliveCall).toBeDefined();
      expect(JSON.parse(String(keepaliveCall?.[1]?.body))).toEqual({
        answers: [
          { question_id: "math/q1", answer: "A", images: [] },
          { question_id: "math/q2", answer: "", images: [] },
        ],
      });
    });

    document.dispatchEvent(new Event("copy"));
    await waitFor(() =>
      expect(mocks.recordStudentProctorEvent).toHaveBeenCalledWith(
        "attempt1",
        expect.objectContaining({ event_type: "copy" }),
      ),
    );

    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    expect(screen.getByRole("dialog", { name: "提交前确认" })).toBeInTheDocument();
    expect(screen.getByText("已答 1 题")).toBeInTheDocument();
    expect(screen.getByText("未答 1 题")).toBeInTheDocument();
    expect(screen.getByText("草稿已恢复，可安全提交")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "继续检查" }));
    expect(mocks.submitStudentAttempt).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("student-submit-attempt"));
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
    fetchSpy.mockRestore();
  });

  it("auto-submits at zero without an unanswered confirmation", async () => {
    mocks.startStudentPaper.mockResolvedValue({
      attempt: {
        id: "attempt1",
        publication_id: "pub1",
        exam_id: "midterm/Math",
        title: "Timed Exam",
        subject: "Math",
        status: "in_progress",
        time_spent_seconds: 60,
        time_limit_minutes: 1,
        remaining_seconds: 0,
        show_results: true,
      },
      questions: [
        {
          question_id: "math/q1",
          header: "1.1",
          section_id: "Choice",
          score_per_item: 5,
          type: "single_choice",
          content: "1+1=?",
          options: { A: "2", B: "3" },
        },
      ],
      saved_answers: [],
    });
    mocks.submitStudentAttempt.mockResolvedValue({ attempt: { id: "attempt1", status: "submitted" } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("student-page-papers"));
    await userEvent.click(screen.getByTestId("student-start-pub1"));

    await waitFor(() => expect(mocks.submitStudentAttempt).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.submitStudentAttempt).toHaveBeenCalledWith(
      "attempt1",
      expect.objectContaining({ answers: [{ question_id: "math/q1", answer: "", images: [] }] }),
    );
    confirmSpy.mockRestore();
  });
});
