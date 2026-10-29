import { buildQuery, downloadAuthorizedBlob, platformRequest } from "./platformRequest";
import type {
  ContentFolder,
  ContentTag,
  FolderDeleteResult,
  ListQuery,
  PagedResult,
  PaperPublicationRecord,
  PaperSubmissionAnswerRecord,
  PaperSubmissionMode,
  PaperSubmissionRecord,
  PlatformPaperAnalysis,
  PlatformPaperRecord,
  PlatformUser,
  PracticeHistoryResponse,
  StudentAnswerImage,
  StudentAttemptRecord,
  StudentPaperRecord,
  StudentQuestionRecord,
  StudentResultRecord,
  TeacherClassRecord,
  TeacherClassStudentRecord,
  TeacherStudentProfile,
} from "./authTypes";

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

export function updateAccountCredentials(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ user: PlatformUser }> {
  return platformRequest("/api/auth/account", { method: "PATCH", body: JSON.stringify(payload) });
}

export function normalizePaper(raw: Partial<PlatformPaperRecord> & { id?: string }): PlatformPaperRecord {
  return {
    paper_id: String(raw.paper_id ?? raw.id ?? ""),
    exam_id: String(raw.exam_id ?? ""),
    title: String(raw.title ?? raw.exam_id ?? ""),
    subject: String(raw.subject ?? ""),
    delivery_mode: raw.delivery_mode === "online" ? "online" : "offline",
    status: String(raw.status ?? "draft"),
    owner_teacher_id: raw.owner_teacher_id ?? null,
    school_id: raw.school_id ?? null,
    folder_id: raw.folder_id ?? null,
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
  params: (ListQuery & { deliveryMode?: "offline" | "online" | "all" | null; subject?: string | null; folderId?: string | null }) = {},
): Promise<{ papers: PlatformPaperRecord[] } & PagedResult> {
  const data = await platformRequest<
    { papers: Array<Partial<PlatformPaperRecord> & { id?: string }> } & PagedResult
  >(
    `/api/papers${buildQuery({
      q: params.q,
      status: params.status,
      delivery_mode: params.deliveryMode,
      subject: params.subject,
      folder_id: params.folderId,
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
    student_ids?: string[];
    folder_id?: string | null;
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

export function listContentFolders(scope: ContentFolder["scope"]): Promise<{ folders: ContentFolder[] }> {
  return platformRequest(`/api/organizer/folders?scope=${scope}`);
}

export function createContentFolder(payload: { scope: ContentFolder["scope"]; name: string; parent_id?: string | null; kind?: ContentFolder["kind"] }): Promise<{ folder: ContentFolder }> {
  return platformRequest("/api/organizer/folders", { method: "POST", body: JSON.stringify(payload) });
}

export function updateContentFolder(id: string, payload: { name?: string; parent_id?: string | null; move?: boolean; kind?: ContentFolder["kind"] }): Promise<{ folder: ContentFolder }> {
  return platformRequest(`/api/organizer/folders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteContentFolder(id: string): Promise<FolderDeleteResult> {
  return platformRequest(`/api/organizer/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function movePaperToFolder(paperId: string, folderId: string): Promise<{ ok: boolean }> {
  return platformRequest(`/api/organizer/papers/${encodeURIComponent(paperId)}/folder`, { method: "POST", body: JSON.stringify({ folder_id: folderId }) });
}

export function moveContentItemsToFolder(scope: "compose" | "paper", itemIds: string[], folderId: string | null): Promise<{ ok: boolean; moved_count: number }> {
  return platformRequest("/api/organizer/folder-items/move", {
    method: "POST", body: JSON.stringify({ scope, item_ids: itemIds, folder_id: folderId }),
  });
}

export function listFolderItems(scope: "template" | "compose"): Promise<{ items: Record<string, string> }> {
  return platformRequest(`/api/organizer/folder-items?scope=${scope}`);
}

export function assignFolderItem(scope: "template" | "compose", itemId: string, folderId: string | null): Promise<{ ok: boolean }> {
  return platformRequest("/api/organizer/folder-items", { method: "PUT", body: JSON.stringify({ scope, item_id: itemId, folder_id: folderId }) });
}

export function analyzePaperFolder(folderId: string): Promise<{ folder: ContentFolder; summary: { assigned_count: number; submitted_count: number; graded_count: number; average_score_percent: number | null; publication_count: number }; personal_summary?: { assigned_count: number; submitted_count: number } | null; attempts: Array<{ student_no: string; display_name: string; title: string; status: string; score: number | null; max_score: number | null; recipient_scope: "class" | "student" }> }> {
  return platformRequest(`/api/organizer/folders/${encodeURIComponent(folderId)}/analysis`);
}

export function listContentTags(): Promise<{ tags: ContentTag[] }> {
  return platformRequest("/api/organizer/tags");
}

export function listTaggedItems(scope: "bank" | ContentFolder["scope"]): Promise<{ items: Record<string, ContentTag[]> }> {
  return platformRequest(`/api/organizer/tagged-items?scope=${scope}`);
}

export function saveContentTag(payload: { name: string; color: ContentTag["color"] }, id?: string): Promise<{ tag: ContentTag }> {
  return platformRequest(id ? `/api/organizer/tags/${encodeURIComponent(id)}` : "/api/organizer/tags", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
}

export function listItemTags(scope: "bank" | ContentFolder["scope"], itemId: string): Promise<{ tags: ContentTag[] }> {
  return platformRequest(`/api/organizer/tags/${scope}/${encodeURIComponent(itemId)}`);
}

export function setItemTags(scope: "bank" | ContentFolder["scope"], itemId: string, tagIds: string[]): Promise<{ tag_ids: string[] }> {
  return platformRequest(`/api/organizer/tags/${scope}/${encodeURIComponent(itemId)}`, { method: "PUT", body: JSON.stringify({ tag_ids: tagIds }) });
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

export function analyzePlatformPaper(paperId: string, publicationId?: string, classId?: string): Promise<{ analysis: PlatformPaperAnalysis }> {
  const params = new URLSearchParams();
  if (publicationId) params.set("publication_id", publicationId);
  if (classId) params.set("class_id", classId);
  return platformRequest(`/api/papers/${encodeURIComponent(paperId)}/analysis${params.size ? `?${params}` : ""}`);
}

export function downloadPaperAnalysisReport(paperId: string, format: "xlsx" | "pdf", publicationId?: string, classId?: string): Promise<Blob> {
  const params = new URLSearchParams();
  if (publicationId) params.set("publication_id", publicationId);
  if (classId) params.set("class_id", classId);
  return downloadAuthorizedBlob(`/api/papers/${encodeURIComponent(paperId)}/analysis.${format}${params.size ? `?${params}` : ""}`);
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
  expectedVersion?: string,
): Promise<{ answer: PaperSubmissionAnswerRecord }> {
  return platformRequest(
    `/api/papers/${encodeURIComponent(paperId)}/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}/grade`,
    { method: "PATCH", body: JSON.stringify(payload),
      ...(expectedVersion === undefined ? {} : { headers: { "If-Match": `"${expectedVersion}"` } }),
    },
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
