import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProvider } from "../../../contexts/AgentContext";
import { TeacherStudentInsightsWorkspace } from "./TeacherStudentInsightsWorkspace";

const mocks = vi.hoisted(() => ({
  listTeacherAssignedClasses: vi.fn(),
  listTeacherClassStudents: vi.fn(),
  getTeacherStudentProfile: vi.fn(),
  publishWrongQuestionPractice: vi.fn(),
  confirmDialog: vi.fn(),
}));

vi.mock("../../../lib/confirmDialog", () => ({ confirmDialog: mocks.confirmDialog }));

vi.mock("../../../platform/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/auth")>()),
  ...mocks,
}));

describe("TeacherStudentInsightsWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTeacherAssignedClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "高一 1 班", grade: "高一", subject: "数学" }],
    });
    mocks.listTeacherClassStudents.mockResolvedValue({
      students: [{ id: "s1", student_no: "S001", display_name: "演示学生1", status: "active" }],
    });
    mocks.getTeacherStudentProfile.mockResolvedValue({
      profile: {
        student: { id: "s1", student_no: "S001", display_name: "演示学生1", status: "active" },
        class_id: "c1",
        summary: {
          exam_count: 4,
          submitted_exam_count: 4,
          graded_exam_count: 3,
          completion_rate: 100,
          average_score_percent: 82.5,
          average_time_seconds: 1200,
          average_time_per_question_seconds: 120,
          integrity_event_count: 1,
          behavior_event_average_per_exam: 0.3,
        },
        radar: [{ id: "score", label: "得分表现", value: 82.5 }],
        recent_exams: [
          { attempt_id: "a1", publication_id: "pub1", can_assign_wrong_question_practice: 1,
            paper_id: "p1", title: "期中考试", subject: "数学", status: "submitted", score_percent: 82.5 },
        ],
        weak_questions: [{ paper_id: "p1", paper_title: "期中考试", question_id: "math/q2", attempt_count: 2, wrong_count: 2, average_score_percent: 40 }],
      },
    });
  });

  it("confirms the exact student and source before assigning a personal practice", async () => {
    mocks.confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.publishWrongQuestionPractice.mockResolvedValue({});
    render(<AgentProvider><TeacherStudentInsightsWorkspace /></AgentProvider>);
    await userEvent.click(await screen.findByText("演示学生1"));
    await userEvent.click(await screen.findByRole("button", { name: "查看薄弱题排名" }));
    const publish = screen.getByRole("button", { name: "布置个人错题练习" });
    expect(publish).toBeDisabled();
    await userEvent.click(screen.getByRole("combobox", { name: "错题练习来源" }));
    await userEvent.click(await screen.findByRole("option", { name: "期中考试" }));
    await userEvent.click(publish);
    expect(mocks.confirmDialog).toHaveBeenCalledWith(expect.stringContaining("演示学生1"), "布置个人错题练习");
    expect(mocks.publishWrongQuestionPractice).not.toHaveBeenCalled();
    await userEvent.click(publish);
    expect(await screen.findByText("已发布个人错题练习。")).toBeInTheDocument();
    expect(mocks.publishWrongQuestionPractice).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      class_id: "c1", student_id: "s1", source_publication_id: "pub1", max_questions_per_student: 5,
    }));
  });

  it("shows a permitted class student profile and analysis", async () => {
    render(
      <AgentProvider>
        <TeacherStudentInsightsWorkspace />
      </AgentProvider>,
    );

    const student = await screen.findByText("演示学生1");
    await userEvent.click(student);
    await waitFor(() => expect(mocks.getTeacherStudentProfile).toHaveBeenCalledWith("c1", "s1", "", ""));
    expect(screen.getAllByText("82.5%").length).toBeGreaterThan(0);
    expect(screen.getByText("期中考试")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "查看薄弱题排名" }));
    expect(screen.getByText("期中考试 · math/q2")).toBeInTheDocument();
  });

  it("keeps changed historical question versions as separate weak question cards", async () => {
    mocks.getTeacherStudentProfile.mockResolvedValueOnce({
      profile: {
        student: { id: "s1", student_no: "S001", display_name: "演示学生1", status: "active" },
        class_id: "c1",
        summary: {
          exam_count: 2,
          submitted_exam_count: 2,
          graded_exam_count: 2,
          completion_rate: 100,
          average_score_percent: 50,
          average_time_per_question_seconds: 120,
          integrity_event_count: 0,
          behavior_event_average_per_exam: 0,
        },
        recent_exams: [],
        weak_questions: [
          {
            paper_id: "p1",
            paper_title: "期中考试",
            question_id: "math/q2",
            attempt_count: 1,
            wrong_count: 1,
            average_score_percent: 40,
            content: "旧题干",
            question_version: 1,
            question_version_count: 2,
            question_version_label: "历史版本 1",
          },
          {
            paper_id: "p1",
            paper_title: "期中考试",
            question_id: "math/q2",
            attempt_count: 1,
            wrong_count: 1,
            average_score_percent: 60,
            content: "新题干",
            question_version: 2,
            question_version_count: 2,
            question_version_label: "历史版本 2",
          },
        ],
      },
    });

    render(
      <AgentProvider>
        <TeacherStudentInsightsWorkspace />
      </AgentProvider>,
    );

    await userEvent.click(await screen.findByText("演示学生1"));
    await userEvent.click(screen.getByRole("button", { name: "查看薄弱题排名" }));
    expect(screen.getByText("历史版本 1")).toBeInTheDocument();
    expect(screen.getByText("历史版本 2")).toBeInTheDocument();
    expect(screen.getByText("旧题干")).toBeInTheDocument();
    expect(screen.getByText("新题干")).toBeInTheDocument();
  });
});
