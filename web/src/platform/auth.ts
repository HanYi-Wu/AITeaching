import { resolveApiUrl } from "../api/client";
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
};

export type PlatformStatus = {
  project_bound: boolean;
  admin_exists: boolean;
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
};

export type StudentRecord = {
  id: string;
  school_id: string;
  student_no: string;
  display_name: string;
  email?: string | null;
  status: string;
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
  mtime?: string | null;
};

export type TeacherClassRecord = ClassRecord & {
  subject?: string | null;
};

export type PaperPublicationRecord = {
  id: string;
  paper_id: string;
  teacher_id?: string;
  title: string;
  description?: string | null;
  status: string;
  class_ids: string[];
  attempt_count?: number;
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

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      message = body.detail;
    }
  } catch {
    /* ignore */
  }
  throw new Error(message);
}

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  const response = await fetch(url, { ...init, headers });
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

export function listSchools(): Promise<{ schools: SchoolRecord[] }> {
  return platformRequest("/api/schools");
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

export function listTeachers(): Promise<{ teachers: TeacherRecord[] }> {
  return platformRequest("/api/school/teachers");
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

export function listClasses(): Promise<{ classes: ClassRecord[] }> {
  return platformRequest("/api/school/classes");
}

export function createClass(payload: {
  name: string;
  grade?: string | null;
  subject_hint?: string | null;
}): Promise<{ class: ClassRecord }> {
  return platformRequest("/api/school/classes", { method: "POST", body: JSON.stringify(payload) });
}

export function importStudents(payload: {
  class_id?: string | null;
  students: Array<{ student_no: string; display_name: string; email?: string | null }>;
}): Promise<{ imported: number; students: StudentRecord[] }> {
  return platformRequest("/api/school/students/import", { method: "POST", body: JSON.stringify(payload) });
}

export function assignTeacherClass(payload: {
  teacher_id: string;
  class_id: string;
  subject: string;
}): Promise<{ assignment: { teacher_id: string; class_id: string; subject: string } }> {
  return platformRequest("/api/school/teacher-class-assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
    mtime: raw.mtime ?? null,
  };
}

export async function listPlatformPapers(): Promise<{ papers: PlatformPaperRecord[] }> {
  const data = await platformRequest<{ papers: Array<Partial<PlatformPaperRecord> & { id?: string }> }>("/api/papers");
  return { papers: data.papers.map(normalizePaper) };
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

export function listTeacherAssignedClasses(): Promise<{ classes: TeacherClassRecord[] }> {
  return platformRequest("/api/teacher/classes");
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
  },
): Promise<{ publication: PaperPublicationRecord }> {
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/publish`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadPaperScores(examId: string, file: File): Promise<{ batch_id: string; student_count: number; question_count: number }> {
  const fd = new FormData();
  fd.append("file", file);
  return platformRequest(`/api/exams/${encodeURIComponent(examId)}/scores`, { method: "POST", body: fd });
}
