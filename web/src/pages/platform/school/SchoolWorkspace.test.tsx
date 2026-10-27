import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchoolWorkspace } from "./SchoolWorkspace";

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

  it("ignores late responses from a previously selected account after switching", async () => {
    let resolveUser1Teachers!: (value: unknown) => void;
    const user1TeachersPromise = new Promise((resolve) => {
      resolveUser1Teachers = resolve;
    });

    let firstCall = true;
    mocks.listTeachers.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return user1TeachersPromise;
      }
      return Promise.resolve({
        teachers: [
          {
            id: "t2",
            school_id: "s2",
            role: "teacher",
            username: "teacher_new",
            display_name: "Teacher New",
            status: "active",
            subjects: ["Physics"],
          },
        ],
      });
    });

    const { rerender } = render(
      <SchoolWorkspace
        user={{ id: "u1", school_id: "s1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    // Switch account to u2
    rerender(
      <SchoolWorkspace
        user={{ id: "u2", school_id: "s2", role: "school", username: "school_b", display_name: "School B", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher New")).toBeInTheDocument();

    // Now late response for user 1 resolves with Teacher Li
    resolveUser1Teachers({
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

    // Wait a tick; Teacher Li must NOT overwrite Teacher New
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByDisplayValue("Teacher New")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Teacher Li")).not.toBeInTheDocument();
  });

  it("isolates list requests across six consecutive search updates", async () => {
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();

    const baselineCalls = {
      teachers: mocks.listTeachers.mock.calls.length,
      classes: mocks.listClasses.mock.calls.length,
      students: mocks.listStudents.mock.calls.length,
      assignments: mocks.listTeacherClassAssignments.mock.calls.length,
      ai: mocks.getSchoolAiSettings.mock.calls.length,
    };

    const searchInput = screen.getByPlaceholderText("搜索");
    await userEvent.type(searchInput, "abcdef");

    // Total target list calls increased by exactly 6
    expect(mocks.listTeachers).toHaveBeenCalledTimes(baselineCalls.teachers + 6);

    // Other lists, options, and AI queries were NOT called
    expect(mocks.listClasses).toHaveBeenCalledTimes(baselineCalls.classes);
    expect(mocks.listStudents).toHaveBeenCalledTimes(baselineCalls.students);
    expect(mocks.listTeacherClassAssignments).toHaveBeenCalledTimes(baselineCalls.assignments);
    expect(mocks.getSchoolAiSettings).toHaveBeenCalledTimes(baselineCalls.ai);

    // Active teacher choices query (pageSize: 100) was NOT re-triggered
    const choicesCalls = mocks.listTeachers.mock.calls
      .slice(baselineCalls.teachers)
      .filter(([arg]: any) => arg && arg.pageSize === 100);
    expect(choicesCalls).toHaveLength(0);
  });

  it("keeps the newest list response when same-account queries resolve out of order", async () => {
    let resolveQueryA!: (val: unknown) => void;
    let resolveQueryB!: (val: unknown) => void;
    const promiseA = new Promise((resolve) => { resolveQueryA = resolve; });
    const promiseB = new Promise((resolve) => { resolveQueryB = resolve; });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();

    let callIndex = 0;
    mocks.listTeachers.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return promiseA;
      if (callIndex === 2) return promiseB;
      return Promise.resolve({ teachers: [], total: 0 });
    });

    const searchInput = screen.getByPlaceholderText("搜索");
    // Trigger Query A
    await userEvent.type(searchInput, "A");
    // Trigger Query B
    await userEvent.type(searchInput, "B");

    // Resolve B first with Teacher B
    resolveQueryB({
      teachers: [
        {
          id: "t_b",
          school_id: "s1",
          role: "teacher",
          username: "teacher_b",
          display_name: "Teacher B",
          status: "active",
          subjects: ["Biology"],
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    expect(await screen.findByDisplayValue("Teacher B")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 1 页，共 1 条")).toBeInTheDocument();

    // Now resolve Query A late with Teacher A
    await act(async () => {
      resolveQueryA({
        teachers: [
          {
            id: "t_a",
            school_id: "s1",
            role: "teacher",
            username: "teacher_a",
            display_name: "Teacher A",
            status: "active",
            subjects: ["Art"],
          },
        ],
        total: 50,
        page: 1,
        page_size: 10,
        total_pages: 5,
      });
      await promiseA;
    });

    // UI and metadata must remain Query B's results
    expect(screen.getByDisplayValue("Teacher B")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Teacher A")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 / 1 页，共 1 条")).toBeInTheDocument();
  });

  it("ignores stale same-account query errors without disturbing the latest request", async () => {
    const onError = vi.fn();
    let rejectQueryA!: (err: unknown) => void;
    let resolveQueryB!: (val: unknown) => void;
    const promiseA = new Promise((_, reject) => { rejectQueryA = reject; });
    const promiseB = new Promise((resolve) => { resolveQueryB = resolve; });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={onError}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
    onError.mockClear();

    let callIndex = 0;
    mocks.listTeachers.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return promiseA;
      if (callIndex === 2) return promiseB;
      return Promise.resolve({ teachers: [], total: 0 });
    });

    const searchInput = screen.getByPlaceholderText("搜索");
    await userEvent.type(searchInput, "A");
    await userEvent.type(searchInput, "B");

    // Reject Query A while Query B is still pending
    await act(async () => {
      rejectQueryA(new Error("Stale query network failure"));
      await promiseA.catch(() => undefined);
    });
    expect(onError).not.toHaveBeenCalled();

    // Resolve Query B
    resolveQueryB({
      teachers: [
        {
          id: "t_b",
          school_id: "s1",
          role: "teacher",
          username: "teacher_b",
          display_name: "Teacher B",
          status: "active",
          subjects: ["Biology"],
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    expect(await screen.findByDisplayValue("Teacher B")).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("refreshes teacher and assignment options after a teacher write", async () => {
    mocks.createTeacher.mockResolvedValue({
      teacher: {
        id: "t_wang",
        school_id: "s1",
        role: "teacher",
        username: "teacher_wang",
        display_name: "Teacher Wang",
        status: "active",
        subjects: ["Chemistry"],
      },
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();

    const baselineCalls = {
      classes: mocks.listClasses.mock.calls.length,
      students: mocks.listStudents.mock.calls.length,
      assignments: mocks.listTeacherClassAssignments.mock.calls.length,
      ai: mocks.getSchoolAiSettings.mock.calls.length,
    };

    mocks.listTeachers.mockResolvedValue({
      teachers: [
        { id: "t1", school_id: "s1", role: "teacher", username: "teacher_li", display_name: "Teacher Li", status: "active", subjects: ["Math"] },
        { id: "t_wang", school_id: "s1", role: "teacher", username: "teacher_wang", display_name: "Teacher Wang", status: "active", subjects: ["Chemistry"] },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    await userEvent.type(screen.getByPlaceholderText("登录用户名"), "teacher_wang");
    await userEvent.type(screen.getByPlaceholderText("初始密码"), "pass123456");
    await userEvent.type(screen.getByPlaceholderText("教师姓名"), "Teacher Wang");
    await userEvent.type(screen.getByPlaceholderText("任教学科（逗号分隔）"), "Chemistry");
    await userEvent.click(screen.getByRole("button", { name: "创建教师" }));

    expect(await screen.findByDisplayValue("Teacher Wang")).toBeInTheDocument();

    // Verify non-dependent endpoints were not called
    expect(mocks.listClasses).toHaveBeenCalledTimes(baselineCalls.classes);
    expect(mocks.listStudents).toHaveBeenCalledTimes(baselineCalls.students);
    expect(mocks.listTeacherClassAssignments).toHaveBeenCalledTimes(baselineCalls.assignments);
    expect(mocks.getSchoolAiSettings).toHaveBeenCalledTimes(baselineCalls.ai);

    // Verify cross-panel dependent dropdown (Assignments panel teacher select)
    await userEvent.click(screen.getByTestId("school-page-assignments"));
    expect(screen.getByRole("option", { name: /Teacher Wang/ })).toBeInTheDocument();
  });

  it("refreshes class and cross-panel select options after a class write", async () => {
    mocks.createClass.mockResolvedValue({
      class: { id: "c_new", school_id: "s1", name: "Class 2", grade: "G10", subject_hint: null },
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-classes"));
    expect(await screen.findByDisplayValue("Class 1")).toBeInTheDocument();

    const baselineCalls = {
      teachers: mocks.listTeachers.mock.calls.length,
      students: mocks.listStudents.mock.calls.length,
      assignments: mocks.listTeacherClassAssignments.mock.calls.length,
      ai: mocks.getSchoolAiSettings.mock.calls.length,
    };

    mocks.listClasses.mockResolvedValue({
      classes: [
        { id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null },
        { id: "c_new", school_id: "s1", name: "Class 2", grade: "G10", subject_hint: null },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    await userEvent.type(screen.getByPlaceholderText("班级名称，如 高一 1 班"), "Class 2");
    await userEvent.type(screen.getByPlaceholderText("年级，如 高一"), "G10");
    await userEvent.click(screen.getByRole("button", { name: "创建班级" }));

    expect(await screen.findByDisplayValue("Class 2")).toBeInTheDocument();

    // Verify non-dependent endpoints were not called
    expect(mocks.listTeachers).toHaveBeenCalledTimes(baselineCalls.teachers);
    expect(mocks.listStudents).toHaveBeenCalledTimes(baselineCalls.students);
    expect(mocks.listTeacherClassAssignments).toHaveBeenCalledTimes(baselineCalls.assignments);
    expect(mocks.getSchoolAiSettings).toHaveBeenCalledTimes(baselineCalls.ai);

    // Verify cross-panel dependent dropdowns
    // 1. Assignments panel class select
    await userEvent.click(screen.getByTestId("school-page-assignments"));
    expect(screen.getByRole("option", { name: /Class 2/ })).toBeInTheDocument();

    // 2. Students panel class select and filter options
    await userEvent.click(screen.getByTestId("school-page-students"));
    expect(screen.getAllByRole("option", { name: /Class 2/ }).length).toBeGreaterThan(0);
  });

  it("keeps the latest list query when a write finishes after the query changes", async () => {
    let resolveCreate!: (value: unknown) => void;
    mocks.createTeacher.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const teacherLi = {
      id: "t1", school_id: "s1", role: "teacher", username: "teacher_li",
      display_name: "Teacher Li", status: "active", subjects: ["Math"],
    };
    const teacherLatest = {
      id: "t_latest", school_id: "s1", role: "teacher", username: "teacher_latest",
      display_name: "Teacher Latest", status: "active", subjects: ["Science"],
    };
    mocks.listTeachers.mockImplementation((query: any = {}) => {
      if (query.pageSize === 100) return Promise.resolve({ teachers: [teacherLi, teacherLatest] });
      if (query.q === "Latest") return Promise.resolve({ teachers: [teacherLatest], total: 1, page: 1, page_size: 10, total_pages: 1 });
      return Promise.resolve({ teachers: [teacherLi, teacherLatest], total: 2, page: 1, page_size: 10, total_pages: 1 });
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("登录用户名"), "teacher_latest");
    await userEvent.type(screen.getByPlaceholderText("初始密码"), "pass123456");
    await userEvent.click(screen.getByRole("button", { name: "创建教师" }));

    // The query controls remain available while the write is pending.
    await userEvent.type(screen.getByPlaceholderText("搜索"), "Latest");
    expect(await screen.findByDisplayValue("Teacher Latest")).toBeInTheDocument();

    const listCallCountBeforeWriteCompletes = mocks.listTeachers.mock.calls.filter(
      ([query]: any[]) => query?.pageSize !== 100,
    ).length;
    resolveCreate({ teacher: teacherLatest });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建教师" })).not.toBeDisabled());

    await waitFor(() => {
      const listCalls = mocks.listTeachers.mock.calls.filter(([query]: any[]) => query?.pageSize !== 100);
      expect(listCalls.length).toBeGreaterThan(listCallCountBeforeWriteCompletes);
      expect(listCalls.at(-1)?.[0]).toEqual(expect.objectContaining({ q: "Latest" }));
      expect(screen.queryByDisplayValue("Teacher Li")).not.toBeInTheDocument();
    });
  });

  it("user perspective: end-to-end navigation, search, filter, and pagination across all panels", async () => {
    // Mock multi-item paginated response for teachers
    mocks.listTeachers.mockResolvedValue({
      teachers: [
        { id: "t1", school_id: "s1", role: "teacher", username: "teacher_li", display_name: "Teacher Li", status: "active", subjects: ["Math"] },
        { id: "t2", school_id: "s1", role: "teacher", username: "teacher_zhang", display_name: "Teacher Zhang", status: "active", subjects: ["English"] },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    mocks.listClasses.mockResolvedValue({
      classes: [{ id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null }],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    mocks.listStudents.mockResolvedValue({
      students: [
        { id: "stu1", school_id: "s1", student_no: "S001", display_name: "Student One", status: "active", account_username: "stu1", initial_password: "123", class_names: "Class 1" },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });
    mocks.listTeacherClassAssignments.mockResolvedValue({
      assignments: [{ teacher_id: "t1", class_id: "c1", teacher_name: "Teacher Li", class_name: "Class 1" }],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    // 1. Overview panel: verify metric cards
    expect(await screen.findByText("学校数据概览")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "首次使用清单" })).toBeInTheDocument();

    // 2. Teachers panel: navigate, search, filter by status
    await userEvent.click(screen.getByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Teacher Zhang")).toBeInTheDocument();

    // Teacher search
    const teacherSearch = screen.getByPlaceholderText("搜索");
    await userEvent.clear(teacherSearch);
    await userEvent.type(teacherSearch, "Zhang");
    await waitFor(() =>
      expect(mocks.listTeachers).toHaveBeenCalledWith(
        expect.objectContaining({ q: "Zhang" }),
      ),
    );

    // Teacher status filter
    const statusSelect = screen.getByDisplayValue("全部状态");
    await userEvent.selectOptions(statusSelect, "active");
    await waitFor(() =>
      expect(mocks.listTeachers).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" }),
      ),
    );

    // 3. Classes panel: navigate and search
    await userEvent.click(screen.getByTestId("school-page-classes"));
    expect(await screen.findByDisplayValue("Class 1")).toBeInTheDocument();
    const classSearch = screen.getByPlaceholderText("搜索");
    await userEvent.type(classSearch, "Grade 10");
    await waitFor(() =>
      expect(mocks.listClasses).toHaveBeenCalledWith(
        expect.objectContaining({ q: "Grade 10" }),
      ),
    );

    // 4. Students panel: navigate, filter by class dropdown
    await userEvent.click(screen.getByTestId("school-page-students"));
    expect(await screen.findByDisplayValue("Student One")).toBeInTheDocument();
    const classFilterSelect = screen.getByDisplayValue("全部班级");
    await userEvent.selectOptions(classFilterSelect, "c1");
    await waitFor(() =>
      expect(mocks.listStudents).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({ page: 1 }),
      ),
    );

    // 5. Assignments panel: navigate and verify existing assignment
    await userEvent.click(screen.getByTestId("school-page-assignments"));
    expect((await screen.findAllByText("Teacher Li")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Class 1").length).toBeGreaterThan(0);

    // 6. Header global refresh button: click and verify full reload
    const baselineGlobalCalls = {
      ai: mocks.getSchoolAiSettings.mock.calls.length,
      teachers: mocks.listTeachers.mock.calls.length,
      classes: mocks.listClasses.mock.calls.length,
      students: mocks.listStudents.mock.calls.length,
      assignments: mocks.listTeacherClassAssignments.mock.calls.length,
    };
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => {
      expect(mocks.getSchoolAiSettings.mock.calls.length).toBeGreaterThan(baselineGlobalCalls.ai);
      expect(mocks.listTeachers.mock.calls.length).toBeGreaterThan(baselineGlobalCalls.teachers);
      expect(mocks.listClasses.mock.calls.length).toBeGreaterThan(baselineGlobalCalls.classes);
    });
  });

  it("user perspective: handles empty data states gracefully across lists", async () => {
    mocks.listTeachers.mockResolvedValue({ teachers: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.listClasses.mockResolvedValue({ classes: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.listStudents.mockResolvedValue({ students: [], total: 0, page: 1, page_size: 10, total_pages: 1 });
    mocks.listTeacherClassAssignments.mockResolvedValue({ assignments: [], total: 0, page: 1, page_size: 10, total_pages: 1 });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    // Overview shows 0 metrics without error
    expect(await screen.findByText("学校数据概览")).toBeInTheDocument();

    // Teachers panel shows empty message "暂无数据"
    await userEvent.click(screen.getByTestId("school-page-teachers"));
    expect(await screen.findByText("暂无数据")).toBeInTheDocument();

    // Classes panel shows empty message "暂无数据"
    await userEvent.click(screen.getByTestId("school-page-classes"));
    expect(await screen.findByText("暂无数据")).toBeInTheDocument();

    // Students panel shows empty message "暂无数据"
    await userEvent.click(screen.getByTestId("school-page-students"));
    expect(await screen.findByText("暂无数据")).toBeInTheDocument();

    // Assignments panel shows empty message "暂无数据"
    await userEvent.click(screen.getByTestId("school-page-assignments"));
    expect(await screen.findByText("暂无数据")).toBeInTheDocument();
  });

  it("user perspective: gracefully handles query errors and allows recovery without page reload", async () => {
    const onError = vi.fn();
    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={onError}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-teachers"));
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
    onError.mockClear();

    // Simulate query failure
    mocks.listTeachers.mockRejectedValueOnce(new Error("服务器响应超时"));

    const searchInput = screen.getByPlaceholderText("搜索");
    await userEvent.type(searchInput, "X");

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("服务器响应超时");
    });

    // User recovers by searching again, next query succeeds
    mocks.listTeachers.mockResolvedValueOnce({
      teachers: [
        { id: "t1", school_id: "s1", role: "teacher", username: "teacher_li", display_name: "Teacher Li", status: "active", subjects: ["Math"] },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    await userEvent.type(searchInput, "Y");
    expect(await screen.findByDisplayValue("Teacher Li")).toBeInTheDocument();
  });
});
