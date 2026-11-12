import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  assignTeacherClass,
  askSchoolAi,
  createClass,
  createTeacher,
  downloadSchoolImportTemplate,
  getSchoolAiCapabilities,
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
  type SchoolAiResponse,
  type SchoolAiSettings,
  type SchoolImportKind,
  type StudentRecord,
  type TeacherClassAssignmentRecord,
  type TeacherRecord,
} from "../../../../platform/auth";
import type { PageMeta, PageQuery } from "../SchoolControls";
import { canManage } from "../../../../platform/managementAccess";
import type { ManagementOptions } from "../../../../platform/managementApi";
export type { PageMeta, PageQuery };

export type TeacherDraft = { display_name: string; email: string; subjects: string };
export type ClassDraft = { name: string; grade: string };
export type StudentDraft = { student_no: string; display_name: string; email: string };
export type SchoolPage = "overview" | "teachers" | "classes" | "students" | "assignments" | "ai" | "audit" | "access" | "settings" | "activity";
export type SchoolAiMessage = { role: "user" | "assistant" | "system"; content: string; source?: string };
export type PendingSchoolAiImport = {
  kind: SchoolImportKind;
  file: File;
  classId: string | null;
  review: SchoolAiImportReviewResponse;
};

type RefreshTarget = "teachers" | "classes" | "students" | "assignments" | "ai";

const LIST_SEARCH_DEBOUNCE_MS = 300;

type ListQueryEffectSnapshot = {
  activePage: SchoolPage;
  accountKey: string;
  query: PageQuery;
  scope?: string;
};

type CurrentValue<T> = { current: T };

type ScheduleListQueryOptions = {
  targetPage: SchoolPage;
  query: PageQuery;
  queryRef: CurrentValue<PageQuery>;
  scope?: string;
  currentScope?: () => string | undefined;
  includeStatus: boolean;
  serialize: (query: PageQuery, scope?: string) => string;
  lastLoadedRef: CurrentValue<string | null>;
  timerRef: CurrentValue<number | null>;
  previousRef: CurrentValue<ListQueryEffectSnapshot | null>;
  sequenceRef: CurrentValue<number>;
  fetch: (query: PageQuery, scope: string | undefined, accountKey: string) => void;
};

function isSearchOnlyQueryChange(
  previous: ListQueryEffectSnapshot | null,
  next: ListQueryEffectSnapshot,
  includeStatus: boolean,
): boolean {
  if (
    !previous ||
    previous.activePage !== next.activePage ||
    previous.accountKey !== next.accountKey ||
    previous.scope !== next.scope ||
    previous.query.q === next.query.q ||
    previous.query.pageSize !== next.query.pageSize ||
    (includeStatus && previous.query.status !== next.query.status)
  ) {
    return false;
  }

  // Search changes reset a later page to page 1 in the panel's existing setter.
  return previous.query.page === next.query.page || (previous.query.page > 1 && next.query.page === 1);
}

function clearListSearchTimer(timer: { current: number | null }) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

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

export function useSchoolWorkspaceData(user: PlatformUser, onError: (message: string | null) => void, managementOptions?: ManagementOptions | null) {
  const permissionsKey = JSON.stringify([user.school_access_mode, user.management_permissions]);
  const currentUserRef = useRef(user);
  currentUserRef.current = user;
  const allowed = (permission: string) => canManage(currentUserRef.current, permission);
  const canReadTeachers = canManage(user, "school.teachers.read");
  const canReadClasses = canManage(user, "school.classes.read");
  const canReadStudents = canManage(user, "school.students.read");
  const canReadAssignments = canManage(user, "school.assignments.read");
  const canReadAi = canManage(user, "school.ai.read");
  const [activePage, setActivePage] = useState<SchoolPage>("overview");
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [teacherChoices, setTeacherChoices] = useState<TeacherRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [classChoices, setClassChoices] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<TeacherClassAssignmentRecord[]>([]);
  const [aiSettings, setAiSettings] = useState<SchoolAiSettings | null>(null);
  const [schoolStats, setSchoolStats] = useState<SchoolAiResponse["stats"] | null>(null);
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
  const activeAccountKey = `${user.id}:${user.school_id ?? ""}:${permissionsKey}`;
  const activeAccountRef = useRef(activeAccountKey);
  activeAccountRef.current = activeAccountKey;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const previousAccountKeyRef = useRef(activeAccountKey);
  const accountSwitchingRef = useRef(false);

  const teacherSeqRef = useRef(0);
  const teacherChoicesSeqRef = useRef(0);
  const classSeqRef = useRef(0);
  const classChoicesSeqRef = useRef(0);
  const studentSeqRef = useRef(0);
  const assignmentSeqRef = useRef(0);
  const overviewRefreshSeqRef = useRef(0);
  const teacherChoicesAccountRef = useRef<string | null>(null);
  const classChoicesAccountRef = useRef<string | null>(null);
  const hasTeacherChoicesSnapshotRef = useRef(false);
  const hasClassChoicesSnapshotRef = useRef(false);
  const aiSettingsAccountRef = useRef<string | null>(null);
  const defaultPageSizeAccountRef = useRef<{ key: string; value: number } | null>(null);

  const serializeTeacherQuery = (q: PageQuery) => `${q.q}:${q.status ?? ""}:${q.page}:${q.pageSize}`;
  const serializeClassQuery = (q: PageQuery) => `${q.q}:${q.page}:${q.pageSize}`;
  const serializeStudentQuery = (classFilter: string, q: PageQuery) => `${classFilter}:${q.q}:${q.status ?? ""}:${q.page}:${q.pageSize}`;
  const serializeAssignmentQuery = (q: PageQuery) => `${q.q}:${q.page}:${q.pageSize}`;

  const lastLoadedTeacherQueryRef = useRef<string | null>(null);
  const lastLoadedClassQueryRef = useRef<string | null>(null);
  const lastLoadedStudentQueryRef = useRef<string | null>(null);
  const lastLoadedAssignmentQueryRef = useRef<string | null>(null);
  const teacherSearchTimerRef = useRef<number | null>(null);
  const classSearchTimerRef = useRef<number | null>(null);
  const studentSearchTimerRef = useRef<number | null>(null);
  const assignmentSearchTimerRef = useRef<number | null>(null);
  const previousTeacherEffectRef = useRef<ListQueryEffectSnapshot | null>(null);
  const previousClassEffectRef = useRef<ListQueryEffectSnapshot | null>(null);
  const previousStudentEffectRef = useRef<ListQueryEffectSnapshot | null>(null);
  const previousAssignmentEffectRef = useRef<ListQueryEffectSnapshot | null>(null);

  function clearPendingListSearches() {
    clearListSearchTimer(teacherSearchTimerRef);
    clearListSearchTimer(classSearchTimerRef);
    clearListSearchTimer(studentSearchTimerRef);
    clearListSearchTimer(assignmentSearchTimerRef);
  }

  function scheduleListQuery({
    targetPage,
    query,
    queryRef,
    scope,
    currentScope,
    includeStatus,
    serialize,
    lastLoadedRef,
    timerRef,
    previousRef,
    sequenceRef,
    fetch,
  }: ScheduleListQueryOptions): (() => void) | undefined {
    const accountKey = activeAccountKey;
    const snapshot: ListQueryEffectSnapshot = { activePage, accountKey, query: { ...query }, scope };
    const previous = previousRef.current;
    previousRef.current = snapshot;
    if (activePage !== targetPage) return undefined;

    const key = serialize(query, scope);
    if (lastLoadedRef.current === key) {
      clearListSearchTimer(timerRef);
      return undefined;
    }

    if (isSearchOnlyQueryChange(previous, snapshot, includeStatus)) {
      sequenceRef.current += 1;
      // A response for the previous key is stale now, even if that key is typed again before debounce.
      lastLoadedRef.current = null;
      clearListSearchTimer(timerRef);
      const querySnapshot = { ...query };
      const scopeSnapshot = scope;
      const timer = window.setTimeout(() => {
        if (timerRef.current === timer) timerRef.current = null;
        if (activePageRef.current !== targetPage || activeAccountRef.current !== accountKey) return;
        if (serialize(queryRef.current, currentScope?.()) !== key) return;
        lastLoadedRef.current = key;
        fetch(querySnapshot, scopeSnapshot, accountKey);
      }, LIST_SEARCH_DEBOUNCE_MS);
      timerRef.current = timer;
      return () => {
        if (timerRef.current === timer) clearListSearchTimer(timerRef);
      };
    }

    clearListSearchTimer(timerRef);
    lastLoadedRef.current = key;
    fetch({ ...query }, scope, accountKey);
    return undefined;
  }

  useEffect(() => {
    activeAccountRef.current = `${user.id}:${user.school_id ?? ""}`;
  }, [user.id, user.school_id]);

  // A page-sized list is only an option fallback while the full choice
  // snapshot is loading. Once a full snapshot exists, preserve it (including
  // an intentionally empty snapshot) through ordinary page refreshes.
  const visibleTeacherChoices = hasTeacherChoicesSnapshotRef.current ? teacherChoices : teachers;
  const visibleClassChoices = hasClassChoicesSnapshotRef.current ? classChoices : classes;
  const teacherOptions = useMemo(
    () => visibleTeacherChoices.filter((teacher) => teacher.status === "active"),
    [visibleTeacherChoices],
  );
  const visibleAssignTeacherId = assignTeacherId || teacherOptions[0]?.id || "";
  const visibleAssignClassId = classChoicesAccountRef.current === activeAccountKey
    ? (assignClassId && visibleClassChoices.some((klass) => klass.id === assignClassId) ? assignClassId : visibleClassChoices[0]?.id || "")
    : assignClassId || visibleClassChoices[0]?.id || "";
  const visibleStudentClassId = classChoicesAccountRef.current === activeAccountKey
    ? (studentClassId && visibleClassChoices.some((klass) => klass.id === studentClassId) ? studentClassId : visibleClassChoices[0]?.id || "")
    : studentClassId || visibleClassChoices[0]?.id || "";

  async function fetchTeachersList(query: PageQuery, accountKey: string) {
    if (!allowed("school.teachers.read")) return;
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
    if (!allowed("school.teachers.read")) return false;
    const seq = ++teacherChoicesSeqRef.current;
    try {
      const allTeacherData = await listTeachers({ page: 1, pageSize: 100, status: "active" });
      if (teacherChoicesSeqRef.current !== seq || activeAccountRef.current !== accountKey) return false;
      setTeacherChoices(allTeacherData.teachers);
      setAssignTeacherId((current) => current || allTeacherData.teachers.find((teacher) => teacher.status === "active")?.id || "");
      hasTeacherChoicesSnapshotRef.current = true;
      teacherChoicesAccountRef.current = accountKey;
      return true;
    } catch (e) {
      if (teacherChoicesSeqRef.current !== seq || activeAccountRef.current !== accountKey) return false;
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function fetchClassesList(query: PageQuery, accountKey: string): Promise<boolean> {
    if (!allowed("school.classes.read")) return false;
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
    if (!allowed("school.classes.read")) return false;
    const seq = ++classChoicesSeqRef.current;
    try {
      const allClassData = await listClasses({ page: 1, pageSize: 100 });
      if (classChoicesSeqRef.current !== seq || activeAccountRef.current !== accountKey) return false;
      const selection = applyClassChoices(allClassData.classes);
      hasClassChoicesSnapshotRef.current = true;
      classChoicesAccountRef.current = accountKey;
      if ((selection.removed || selection.studentFilterChanged) && allowed("school.students.read")) {
        const query = { ...studentQueryRef.current };
        clearListSearchTimer(studentSearchTimerRef);
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
    if (!allowed("school.students.read")) return false;
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
    if (!allowed("school.assignments.read")) return;
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

  async function fetchAiSettings(accountKey: string): Promise<boolean> {
    if (!allowed("school.ai.read")) return false;
    try {
      const aiData = await getSchoolAiSettings();
      if (activeAccountRef.current !== accountKey) return false;
      setAiSettings(aiData);
      aiSettingsAccountRef.current = accountKey;
      return true;
    } catch (e) {
      if (activeAccountRef.current !== accountKey) return false;
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function fetchSchoolAiOverview(accountKey: string): Promise<boolean> {
    const requestId = ++overviewRefreshSeqRef.current;
    try {
      const overview = await getSchoolAiCapabilities();
      if (activeAccountRef.current !== accountKey || overviewRefreshSeqRef.current !== requestId) return false;
      setAiSettings(overview);
      setSchoolStats(overview.stats);
      aiSettingsAccountRef.current = accountKey;
      return true;
    } catch (e) {
      if (activeAccountRef.current !== accountKey || overviewRefreshSeqRef.current !== requestId) return false;
      onError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function refreshOverview() {
    const requestKey = activeAccountRef.current;
    onError(null);
    await fetchSchoolAiOverview(requestKey);
  }

  async function refresh() {
    clearPendingListSearches();
    overviewRefreshSeqRef.current += 1;
    teacherChoicesAccountRef.current = null;
    classChoicesAccountRef.current = null;
    const requestKey = activeAccountRef.current;
    const currentTeacherQuery = { ...teacherQueryRef.current };
    const currentClassQuery = { ...classQueryRef.current };
    const currentStudentQuery = { ...studentQueryRef.current };
    const currentAssignmentQuery = { ...assignmentQueryRef.current };
    const currentStudentClassFilter = studentClassFilterRef.current;
    lastLoadedTeacherQueryRef.current = serializeTeacherQuery(currentTeacherQuery);
    lastLoadedClassQueryRef.current = serializeClassQuery(currentClassQuery);
    lastLoadedStudentQueryRef.current = serializeStudentQuery(currentStudentClassFilter, currentStudentQuery);
    lastLoadedAssignmentQueryRef.current = serializeAssignmentQuery(currentAssignmentQuery);
    const teacherChoicesSeq = ++teacherChoicesSeqRef.current;
    const classChoicesSeq = ++classChoicesSeqRef.current;
    const teacherSeq = ++teacherSeqRef.current;
    const classSeq = ++classSeqRef.current;
    const studentSeq = ++studentSeqRef.current;
    const assignmentSeq = ++assignmentSeqRef.current;
    onError(null);
    const [, teacherData, allTeacherData, classData, allClassData, studentData, assignmentData] = await Promise.all([
      fetchSchoolAiOverview(requestKey),
      allowed("school.teachers.read") ? listTeachers(currentTeacherQuery) : Promise.resolve({ teachers: [], total: 0 }),
      allowed("school.teachers.read") ? listTeachers({ page: 1, pageSize: 100, status: "active" }) : Promise.resolve({ teachers: [] }),
      allowed("school.classes.read") ? listClasses(currentClassQuery) : Promise.resolve({ classes: [], total: 0 }),
      allowed("school.classes.read") ? listClasses({ page: 1, pageSize: 100 }) : Promise.resolve({ classes: [] }),
      allowed("school.students.read") ? listStudents(currentStudentClassFilter || null, currentStudentQuery) : Promise.resolve({ students: [], total: 0 }),
      allowed("school.assignments.read") ? listTeacherClassAssignments(currentAssignmentQuery) : Promise.resolve({ assignments: [], total: 0 }),
    ]);

    // Check if account has changed since request was launched
    if (activeAccountRef.current !== requestKey) {
      return;
    }

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
    if (teacherChoicesSeqRef.current === teacherChoicesSeq) {
      setTeacherChoices(allTeacherData.teachers);
      hasTeacherChoicesSnapshotRef.current = true;
      teacherChoicesAccountRef.current = requestKey;
    }
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
    if (classChoicesSelection) {
      hasClassChoicesSnapshotRef.current = true;
      classChoicesAccountRef.current = requestKey;
    }
    if (classChoicesSelection?.removed || classChoicesSelection?.studentFilterChanged) {
      studentSeqRef.current += 1;
      const query = { ...studentQueryRef.current };
      clearListSearchTimer(studentSearchTimerRef);
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
    if (teacherChoicesSeqRef.current === teacherChoicesSeq) {
      setAssignTeacherId((current) => current || allTeacherData.teachers.find((teacher) => teacher.status === "active")?.id || "");
    }
  }

  async function refreshTargets(targets: RefreshTarget[]): Promise<boolean> {
    overviewRefreshSeqRef.current += 1;
    const accountKey = activeAccountRef.current;
    const promises: Array<Promise<void | boolean>> = [];

    if (targets.includes("teachers")) {
      clearListSearchTimer(teacherSearchTimerRef);
      teacherChoicesAccountRef.current = null;
      teacherChoicesSeqRef.current += 1;
      lastLoadedTeacherQueryRef.current = serializeTeacherQuery(teacherQueryRef.current);
      promises.push(fetchTeachersList(teacherQueryRef.current, accountKey));
      if (activePage === "assignments") promises.push(fetchTeacherChoices(accountKey));
    }
    if (targets.includes("classes")) {
      clearListSearchTimer(classSearchTimerRef);
      classChoicesAccountRef.current = null;
      classChoicesSeqRef.current += 1;
      lastLoadedClassQueryRef.current = serializeClassQuery(classQueryRef.current);
      promises.push(fetchClassesList(classQueryRef.current, accountKey));
      if (activePage === "students" || activePage === "assignments" || activePage === "ai") {
        promises.push(fetchClassChoices(accountKey));
      }
    }
    if (targets.includes("students")) {
      clearListSearchTimer(studentSearchTimerRef);
      lastLoadedStudentQueryRef.current = serializeStudentQuery(studentClassFilterRef.current, studentQueryRef.current);
      promises.push(fetchStudentsList(studentClassFilterRef.current, studentQueryRef.current, accountKey));
    }
    if (targets.includes("assignments")) {
      clearListSearchTimer(assignmentSearchTimerRef);
      lastLoadedAssignmentQueryRef.current = serializeAssignmentQuery(assignmentQueryRef.current);
      promises.push(fetchAssignmentsList(assignmentQueryRef.current, accountKey));
    }
    if (targets.includes("ai")) {
      promises.push(fetchAiSettings(accountKey));
    }
    if (targets.some((target) => target === "teachers" || target === "classes" || target === "students" || target === "assignments")) {
      promises.push(fetchSchoolAiOverview(accountKey));
    }

    const results = await Promise.all(promises);
    return results.every((result) => result !== false);
  }

  function seedTeacherChoicesFromCurrentPage(accountKey: string) {
    if (teacherChoicesAccountRef.current === accountKey || hasTeacherChoicesSnapshotRef.current) return;
    setTeacherChoices(teachers);
    setAssignTeacherId((current) => current || teachers.find((teacher) => teacher.status === "active")?.id || "");
  }

  function seedClassChoicesFromCurrentPage(accountKey: string) {
    if (classChoicesAccountRef.current === accountKey || hasClassChoicesSnapshotRef.current) return;
    // The visible class page is only an immediate option fallback while the
    // full choice query is loading. It must not clear a filter or selection;
    // only applyClassChoices(fullChoices) may make those decisions.
    setClassChoices(classes);
    setAssignClassId((current) => current || classes[0]?.id || "");
    setStudentClassId((current) => current || classes[0]?.id || "");
  }

  useEffect(() => {
    let cancelled = false;
    const currentKey = activeAccountKey;
    const accountChanged = previousAccountKeyRef.current !== currentKey;
    previousAccountKeyRef.current = currentKey;
    activeAccountRef.current = currentKey;
    accountSwitchingRef.current = accountChanged;

    overviewRefreshSeqRef.current += 1;
    teacherChoicesSeqRef.current += 1;
    classChoicesSeqRef.current += 1;
    if (accountChanged) {
      teacherChoicesAccountRef.current = null;
      classChoicesAccountRef.current = null;
      aiSettingsAccountRef.current = null;
      hasTeacherChoicesSnapshotRef.current = false;
      hasClassChoicesSnapshotRef.current = false;
      classChoicesRef.current = [];
      setTeachers([]);
      setTeacherChoices([]);
      setClasses([]);
      setClassChoices([]);
      setStudents([]);
      setAssignments([]);
      setAiSettings(null);
      setSchoolStats(null);
      setTeacherMeta(DEFAULT_META);
      setClassMeta(DEFAULT_META);
      setStudentMeta(DEFAULT_META);
      setAssignmentMeta(DEFAULT_META);
      setTeacherDrafts({});
      setClassDrafts({});
      setStudentDrafts({});
      setSelectedTeacherIds([]);
      setSelectedStudentIds([]);
      setAssignTeacherId("");
      setAssignClassId("");
      setStudentClassId("");
      setStudentClassFilter("");
      studentClassFilterRef.current = "";
    }
    lastLoadedTeacherQueryRef.current = null;
    lastLoadedClassQueryRef.current = null;
    lastLoadedStudentQueryRef.current = null;
    lastLoadedAssignmentQueryRef.current = null;

    void refreshOverview().catch((e) => {
      if (!cancelled && activeAccountRef.current === currentKey) {
        onError(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, user.school_id, permissionsKey]);

  useEffect(() => {
    if (!managementOptions) return;
    const pageSize = managementOptions.settings.default_page_size;
    if (![10, 20, 50].includes(pageSize)) return;
    const previousDefault = defaultPageSizeAccountRef.current;
    if (previousDefault?.key === activeAccountKey && previousDefault.value === pageSize) return;
    const previousPageSize = previousDefault?.key === activeAccountKey ? previousDefault.value : 10;
    defaultPageSizeAccountRef.current = { key: activeAccountKey, value: pageSize };
    const applyDefault = (current: PageQuery): PageQuery =>
      current.page === 1 && !current.q && current.pageSize === previousPageSize ? { ...current, pageSize } : current;
    setTeacherQuery(applyDefault);
    setClassQuery(applyDefault);
    setStudentQuery(applyDefault);
    setAssignmentQuery(applyDefault);
  }, [activeAccountKey, managementOptions]);

  useEffect(() => {
    if (!canReadTeachers) return;
    return scheduleListQuery({
      targetPage: "teachers",
      query: teacherQuery,
      queryRef: teacherQueryRef,
      includeStatus: true,
      serialize: (query) => serializeTeacherQuery(query),
      lastLoadedRef: lastLoadedTeacherQueryRef,
      timerRef: teacherSearchTimerRef,
      previousRef: previousTeacherEffectRef,
      sequenceRef: teacherSeqRef,
      fetch: (query, _scope, accountKey) => { void fetchTeachersList(query, accountKey); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, user.id, user.school_id, permissionsKey, canReadTeachers, teacherQuery.q, teacherQuery.status, teacherQuery.page, teacherQuery.pageSize]);

  useEffect(() => {
    if (!canReadClasses) return;
    return scheduleListQuery({
      targetPage: "classes",
      query: classQuery,
      queryRef: classQueryRef,
      includeStatus: false,
      serialize: (query) => serializeClassQuery(query),
      lastLoadedRef: lastLoadedClassQueryRef,
      timerRef: classSearchTimerRef,
      previousRef: previousClassEffectRef,
      sequenceRef: classSeqRef,
      fetch: (query, _scope, accountKey) => { void fetchClassesList(query, accountKey); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, user.id, user.school_id, permissionsKey, canReadClasses, classQuery.q, classQuery.page, classQuery.pageSize]);

  useEffect(() => {
    if (!canReadStudents) return;
    return scheduleListQuery({
      targetPage: "students",
      query: studentQuery,
      queryRef: studentQueryRef,
      scope: studentClassFilter,
      currentScope: () => studentClassFilterRef.current,
      includeStatus: true,
      serialize: (query, scope) => serializeStudentQuery(scope ?? "", query),
      lastLoadedRef: lastLoadedStudentQueryRef,
      timerRef: studentSearchTimerRef,
      previousRef: previousStudentEffectRef,
      sequenceRef: studentSeqRef,
      fetch: (query, scope, accountKey) => { void fetchStudentsList(scope ?? "", query, accountKey); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, user.id, user.school_id, permissionsKey, canReadStudents, studentQuery.q, studentQuery.status, studentQuery.page, studentQuery.pageSize, studentClassFilter]);

  useEffect(() => {
    if (!canReadAssignments) return;
    return scheduleListQuery({
      targetPage: "assignments",
      query: assignmentQuery,
      queryRef: assignmentQueryRef,
      includeStatus: false,
      serialize: (query) => serializeAssignmentQuery(query),
      lastLoadedRef: lastLoadedAssignmentQueryRef,
      timerRef: assignmentSearchTimerRef,
      previousRef: previousAssignmentEffectRef,
      sequenceRef: assignmentSeqRef,
      fetch: (query, _scope, accountKey) => { void fetchAssignmentsList(query, accountKey); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, user.id, user.school_id, permissionsKey, canReadAssignments, assignmentQuery.q, assignmentQuery.page, assignmentQuery.pageSize]);

  useEffect(() => {
    const accountKey = activeAccountRef.current;
    const accountChanged = accountSwitchingRef.current;
    accountSwitchingRef.current = false;
    if (activePage === "students" && canReadClasses && classChoicesAccountRef.current !== accountKey) {
      if (!accountChanged) seedClassChoicesFromCurrentPage(accountKey);
      void fetchClassChoices(accountKey);
    }
    if (activePage === "assignments") {
      if (!accountChanged) {
        seedTeacherChoicesFromCurrentPage(accountKey);
        seedClassChoicesFromCurrentPage(accountKey);
      }
      if (canReadTeachers && teacherChoicesAccountRef.current !== accountKey) void fetchTeacherChoices(accountKey);
      if (canReadClasses && classChoicesAccountRef.current !== accountKey) void fetchClassChoices(accountKey);
    }
    if (activePage === "ai" && canReadClasses && classChoicesAccountRef.current !== accountKey) {
      if (!accountChanged) seedClassChoicesFromCurrentPage(accountKey);
      void fetchClassChoices(accountKey);
    }
    if (activePage === "ai" && canReadAi && aiSettingsAccountRef.current !== accountKey) {
      void fetchAiSettings(accountKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, user.id, user.school_id, permissionsKey, canReadClasses, canReadTeachers, canReadAi]);

  async function run(
    action: () => Promise<void>,
    targets?: RefreshTarget[],
  ) {
    const operationAccount = activeAccountRef.current;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (activeAccountRef.current !== operationAccount) return;
      if (targets && targets.length > 0) {
        await refreshTargets(targets);
      } else {
        await refresh();
      }
    } catch (e) {
      if (activeAccountRef.current === operationAccount) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (activeAccountRef.current === operationAccount) setBusy(false);
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
        class_id: visibleStudentClassId || null,
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
      await assignTeacherClass({ teacher_id: visibleAssignTeacherId, class_id: visibleAssignClassId });
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
      if (kind === "students") await importStudentsFile(file, visibleStudentClassId || null);
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
      const classId = schoolAiImportKind === "students" ? visibleStudentClassId || null : null;
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
    teacherChoices: visibleTeacherChoices,
    classes,
    classChoices: visibleClassChoices,
    students,
    assignments,
    aiSettings,
    schoolStats,
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
    studentClassId: visibleStudentClassId,
    setStudentClassId,
    studentClassFilter,
    setStudentClassFilter,
    assignTeacherId: visibleAssignTeacherId,
    setAssignTeacherId,
    assignClassId: visibleAssignClassId,
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
