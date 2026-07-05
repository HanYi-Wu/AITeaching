import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Download, Link2, Plus, RefreshCw, Save, Upload } from "lucide-react";
import {
  assignTeacherClass,
  createClass,
  createTeacher,
  exportStudentAccounts,
  importClassesFile,
  importStudents,
  importStudentsFile,
  importTeachersFile,
  listClasses,
  listStudents,
  listTeachers,
  updateClass,
  updateStudent,
  updateTeacher,
  type ClassRecord,
  type PlatformUser,
  type StudentRecord,
  type TeacherRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

type TeacherDraft = { display_name: string; subjects: string };
type ClassDraft = { name: string; grade: string };
type StudentDraft = { student_no: string; display_name: string; email: string };

function splitSubjects(value: string): string[] {
  return value
    .split(/[,\s，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, TeacherDraft>>({});
  const [classDrafts, setClassDrafts] = useState<Record<string, ClassDraft>>({});
  const [studentDrafts, setStudentDrafts] = useState<Record<string, StudentDraft>>({});
  const [teacherUsername, setTeacherUsername] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherSubjects, setTeacherSubjects] = useState("");
  const [className, setClassName] = useState("");
  const [grade, setGrade] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentClassId, setStudentClassId] = useState("");
  const [assignTeacherId, setAssignTeacherId] = useState("");
  const [assignClassId, setAssignClassId] = useState("");
  const [busy, setBusy] = useState(false);

  const teacherOptions = useMemo(() => teachers.filter((teacher) => teacher.status === "active"), [teachers]);

  async function refresh() {
    onError(null);
    const [teacherData, classData, studentData] = await Promise.all([listTeachers(), listClasses(), listStudents()]);
    setTeachers(teacherData.teachers);
    setClasses(classData.classes);
    setStudents(studentData.students);
    setTeacherDrafts(
      Object.fromEntries(
        teacherData.teachers.map((teacher) => [
          teacher.id,
          { display_name: teacher.display_name || teacher.username, subjects: teacher.subjects.join(", ") },
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
            email: student.email || "",
          },
        ]),
      ),
    );
    if (!assignTeacherId && teacherData.teachers[0]) setAssignTeacherId(teacherData.teachers[0].id);
    if (!assignClassId && classData.classes[0]) setAssignClassId(classData.classes[0].id);
    if (!studentClassId && classData.classes[0]) setStudentClassId(classData.classes[0].id);
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
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
        subjects: splitSubjects(teacherSubjects),
      });
      setTeacherUsername("");
      setTeacherPassword("");
      setTeacherName("");
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
        students: [{ student_no: studentNo, display_name: studentName }],
      });
      setStudentNo("");
      setStudentName("");
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="space-y-6">
          <ManagementSection title="教师" count={teachers.length}>
            {teachers.map((teacher) => {
              const draft = teacherDrafts[teacher.id] || { display_name: teacher.display_name, subjects: "" };
              return (
                <div key={teacher.id} className="grid gap-3 border-b border-slate-100 py-3 md:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={draft.display_name}
                      onChange={(event) =>
                        setTeacherDrafts((prev) => ({
                          ...prev,
                          [teacher.id]: { ...draft, display_name: event.target.value },
                        }))
                      }
                    />
                    <p className="mt-1 text-xs text-slate-500">{teacher.username}</p>
                  </div>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={draft.subjects}
                    placeholder="教师学科"
                    onChange={(event) =>
                      setTeacherDrafts((prev) => ({
                        ...prev,
                        [teacher.id]: { ...draft, subjects: event.target.value },
                      }))
                    }
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await updateTeacher(teacher.id, {
                          display_name: draft.display_name,
                          subjects: splitSubjects(draft.subjects),
                        });
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Save className="h-4 w-4" />
                    保存
                  </button>
                </div>
              );
            })}
          </ManagementSection>

          <ManagementSection title="班级" count={classes.length}>
            {classes.map((klass) => {
              const draft = classDrafts[klass.id] || { name: klass.name, grade: klass.grade || "" };
              return (
                <div key={klass.id} className="grid gap-3 border-b border-slate-100 py-3 md:grid-cols-[1fr_160px_auto]">
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={draft.name}
                    onChange={(event) =>
                      setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, name: event.target.value } }))
                    }
                  />
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={draft.grade}
                    placeholder="年级"
                    onChange={(event) =>
                      setClassDrafts((prev) => ({ ...prev, [klass.id]: { ...draft, grade: event.target.value } }))
                    }
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await updateClass(klass.id, { name: draft.name, grade: draft.grade });
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Save className="h-4 w-4" />
                    保存
                  </button>
                </div>
              );
            })}
          </ManagementSection>

          <ManagementSection title="学生账号" count={students.length}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">学号</th>
                    <th className="py-2 pr-3">姓名</th>
                    <th className="py-2 pr-3">班级</th>
                    <th className="py-2 pr-3">登录名</th>
                    <th className="py-2 pr-3">初始密码</th>
                    <th className="py-2 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const draft = studentDrafts[student.id] || {
                      student_no: student.student_no,
                      display_name: student.display_name,
                      email: student.email || "",
                    };
                    return (
                      <tr key={student.id} className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <input
                            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            value={draft.student_no}
                            onChange={(event) =>
                              setStudentDrafts((prev) => ({
                                ...prev,
                                [student.id]: { ...draft, student_no: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="py-2 pr-3">
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
                        <td className="py-2 pr-3 text-slate-600">{student.class_names || "-"}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{student.account_username || "-"}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{student.initial_password || "-"}</td>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await updateStudent(student.id, draft);
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Save className="h-3.5 w-3.5" />
                            保存
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ManagementSection>
        </section>

        <aside className="space-y-4">
          <form onSubmit={(event) => void submitTeacher(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">添加教师</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="用户名" value={teacherUsername} onChange={(event) => setTeacherUsername(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="姓名" value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="教师学科" value={teacherSubjects} onChange={(event) => setTeacherSubjects(event.target.value)} />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="初始密码" type="password" minLength={6} value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加教师
            </button>
            <FileImportControl label="导入教师 JSON / Excel" testId="teachers-import-file" onChange={(event) => void handleFile(event, "teachers")} />
          </form>

          <form onSubmit={(event) => void submitClass(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">添加班级</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="班级名称" value={className} onChange={(event) => setClassName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="年级" value={grade} onChange={(event) => setGrade(event.target.value)} />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加班级
            </button>
            <FileImportControl label="导入班级 JSON / Excel" testId="classes-import-file" onChange={(event) => void handleFile(event, "classes")} />
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
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              添加学生
            </button>
            <FileImportControl label="导入学生 JSON / Excel" testId="students-import-file" onChange={(event) => void handleFile(event, "students")} />
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

function ManagementSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>
      </div>
      {count === 0 ? <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无数据</p> : children}
    </section>
  );
}

function FileImportControl({
  label,
  testId,
  onChange,
}: {
  label: string;
  testId: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
      <Upload className="h-4 w-4" />
      {label}
      <input data-testid={testId} className="sr-only" type="file" accept=".json,.xlsx" onChange={onChange} />
    </label>
  );
}
