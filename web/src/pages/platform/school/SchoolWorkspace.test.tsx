import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformRequestError } from "../../../platform/platformRequest";
import { SchoolWorkspace } from "./SchoolWorkspace";
import { selectOption } from "../../../test/selectOption";

function comboboxWithText(text: string) {
  const trigger = screen.getAllByRole("combobox").find((element) => element.textContent?.includes(text));
  if (!trigger) throw new Error(`Select trigger not found: ${text}`);
  return trigger;
}

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
  getStudentClassTransfer: vi.fn(),
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
  transferStudentClass: vi.fn(),
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
    getStudentClassTransfer: mocks.getStudentClassTransfer,
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
    transferStudentClass: mocks.transferStudentClass,
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

    await selectOption(screen.getByTestId("school-ai-import-kind"), "students");
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
    await selectOption(screen.getByTestId("school-ai-import-kind"), "all");
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
    await userEvent.click(comboboxWithText("Teacher Li"));
    expect(screen.getByRole("option", { name: /Teacher Wang/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
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
    await userEvent.click(comboboxWithText("Class 2"));
    expect(screen.getByRole("option", { name: /Class 2/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    // 2. Students panel class select and filter options
    await userEvent.click(screen.getByTestId("school-page-students"));
    await userEvent.click(comboboxWithText("全部班级"));
    expect(screen.getAllByRole("option", { name: /Class 2/ }).length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(comboboxWithText("Class 2"));
    expect(screen.getByRole("option", { name: "Class 2" })).toBeInTheDocument();
  });

  it("clears deleted class selections and refreshes students without stale responses", async () => {
    const classOne = { id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null };
    const classTwo = { id: "c2", school_id: "s1", name: "Class 2", grade: "G10", subject_hint: null };
    let availableClasses = [classOne, classTwo];
    let deleted = false;
    let resolveStaleStudents!: (value: unknown) => void;
    const staleStudents = new Promise((resolve) => { resolveStaleStudents = resolve; });
    const latestStudents = {
      students: [
        { id: "stu1", school_id: "s1", student_no: "S001", display_name: "Student One", status: "active", class_names: "Class 2" },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    };

    mocks.listClasses.mockImplementation(async (query: any = {}) => ({
      classes: availableClasses,
      total: availableClasses.length,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 10,
      total_pages: 1,
    }));
    mocks.listStudents.mockImplementation((classId: string | null) => {
      if (classId === "c1" && !deleted) return staleStudents;
      if (deleted) return Promise.resolve(latestStudents);
      return Promise.resolve({
        ...latestStudents,
        students: [{ ...latestStudents.students[0], class_names: "Class 1, Class 2" }],
      });
    });
    mocks.deleteClass.mockImplementation(async (classId: string) => {
      deleted = true;
      availableClasses = availableClasses.filter((klass) => klass.id !== classId);
      return { ok: true, deleted: classId };
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await selectOption(comboboxWithText("全部班级"), "c1");
    await waitFor(() => expect(mocks.listStudents).toHaveBeenCalledWith("c1", expect.anything()));
    await waitFor(() => expect(resolveStaleStudents).toBeDefined());

    await userEvent.click(screen.getByTestId("school-page-classes"));
    expect(await screen.findByDisplayValue("Class 1")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "删除班级" })[0]);

    await userEvent.click(await screen.findByTestId("school-page-students"));
    const filter = comboboxWithText("全部班级");
    expect(filter).toHaveTextContent("全部班级");
    const importClassSelect = comboboxWithText("Class 2");
    await userEvent.click(importClassSelect);
    expect(screen.getByRole("option", { name: "未指定班级" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Class 2" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("Class 2", { selector: "td" })).toBeInTheDocument();
    expect(mocks.listStudents).toHaveBeenCalledWith(null, expect.anything());

    await act(async () => {
      resolveStaleStudents({
        ...latestStudents,
        students: [{ ...latestStudents.students[0], class_names: "Class 1, Class 2" }],
      });
      await staleStudents;
    });
    const studentRow = screen.getByDisplayValue("Student One").closest("tr");
    expect(studentRow).toHaveTextContent("Class 2");
    expect(studentRow).not.toHaveTextContent("Class 1");
  });

  it("marks legacy multi-class student records for review while retaining class names", async () => {
    mocks.listStudents.mockResolvedValue({
      students: [{
        id: "stu_legacy",
        school_id: "s1",
        student_no: "S099",
        display_name: "Legacy Student",
        status: "active",
        class_count: 2,
        class_names: "Class A, Class B",
      }],
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

    await userEvent.click(await screen.findByTestId("school-page-students"));
    const studentRow = (await screen.findByDisplayValue("Legacy Student")).closest("tr");
    expect(studentRow).toHaveTextContent("班级归属需核对");
    expect(studentRow).toHaveTextContent("Class A, Class B");
  });

  it("previews and explicitly confirms a transfer while retaining exam records", async () => {
    const classOne = { id: "c1", name: "Class 1", grade: "G10" };
    const classTwo = { id: "c2", name: "Class 2", grade: "G10" };
    mocks.listClasses.mockResolvedValue({ classes: [
      { ...classOne, school_id: "s1", subject_hint: null },
      { ...classTwo, school_id: "s1", subject_hint: null },
    ] });
    mocks.getStudentClassTransfer.mockResolvedValue({
      student: { id: "stu1", student_no: "S001", display_name: "Student One" },
      current_classes: [classOne],
      available_classes: [classOne, classTwo],
      attempt_count: 4,
      legacy_attempt_count: 2,
    });
    mocks.transferStudentClass.mockResolvedValue({
      student_id: "stu1",
      current_class: classTwo,
      previous_classes: [classOne],
      retained_attempt_count: 4,
      captured_legacy_attempt_count: 2,
      changed: true,
      transfer_id: "transfer-1",
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", school_id: "s1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    const dialog = await screen.findByRole("dialog", { name: "转班确认" });
    expect(dialog).toHaveTextContent("Class 1（G10）");
    expect(dialog).toHaveTextContent("保留 4 份考试记录");
    expect(dialog).toHaveTextContent("2 份旧考试记录没有冻结的原始班级快照");

    const studentCallsBefore = mocks.listStudents.mock.calls.length;
    const classCallsBefore = mocks.listClasses.mock.calls.length;
    await selectOption(screen.getByRole("combobox", { name: "目标班级" }), "c2");
    expect(dialog).toHaveTextContent("Class 1 → Class 2");
    await userEvent.click(screen.getByRole("button", { name: "确认转班" }));

    await waitFor(() => expect(mocks.transferStudentClass).toHaveBeenCalledWith("stu1", {
      target_class_id: "c2",
      expected_class_ids: ["c1"],
    }));
    await waitFor(() => expect(mocks.listStudents.mock.calls.length).toBeGreaterThan(studentCallsBefore));
    await waitFor(() => expect(mocks.listClasses.mock.calls.length).toBeGreaterThan(classCallsBefore));
    expect(screen.queryByRole("dialog", { name: "转班确认" })).not.toBeInTheDocument();
  });

  it("refreshes a conflicted transfer preview without resubmitting", async () => {
    const classOne = { id: "c1", name: "Class 1", grade: "G10" };
    const classTwo = { id: "c2", name: "Class 2", grade: "G10" };
    mocks.getStudentClassTransfer
      .mockResolvedValueOnce({
        student: { id: "stu1", student_no: "S001", display_name: "Student One" },
        current_classes: [classOne],
        available_classes: [classOne, classTwo],
        attempt_count: 2,
        legacy_attempt_count: 0,
      })
      .mockResolvedValueOnce({
        student: { id: "stu1", student_no: "S001", display_name: "Student One" },
        current_classes: [classTwo],
        available_classes: [classOne, classTwo],
        attempt_count: 2,
        legacy_attempt_count: 0,
      });
    mocks.transferStudentClass.mockRejectedValueOnce(new PlatformRequestError("班级信息已变化", 409));

    render(
      <SchoolWorkspace
        user={{ id: "u1", school_id: "s1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    await screen.findByRole("dialog", { name: "转班确认" });
    await selectOption(screen.getByRole("combobox", { name: "目标班级" }), "c2");
    await userEvent.click(screen.getByRole("button", { name: "确认转班" }));

    const dialog = await screen.findByRole("dialog", { name: "转班确认" });
    await waitFor(() => expect(dialog).toHaveTextContent("班级信息已变化，已刷新转班预览"));
    expect(dialog).toHaveTextContent("Class 2");
    expect(screen.getByRole("combobox", { name: "目标班级" })).toHaveTextContent("请选择目标班级");
    expect(mocks.getStudentClassTransfer).toHaveBeenCalledTimes(2);
    expect(mocks.transferStudentClass).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "确认转班" })).toBeDisabled();
  });

  it("does not write a transfer notice after the school scope changes during refresh", async () => {
    const classOne = { id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null };
    const classTwo = { id: "c2", school_id: "s1", name: "Class 2", grade: "G10", subject_hint: null };
    mocks.listClasses.mockResolvedValue({ classes: [classOne, classTwo] });
    mocks.getStudentClassTransfer.mockResolvedValue({
      student: { id: "stu1", student_no: "S001", display_name: "Student One" },
      current_classes: [classOne],
      available_classes: [classOne, classTwo],
      attempt_count: 1,
      legacy_attempt_count: 0,
    });
    mocks.transferStudentClass.mockResolvedValue({
      student_id: "stu1",
      current_class: { id: "c2", name: "Class 2", grade: "G10" },
      previous_classes: [{ id: "c1", name: "Class 1", grade: "G10" }],
      retained_attempt_count: 1,
      captured_legacy_attempt_count: 0,
      changed: true,
      transfer_id: "transfer-2",
    });
    let resolveStudentRefresh!: (value: unknown) => void;
    let holdStudentRefresh = false;
    mocks.listStudents.mockImplementation(() => {
      if (!holdStudentRefresh) {
        return Promise.resolve({ students: [{
          id: "stu1", school_id: "s1", student_no: "S001", display_name: "Student One",
          status: "active", class_names: "Class 1",
        }] });
      }
      holdStudentRefresh = false;
      return new Promise((resolve) => { resolveStudentRefresh = resolve; });
    });

    const props = {
      user: { id: "u1", school_id: "s1", role: "school" as const, username: "school_a", display_name: "School A", status: "active" },
      onLogout: vi.fn(),
      onError: vi.fn(),
    };
    const view = render(<SchoolWorkspace {...props} />);

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    await screen.findByRole("dialog", { name: "转班确认" });
    await selectOption(screen.getByRole("combobox", { name: "目标班级" }), "c2");
    holdStudentRefresh = true;
    await userEvent.click(screen.getByRole("button", { name: "确认转班" }));
    await waitFor(() => expect(mocks.transferStudentClass).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(resolveStudentRefresh).toBeDefined());

    view.rerender(
      <SchoolWorkspace
        {...props}
        user={{ ...props.user, id: "u2", school_id: "s2", username: "school_b", display_name: "School B" }}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "转班确认" })).not.toBeInTheDocument());
    await act(async () => {
      resolveStudentRefresh({ students: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText(/学生转班完成/)).not.toBeInTheDocument();
    expect(mocks.transferStudentClass).toHaveBeenCalledTimes(1);
  });

  it("reports a completed transfer when list refresh fails without retrying the transfer", async () => {
    const classOne = { id: "c1", name: "Class 1", grade: "G10" };
    const classTwo = { id: "c2", name: "Class 2", grade: "G10" };
    mocks.getStudentClassTransfer.mockResolvedValue({
      student: { id: "stu1", student_no: "S001", display_name: "Student One" },
      current_classes: [classOne],
      available_classes: [classOne, classTwo],
      attempt_count: 1,
      legacy_attempt_count: 0,
    });
    mocks.transferStudentClass.mockResolvedValue({
      student_id: "stu1",
      current_class: classTwo,
      previous_classes: [classOne],
      retained_attempt_count: 1,
      captured_legacy_attempt_count: 0,
      changed: true,
      transfer_id: "transfer-3",
    });

    render(
      <SchoolWorkspace
        user={{ id: "u1", school_id: "s1", role: "school", username: "school_a", display_name: "School A", status: "active" }}
        onLogout={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    await screen.findByRole("dialog", { name: "转班确认" });
    await selectOption(screen.getByRole("combobox", { name: "目标班级" }), "c2");
    mocks.listStudents.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "确认转班" }));

    expect(await screen.findByText("转班已完成，但学生或班级列表刷新失败，请点击“刷新”重新加载。"))
      .toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "转班确认" })).not.toBeInTheDocument();
    expect(mocks.transferStudentClass).toHaveBeenCalledTimes(1);
  });

  it("discards a pending transfer preview when the student query or school scope changes", async () => {
    const classOne = { id: "c1", school_id: "s1", name: "Class 1", grade: "G10", subject_hint: null };
    const classTwo = { id: "c2", school_id: "s1", name: "Class 2", grade: "G10", subject_hint: null };
    mocks.listClasses.mockResolvedValue({ classes: [classOne, classTwo] });
    const pendingPreviews: Array<(value: unknown) => void> = [];
    mocks.getStudentClassTransfer.mockImplementation(() => new Promise((resolve) => pendingPreviews.push(resolve)));
    const props = {
      user: { id: "u1", school_id: "s1", role: "school" as const, username: "school_a", display_name: "School A", status: "active" },
      onLogout: vi.fn(),
      onError: vi.fn(),
    };
    const view = render(<SchoolWorkspace {...props} />);

    await userEvent.click(await screen.findByTestId("school-page-students"));
    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    await waitFor(() => expect(pendingPreviews).toHaveLength(1));
    await selectOption(comboboxWithText("全部班级"), "c2");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "转班确认" })).not.toBeInTheDocument());
    await act(async () => {
      pendingPreviews[0]({
        student: { id: "stu1", student_no: "S001", display_name: "Student One" },
        current_classes: [],
        available_classes: [classOne, classTwo],
        attempt_count: 1,
        legacy_attempt_count: 0,
      });
    });
    expect(screen.queryByText("正在读取当前班级和考试记录…")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "转班" }));
    await waitFor(() => expect(pendingPreviews).toHaveLength(2));
    view.rerender(
      <SchoolWorkspace
        {...props}
        user={{ ...props.user, id: "u2", school_id: "s2", username: "school_b", display_name: "School B" }}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "转班确认" })).not.toBeInTheDocument());
    await act(async () => {
      pendingPreviews[1]({
        student: { id: "stu1", student_no: "S001", display_name: "Student One" },
        current_classes: [classOne],
        available_classes: [classOne],
        attempt_count: 1,
        legacy_attempt_count: 0,
      });
    });
    expect(screen.queryByText("正在读取当前班级和考试记录…")).not.toBeInTheDocument();
    expect(mocks.transferStudentClass).not.toHaveBeenCalled();
  });

  it("does not show the transfer action to teacher or global administrator roles", async () => {
    for (const role of ["teacher", "admin"] as const) {
      const view = render(
        <SchoolWorkspace
          user={{ id: `u_${role}`, school_id: "s1", role, username: role, display_name: role, status: "active" }}
          onLogout={vi.fn()}
          onError={vi.fn()}
        />,
      );

      await userEvent.click(await screen.findByTestId("school-page-students"));
      expect(screen.queryByRole("button", { name: "转班" })).not.toBeInTheDocument();
      view.unmount();
    }
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
    expect(await screen.findByRole("heading", { name: "学校管理总览" })).toBeInTheDocument();
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
    const statusSelect = comboboxWithText("全部状态");
    await selectOption(statusSelect, "active");
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
    const classFilterSelect = comboboxWithText("全部班级");
    await selectOption(classFilterSelect, "c1");
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
    expect(await screen.findByRole("heading", { name: "学校管理总览" })).toBeInTheDocument();

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
