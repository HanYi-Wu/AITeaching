import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchoolWorkspace } from "../SchoolWorkspace";

const mocks = vi.hoisted(() => ({
  assignTeacherClass: vi.fn(),
  bulkUpdateStudents: vi.fn(),
  bulkUpdateTeachers: vi.fn(),
  createClass: vi.fn(),
  createTeacher: vi.fn(),
  deleteClass: vi.fn(),
  downloadSchoolImportTemplate: vi.fn(),
  exportStudentAccounts: vi.fn(),
  importClassesFile: vi.fn(),
  importStudents: vi.fn(),
  importStudentsFile: vi.fn(),
  importTeachersFile: vi.fn(),
  listClasses: vi.fn(),
  listStudents: vi.fn(),
  listTeacherClassAssignments: vi.fn(),
  listTeachers: vi.fn(),
  removeTeacherClassAssignment: vi.fn(),
  resetStudentPassword: vi.fn(),
  resetTeacherPassword: vi.fn(),
  updateClass: vi.fn(),
  updateStudent: vi.fn(),
  updateTeacher: vi.fn(),
}));

vi.mock("../../../platform/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/auth")>();
  return {
    ...actual,
    assignTeacherClass: mocks.assignTeacherClass,
    bulkUpdateStudents: mocks.bulkUpdateStudents,
    bulkUpdateTeachers: mocks.bulkUpdateTeachers,
    createClass: mocks.createClass,
    createTeacher: mocks.createTeacher,
    deleteClass: mocks.deleteClass,
    downloadSchoolImportTemplate: mocks.downloadSchoolImportTemplate,
    exportStudentAccounts: mocks.exportStudentAccounts,
    importClassesFile: mocks.importClassesFile,
    importStudents: mocks.importStudents,
    importStudentsFile: mocks.importStudentsFile,
    importTeachersFile: mocks.importTeachersFile,
    listClasses: mocks.listClasses,
    listStudents: mocks.listStudents,
    listTeacherClassAssignments: mocks.listTeacherClassAssignments,
    listTeachers: mocks.listTeachers,
    removeTeacherClassAssignment: mocks.removeTeacherClassAssignment,
    resetStudentPassword: mocks.resetStudentPassword,
    resetTeacherPassword: mocks.resetTeacherPassword,
    updateClass: mocks.updateClass,
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
  });

  it("assigns a teacher to a class without requiring a subject", async () => {
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(await screen.findByText("Teacher Li")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("默认学科")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("学科")).not.toBeInTheDocument();
    expect(screen.getByTestId("students-export-link")).toBeInTheDocument();
    expect(screen.getByTestId("teachers-import-file")).toBeInTheDocument();
    expect(screen.getByTestId("classes-import-file")).toBeInTheDocument();
    expect(screen.getByTestId("students-import-file")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("assign-teacher-class"));

    await waitFor(() =>
      expect(mocks.assignTeacherClass).toHaveBeenCalledWith({
        teacher_id: "t1",
        class_id: "c1",
      }),
    );
  });
});
