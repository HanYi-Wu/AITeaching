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
          time_spent_seconds: 0,
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
          time_spent_seconds: 300,
          show_results: true,
          analysis: { correct_count: 1, wrong_count: 1, answered_count: 2, screen_switch_count: 1 },
          answers: [],
        },
      ],
    });
  });

  it("lets a student change the generated username and password", async () => {
    mocks.updateStudentAccount.mockResolvedValue({
      user: { id: "s1", role: "student", username: "student_custom", display_name: "Student", status: "active" },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByTestId("student-account-username"), "student_custom");
    await userEvent.type(screen.getByTestId("student-account-current-password"), "initial123");
    await userEvent.type(screen.getByTestId("student-account-new-password"), "changed123");
    await userEvent.click(screen.getByTestId("student-account-save"));

    await waitFor(() =>
      expect(mocks.updateStudentAccount).toHaveBeenCalledWith({
        username: "student_custom",
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
        show_results: true,
      },
    });

    render(
      <StudentWorkspace
        user={{ id: "s1", role: "student", username: "stu_abcd", display_name: "Student", status: "active" }}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByText("Online Midterm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("student-start-pub1"));
    expect(await screen.findByText("1+1=?")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("A. 2"));
    await userEvent.type(screen.getByTestId("student-answer-math/q2"), "4");
    await userEvent.click(screen.getByTestId("student-submit-attempt"));

    await waitFor(() =>
      expect(mocks.saveStudentAnswers).toHaveBeenCalledWith("attempt1", [
        { question_id: "math/q1", answer: "A" },
        { question_id: "math/q2", answer: "4" },
      ]),
    );
    expect(mocks.submitStudentAttempt).toHaveBeenCalledWith("attempt1", expect.objectContaining({ time_spent_seconds: expect.any(Number) }));
    await waitFor(() => expect(screen.getAllByText("Old Quiz").length).toBeGreaterThan(0));
    expect(screen.getByText("80%")).toBeInTheDocument();
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

      expect(await screen.findByText("Image Exam")).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("student-start-pub-img"));
      const file = new File(["fake"], "answer.png", { type: "image/png" });
      await userEvent.upload(await screen.findByTestId("student-image-math/q1"), file);
      await userEvent.click(screen.getByTestId("student-submit-attempt"));

      await waitFor(() =>
        expect(mocks.saveStudentAnswers).toHaveBeenCalledWith("attempt-img", [
          {
            question_id: "math/q1",
            images: [{ name: "answer.png", mime_type: "image/png", data_url: "data:image/png;base64,ZmFrZQ==" }],
          },
        ]),
      );
    } finally {
      FileReader.prototype.readAsDataURL = originalReadAsDataURL;
    }
  });
});
