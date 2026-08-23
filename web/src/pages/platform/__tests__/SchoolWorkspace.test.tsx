import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchoolWorkspace } from "../SchoolWorkspace";

const mocks = vi.hoisted(() => ({
  assignTeacherClass: vi.fn(),
  askSchoolAi: vi.fn(),
  bulkUpdateStudents: vi.fn(),
  bulkUpdateTeachers: vi.fn(),
  createClass: vi.fn(),
  createTeacher: vi.fn(),
  deleteClass: vi.fn(),
  downloadSchoolImportTemplate: vi.fn(),
  exportStudentAccounts: vi.fn(),
  getSchoolAiSettings: vi.fn(),
  importClassesFile: vi.fn(),
  importSchoolAiFile: vi.fn(),
  importStudents: vi.fn(),
  importStudentsFile: vi.fn(),
  importTeacherClassAssignmentsFile: vi.fn(),
  importTeachersFile: vi.fn(),
  listClasses: vi.fn(),
  listStudents: vi.fn(),
  listTeacherClassAssignments: vi.fn(),
  listTeachers: vi.fn(),
  removeTeacherClassAssignment: vi.fn(),
  resetStudentPassword: vi.fn(),
  resetTeacherPassword: vi.fn(),
  reviewSchoolAiImportFile: vi.fn(),
  updateClass: vi.fn(),
  updateSchoolAiSettings: vi.fn(),
  updateStudent: vi.fn(),
  updateTeacher: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    assignTeacherClass: mocks.assignTeacherClass,
    askSchoolAi: mocks.askSchoolAi,
    bulkUpdateStudents: mocks.bulkUpdateStudents,
    bulkUpdateTeachers: mocks.bulkUpdateTeachers,
    createClass: mocks.createClass,
    createTeacher: mocks.createTeacher,
    deleteClass: mocks.deleteClass,
    downloadSchoolImportTemplate: mocks.downloadSchoolImportTemplate,
    exportStudentAccounts: mocks.exportStudentAccounts,
    getSchoolAiSettings: mocks.getSchoolAiSettings,
    importClassesFile: mocks.importClassesFile,
    importSchoolAiFile: mocks.importSchoolAiFile,
    importStudents: mocks.importStudents,
    importStudentsFile: mocks.importStudentsFile,
    importTeacherClassAssignmentsFile: mocks.importTeacherClassAssignmentsFile,
    importTeachersFile: mocks.importTeachersFile,
    listClasses: mocks.listClasses,
    listStudents: mocks.listStudents,
    listTeacherClassAssignments: mocks.listTeacherClassAssignments,
    listTeachers: mocks.listTeachers,
    removeTeacherClassAssignment: mocks.removeTeacherClassAssignment,
    resetStudentPassword: mocks.resetStudentPassword,
    resetTeacherPassword: mocks.resetTeacherPassword,
    reviewSchoolAiImportFile: mocks.reviewSchoolAiImportFile,
    updateClass: mocks.updateClass,
    updateSchoolAiSettings: mocks.updateSchoolAiSettings,
    updateStudent: mocks.updateStudent,
    updateTeacher: mocks.updateTeacher,
  };
});

describe("SchoolWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTeachers.mockResolvedValue({
      teachers: [
        {
          id: "t1",
          school_id: "s1",
          role: "teacher",
          username: "teacher_li",
          display_name: "Teacher Li",
          status: "active",
          subjects: ["Math"],
        },
      ],
    });
    mocks.listClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null }],
    });
    mocks.listStudents.mockResolvedValue({
      students: [
        {
          id: "stu1",
          school_id: "s1",
          student_no: "S001",
          display_name: "Student One",
          status: "active",
          account_username: "stu_abcd1234",
          initial_password: "abc1234567",
          class_names: "Class 1",
        },
      ],
    });
    mocks.listTeacherClassAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.assignTeacherClass.mockResolvedValue({ assignment: { teacher_id: "t1", class_id: "c1" } });
    mocks.getSchoolAiSettings.mockResolvedValue({
      ai_available: true,
      ai_enabled: false,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 0, created_at: "", updated_at: "" },
    });
    mocks.updateSchoolAiSettings.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
    });
    mocks.askSchoolAi.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
      capabilities: [],
      stats: { teachers: 1, classes: 1, students: 1, assignments: 0 },
      reply: "当前学校教师名单：\n1. Teacher Li（账号：teacher_li，学科：Math，状态：active）",
      source: "local",
    });
  });

  it("assigns a teacher to a class without requiring a subject", async () => {
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("默认学科")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("学科")).not.toBeInTheDocument();
    expect(screen.getByTestId("teachers-import-file")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("school-page-classes"));
    expect(screen.getByTestId("classes-import-file")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("school-page-students"));
    expect(screen.getByTestId("students-export-link")).toBeInTheDocument();
    expect(screen.getByTestId("students-import-file")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("school-page-assignments"));
    expect(screen.getByTestId("assignments-import-file")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("assign-teacher-class"));

    await waitFor(() =>
      expect(mocks.assignTeacherClass).toHaveBeenCalledWith({
        teacher_id: "t1",
        class_id: "c1",
      }),
    );
  });

  it("lets the school enable AI only through the school switch", async () => {
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-ai"));
    const toggle = await screen.findByTestId("school-ai-toggle");
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => expect(mocks.updateSchoolAiSettings).toHaveBeenCalledWith(true));
  });

  it("uses a chat-style school AI panel and imports files from the AI page", async () => {
    mocks.getSchoolAiSettings.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
    });
    mocks.reviewSchoolAiImportFile.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
      kind: "students",
      row_count: 1,
      review: "AI import review: 1 student row is ready.",
      preview: [{ student_no: "S002", display_name: "Student Two" }],
    });
    mocks.importSchoolAiFile.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
      kind: "students",
      imported: 1,
      review: "AI 导入审核：识别到 1 行学生数据。",
      result: { imported: 1, students: [] },
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-ai"));
    expect(screen.getByTestId("school-ai-panel")).toHaveClass("h-[calc(100vh-9rem)]");
    expect(screen.getByTestId("school-ai-messages")).toHaveClass("overflow-y-auto");
    await userEvent.type(screen.getByPlaceholderText("询问教师导入、学生账号、班级管理或教师分配"), "有哪些教师名字");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(mocks.askSchoolAi).toHaveBeenCalledWith("有哪些教师名字"));
    expect(await screen.findByText(/Teacher Li/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId("school-ai-import-kind"), "students");
    const file = new File([JSON.stringify([{ student_no: "S002", display_name: "Student Two" }])], "students.json", {
      type: "application/json",
    });
    await userEvent.upload(screen.getByTestId("school-ai-import-file"), file);
    await userEvent.click(screen.getByTestId("school-ai-import-run"));

    await waitFor(() => expect(mocks.reviewSchoolAiImportFile).toHaveBeenCalledWith("students", file, "c1"));
    expect(mocks.importSchoolAiFile).not.toHaveBeenCalled();
    expect(await screen.findByTestId("school-ai-import-confirm-card")).toBeInTheDocument();
    expect(screen.getAllByText(/AI import review/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("school-ai-import-confirm"));

    await waitFor(() => expect(mocks.importSchoolAiFile).toHaveBeenCalledWith("students", file, "c1"));
    expect(await screen.findByText(/已确认并写入 1 行数据/)).toBeInTheDocument();
  });

  it("shows the school setup order and opens the unfinished assignment step", async () => {
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();
    expect(screen.getByText("按顺序完成教师、班级、学生和任课分配")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "分配任课教师" }));
    expect(screen.getByTestId("assign-teacher-class")).toBeInTheDocument();
  });

  it("reviews and imports all school data in one AI operation", async () => {
    mocks.getSchoolAiSettings.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
    });
    mocks.reviewSchoolAiImportFile.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
      kind: "all",
      row_count: 4,
      review: "完整学校数据可导入",
      preview: [],
    });
    mocks.importSchoolAiFile.mockResolvedValue({
      ai_available: true,
      ai_enabled: true,
      school: { id: "s1", name: "School A", status: "active", ai_enabled: 1, created_at: "", updated_at: "" },
      kind: "all",
      imported: 4,
      review: "完整学校数据已导入",
      result: {},
    });
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-ai"));
    await userEvent.selectOptions(screen.getByTestId("school-ai-import-kind"), "all");
    const file = new File([JSON.stringify({ classes: [], teachers: [], students: [], assignments: [] })], "school.json", {
      type: "application/json",
    });
    await userEvent.upload(screen.getByTestId("school-ai-import-file"), file);
    await userEvent.click(screen.getByTestId("school-ai-import-run"));
    await waitFor(() => expect(mocks.reviewSchoolAiImportFile).toHaveBeenCalledWith("all", file, null));
    await userEvent.click(screen.getByTestId("school-ai-import-confirm"));
    await waitFor(() => expect(mocks.importSchoolAiFile).toHaveBeenCalledWith("all", file, null));
  });
});
