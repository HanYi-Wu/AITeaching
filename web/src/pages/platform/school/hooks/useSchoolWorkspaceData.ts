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

type RefreshTarget = "teachers" | "classes" | "students" | "assignments" | "ai";

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

  const teacherQueryRef = useRef(teacherQuery);
  const classQueryRef = useRef(classQuery);
  const studentQueryRef = useRef(studentQuery);
  const assignmentQueryRef = useRef(assignmentQuery);
  const studentClassFilterRef = useRef(studentClassFilter);
  const classChoicesRef = useRef<ClassRecord[]>([]);
  teacherQueryRef.current = teacherQuery;
  classQueryRef.current = classQuery;
  studentQueryRef.current = studentQuery;
  assignmentQueryRef.current = assignmentQuery;
  studentClassFilterRef.current = studentClassFilter;

  // Track active account to protect against late responses from previously selected account/school
  const activeAccountKey = `${user.id}:${user.school_id ?? ""}`;
  const activeAccountRef = useRef(activeAccountKey);

  const teacherSeqRef = useRef(0);
  const classSeqRef = useRef(0);
  const classChoicesSeqRef = useRef(0);
  const studentSeqRef = useRef(0);
  const assignmentSeqRef = useRef(0);

  const serializeTeacherQuery = (q: PageQuery) => `${q.q}:${q.status ?? ""}:${q.page}:${q.pageSize}`;
  const serializeClassQuery = (q: PageQuery) => `${q.q}:${q.page}:${q.pageSize}`;
  const serializeStudentQuery = (classFilter: string, q: PageQuery) => `${classFilter}:${q.q}:${q.status ?? ""}:${q.page}:${q.pageSize}`;
  const serializeAssignmentQuery = (q: PageQuery) => `${q.q}:${q.page}:${q.pageSize}`;

  const lastLoadedTeacherQueryRef = useRef<string | null>(null);
  const lastLoadedClassQueryRef = useRef<string | null>(null);
  const lastLoadedStudentQueryRef = useRef<string | null>(null);
  const lastLoadedAssignmentQueryRef = useRef<string | null>(null);

  useEffect(() => {
    activeAccountRef.current = `${user.id}:${user.school_id ?? ""}`;
  }, [user.id, user.school_id]);

  const teacherOptions = useMemo(() => teacherChoices.filter((teacher) => teacher.status === "active"), [teacherChoices]);

  async function fetchTeachersList(query: PageQuery, accountKey: string) {
    const seq = ++teacherSeqRef.current;
    const querySnapshot = { ...query };
    try {
      const teacherData = await listTeachers(querySnapshot);
      if (teacherSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return;
      }
      setTeachers(teacherData.teachers);
      setTeacherMeta(mergeMeta(teacherData, querySnapshot, teacherData.teachers.length));
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
    } catch (e) {
      if (teacherSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return;
      }
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function fetchTeacherChoices(accountKey: string) {
    try {
      const allTeacherData = await listTeachers({ page: 1, pageSize: 100, status: "active" });
      if (activeAccountRef.current !== accountKey) return;
      setTeacherChoices(allTeacherData.teachers);
      setAssignTeacherId((current) => current || allTeacherData.teachers.find((teacher) => teacher.status === "active")?.id || "");
    } catch (e) {
      if (activeAccountRef.current !== accountKey) return;
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function fetchClassesList(query: PageQuery, accountKey: string): Promise<boolean> {
    const seq = ++classSeqRef.current;
    const querySnapshot = { ...query };
    try {
      const classData = await listClasses(querySnapshot);
      if (classSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return false;
      }
      setClasses(classData.classes);
      setClassMeta(mergeMeta(classData, querySnapshot, classData.classes.length));
      setClassDrafts(
        Object.fromEntries(
          classData.classes.map((klass) => [klass.id, { name: klass.name, grade: klass.grade || "" }]),
        ),
      );
      return true;
    } catch (e) {
      if (classSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return false;
      }
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function applyClassChoices(availableClasses: ClassRecord[]) {
    const availableIds = new Set(availableClasses.map((klass) => klass.id));
    const previousIds = new Set(classChoicesRef.current.map((klass) => klass.id));
    const removed = [...previousIds].some((id) => !availableIds.has(id));
    const fallbackClassId = availableClasses[0]?.id || "";
    const currentStudentFilter = studentClassFilterRef.current;
    const studentFilter = currentStudentFilter && availableIds.has(currentStudentFilter) ? currentStudentFilter : "";
    const studentFilterChanged = studentFilter !== currentStudentFilter;

    classChoicesRef.current = availableClasses;
    setClassChoices(availableClasses);
    setAssignClassId((current) => (current && availableIds.has(current) ? current : fallbackClassId));
    setStudentClassId((current) => (current && availableIds.has(current) ? current : fallbackClassId));
    if (studentFilterChanged) {
      studentClassFilterRef.current = studentFilter;
      setStudentClassFilter(studentFilter);
    }

    return { removed, studentFilter, studentFilterChanged };
  }

  async function fetchClassChoices(accountKey: string): Promise<boolean> {
    const seq = ++classChoicesSeqRef.current;
    try {
      const allClassData = await listClasses({ page: 1, pageSize: 100 });
      if (classChoicesSeqRef.current !== seq || activeAccountRef.current !== accountKey) return false;
      const selection = applyClassChoices(allClassData.classes);
      if (selection.removed || selection.studentFilterChanged) {
        const query = { ...studentQueryRef.current };
        lastLoadedStudentQueryRef.current = serializeStudentQuery(selection.studentFilter, query);
        if (!await fetchStudentsList(selection.studentFilter, query, accountKey)) return false;
      }
      return true;
    } catch (e) {
      if (classChoicesSeqRef.current !== seq || activeAccountRef.current !== accountKey) return false;
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function fetchStudentsList(classFilter: string, query: PageQuery, accountKey: string): Promise<boolean> {
    const seq = ++studentSeqRef.current;
    const querySnapshot = { ...query };
    try {
      const studentData = await listStudents(classFilter || null, querySnapshot);
      if (studentSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return false;
      }
      setStudents(studentData.students);
      setStudentMeta(mergeMeta(studentData, querySnapshot, studentData.students.length));
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
      return true;
    } catch (e) {
      if (studentSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return false;
      }
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function fetchAssignmentsList(query: PageQuery, accountKey: string) {
    const seq = ++assignmentSeqRef.current;
    const querySnapshot = { ...query };
    try {
      const assignmentData = await listTeacherClassAssignments(querySnapshot);
      if (assignmentSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return;
      }
      setAssignments(assignmentData.assignments);
      setAssignmentMeta(mergeMeta(assignmentData, querySnapshot, assignmentData.assignments.length));
    } catch (e) {
      if (assignmentSeqRef.current !== seq || activeAccountRef.current !== accountKey) {
        return;
      }
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refresh() {
    const requestKey = activeAccountRef.current;
    const currentTeacherQuery = { ...teacherQueryRef.current };
    const currentClassQuery = { ...classQueryRef.current };
    const currentStudentQuery = { ...studentQueryRef.current };
    const currentAssignmentQuery = { ...assignmentQueryRef.current };
    const currentStudentClassFilter = studentClassFilterRef.current;
    const classChoicesSeq = ++classChoicesSeqRef.current;
    const teacherSeq = ++teacherSeqRef.current;
    const classSeq = ++classSeqRef.current;
    const studentSeq = ++studentSeqRef.current;
    const assignmentSeq = ++assignmentSeqRef.current;
    onError(null);
    const [aiData, teacherData, allTeacherData, classData, allClassData, studentData, assignmentData] = await Promise.all([
      getSchoolAiSettings(),
      listTeachers(currentTeacherQuery),
      listTeachers({ page: 1, pageSize: 100, status: "active" }),
      listClasses(currentClassQuery),
      listClasses({ page: 1, pageSize: 100 }),
      listStudents(currentStudentClassFilter || null, currentStudentQuery),
      listTeacherClassAssignments(currentAssignmentQuery),
    ]);

    // Check if account has changed since request was launched
    if (activeAccountRef.current !== requestKey) {
      return;
    }

    setAiSettings(aiData);
    if (teacherSeqRef.current === teacherSeq) {
      setTeachers(teacherData.teachers);
      setTeacherMeta(mergeMeta(teacherData, currentTeacherQuery, teacherData.teachers.length));
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
      lastLoadedTeacherQueryRef.current = serializeTeacherQuery(currentTeacherQuery);
    }
    setTeacherChoices(allTeacherData.teachers);
    if (classSeqRef.current === classSeq) {
      setClasses(classData.classes);
      setClassMeta(mergeMeta(classData, currentClassQuery, classData.classes.length));
      setClassDrafts(
        Object.fromEntries(
          classData.classes.map((klass) => [klass.id, { name: klass.name, grade: klass.grade || "" }]),
        ),
      );
      lastLoadedClassQueryRef.current = serializeClassQuery(currentClassQuery);
    }
    const classChoicesSelection = classChoicesSeqRef.current === classChoicesSeq
      ? applyClassChoices(allClassData.classes)
      : null;
    if (classChoicesSelection?.removed || classChoicesSelection?.studentFilterChanged) {
      studentSeqRef.current += 1;
      const query = { ...studentQueryRef.current };
      lastLoadedStudentQueryRef.current = serializeStudentQuery(classChoicesSelection.studentFilter, query);
      void fetchStudentsList(classChoicesSelection.studentFilter, query, requestKey);
    }
    if (studentSeqRef.current === studentSeq) {
      setStudents(studentData.students);
      setStudentMeta(mergeMeta(studentData, currentStudentQuery, studentData.students.length));
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
      lastLoadedStudentQueryRef.current = serializeStudentQuery(currentStudentClassFilter, currentStudentQuery);
    }
    if (assignmentSeqRef.current === assignmentSeq) {
      setAssignments(assignmentData.assignments);
      setAssignmentMeta(mergeMeta(assignmentData, currentAssignmentQuery, assignmentData.assignments.length));
      lastLoadedAssignmentQueryRef.current = serializeAssignmentQuery(currentAssignmentQuery);
    }
    setAssignTeacherId((current) => current || allTeacherData.teachers.find((teacher) => teacher.status === "active")?.id || "");
  }

  async function refreshTargets(targets: RefreshTarget[]): Promise<boolean> {
    const accountKey = activeAccountRef.current;
    const promises: Array<Promise<void | boolean>> = [];

    if (targets.includes("teachers")) {
      promises.push(fetchTeachersList(teacherQueryRef.current, accountKey));
      promises.push(fetchTeacherChoices(accountKey));
    }
    if (targets.includes("classes")) {
      promises.push(fetchClassesList(classQueryRef.current, accountKey));
      promises.push(fetchClassChoices(accountKey));
    }
    if (targets.includes("students")) {
      promises.push(fetchStudentsList(studentClassFilterRef.current, studentQueryRef.current, accountKey));
    }
    if (targets.includes("assignments")) {
      promises.push(fetchAssignmentsList(assignmentQueryRef.current, accountKey));
    }
    if (targets.includes("ai")) {
      promises.push(
        getSchoolAiSettings().then((aiData) => {
          if (activeAccountRef.current === accountKey) {
            setAiSettings(aiData);
          }
        }),
      );
    }

    const results = await Promise.all(promises);
    return results.every((result) => result !== false);
  }

  useEffect(() => {
    let cancelled = false;
    const currentKey = `${user.id}:${user.school_id ?? ""}`;
    activeAccountRef.current = currentKey;

    lastLoadedTeacherQueryRef.current = serializeTeacherQuery(teacherQuery);
    lastLoadedClassQueryRef.current = serializeClassQuery(classQuery);
    lastLoadedStudentQueryRef.current = serializeStudentQuery(studentClassFilter, studentQuery);
    lastLoadedAssignmentQueryRef.current = serializeAssignmentQuery(assignmentQuery);

    void refresh().catch((e) => {
      if (!cancelled && activeAccountRef.current === currentKey) {
        onError(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, user.school_id]);

  useEffect(() => {
    const key = serializeTeacherQuery(teacherQuery);
    if (lastLoadedTeacherQueryRef.current === key) {
      return;
    }
    lastLoadedTeacherQueryRef.current = key;
    void fetchTeachersList(teacherQuery, activeAccountRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherQuery.q, teacherQuery.status, teacherQuery.page, teacherQuery.pageSize]);

  useEffect(() => {
    const key = serializeClassQuery(classQuery);
    if (lastLoadedClassQueryRef.current === key) {
      return;
    }
    lastLoadedClassQueryRef.current = key;
    void fetchClassesList(classQuery, activeAccountRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classQuery.q, classQuery.page, classQuery.pageSize]);

  useEffect(() => {
    const key = serializeStudentQuery(studentClassFilter, studentQuery);
    if (lastLoadedStudentQueryRef.current === key) {
      return;
    }
    lastLoadedStudentQueryRef.current = key;
    void fetchStudentsList(studentClassFilter, studentQuery, activeAccountRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentQuery.q, studentQuery.status, studentQuery.page, studentQuery.pageSize, studentClassFilter]);

  useEffect(() => {
    const key = serializeAssignmentQuery(assignmentQuery);
    if (lastLoadedAssignmentQueryRef.current === key) {
      return;
    }
    lastLoadedAssignmentQueryRef.current = key;
    void fetchAssignmentsList(assignmentQuery, activeAccountRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentQuery.q, assignmentQuery.page, assignmentQuery.pageSize]);

  async function run(
    action: () => Promise<void>,
    targets?: RefreshTarget[],
  ) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (targets && targets.length > 0) {
        await refreshTargets(targets);
      } else {
        await refresh();
      }
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
    }, ["teachers"]);
  }

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const created = await createClass({ name: className, grade });
      setClassName("");
      setGrade("");
      setStudentClassId(created.class.id);
      setAssignClassId(created.class.id);
    }, ["classes"]);
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
    }, ["students"]);
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await assignTeacherClass({ teacher_id: assignTeacherId, class_id: assignClassId });
    }, ["assignments"]);
  }

  async function setSchoolAiEnabled(enabled: boolean) {
    await run(async () => {
      await updateSchoolAiSettings(enabled);
      setNotice(enabled ? "学校 AI 功能已开启" : "学校 AI 功能已关闭");
    }, ["ai"]);
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
    }, [kind]);
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
      if (pending.kind === "all") {
        await refresh();
      } else {
        await refreshTargets([pending.kind]);
      }
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
    refreshTargets,
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
