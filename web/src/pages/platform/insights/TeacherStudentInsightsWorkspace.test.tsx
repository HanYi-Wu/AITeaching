import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProvider } from "../../../contexts/AgentContext";
import { TeacherStudentInsightsWorkspace } from "./TeacherStudentInsightsWorkspace";

const mocks = vi.hoisted(() => ({
  listTeacherAssignedClasses: vi.fn(),
  listTeacherClassStudents: vi.fn(),
  getTeacherStudentProfile: vi.fn(),
}));

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
          { attempt_id: "a1", paper_id: "p1", title: "期中考试", subject: "数学", status: "submitted", score_percent: 82.5 },
        ],
        weak_questions: [{ paper_id: "p1", paper_title: "期中考试", question_id: "math/q2", attempt_count: 2, wrong_count: 2, average_score_percent: 40 }],
      },
    });
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
