import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformUser, TeacherRecord } from "../../../platform/authTypes";
import { ManagementOptionsProvider } from "../../../platform/useManagementOptions";
import type { ManagementOptions } from "../../../platform/managementApi";
import { useSchoolWorkspaceData } from "../school/hooks/useSchoolWorkspaceData";
import { TeachersMainPanel } from "../school/panels/TeachersPanel";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), teachers: vi.fn(), classes: vi.fn(), students: vi.fn(), assignments: vi.fn(),
}));
vi.mock("../../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../platform/auth")>(),
  getSchoolAiCapabilities: (...args: unknown[]) => mocks.overview(...args),
  listTeachers: (...args: unknown[]) => mocks.teachers(...args),
  listClasses: (...args: unknown[]) => mocks.classes(...args),
  listStudents: (...args: unknown[]) => mocks.students(...args),
  listTeacherClassAssignments: (...args: unknown[]) => mocks.assignments(...args),
}));

const base = ["school.overview.read", "school.access.read", "school.options.read"];
const schoolUser = (permissions: string[]): PlatformUser => ({
  id: "school-user", school_id: "school-one", role: "school", status: "active",
  username: "school-user", display_name: "查看账号", school_access_mode: "custom", management_permissions: permissions,
});
const teacher: TeacherRecord = {
  id: "teacher-one", school_id: "school-one", role: "teacher", status: "active",
  username: "teacher-one", display_name: "教师一", email: "", subjects: ["数学"],
};
const options: ManagementOptions = {
  settings: { default_page_size: 20, activity_default_days: 7 }, subjects: [], grades: [],
};

describe("management permissions in existing school workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue({
      school: { id: "school-one", name: "学校一", status: "active", ai_enabled: 0 },
      stats: { teachers: 1, classes: 1, students: 2, assignments: 1 }, capabilities: [],
      ai_available: false, ai_enabled: false,
    });
    mocks.teachers.mockResolvedValue({ teachers: [teacher], total: 1, page: 1, page_size: 10, total_pages: 1 });
    mocks.classes.mockResolvedValue({ classes: [], total: 0 });
    mocks.students.mockResolvedValue({ students: [], total: 0 });
    mocks.assignments.mockResolvedValue({ assignments: [], total: 0 });
  });

  it("refreshes only the rosters the school subrole can read", async () => {
    const { result } = renderHook(() => useSchoolWorkspaceData(schoolUser([...base, "school.teachers.read"]), vi.fn()));
    await waitFor(() => expect(mocks.overview).toHaveBeenCalled());
    act(() => result.current.setActivePage("teachers"));
    await waitFor(() => expect(mocks.teachers).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refresh(); });
    expect(mocks.teachers.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.classes).not.toHaveBeenCalled();
    expect(mocks.students).not.toHaveBeenCalled();
    expect(mocks.assignments).not.toHaveBeenCalled();
    act(() => result.current.setActivePage("students"));
    expect(mocks.students).not.toHaveBeenCalled();
  });

  it("drops an in-flight roster response when the account loses read access", async () => {
    let finish!: (value: { teachers: TeacherRecord[]; total: number }) => void;
    mocks.teachers.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(
      ({ user }) => useSchoolWorkspaceData(user, vi.fn()),
      { initialProps: { user: schoolUser([...base, "school.teachers.read"]) } },
    );
    act(() => result.current.setActivePage("teachers"));
    await waitFor(() => expect(mocks.teachers).toHaveBeenCalledTimes(1));
    rerender({ user: schoolUser(base) });
    await act(async () => { finish({ teachers: [teacher], total: 1 }); });
    expect(result.current.teachers).toEqual([]);
  });

  it("uses configured pagination without overwriting an explicit page-size choice", async () => {
    const { result, rerender } = renderHook(
      ({ defaults }: { defaults: ManagementOptions | null }) =>
        useSchoolWorkspaceData(schoolUser([...base, "school.teachers.read"]), vi.fn(), defaults),
      { initialProps: { defaults: null as ManagementOptions | null } },
    );
    act(() => result.current.setTeacherQuery((current) => ({ ...current, pageSize: 50 })));
    rerender({ defaults: options });
    await waitFor(() => expect(result.current.classQuery.pageSize).toBe(20));
    expect(result.current.teacherQuery.pageSize).toBe(50);
  });

  it("keeps teacher fields readable while disabling ungranted actions and exports", () => {
    render(
      <ManagementOptionsProvider user={schoolUser([...base, "school.teachers.read"])} value={null}>
        <TeachersMainPanel
          teachers={[teacher]} teacherMeta={{ total: 1, page: 1, pageSize: 10, totalPages: 1 }}
          teacherQuery={{ q: "", page: 1, pageSize: 10 }} setTeacherQuery={vi.fn()}
          selectedTeacherIds={[]} setSelectedTeacherIds={vi.fn()} toggleTeacher={vi.fn()}
          teacherDrafts={{}} setTeacherDrafts={vi.fn()} busy={false} run={vi.fn()} setNotice={vi.fn()}
        />
      </ManagementOptionsProvider>,
    );
    expect(screen.getByDisplayValue("教师一")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "保存教师" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重置密码" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出教师" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "全选当前页教师" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "搜索名单" })).toBeEnabled();
  });
});
