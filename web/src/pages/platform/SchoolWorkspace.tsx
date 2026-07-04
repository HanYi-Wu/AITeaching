import { FormEvent, useEffect, useMemo, useState } from "react";
import { GraduationCap, Link2, Plus, RefreshCw, Users } from "lucide-react";
import {
  assignTeacherClass,
  createClass,
  createTeacher,
  importStudents,
  listClasses,
  listTeachers,
  type ClassRecord,
  type PlatformUser,
  type TeacherRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

export function SchoolWorkspace({ user, onLogout, onError }: Props) {
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [teacherUsername, setTeacherUsername] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherSubjects, setTeacherSubjects] = useState("数学");
  const [className, setClassName] = useState("");
  const [grade, setGrade] = useState("");
  const [subjectHint, setSubjectHint] = useState("数学");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentClassId, setStudentClassId] = useState("");
  const [assignTeacherId, setAssignTeacherId] = useState("");
  const [assignClassId, setAssignClassId] = useState("");
  const [assignSubject, setAssignSubject] = useState("数学");
  const [busy, setBusy] = useState(false);

  const teacherOptions = useMemo(() => teachers.filter((teacher) => teacher.status === "active"), [teachers]);

  async function refresh() {
    onError(null);
    const [teacherData, classData] = await Promise.all([listTeachers(), listClasses()]);
    setTeachers(teacherData.teachers);
    setClasses(classData.classes);
    if (!assignTeacherId && teacherData.teachers[0]) setAssignTeacherId(teacherData.teachers[0].id);
    if (!assignClassId && classData.classes[0]) setAssignClassId(classData.classes[0].id);
    if (!studentClassId && classData.classes[0]) setStudentClassId(classData.classes[0].id);
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await createTeacher({
        username: teacherUsername,
        password: teacherPassword,
        display_name: teacherName,
        subjects: teacherSubjects.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean),
      });
      setTeacherUsername("");
      setTeacherPassword("");
      setTeacherName("");
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await createClass({ name: className, grade, subject_hint: subjectHint });
      setClassName("");
      setStudentClassId(created.class.id);
      setAssignClassId(created.class.id);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await importStudents({
        class_id: studentClassId || null,
        students: [{ student_no: studentNo, display_name: studentName }],
      });
      setStudentNo("");
      setStudentName("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await assignTeacherClass({
        teacher_id: assignTeacherId,
        class_id: assignClassId,
        subject: assignSubject,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
    </>
  );

  return (
    <PlatformShell
      roleLabel="学校端"
      title={user.display_name || user.username}
      subtitle="管理教师、学科、班级、学生和任课分配。"
      userName={user.username}
      actions={actions}
      onLogout={onLogout}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="space-y-6">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-slate-600" />
              <h2 className="text-base font-semibold">教师</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {teachers.map((teacher) => (
                <div key={teacher.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="font-medium">{teacher.display_name || teacher.username}</p>
                  <p className="text-sm text-slate-500">{teacher.username}</p>
                  <p className="mt-2 text-sm text-slate-600">学科：{teacher.subjects.join("、") || "未分配"}</p>
                </div>
              ))}
              {teachers.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                  暂无教师。
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-slate-600" />
              <h2 className="text-base font-semibold">班级</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {classes.map((klass) => (
                <div key={klass.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="font-medium">{klass.name}</p>
                  <p className="text-sm text-slate-500">{klass.grade || "未设置年级"}</p>
                  <p className="mt-2 text-sm text-slate-600">默认学科：{klass.subject_hint || "未设置"}</p>
                </div>
              ))}
              {classes.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                  暂无班级。
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <form onSubmit={(event) => void submitTeacher(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">创建教师</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="用户名" value={teacherUsername} onChange={(event) => setTeacherUsername(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="显示名称" value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="学科，用逗号分隔" value={teacherSubjects} onChange={(event) => setTeacherSubjects(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="初始密码" type="password" minLength={6} value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              创建教师
            </button>
          </form>

          <form onSubmit={(event) => void submitClass(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">创建班级</h2>
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="班级名称" value={className} onChange={(event) => setClassName(event.target.value)} required />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="年级" value={grade} onChange={(event) => setGrade(event.target.value)} />
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="默认学科" value={subjectHint} onChange={(event) => setSubjectHint(event.target.value)} />
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Plus className="h-4 w-4" />
              创建班级
            </button>
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
            <input className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="学科" value={assignSubject} onChange={(event) => setAssignSubject(event.target.value)} required />
            <button type="submit" disabled={busy || !assignTeacherId || !assignClassId} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Link2 className="h-4 w-4" />
              分配
            </button>
          </form>
        </aside>
      </div>
    </PlatformShell>
  );
}
