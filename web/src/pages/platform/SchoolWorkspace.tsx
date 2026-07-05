import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Download,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  assignTeacherClass,
  bulkUpdateStudents,
  bulkUpdateTeachers,
  createClass,
  createTeacher,
  deleteClass,
  downloadSchoolImportTemplate,
  exportStudentAccounts,
  importClassesFile,
  importStudents,
  importStudentsFile,
  importTeachersFile,
  listClasses,
  listStudents,
  listTeacherClassAssignments,
  listTeachers,
  removeTeacherClassAssignment,
  resetStudentPassword,
  resetTeacherPassword,
  updateClass,
  updateStudent,
  updateTeacher,
  type ClassRecord,
  type PlatformUser,
  type StudentRecord,
  type TeacherClassAssignmentRecord,
  type TeacherRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

type TeacherDraft = { display_name: string; email: string; subjects: string };
type ClassDraft = { name: string; grade: string };
type StudentDraft = { student_no: string; display_name: string; email: string };
type PageQuery = { q: string; status?: string; page: number; pageSize: number };
type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

const DEFAULT_META: PageMeta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };

function splitSubjects(value: string): string[] {
  return value
    .split(/[,\s，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalText(value: string | null | undefined): string {
  if (!value || value.toLowerCase() === "none") return "";
  return value;
}

function mergeMeta<T extends { total?: number; page?: number; page_size?: number; total_pages?: number }>(
  data: T,
  fallback: PageQuery,
  itemCount = 0,
): PageMeta {
  const pageSize = Number(data.page_size ?? fallback.pageSize);
  const total = Number(data.total ?? itemCount);
  return {
    total,
    page: Number(data.page ?? fallback.page),
    pageSize,
    totalPages: Number(data.total_pages ?? Math.max(1, Math.ceil(total / pageSize))),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SchoolWorkspace({ user, onLogout, onError }: Props) {
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [teacherChoices, setTeacherChoices] = useState<TeacherRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<TeacherClassAssignmentRecord[]>([]);
  const [teacherMeta, setTeacherMeta] = useState<PageMeta>(DEFAULT_META);
  const [classMeta, setClassMeta] = useState<PageMeta>(DEFAULT_META);
  const [studentMeta, setStudentMeta] = useState<PageMeta>(DEFAULT_META);
  const [assignmentMeta, setAssignmentMeta] = useState<PageMeta>(DEFAULT_META);
  const [teacherQuery, setTeacherQuery] = useState<PageQuery>({ q: "", status: "all", page: 1, pageSize: 10 });
  const [classQuery, setClassQuery] = useState<PageQuery>({ q: "", page: 1, pageSize: 10 });
  const [studentQuery, setStudentQuery] = useState<PageQuery>({ q: "", status: "all", page: 1, pageSize: 10 });
  const [assignmentQuery, setAssignmentQuery] = useState<PageQuery>({ q: "", page: 1, pageSize: 10 });
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, TeacherDraft>>({});
  const [classDrafts, setClassDrafts] = useState<Record<string, ClassDraft>>({});
  const [studentDrafts, setStudentDrafts] = useState<Record<string, StudentDraft>>({});
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [teacherUsername, setTeacherUsername] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherSubjects, setTeacherSubjects] = useState("");
  const [className, setClassName] = useState("");
  const [grade, setGrade] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentClassId, setStudentClassId] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState("");
  const [assignTeacherId, setAssignTeacherId] = useState("");
  const [assignClassId, setAssignClassId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const teacherOptions = useMemo(() => teacherChoices.filter((teacher) => teacher.status === "active"), [teacherChoices]);

  async function refresh() {
    onError(null);
    const [teacherData, allTeacherData, classData, allClassData, studentData, assignmentData] = await Promise.all([
      listTeachers(teacherQuery),
      listTeachers({ page: 1, pageSize: 100, status: "active" }),
      listClasses(classQuery),
      listClasses({ page: 1, pageSize: 100 }),
      listStudents(studentClassFilter || null, studentQuery),
      listTeacherClassAssignments(assignmentQuery),
    ]);
    setTeachers(teacherData.teachers);
    setTeacherChoices(allTeacherData.teachers);
    setClasses(allClassData.classes);
    setStudents(studentData.students);
    setAssignments(assignmentData.assignments);
    setTeacherMeta(mergeMeta(teacherData, teacherQuery, teacherData.teachers.length));
    setClassMeta(mergeMeta(classData, classQuery, classData.classes.length));
    setStudentMeta(mergeMeta(studentData, studentQuery, studentData.students.length));
    setAssignmentMeta(mergeMeta(assignmentData, assignmentQuery, assignmentData.assignments.length));
    setTeacherDrafts(
      Object.fromEntries(
        teacherData.teachers.map((teacher) => [
          teacher.id,
          {
            display_name: teacher.display_name || teacher.username,
            email: optionalText(teacher.email),
            subjects: teacher.subjects.join(", "),
          },
        ]),
      ),
    );
    setClassDrafts(
      Object.fromEntries(
        classData.classes.map((klass) => [klass.id, { name: klass.name, grade: klass.grade || "" }]),
      ),
    );
    setStudentDrafts(
      Object.fromEntries(
        studentData.students.map((student) => [
          student.id,
          {
            student_no: student.student_no,
            display_name: student.display_name,
            email: optionalText(student.email),
          },
        ]),
      ),
    );
    setAssignTeacherId((current) => current || allTeacherData.teachers.find((teacher) => teacher.status === "active")?.id || "");
    setAssignClassId((current) => current || allClassData.classes[0]?.id || "");
    setStudentClassId((current) => current || allClassData.classes[0]?.id || "");
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    teacherQuery.q,
    teacherQuery.status,
    teacherQuery.page,
    teacherQuery.pageSize,
    classQuery.q,
    classQuery.page,
    classQuery.pageSize,
    studentQuery.q,
    studentQuery.status,
    studentQuery.page,
    studentQuery.pageSize,
    studentClassFilter,
    assignmentQuery.q,
    assignmentQuery.page,
    assignmentQuery.pageSize,
  ]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await createTeacher({
        username: teacherUsername,
        password: teacherPassword,
        display_name: teacherName,
        email: teacherEmail || null,
        subjects: splitSubjects(teacherSubjects),
      });
      setTeacherUsername("");
      setTeacherPassword("");
      setTeacherName("");
      setTeacherEmail("");
      setTeacherSubjects("");
    });
  }

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const created = await createClass({ name: className, grade });
      setClassName("");
      setGrade("");
      setStudentClassId(created.class.id);
      setAssignClassId(created.class.id);
    });
  }

  async function submitStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await importStudents({
        class_id: studentClassId || null,
        students: [{ student_no: studentNo, display_name: studentName, email: studentEmail || null }],
      });
      setStudentNo("");
      setStudentName("");
      setStudentEmail("");
    });
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await assignTeacherClass({ teacher_id: assignTeacherId, class_id: assignClassId });
    });
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>, kind: "teachers" | "classes" | "students") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(async () => {
      if (kind === "teachers") await importTeachersFile(file);
      if (kind === "classes") await importClassesFile(file);
      if (kind === "students") await importStudentsFile(file, studentClassId || null);
    });
  }

  async function downloadTemplate(kind: "teachers" | "classes" | "students") {
    await run(async () => {
      const blob = await downloadSchoolImportTemplate(kind);
      downloadBlob(blob, `${kind}_template.xlsx`);
    });
  }

  function toggleTeacher(id: string) {
    setSelectedTeacherIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleStudent(id: string) {
    setSelectedStudentIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const actions = (
    <>
      <button
        type="button"
        onClick={() => void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)))}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <RefreshCw className="h-4 w-4" />
        刷新
      </button>
      <button
        type="button"
        data-testid="students-export-link"
        onClick={() =>
          void run(async () => {
            const blob = await exportStudentAccounts();
            downloadBlob(blob, "student_accounts.xlsx");
          })
        }
        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        <Download className="h-4 w-4" />
        导出学生账号
      </button>
    </>
  );

  return (
    <PlatformShell
      roleLabel="学校端"
      title={user.display_name || user.username}
      subtitle="管理教师、教师学科、班级、学生账号和班级分配。"
      userName={user.username}
      actions={actions}
      onLogout={onLogout}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="教师" value={teacherMeta.total} />
            <Metric label="班级" value={classMeta.total} />
            <Metric label="学生" value={studentMeta.total} />
            <Metric label="分配" value={assignmentMeta.total} />
          </div>

          <ManagementSection
            title="教师管理"
            count={teacherMeta.total}
            controls={
              <Toolbar
                query={teacherQuery}
                onQueryChange={(patch) => setTeacherQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
                status
                bulk={
                  selectedTeacherIds.length ? (
                    <BulkActions
                      disabled={busy}
                      count={selectedTeacherIds.length}
                      onEnable={() =>
                        void run(async () => {
                          await bulkUpdateTeachers({ ids: selectedTeacherIds, status: "active" });
                          setSelectedTeacherIds([]);
                        })
                      }
                      onDisable={() =>
                        void run(async () => {
                          await bulkUpdateTeachers({ ids: selectedTeacherIds, status: "disabled" });
                          setSelectedTeacherIds([]);
                        })
                      }
                    />
                  ) : null
                }
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-[860px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2">账号</th>
                    <th className="px-3 py-2">姓名</th>
                    <th className="px-3 py-2">邮箱</th>
                    <th className="px-3 py-2">教师学科</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher) => {
                    const draft = teacherDrafts[teacher.id] || {
                      display_name: teacher.display_name,
                      email: optionalText(teacher.email),
                      subjects: teacher.subjects.join(", "),
                    };
                    return (
                      <tr key={teacher.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedTeacherIds.includes(teacher.id)} onChange={() => toggleTeacher(teacher.id)} />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{teacher.username}</td>
                        <td className="px-3 py-2">
                          <input
                            className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.display_name}
                            onChange={(event) =>
                              setTeacherDrafts((prev) => ({
                                ...prev,
                                [teacher.id]: { ...draft, display_name: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.email}
                            onChange={(event) =>
                              setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, email: event.target.value } }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.subjects}
                            onChange={(event) =>
                              setTeacherDrafts((prev) => ({
                                ...prev,
                                [teacher.id]: { ...draft, subjects: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={teacher.status} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <IconButton
                              label="保存教师"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await updateTeacher(teacher.id, {
                                    display_name: draft.display_name,
                                    email: draft.email || null,
                                    subjects: splitSubjects(draft.subjects),
                                  });
                                })
                              }
                              icon={<Save className="h-4 w-4" />}
                            />
                            <IconButton
                              label="重置密码"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const result = await resetTeacherPassword(teacher.id);
                                  setNotice(`${teacher.username} 新密码：${result.password}`);
                                })
                              }
                              icon={<KeyRound className="h-4 w-4" />}
                            />
                            <IconButton
                              label={teacher.status === "active" ? "停用教师" : "启用教师"}
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await updateTeacher(teacher.id, { status: teacher.status === "active" ? "disabled" : "active" });
                                })
                              }
                              icon={teacher.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager meta={teacherMeta} onPage={(page) => setTeacherQuery((current) => ({ ...current, page }))} />
          </ManagementSection>

          <ManagementSection
            title="班级管理"
            count={classMeta.total}
            controls={
              <Toolbar
                query={classQuery}
                onQueryChange={(patch) => setClassQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">班级</th>
                    <th className="px-3 py-2">年级</th>
                    <th className="px-3 py-2">学生</th>
                    <th className="px-3 py-2">教师</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {classes
                    .filter((klass) => classDrafts[klass.id])
                    .map((klass) => {
                      const draft = classDrafts[klass.id] || { name: klass.name, grade: klass.grade || "" };
                      return (
                        <tr key={klass.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2">
                            <input
                              className="w-52 rounded-md border border-slate-300 px-2 py-1 text-sm"
                              value={draft.name}
                              onChange={(event) =>
                                setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, name: event.target.value } }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                              value={draft.grade}
                              onChange={(event) =>
                                setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, grade: event.target.value } }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-slate-600">{klass.student_count ?? 0}</td>
                          <td className="px-3 py-2 text-slate-600">{klass.teacher_count ?? 0}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <IconButton
                                label="保存班级"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await updateClass(klass.id, { name: draft.name, grade: draft.grade });
                                  })
                                }
                                icon={<Save className="h-4 w-4" />}
                              />
                              <IconButton
                                label="删除班级"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await deleteClass(klass.id);
                                  })
                                }
                                icon={<Trash2 className="h-4 w-4" />}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <Pager meta={classMeta} onPage={(page) => setClassQuery((current) => ({ ...current, page }))} />
          </ManagementSection>

          <ManagementSection
            title="学生账号"
            count={studentMeta.total}
            controls={
              <div className="flex flex-wrap items-center gap-2">
                <Toolbar
                  query={studentQuery}
                  onQueryChange={(patch) => setStudentQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
                  status
                  bulk={
                    selectedStudentIds.length ? (
                      <BulkActions
                        disabled={busy}
                        count={selectedStudentIds.length}
                        onEnable={() =>
                          void run(async () => {
                            await bulkUpdateStudents({ ids: selectedStudentIds, status: "active" });
                            setSelectedStudentIds([]);
                          })
                        }
                        onDisable={() =>
                          void run(async () => {
                            await bulkUpdateStudents({ ids: selectedStudentIds, status: "disabled" });
                            setSelectedStudentIds([]);
                          })
                        }
                      />
                    ) : null
                  }
                />
                <select
                  className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={studentClassFilter}
                  onChange={(event) => {
                    setStudentClassFilter(event.target.value);
                    setStudentQuery((current) => ({ ...current, page: 1 }));
                  }}
                >
                  <option value="">全部班级</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </select>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2">学号</th>
                    <th className="px-3 py-2">姓名</th>
                    <th className="px-3 py-2">邮箱</th>
                    <th className="px-3 py-2">班级</th>
                    <th className="px-3 py-2">登录名</th>
                    <th className="px-3 py-2">初始密码</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const draft = studentDrafts[student.id] || {
                      student_no: student.student_no,
                      display_name: student.display_name,
                      email: optionalText(student.email),
                    };
                    return (
                      <tr key={student.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.student_no}
                            onChange={(event) =>
                              setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, student_no: event.target.value } }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.display_name}
                            onChange={(event) =>
                              setStudentDrafts((prev) => ({
                                ...prev,
                                [student.id]: { ...draft, display_name: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.email}
                            onChange={(event) =>
                              setStudentDrafts((prev) => ({ ...prev, [student.id]: { ...draft, email: event.target.value } }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-600">{student.class_names || "-"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{student.account_username || "-"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{student.initial_password || "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={student.status} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <IconButton
                              label="保存学生"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await updateStudent(student.id, draft);
                                })
                              }
                              icon={<Save className="h-4 w-4" />}
                            />
                            <IconButton
                              label="重置密码"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const result = await resetStudentPassword(student.id);
                                  setNotice(`${student.account_username || student.student_no} 新密码：${result.password}`);
                                })
                              }
                              icon={<KeyRound className="h-4 w-4" />}
                            />
                            <IconButton
                              label={student.status === "active" ? "停用学生" : "启用学生"}
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await updateStudent(student.id, { status: student.status === "active" ? "disabled" : "active" });
                                })
                              }
                              icon={student.status === "active" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager meta={studentMeta} onPage={(page) => setStudentQuery((current) => ({ ...current, page }))} />
          </ManagementSection>

          <ManagementSection
            title="教师班级分配"
            count={assignmentMeta.total}
            controls={
              <Toolbar
                query={assignmentQuery}
                onQueryChange={(patch) => setAssignmentQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-[680px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">教师</th>
                    <th className="px-3 py-2">班级</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={`${assignment.teacher_id}:${assignment.class_id}:${assignment.subject || ""}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="font-medium">{assignment.teacher_name || assignment.teacher_username}</span>
                        <span className="ml-2 font-mono text-xs text-slate-500">{assignment.teacher_username}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {[assignment.class_grade, assignment.class_name].filter(Boolean).join(" · ")}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={assignment.teacher_status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <IconButton
                          label="移除分配"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await removeTeacherClassAssignment({
                                teacher_id: assignment.teacher_id,
                                class_id: assignment.class_id,
                                subject: assignment.subject || null,
                              });
                            })
                          }
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager meta={assignmentMeta} onPage={(page) => setAssignmentQuery((current) => ({ ...current, page }))} />
          </ManagementSection>

          {notice ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{notice}</div> : null}
        </section>

        <aside className="space-y-4">
          <form onSubmit={(event) => void submitTeacher(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">添加教师</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="用户名" value={teacherUsername} onChange={(event) => setTeacherUsername(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="姓名" value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="邮箱" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="教师学科（可选）" value={teacherSubjects} onChange={(event) => setTeacherSubjects(event.target.value)} />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="初始密码" type="password" minLength={6} value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加教师
            </button>
            <ImportActions
              kind="teachers"
              label="导入教师 JSON / Excel"
              testId="teachers-import-file"
              onTemplate={() => void downloadTemplate("teachers")}
              onChange={(event) => void handleFile(event, "teachers")}
            />
          </form>

          <form onSubmit={(event) => void submitClass(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">添加班级</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="班级名称" value={className} onChange={(event) => setClassName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="年级" value={grade} onChange={(event) => setGrade(event.target.value)} />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加班级
            </button>
            <ImportActions
              kind="classes"
              label="导入班级 JSON / Excel"
              testId="classes-import-file"
              onTemplate={() => void downloadTemplate("classes")}
              onChange={(event) => void handleFile(event, "classes")}
            />
          </form>

          <form onSubmit={(event) => void submitStudent(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">添加学生</h2>
            <select className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={studentClassId} onChange={(event) => setStudentClassId(event.target.value)}>
              <option value="">不加入班级</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </select>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="学号" value={studentNo} onChange={(event) => setStudentNo(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="姓名" value={studentName} onChange={(event) => setStudentName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="邮箱" value={studentEmail} onChange={(event) => setStudentEmail(event.target.value)} />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加学生
            </button>
            <ImportActions
              kind="students"
              label="导入学生 JSON / Excel"
              testId="students-import-file"
              onTemplate={() => void downloadTemplate("students")}
              onChange={(event) => void handleFile(event, "students")}
            />
          </form>

          <form onSubmit={(event) => void submitAssignment(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">分配教师班级</h2>
            <select className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={assignTeacherId} onChange={(event) => setAssignTeacherId(event.target.value)} required>
              <option value="">选择教师</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.display_name || teacher.username}
                </option>
              ))}
            </select>
            <select className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={assignClassId} onChange={(event) => setAssignClassId(event.target.value)} required>
              <option value="">选择班级</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </select>
            <button data-testid="assign-teacher-class" type="submit" disabled={busy || !assignTeacherId || !assignClassId} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Link2 className="h-4 w-4" />
              分配
            </button>
          </form>
        </aside>
      </div>
    </PlatformShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ManagementSection({
  title,
  count,
  controls,
  children,
}: {
  title: string;
  count: number;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>
        </div>
        {controls}
      </div>
      {count === 0 ? <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无数据</p> : children}
    </section>
  );
}

function Toolbar({
  query,
  onQueryChange,
  status = false,
  bulk,
}: {
  query: PageQuery;
  onQueryChange: (patch: Partial<PageQuery>) => void;
  status?: boolean;
  bulk?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
        <input
          className="w-48 rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm"
          placeholder="搜索"
          value={query.q}
          onChange={(event) => onQueryChange({ q: event.target.value })}
        />
      </div>
      {status ? (
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          value={query.status || "all"}
          onChange={(event) => onQueryChange({ status: event.target.value })}
        >
          <option value="all">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
      ) : null}
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
        value={query.pageSize}
        onChange={(event) => onQueryChange({ pageSize: Number(event.target.value) })}
      >
        <option value={10}>10 条</option>
        <option value={20}>20 条</option>
        <option value={50}>50 条</option>
      </select>
      {bulk}
    </div>
  );
}

function BulkActions({
  count,
  disabled,
  onEnable,
  onDisable,
}: {
  count: number;
  disabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1">
      <span className="text-xs text-slate-600">已选 {count}</span>
      <button type="button" disabled={disabled} onClick={onEnable} className="text-xs font-medium text-emerald-700 disabled:opacity-60">
        启用
      </button>
      <button type="button" disabled={disabled} onClick={onDisable} className="text-xs font-medium text-rose-700 disabled:opacity-60">
        停用
      </button>
    </div>
  );
}

function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
      <span>
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
      {active ? "启用" : "停用"}
    </span>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
    >
      {icon}
    </button>
  );
}

function ImportActions({
  label,
  testId,
  onTemplate,
  onChange,
}: {
  kind: "teachers" | "classes" | "students";
  label: string;
  testId: string;
  onTemplate: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onTemplate}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        <Download className="h-4 w-4" />
        模板
      </button>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <Upload className="h-4 w-4" />
        {label}
        <input data-testid={testId} className="sr-only" type="file" accept=".json,.xlsx" onChange={onChange} />
      </label>
    </div>
  );
}
