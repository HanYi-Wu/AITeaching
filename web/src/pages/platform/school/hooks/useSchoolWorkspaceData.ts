import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  assignTeacherClass,
  askSchoolAi,
  createClass,
  createTeacher,
  downloadSchoolImportTemplate,
  getSchoolAiSettings,
  importClassesFile,
  importSchoolAiFile,
  importStudents,
  importStudentsFile,
  importTeacherClassAssignmentsFile,
  importTeachersFile,
  listClasses,
  listStudents,
  listTeacherClassAssignments,
  listTeachers,
  reviewSchoolAiImportFile,
  updateSchoolAiSettings,
  type ClassRecord,
  type PlatformUser,
  type SchoolAiImportReviewResponse,
  type SchoolAiSettings,
  type SchoolImportKind,
  type StudentRecord,
  type TeacherClassAssignmentRecord,
  type TeacherRecord,
} from "../../../../platform/auth";
import type { PageMeta, PageQuery } from "../SchoolControls";
export type { PageMeta, PageQuery };

export type TeacherDraft = { display_name: string; email: string; subjects: string };
export type ClassDraft = { name: string; grade: string };
export type StudentDraft = { student_no: string; display_name: string; email: string };
export type SchoolPage = "overview" | "teachers" | "classes" | "students" | "assignments" | "ai";
export type SchoolAiMessage = { role: "user" | "assistant" | "system"; content: string; source?: string };
export type PendingSchoolAiImport = {
  kind: SchoolImportKind;
  file: File;
  classId: string | null;
  review: SchoolAiImportReviewResponse;
};

export const DEFAULT_META: PageMeta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };

export function splitSubjects(value: string): string[] {
  return value
    .split(/[,\s，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function optionalText(value: string | null | undefined): string {
  if (!value || value.toLowerCase() === "none") return "";
  return value;
}

export function mergeMeta<T extends { total?: number; page?: number; page_size?: number; total_pages?: number }>(
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

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useSchoolWorkspaceData(user: PlatformUser, onError: (message: string | null) => void) {
  const [activePage, setActivePage] = useState<SchoolPage>("overview");
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [teacherChoices, setTeacherChoices] = useState<TeacherRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [classChoices, setClassChoices] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<TeacherClassAssignmentRecord[]>([]);
  const [aiSettings, setAiSettings] = useState<SchoolAiSettings | null>(null);
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
  const [schoolAiInput, setSchoolAiInput] = useState("");
  const [schoolAiMessages, setSchoolAiMessages] = useState<SchoolAiMessage[]>([]);
  const [schoolAiBusy, setSchoolAiBusy] = useState(false);
  const [schoolAiImportKind, setSchoolAiImportKind] = useState<SchoolImportKind>("all");
  const [schoolAiImportFile, setSchoolAiImportFile] = useState<File | null>(null);
  const [pendingSchoolAiImport, setPendingSchoolAiImport] = useState<PendingSchoolAiImport | null>(null);

  // Track active account to protect against late responses from previously selected account/school
  const activeAccountKey = `${user.id}:${user.school_id ?? ""}`;
  const activeAccountRef = useRef(activeAccountKey);

  useEffect(() => {
    activeAccountRef.current = `${user.id}:${user.school_id ?? ""}`;
  }, [user.id, user.school_id]);

  const teacherOptions = useMemo(() => teacherChoices.filter((teacher) => teacher.status === "active"), [teacherChoices]);

  async function refresh() {
    const requestKey = activeAccountRef.current;
    onError(null);
    const [aiData, teacherData, allTeacherData, classData, allClassData, studentData, assignmentData] = await Promise.all([
      getSchoolAiSettings(),
      listTeachers(teacherQuery),
      listTeachers({ page: 1, pageSize: 100, status: "active" }),
      listClasses(classQuery),
      listClasses({ page: 1, pageSize: 100 }),
      listStudents(studentClassFilter || null, studentQuery),
      listTeacherClassAssignments(assignmentQuery),
    ]);

    // Check if account has changed since request was launched
    if (activeAccountRef.current !== requestKey) {
      return;
    }

    setAiSettings(aiData);
    setTeachers(teacherData.teachers);
    setTeacherChoices(allTeacherData.teachers);
    setClasses(classData.classes);
    setClassChoices(allClassData.classes);
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
    let cancelled = false;
    const currentKey = `${user.id}:${user.school_id ?? ""}`;
    activeAccountRef.current = currentKey;

    void refresh().catch((e) => {
      if (!cancelled && activeAccountRef.current === currentKey) {
        onError(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user.id,
    user.school_id,
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

  async function setSchoolAiEnabled(enabled: boolean) {
    await run(async () => {
      await updateSchoolAiSettings(enabled);
      setNotice(enabled ? "学校 AI 功能已开启" : "学校 AI 功能已关闭");
    });
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>, kind: Exclude<SchoolImportKind, "all">) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(async () => {
      if (kind === "teachers") await importTeachersFile(file);
      if (kind === "classes") await importClassesFile(file);
      if (kind === "students") await importStudentsFile(file, studentClassId || null);
      if (kind === "assignments") await importTeacherClassAssignmentsFile(file);
    });
  }

  async function downloadTemplate(kind: SchoolImportKind) {
    await run(async () => {
      const blob = await downloadSchoolImportTemplate(kind);
      downloadBlob(blob, `${kind}_template.xlsx`);
    });
  }

  async function submitSchoolAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = schoolAiInput.trim();
    if (!message) return;
    setSchoolAiBusy(true);
    setNotice(null);
    setSchoolAiMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const response = await askSchoolAi(message);
      setAiSettings(response);
      setSchoolAiMessages((current) => [
        ...current,
        { role: "assistant", content: response.reply || "AI 已响应，但没有返回正文。", source: response.source },
      ]);
      setSchoolAiInput("");
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      onError(text);
      setSchoolAiMessages((current) => [...current, { role: "system", content: text }]);
    } finally {
      setSchoolAiBusy(false);
    }
  }

  async function runSchoolAiImport() {
    if (!schoolAiImportFile) return;
    setSchoolAiBusy(true);
    setNotice(null);
    setPendingSchoolAiImport(null);
    try {
      const file = schoolAiImportFile;
      const classId = schoolAiImportKind === "students" ? studentClassId || null : null;
      const review = await reviewSchoolAiImportFile(
        schoolAiImportKind,
        file,
        classId,
      );
      const result = { ...review, imported: review.row_count };
      setAiSettings(review);
      setPendingSchoolAiImport({ kind: schoolAiImportKind, file, classId, review });
      setSchoolAiMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `${result.review}\n\n已审核 ${file.name}，确认后将写入 ${result.imported} 行数据。`,
          source: "review",
        },
      ]);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      onError(text);
      setSchoolAiMessages((current) => [...current, { role: "system", content: `导入失败：${text}` }]);
    } finally {
      setSchoolAiBusy(false);
    }
  }

  async function confirmSchoolAiImport(accepted: boolean) {
    const pending = pendingSchoolAiImport;
    if (!pending) return;
    if (!accepted) {
      setPendingSchoolAiImport(null);
      setSchoolAiMessages((current) => [...current, { role: "system", content: "已取消本次 AI 导入。" }]);
      return;
    }
    setSchoolAiBusy(true);
    setNotice(null);
    try {
      const result = await importSchoolAiFile(pending.kind, pending.file, pending.classId);
      setAiSettings(result);
      setSchoolAiMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `${result.review}\n\n已确认并写入 ${result.imported} 行数据。`,
          source: "import",
        },
      ]);
      setPendingSchoolAiImport(null);
      setSchoolAiImportFile(null);
      await refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      onError(text);
      setSchoolAiMessages((current) => [...current, { role: "system", content: `导入失败：${text}` }]);
    } finally {
      setSchoolAiBusy(false);
    }
  }

  function toggleTeacher(id: string) {
    setSelectedTeacherIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleStudent(id: string) {
    setSelectedStudentIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return {
    activePage,
    setActivePage,
    teachers,
    setTeachers,
    teacherChoices,
    classes,
    classChoices,
    students,
    assignments,
    aiSettings,
    teacherMeta,
    classMeta,
    studentMeta,
    assignmentMeta,
    teacherQuery,
    setTeacherQuery,
    classQuery,
    setClassQuery,
    studentQuery,
    setStudentQuery,
    assignmentQuery,
    setAssignmentQuery,
    teacherDrafts,
    setTeacherDrafts,
    classDrafts,
    setClassDrafts,
    studentDrafts,
    setStudentDrafts,
    selectedTeacherIds,
    setSelectedTeacherIds,
    selectedStudentIds,
    setSelectedStudentIds,
    teacherUsername,
    setTeacherUsername,
    teacherPassword,
    setTeacherPassword,
    teacherName,
    setTeacherName,
    teacherEmail,
    setTeacherEmail,
    teacherSubjects,
    setTeacherSubjects,
    className,
    setClassName,
    grade,
    setGrade,
    studentNo,
    setStudentNo,
    studentName,
    setStudentName,
    studentEmail,
    setStudentEmail,
    studentClassId,
    setStudentClassId,
    studentClassFilter,
    setStudentClassFilter,
    assignTeacherId,
    setAssignTeacherId,
    assignClassId,
    setAssignClassId,
    busy,
    notice,
    setNotice,
    schoolAiInput,
    setSchoolAiInput,
    schoolAiMessages,
    schoolAiBusy,
    schoolAiImportKind,
    setSchoolAiImportKind,
    schoolAiImportFile,
    setSchoolAiImportFile,
    pendingSchoolAiImport,
    setPendingSchoolAiImport,
    teacherOptions,
    refresh,
    run,
    submitTeacher,
    submitClass,
    submitStudent,
    submitAssignment,
    setSchoolAiEnabled,
    handleFile,
    downloadTemplate,
    submitSchoolAi,
    runSchoolAiImport,
    confirmSchoolAiImport,
    toggleTeacher,
    toggleStudent,
  };
}
