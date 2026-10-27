import { resolveApiUrl } from "../api/address";
import { loadSessionToken } from "./session";
import { buildQuery, platformRequest } from "./platformRequest";
import type {
  ClassRecord,
  ListQuery,
  PagedResult,
  SchoolAiCapability,
  SchoolAiImportResponse,
  SchoolAiImportReviewResponse,
  SchoolAiResponse,
  SchoolAiSettings,
  SchoolImportKind,
  SchoolRecord,
  StudentRecord,
  StudentClassTransferPreview,
  StudentClassTransferResult,
  TeacherClassAssignmentRecord,
  TeacherRecord,
} from "./authTypes";

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
): Promise<{ user: { id: string; school_id: string; username: string; display_name: string; status: string } }> {
  return platformRequest(`/api/schools/${encodeURIComponent(schoolId)}/school-users`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSchoolAiSettings(): Promise<SchoolAiSettings> {
  return platformRequest("/api/school/ai-settings");
}

export function updateSchoolAiSettings(ai_enabled: boolean): Promise<SchoolAiSettings> {
  return platformRequest("/api/school/ai-settings", {
    method: "PATCH",
    body: JSON.stringify({ ai_enabled }),
  });
}

export function getSchoolAiCapabilities(): Promise<SchoolAiSettings & { capabilities: SchoolAiCapability[] }> {
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
  fd.set("kind", kind);
  if (classId) {
    fd.set("class_id", classId);
  }
  fd.set("file", file);
  return platformRequest("/api/school/ai/import-file", { method: "POST", body: fd });
}

export function reviewSchoolAiImportFile(
  kind: SchoolImportKind,
  file: File,
  classId?: string | null,
): Promise<SchoolAiImportReviewResponse> {
  const fd = new FormData();
  fd.set("kind", kind);
  if (classId) {
    fd.set("class_id", classId);
  }
  fd.set("file", file);
  return platformRequest("/api/school/ai/import-review", { method: "POST", body: fd });
}

export function listTeachers(params: ListQuery = {}): Promise<{ teachers: TeacherRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/teachers${buildQuery({
      q: params.q ?? null,
      status: params.status ?? null,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function createTeacher(payload: {
  username: string;
  password: string;
  display_name: string;
  email?: string | null;
  subjects?: string[];
}): Promise<{ teacher: TeacherRecord }> {
  return platformRequest("/api/school/teachers", { method: "POST", body: JSON.stringify(payload) });
}

export function importTeachers(teachers: Array<Record<string, unknown>>): Promise<{ imported: number }> {
  return platformRequest("/api/school/teachers/import", { method: "POST", body: JSON.stringify({ teachers }) });
}

export function importTeachersFile(file: File): Promise<{ imported: number }> {
  const fd = new FormData();
  fd.set("file", file);
  return platformRequest("/api/school/teachers/import-file", { method: "POST", body: fd });
}

export function updateTeacher(
  teacherId: string,
  payload: { display_name?: string; email?: string | null; subjects?: string[]; password?: string; status?: string },
): Promise<{ teacher: TeacherRecord }> {
  return platformRequest(`/api/school/teachers/${encodeURIComponent(teacherId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function bulkUpdateTeachers(payload: {
  ids: string[];
  status: string;
}): Promise<{ updated: number; status: string }> {
  return platformRequest("/api/school/teachers/bulk-status", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetTeacherPassword(
  teacherId: string,
  password?: string,
): Promise<{ ok: boolean; password?: string }> {
  return platformRequest(`/api/school/teachers/${encodeURIComponent(teacherId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify(password ? { password } : {}),
  });
}

export function listClasses(params: ListQuery = {}): Promise<{ classes: ClassRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/classes${buildQuery({
      q: params.q ?? null,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function createClass(payload: {
  name: string;
  grade?: string;
  subject_hint?: string;
}): Promise<{ class: ClassRecord }> {
  return platformRequest("/api/school/classes", { method: "POST", body: JSON.stringify(payload) });
}

export function importClasses(classes: Array<Record<string, unknown>>): Promise<{ imported: number }> {
  return platformRequest("/api/school/classes/import", { method: "POST", body: JSON.stringify({ classes }) });
}

export function importClassesFile(file: File): Promise<{ imported: number }> {
  const fd = new FormData();
  fd.set("file", file);
  return platformRequest("/api/school/classes/import-file", { method: "POST", body: fd });
}

export function updateClass(
  classId: string,
  payload: { name?: string; grade?: string },
): Promise<{ class: ClassRecord }> {
  return platformRequest(`/api/school/classes/${encodeURIComponent(classId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteClass(classId: string): Promise<{ ok: boolean; deleted: string }> {
  return platformRequest(`/api/school/classes/${encodeURIComponent(classId)}`, { method: "DELETE" });
}

export function listStudents(
  classId: string | null = null,
  params: ListQuery = {},
): Promise<{ students: StudentRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/students${buildQuery({
      class_id: classId,
      q: params.q ?? null,
      status: params.status ?? null,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function importStudents(payload: {
  class_id?: string | null;
  students: Array<Record<string, unknown>>;
}): Promise<{ imported: number; students: StudentRecord[] }> {
  return platformRequest("/api/school/students/import", { method: "POST", body: JSON.stringify(payload) });
}

export function importStudentsFile(
  file: File,
  classId?: string | null,
): Promise<{ imported: number; students: StudentRecord[] }> {
  const fd = new FormData();
  if (classId) {
    fd.set("class_id", classId);
  }
  fd.set("file", file);
  return platformRequest("/api/school/students/import-file", { method: "POST", body: fd });
}

export function importTeacherClassAssignmentsFile(file: File): Promise<{ imported: number }> {
  const fd = new FormData();
  fd.set("file", file);
  return platformRequest("/api/school/teacher-class-assignments/import-file", { method: "POST", body: fd });
}

export function updateStudent(
  studentId: string,
  payload: { student_no?: string; display_name?: string; email?: string | null; status?: string },
): Promise<{ student: StudentRecord }> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getStudentClassTransfer(studentId: string): Promise<StudentClassTransferPreview> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}/class-transfer`);
}

export function transferStudentClass(
  studentId: string,
  payload: { target_class_id: string; expected_class_ids: string[] },
): Promise<StudentClassTransferResult> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}/class-transfer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function bulkUpdateStudents(payload: {
  ids: string[];
  status: string;
}): Promise<{ updated: number; status: string }> {
  return platformRequest("/api/school/students/bulk-status", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetStudentPassword(
  studentId: string,
  password?: string,
): Promise<{ ok: boolean; password?: string }> {
  return platformRequest(`/api/school/students/${encodeURIComponent(studentId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify(password ? { password } : {}),
  });
}

export async function exportStudentAccounts(): Promise<Blob> {
  const token = loadSessionToken();
  const url = await resolveApiUrl("/api/school/students/export.xlsx");
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  return response.blob();
}

export async function downloadSchoolImportTemplate(kind: SchoolImportKind): Promise<Blob> {
  const path =
    kind === "all"
      ? "/api/school/all/template.xlsx"
      : kind === "assignments"
        ? "/api/school/teacher-class-assignments/template.xlsx"
        : `/api/school/${kind}/template.xlsx`;
  const url = await resolveApiUrl(path);
  const token = loadSessionToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }
  return response.blob();
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
  params: ListQuery = {},
): Promise<{ assignments: TeacherClassAssignmentRecord[] } & PagedResult> {
  return platformRequest(
    `/api/school/teacher-class-assignments${buildQuery({
      q: params.q ?? null,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );
}

export function removeTeacherClassAssignment(payload: {
  teacher_id: string;
  class_id: string;
  subject?: string | null;
}): Promise<{ ok: boolean; deleted: { teacher_id: string; class_id: string; subject?: string } }> {
  return platformRequest(
    `/api/school/teacher-class-assignments${buildQuery({
      teacher_id: payload.teacher_id,
      class_id: payload.class_id,
      subject: payload.subject ?? null,
    })}`,
    { method: "DELETE" },
  );
}
