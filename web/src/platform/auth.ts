import { resolveApiUrl } from "../api/client";
import { logApiCall } from "../lib/appLog";
import type { PlatformRole } from "./roles";

const LEGACY_SESSION_STORAGE_KEY = "solaire.platform.session";
const PROJECT_SESSION_STORAGE_PREFIX = "solaire.platform.session:";

export type PlatformUser = {
  id: string;
  school_id?: string | null;
  role: PlatformRole;
  username: string;
  display_name: string;
  email?: string | null;
  status: string;
  must_change_password?: boolean;
  avatar_data_url?: string | null;
  preferences?: { theme?: string; density?: string; font_scale?: number };
  subjects?: string[];
};

export type PlatformStatus = {
  project_bound: boolean;
  admin_exists: boolean;
  public_mode: boolean;
};

export type PlatformAuthResponse = {
  user: PlatformUser;
  token: string;
};

export type SchoolRecord = {
  id: string;
  name: string;
  status: string;
  ai_enabled: number;
  created_at: string;
  updated_at: string;
  school_user_count?: number;
};

export type SchoolAiSettings = {
  school: SchoolRecord;
  ai_available: boolean;
  ai_enabled: boolean;
};

export type SchoolAiCapability = {
  id: string;
  label: string;
  description: string;
};

export type SchoolAiResponse = SchoolAiSettings & {
  capabilities: SchoolAiCapability[];
  stats: {
    teachers: number;
    classes: number;
    students: number;
    assignments: number;
  };
  reply?: string;
  source?: "llm" | "local" | string;
  error?: string;
};

export type SchoolImportKind = "teachers" | "classes" | "students" | "assignments" | "all";

export type SchoolAiImportResponse = SchoolAiSettings & {
  kind: SchoolImportKind;
  imported: number;
  review: string;
  result: unknown;
};

export type SchoolAiImportReviewResponse = SchoolAiSettings & {
  kind: SchoolImportKind;
  class_id?: string | null;
  row_count: number;
  review: string;
  preview: Array<Record<string, unknown>>;
  stats?: SchoolAiResponse["stats"];
};

export type PagedResult = {
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
};

export type ListQuery = {
  q?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
};

export type TeacherRecord = PlatformUser & {
  subjects: string[];
};

export type ClassRecord = {
  id: string;
  school_id: string;
  name: string;
  grade?: string | null;
  subject_hint?: string | null;
  student_count?: number;
  teacher_count?: number;
};

export type StudentRecord = {
  id: string;
  school_id: string;
  user_id?: string | null;
  student_no: string;
  display_name: string;
  email?: string | null;
  account_username?: string | null;
  initial_password?: string | null;
  class_names?: string | null;
  status: string;
};

export type PaperSubmissionMode = "online" | "image_manual" | "image_ai" | "offline_scan";
export type PracticePublishMode = "current" | "wrong_questions" | "reinforcement";

export type PracticeHistoryRecord = {
  id: string;
  paper_id: string;
  title: string;
  subject?: string | null;
  created_at?: string | null;
  status?: string;
  practice_kind?: string | null;
  submitted_student_count: number;
  wrong_answer_count: number;
};

export type PracticeHistoryResponse = {
  class_id: string;
  publication_count: number;
  minimum_reinforcement_history: number;
  eligible_for_reinforcement: boolean;
  publications: PracticeHistoryRecord[];
};

export type StudentAnswerImage = {
  name: string;
  mime_type?: string | null;
  data_url: string;
};

export type PlatformPaperRecord = {
  paper_id: string;
  exam_id: string;
  title: string;
  subject: string;
  delivery_mode: "offline" | "online";
  status: string;
  owner_teacher_id?: string | null;
  school_id?: string | null;
  question_count: number;
  section_count: number;
  score_batch_count: number;
  has_score: boolean;
  has_pdf: boolean;
  has_docx: boolean;
  latest_batch_id?: string | null;
  publication_count: number;
  published_class_count: number;
  total_student_count?: number;
  submitted_student_count?: number;
  in_progress_student_count?: number;
  graded_student_count?: number;
  published_student_count?: number;
  mtime?: string | null;
};

export type TeacherClassRecord = ClassRecord & {
  subject?: string | null;
};

export type PaperPublicationRecord = {
  id: string;
  paper_id: string;
  teacher_id?: string;
  teacher_name?: string | null;
  teacher_username?: string | null;
  title: string;
  description?: string | null;
  status: string;
  class_ids: string[];
  class_names?: string[];
  attempt_count?: number;
  submitted_count?: number;
  proctor_event_count?: number;
  show_results_immediately?: boolean;
  randomize_questions?: boolean;
  randomize_answers?: boolean;
  submission_mode?: PaperSubmissionMode;
  max_screen_switches?: number;
  time_limit_minutes?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PaperSubmissionAnswerRecord = {
  question_id: string;
  header?: string | null;
  content?: string | null;
  type?: string | null;
  score_per_item?: number | null;
  options?: Record<string, string> | null;
  analysis?: string | null;
  section_id?: string | null;
  tags?: string[];
  answer?: unknown;
  images?: StudentAnswerImage[];
  score?: number | null;
  is_correct?: boolean | null;
  grading_status?: string | null;
  feedback?: string | null;
  ai_suggested_score?: number | null;
  ai_feedback?: string | null;
  ai_ocr_text?: string | null;
  responded_at?: string | null;
};

export type PaperSubmissionRecord = {
  attempt_id: string;
  publication_id: string;
  paper_id?: string;
  exam_id?: string;
  title?: string;
  subject?: string | null;
  student_id?: string;
  student_no?: string;
  student_name?: string;
  account_username?: string | null;
  status: string;
  score?: number | null;
  max_score?: number | null;
  submitted_at?: string | null;
  grading_completed_at?: string | null;
  screen_switch_count?: number;
  submission_mode?: PaperSubmissionMode;
  scan_images?: Array<{ page_index: number; name: string; mime_type: string; size: number }>;
  answers: PaperSubmissionAnswerRecord[];
};

export function getAccountProfile(): Promise<{ profile: PlatformUser }> {
  return platformRequest("/api/auth/profile");
}

export function updateAccountProfile(payload: {
  avatar_data_url?: string | null;
  preferences: { theme: string; density: string; font_scale: number };
  subjects?: string[] | null;
}): Promise<{ profile: PlatformUser }> {
  return platformRequest("/api/auth/profile", { method: "PATCH", body: JSON.stringify(payload) });
}

export type TeacherClassStudentRecord = {
  id: string;
  student_no: string;
  display_name: string;
  account_username?: string | null;
  email?: string | null;
  status: string;
};

export type TeacherStudentProfile = {
  student: TeacherClassStudentRecord;
  class_id: string;
  summary: {
    exam_count: number;
    submitted_exam_count: number;
    graded_exam_count: number;
    completion_rate: number;
    average_score_percent?: number | null;
    average_time_per_question_seconds?: number | null;
    integrity_event_count: number;
    behavior_event_average_per_exam: number;
  };
  recent_exams: Array<{
    attempt_id: string;
    paper_id: string;
    title: string;
    subject?: string | null;
    status: string;
    score?: number | null;
    max_score?: number | null;
    score_percent?: number | null;
    submitted_at?: string | null;
    submission_mode?: PaperSubmissionMode;
    scan_image_count?: number;
    integrity_event_count?: number;
  }>;
  weak_questions: Array<{
    paper_id: string;
    paper_title: string;
    question_id: string;
    attempt_count: number;
    wrong_count: number;
    average_score_percent?: number | null;
    header?: string | null;
    content?: string | null;
    section_id?: string | null;
    tags?: string[];
  }>;
  radar?: Array<{ id: string; label: string; value: number }>;
  date_range?: { from?: string | null; to?: string | null };
};

export type TeacherClassAssignmentRecord = {
  teacher_id: string;
  class_id: string;
  subject?: string | null;
  teacher_username: string;
  teacher_name: string;
  teacher_status: string;
  class_name: string;
  class_grade?: string | null;
};

export type PlatformPaperAnalysis = {
  paper: {
    paper_id: string;
    exam_id: string;
    title: string;
    subject: string;
    delivery_mode: "offline" | "online";
    status: string;
  };
  summary: {
    total_students: number;
    completed_students: number;
    in_progress_students: number;
    not_started_students: number;
    completion_rate: number;
    average_score?: number | null;
    average_time_seconds?: number | null;
    publication_count: number;
  };
  proctoring: {
    event_count?: number;
    event_type_counts?: Record<string, number>;
    screen_switch_count: number;
    screen_switch_duration_ms: number;
    flagged_student_count: number;
    exceeded_student_count?: number;
  };
  modules?: Array<{
    module_id: string;
    label?: string;
    question_ids?: string[];
    question_count: number;
    student_count: number;
    answered_count: number;
    scored_count: number;
    correct_count?: number;
    wrong_count?: number;
    max_score?: number;
    average_score_percent?: number | null;
    accuracy_rate?: number | null;
    risk_level?: "no_data" | "low" | "medium" | "high" | string;
  }>;
  questions?: Array<{
    question_id: string;
    header?: string | null;
    section_id?: string | null;
    type?: string | null;
    content?: string | null;
    score_per_item?: number | null;
    answered_count: number;
    scored_count: number;
    correct_count?: number;
    wrong_count?: number;
    average_score_percent?: number | null;
    accuracy_rate?: number | null;
    risk_level?: "no_data" | "low" | "medium" | "high" | string;
  }>;
  classes?: Array<{
    class_id: string;
    class_name: string;
    class_grade?: string | null;
    student_count: number;
    completed_count: number;
    in_progress_count: number;
    not_started_count: number;
    completion_rate: number;
    average_score?: number | null;
    average_time_seconds?: number | null;
    screen_switch_count: number;
  }>;
  radar?: Array<{
    id: "completion" | "score" | "time_efficiency" | "proctoring" | "module_mastery" | string;
    label: string;
    value: number;
  }>;
  students: Array<{
    student_id: string;
    student_no: string;
    display_name: string;
    account_username?: string | null;
    status: "completed" | "in_progress" | "not_started";
    score?: number | null;
    max_score?: number | null;
    score_percent?: number | null;
    time_spent_seconds: number;
    screen_switch_count: number;
    screen_switch_limit?: number;
    screen_switch_exceeded?: boolean;
    screen_switch_remaining?: number;
    screen_switch_duration_ms: number;
    integrity_event_count?: number;
    integrity_event_type_counts?: Record<string, number>;
    integrity_risk_score?: number;
    publication_id?: string | null;
    publication_title?: string | null;
    class_names?: string[];
  }>;
};

export type StudentPaperRecord = {
  publication_id: string;
  attempt_id: string;
  paper_id?: string;
  exam_id: string;
  title: string;
  subject?: string | null;
  status: "not_started" | "in_progress" | "submitted" | "completed" | string;
  started_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  max_score?: number | null;
  score_percent?: number | null;
  time_spent_seconds: number;
  show_results: boolean;
  question_count: number;
  submission_mode?: PaperSubmissionMode;
  publication_status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  time_limit_minutes?: number | null;
  can_answer?: boolean;
  remaining_seconds?: number | null;
  practice_metadata?: {
    kind?: "wrong_questions" | "reinforcement" | string;
    source_count?: number;
    source_publication_ids?: string[];
  };
};

export type StudentQuestionRecord = {
  question_id: string;
  header: string;
  section_id: string;
  score_per_item: number;
  type: string;
  content: string;
  options?: Record<string, string> | null;
};

export type StudentAttemptRecord = Omit<StudentPaperRecord, "attempt_id" | "question_count"> & {
  id: string;
};

export type StudentResultRecord = StudentAttemptRecord & {
  attempt_id: string;
  answers: Array<{
    question_id: string;
    answer?: unknown;
    images?: StudentAnswerImage[];
    score?: number | null;
    is_correct?: boolean | null;
    feedback?: string | null;
    header?: string | null;
    content?: string | null;
    type?: string | null;
    options?: Record<string, string> | null;
    section_id?: string | null;
    score_per_item?: number | null;
    tags?: string[];
    responded_at?: string | null;
    correct_answer?: unknown;
    analysis?: string | null;
  }>;
  analysis?: {
    correct_count?: number | null;
    wrong_count?: number | null;
    answered_count?: number;
    average_time_per_question_seconds?: number | null;
  };
};

export function sessionStorageKeyForProject(_projectRoot: string | null): string {
  return LEGACY_SESSION_STORAGE_KEY;
}

export function setPlatformProjectRoot(_projectRoot: string | null): void {
  // Platform sessions are global. Project roots only affect content workspaces.
}

function clearProjectScopedSessionTokens(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PROJECT_SESSION_STORAGE_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

export function saveSessionToken(token: string): void {
  localStorage.setItem(LEGACY_SESSION_STORAGE_KEY, token);
  clearProjectScopedSessionTokens();
}

export function loadSessionToken(): string | null {
  return localStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
}

export function clearSessionToken(): void {
  localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  clearProjectScopedSessionTokens();
}

function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }
  const message = await readErrorMessage(response);
  throw new Error(message);
}

async function readErrorMessage(response: Response): Promise<string> {
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.clone().json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      message = body.detail;
    }
  } catch {
    /* ignore */
  }
  return message;
}

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toString().toUpperCase();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const token = loadSessionToken();
  const headers = new Headers(init.headers);
  const bodyIsFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body != null && !bodyIsFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const url = await resolveApiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
    const detail = error instanceof Error ? error.message : String(error);
    logApiCall({ path, method, ok: false, status: 0, ms, detail });
    throw error;
  }
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  if (!response.ok) {
    const detail = await readErrorMessage(response);
    logApiCall({ path, method, ok: false, status: response.status, ms, detail });
    throw new Error(detail);
  }
  if (method !== "GET") {
    logApiCall({ path, method, ok: true, status: response.status, ms });
  }
  return readJson<T>(response);
}

export function getPlatformStatus(): Promise<PlatformStatus> {
  return platformRequest<PlatformStatus>("/api/platform/status");
}

export async function getCurrentUser(): Promise<{ user: PlatformUser | null }> {
  if (!loadSessionToken()) {
    return { user: null };
  }
  try {
    return await platformRequest<{ user: PlatformUser }>("/api/auth/me");
  } catch (e) {
    clearSessionToken();
    return { user: null };
  }
}

export function bootstrapAdmin(payload: {
  username: string;
  password: string;
  display_name: string;
}): Promise<PlatformAuthResponse> {
  return platformRequest<PlatformAuthResponse>("/api/auth/bootstrap-admin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginPlatform(payload: { username: string; password: string }): Promise<PlatformAuthResponse> {
  return platformRequest<PlatformAuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logoutPlatform(): Promise<void> {
  if (!loadSessionToken()) {
    return;
  }
  try {
    await platformRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
  } finally {
    clearSessionToken();
  }
}

export function listSchools(params: ListQuery = {}): Promise<{ schools: SchoolRecord[] } & PagedResult> {
  return platformRequest(
    `/api/schools${buildQuery({
      q: params.q ?? null,
      status: params.status ?? null,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function createSchool(payload: { name: string }): Promise<{ school: SchoolRecord }> {
  return platformRequest("/api/schools", { method: "POST", body: JSON.stringify(payload) });
}

export function createSchoolUser(
  schoolId: string,
  payload: { username: string; password: string; display_name: string; email?: string | null },
): Promise<{ school: SchoolRecord; user: PlatformUser }> {
  return platformRequest(`/api/schools/${encodeURIComponent(schoolId)}/school-users`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSchoolAiSettings(): Promise<SchoolAiSettings> {
  return platformRequest("/api/school/ai-settings");
}

export function updateSchoolAiSettings(aiEnabled: boolean): Promise<SchoolAiSettings> {
  return platformRequest("/api/school/ai-settings", {
    method: "PATCH",
    body: JSON.stringify({ ai_enabled: aiEnabled }),
  });
}

export function getSchoolAiCapabilities(): Promise<SchoolAiResponse> {
  return platformRequest("/api/school/ai/capabilities");
}

export function askSchoolAi(message: string): Promise<SchoolAiResponse> {
  return platformRequest("/api/school/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function importSchoolAiFile(
  kind: SchoolImportKind,
  file: File,
  classId?: string | null,
): Promise<SchoolAiImportResponse> {
  const fd = new FormData();
  fd.append("kind", kind);
  if (classId) fd.append("class_id", classId);
  fd.append("file", file);
  return platformRequest("/api/school/ai/import-file", { method: "POST", body: fd });
}

export function reviewSchoolAiImportFile(
  kind: SchoolImportKind,
  file: File,
  classId?: string | null,
): Promise<SchoolAiImportReviewResponse> {
  const fd = new FormData();
  fd.append("kind", kind);
  if (classId) fd.append("class_id", classId);
  fd.append("file", file);
  return platformRequest("/api/school/ai/import-review", { method: "POST", body: fd });
}

export function listTeachers(params: ListQuery = {}): Promise<{ teachers: TeacherRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/teachers${buildQuery({
      q: params.q,
      status: params.status,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function createTeacher(payload: {
  username: string;
  password: string;
  display_name: string;
  subjects: string[];
  email?: string | null;
}): Promise<{ teacher: TeacherRecord }> {
  return platformRequest("/api/school/teachers", { method: "POST", body: JSON.stringify(payload) });
}

export function importTeachers(payload: {
  teachers: Array<{ username: string; password?: string | null; display_name?: string | null; email?: string | null; subjects?: string[] }>;
}): Promise<{ imported: number; teachers: TeacherRecord[] }> {
  return platformRequest("/api/school/teachers/import", { method: "POST", body: JSON.stringify(payload) });
}

export function importTeachersFile(file: File): Promise<{ imported: number; teachers: TeacherRecord[] }> {
  const fd = new FormData();
  fd.append("file", file);
  return platformRequest("/api/school/teachers/import-file", { method: "POST", body: fd });
}

export function updateTeacher(
  teacherId: string,
  payload: { display_name?: string | null; email?: string | null; subjects?: string[] | null; password?: string | null; status?: string | null },
): Promise<{ teacher: TeacherRecord }> {
  return platformRequest(`/api/school/teachers/${encodeURIComponent(teacherId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function bulkUpdateTeachers(payload: {
  ids: string[];
  status: "active" | "disabled";
}): Promise<{ updated: number }> {
  return platformRequest("/api/school/teachers/bulk-status", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetTeacherPassword(
  teacherId: string,
  password?: string | null,
): Promise<{ teacher: TeacherRecord; password: string }> {
  return platformRequest(`/api/school/teachers/${encodeURIComponent(teacherId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password: password || null }),
  });
}

export function listClasses(params: Pick<ListQuery, "q" | "page" | "pageSize"> = {}): Promise<{ classes: ClassRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/classes${buildQuery({
      q: params.q,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function createClass(payload: {
  name: string;
  grade?: string | null;
  subject_hint?: string | null;
}): Promise<{ class: ClassRecord }> {
  return platformRequest("/api/school/classes", { method: "POST", body: JSON.stringify(payload) });
}

export function importClasses(payload: {
  classes: Array<{ name: string; grade?: string | null }>;
}): Promise<{ imported: number; classes: ClassRecord[] }> {
  return platformRequest("/api/school/classes/import", { method: "POST", body: JSON.stringify(payload) });
}

export function importClassesFile(file: File): Promise<{ imported: number; classes: ClassRecord[] }> {
  const fd = new FormData();
  fd.append("file", file);
  return platformRequest("/api/school/classes/import-file", { method: "POST", body: fd });
}

export function updateClass(
  classId: string,
  payload: { name?: string | null; grade?: string | null },
): Promise<{ class: ClassRecord }> {
  return platformRequest(`/api/school/classes/${encodeURIComponent(classId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteClass(classId: string): Promise<{ deleted: boolean; class_id: string }> {
  return platformRequest(`/api/school/classes/${encodeURIComponent(classId)}`, { method: "DELETE" });
}

export function listStudents(
  classId?: string | null,
  params: ListQuery = {},
): Promise<{ students: StudentRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/students${buildQuery({
      class_id: classId,
      q: params.q,
      status: params.status,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function importStudents(payload: {
  class_id?: string | null;
  students: Array<{ student_no: string; display_name: string; email?: string | null }>;
}): Promise<{ imported: number; students: StudentRecord[] }> {
  return platformRequest("/api/school/students/import", { method: "POST", body: JSON.stringify(payload) });
}

export function importStudentsFile(
  file: File,
  classId?: string | null,
): Promise<{ imported: number; students: StudentRecord[] }> {
  const fd = new FormData();
  if (classId) fd.append("class_id", classId);
  fd.append("file", file);
  return platformRequest("/api/school/students/import-file", { method: "POST", body: fd });
}

export function importTeacherClassAssignmentsFile(
  file: File,
): Promise<{ imported: number; assignments: TeacherClassAssignmentRecord[] }> {
  const fd = new FormData();
  fd.append("file", file);
  return platformRequest("/api/school/teacher-class-assignments/import-file", { method: "POST", body: fd });
}

export function updateStudent(
  studentId: string,
  payload: { student_no?: string | null; display_name?: string | null; email?: string | null; status?: string | null },
): Promise<{ student: StudentRecord }> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function bulkUpdateStudents(payload: {
  ids: string[];
  status: "active" | "disabled";
}): Promise<{ updated: number }> {
  return platformRequest("/api/school/students/bulk-status", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetStudentPassword(
  studentId: string,
  password?: string | null,
): Promise<{ student: StudentRecord; password: string }> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password: password || null }),
  });
}

async function downloadAuthorizedBlob(path: string): Promise<Blob> {
  const token = loadSessionToken();
  const url = await resolveApiUrl(path);
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    await readJson(response);
  }
  return response.blob();
}

export function exportStudentAccounts(): Promise<Blob> {
  return downloadAuthorizedBlob("/api/school/students/export.xlsx");
}

export function downloadSchoolImportTemplate(kind: SchoolImportKind): Promise<Blob> {
  return downloadAuthorizedBlob(`/api/school/${kind}/template.xlsx`);
}

export function assignTeacherClass(payload: {
  teacher_id: string;
  class_id: string;
  subject?: string | null;
}): Promise<{ assignment: { teacher_id: string; class_id: string; subject?: string } }> {
  return platformRequest("/api/school/teacher-class-assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTeacherClassAssignments(
  params: Pick<ListQuery, "q" | "page" | "pageSize"> = {},
): Promise<{ assignments: TeacherClassAssignmentRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/teacher-class-assignments${buildQuery({
      q: params.q,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function removeTeacherClassAssignment(payload: {
  teacher_id: string;
  class_id: string;
  subject?: string | null;
}): Promise<{ deleted: number }> {
  return platformRequest(
    `/api/school/teacher-class-assignments${buildQuery({
      teacher_id: payload.teacher_id,
      class_id: payload.class_id,
      subject: payload.subject,
    })}`,
    { method: "DELETE" },
  );
}

function normalizePaper(raw: Partial<PlatformPaperRecord> & { id?: string }): PlatformPaperRecord {
  return {
    paper_id: String(raw.paper_id ?? raw.id ?? ""),
    exam_id: String(raw.exam_id ?? ""),
    title: String(raw.title ?? raw.exam_id ?? ""),
    subject: String(raw.subject ?? ""),
    delivery_mode: raw.delivery_mode === "online" ? "online" : "offline",
    status: String(raw.status ?? "draft"),
    owner_teacher_id: raw.owner_teacher_id ?? null,
    school_id: raw.school_id ?? null,
    question_count: Number(raw.question_count ?? 0),
    section_count: Number(raw.section_count ?? 0),
    score_batch_count: Number(raw.score_batch_count ?? 0),
    has_score: Boolean(raw.has_score),
    has_pdf: Boolean(raw.has_pdf),
    has_docx: Boolean(raw.has_docx),
    latest_batch_id: raw.latest_batch_id ?? null,
    publication_count: Number(raw.publication_count ?? 0),
    published_class_count: Number(raw.published_class_count ?? 0),
    total_student_count: Number(raw.total_student_count ?? 0),
    submitted_student_count: Number(raw.submitted_student_count ?? 0),
    in_progress_student_count: Number(raw.in_progress_student_count ?? 0),
    graded_student_count: Number(raw.graded_student_count ?? 0),
    published_student_count: Number(raw.published_student_count ?? raw.graded_student_count ?? 0),
    mtime: raw.mtime ?? null,
  };
}

export async function listPlatformPapers(
  params: (ListQuery & { deliveryMode?: "offline" | "online" | "all" | null; subject?: string | null }) = {},
): Promise<{ papers: PlatformPaperRecord[] } & PagedResult> {
  const data = await platformRequest<
    { papers: Array<Partial<PlatformPaperRecord> & { id?: string }> } & PagedResult
  >(
    `/api/papers${buildQuery({
      q: params.q,
      status: params.status,
      delivery_mode: params.deliveryMode,
      subject: params.subject,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
  return {
    papers: data.papers.map(normalizePaper),
    total: data.total,
    page: data.page,
    page_size: data.page_size,
    total_pages: data.total_pages,
  };
}

export async function updatePlatformPaperDeliveryMode(
  paperId: string,
  deliveryMode: "offline" | "online",
): Promise<{ paper: PlatformPaperRecord }> {
  const data = await platformRequest<{ paper: Partial<PlatformPaperRecord> & { id?: string } }>(
    `/api/papers/${encodeURIComponent(paperId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ delivery_mode: deliveryMode }),
    },
  );
  return { paper: normalizePaper(data.paper) };
}

export async function syncPlatformPaperFromExam(examId: string): Promise<{ paper: PlatformPaperRecord }> {
  const data = await platformRequest<{ paper: Partial<PlatformPaperRecord> & { id?: string } }>("/api/papers/from-exam", {
    method: "POST",
    body: JSON.stringify({ exam_id: examId }),
  });
  return { paper: normalizePaper(data.paper) };
}

export function listTeacherAssignedClasses(): Promise<{ classes: TeacherClassRecord[] }> {
  return platformRequest("/api/teacher/classes");
}

export function downloadPlatformBlob(path: string): Promise<Blob> {
  return downloadAuthorizedBlob(path);
}

export function listTeacherClassStudents(classId: string): Promise<{ students: TeacherClassStudentRecord[] }> {
  return platformRequest(`/api/teacher/classes/${encodeURIComponent(classId)}/students`);
}

export function getTeacherStudentProfile(
  classId: string,
  studentId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<{ profile: TeacherStudentProfile }> {
  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const suffix = params.toString() ? `?${params}` : "";
  return platformRequest(
    `/api/teacher/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/profile${suffix}`,
  );
}

export function downloadOfflineAnswerUploader(): Promise<Blob> {
  return downloadAuthorizedBlob("/api/tools/offline-answer-uploader.exe");
}

export function publishPlatformPaper(
  paperId: string,
  payload: {
    class_ids: string[];
    title?: string | null;
    description?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    show_results_immediately?: boolean;
    randomize_questions?: boolean;
    randomize_answers?: boolean;
    submission_mode?: PaperSubmissionMode;
    max_screen_switches?: number;
    time_limit_minutes?: number | null;
    subject?: string | null;
  },
): Promise<{ publication: PaperPublicationRecord }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/publish`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listClassPracticeHistory(classId: string): Promise<PracticeHistoryResponse> {
  return platformRequest(`/api/teacher/classes/${encodeURIComponent(classId)}/practice-history`);
}

type AdaptivePracticePublishPayload = {
  class_id: string;
  title: string;
  start_at?: string | null;
  end_at?: string | null;
  show_results_immediately?: boolean;
  submission_mode?: PaperSubmissionMode;
  max_screen_switches?: number;
  time_limit_minutes?: number | null;
};

export function publishWrongQuestionPractice(
  payload: AdaptivePracticePublishPayload & { source_publication_id: string; max_questions_per_student?: number },
): Promise<{
  publication: PaperPublicationRecord & { practice_kind: "wrong_questions" };
  assigned_student_count: number;
  skipped_student_count: number;
}> {
  return platformRequest("/api/teacher/practice-publications/wrong-questions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishReinforcementPractice(
  payload: AdaptivePracticePublishPayload & { source_publication_ids: string[]; questions_per_student?: number },
): Promise<{
  publication: PaperPublicationRecord & { practice_kind: "reinforcement" };
  assigned_student_count: number;
  skipped_student_count: number;
  generation: { provider?: string | null; model?: string | null; total_tokens: number };
}> {
  return platformRequest("/api/teacher/practice-publications/reinforcement", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listPlatformPaperPublications(
  paperId: string,
): Promise<{ publications: PaperPublicationRecord[] }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/publications`);
}

export function updatePlatformPaperPublication(
  paperId: string,
  publicationId: string,
  payload: {
    title?: string | null;
    description?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    time_limit_minutes?: number | null;
    show_results_immediately?: boolean | null;
    status?: string | null;
  },
): Promise<{ publication: PaperPublicationRecord }> {
  return platformRequest(
    `/api/papers/${encodeURIComponent(paperId)}/publications/${encodeURIComponent(publicationId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export function revokePlatformPaperPublication(
  paperId: string,
  publicationId: string,
): Promise<{ publication: PaperPublicationRecord }> {
  return platformRequest(
    `/api/papers/${encodeURIComponent(paperId)}/publications/${encodeURIComponent(publicationId)}`,
    { method: "DELETE" },
  );
}

export function analyzePlatformPaper(paperId: string): Promise<{ analysis: PlatformPaperAnalysis }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/analysis`);
}

export function downloadPaperAnalysisReport(paperId: string, format: "xlsx" | "pdf"): Promise<Blob> {
  return downloadAuthorizedBlob(`/api/papers/${encodeURIComponent(paperId)}/analysis.${format}`);
}

export function listPaperSubmissions(paperId: string): Promise<{ submissions: PaperSubmissionRecord[] }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/submissions`);
}

export function suggestAiGradesForAttempt(
  paperId: string,
  attemptId: string,
  questionIds?: string[] | null,
): Promise<{ suggestions: Array<{ question_id: string; suggested_score?: number | null; feedback?: string | null; status: string }> }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/attempts/${encodeURIComponent(attemptId)}/ai-grade`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds ?? null }),
  });
}

export function downloadOfflineScanImage(
  paperId: string,
  attemptId: string,
  pageIndex: number,
): Promise<Blob> {
  return downloadAuthorizedBlob(
    `/api/papers/${encodeURIComponent(paperId)}/attempts/${encodeURIComponent(attemptId)}/scan-images/${pageIndex}`,
  );
}

export function gradePaperAnswer(
  paperId: string,
  attemptId: string,
  questionId: string,
  payload: { score: number; feedback?: string | null; is_correct?: boolean | null },
): Promise<{ answer: PaperSubmissionAnswerRecord }> {
  return platformRequest(
    `/api/papers/${encodeURIComponent(paperId)}/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}/grade`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export function completePaperAttemptGrading(
  paperId: string,
  attemptId: string,
): Promise<{ attempt: PaperSubmissionRecord }> {
  return platformRequest(
    `/api/papers/${encodeURIComponent(paperId)}/attempts/${encodeURIComponent(attemptId)}/complete-grading`,
    { method: "POST" },
  );
}

export function uploadPaperScores(examId: string, file: File): Promise<{ batch_id: string; student_count: number; question_count: number }> {
  const fd = new FormData();
  fd.append("file", file);
  return platformRequest(`/api/exams/${encodeURIComponent(examId)}/scores`, { method: "POST", body: fd });
}

export function listStudentPapers(): Promise<{ papers: StudentPaperRecord[] }> {
  return platformRequest("/api/student/papers");
}

export function startStudentPaper(
  publicationId: string,
): Promise<{
  attempt: StudentAttemptRecord;
  questions: StudentQuestionRecord[];
  saved_answers?: Array<{ question_id: string; answer?: unknown; images?: StudentAnswerImage[] }>;
}> {
  return platformRequest(`/api/student/publications/${encodeURIComponent(publicationId)}/start`, { method: "POST" });
}

export function saveStudentAnswers(
  attemptId: string,
  answers: Array<{ question_id: string; answer?: unknown; images?: StudentAnswerImage[] }>,
): Promise<{ answer_count: number }> {
  return platformRequest(`/api/student/attempts/${encodeURIComponent(attemptId)}/answers`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function recordStudentProctorEvent(
  attemptId: string,
  payload: { event_type: string; duration_ms?: number | null; payload?: Record<string, unknown> | null },
): Promise<{ event: { id: string; event_type: string } }> {
  return platformRequest(`/api/student/attempts/${encodeURIComponent(attemptId)}/proctor-events`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitStudentAttempt(
  attemptId: string,
  payload: {
    time_spent_seconds?: number | null;
    answers?: Array<{ question_id: string; answer?: unknown; images?: StudentAnswerImage[] }>;
  },
): Promise<{ attempt: StudentAttemptRecord }> {
  return platformRequest(`/api/student/attempts/${encodeURIComponent(attemptId)}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listStudentResults(): Promise<{ results: StudentResultRecord[] }> {
  return platformRequest("/api/student/results");
}

export function updateStudentAccount(payload: {
  username?: string | null;
  current_password: string;
  new_password?: string | null;
}): Promise<{ user: PlatformUser }> {
  return platformRequest("/api/student/account", { method: "PATCH", body: JSON.stringify(payload) });
}
