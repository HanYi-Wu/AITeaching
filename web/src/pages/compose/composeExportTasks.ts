import { ApiError, apiGet, apiPost, type ExamSavedPayload } from "../../api/client";
import type {
  ComposeExportTaskCreateRequest,
  ComposeExportTaskError,
  ComposeExportTaskFormat,
  ComposeExportTaskView,
} from "../../types/compose";

export function createStableExportRequestKey(format: ComposeExportTaskFormat): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `exp-${format}-${ts}-${rand}`.slice(0, 100);
}

export async function submitExportTaskApi(
  payload: ComposeExportTaskCreateRequest,
): Promise<ComposeExportTaskView> {
  return apiPost<ComposeExportTaskView>("/api/exam/export-tasks", payload);
}

export async function getExportTaskApi(taskId: string): Promise<ComposeExportTaskView> {
  return apiGet<ComposeExportTaskView>(`/api/exam/export-tasks/${encodeURIComponent(taskId)}`);
}

export async function listExportTasksApi(limit = 20): Promise<ComposeExportTaskView[]> {
  const clamped = Math.max(1, Math.min(100, Math.trunc(limit)));
  const res = await apiGet<{ tasks?: ComposeExportTaskView[] }>(
    `/api/exam/export-tasks?limit=${clamped}`,
  );
  return Array.isArray(res?.tasks) ? res.tasks : [];
}

export async function retryExportTaskApi(taskId: string): Promise<ComposeExportTaskView> {
  return apiPost<ComposeExportTaskView>(
    `/api/exam/export-tasks/${encodeURIComponent(taskId)}/retry`,
    {},
  );
}

/**
 * 仅当旧后端不存在 `/api/exam/export-tasks`（返回 HTTP 404）时才允许回退同步导出接口；
 * 401/403 等鉴权或权限失败严禁回退。
 */
export function isExportTaskEndpointMissingError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 404;
  }
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return status === 404;
  }
  return false;
}

export function parseExportTaskErrorDetail(
  error: ComposeExportTaskError | null | undefined,
): {
  message: string;
  status: number;
  examSaved?: ExamSavedPayload;
} {
  if (!error) {
    return { message: "导出任务失败", status: 500 };
  }
  const status = typeof error.status === "number" ? error.status : 500;
  const detail = error.detail;

  if (typeof detail === "string" && detail.trim()) {
    return { message: detail.trim(), status };
  }
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item
          ? String((item as { msg?: unknown }).msg ?? "")
          : "",
      )
      .filter(Boolean)
      .join("; ");
    return { message: joined || "导出任务失败", status };
  }
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    let msg =
      typeof d.message === "string" && d.message.trim()
        ? d.message.trim()
        : "导出任务失败";
    if (typeof d.suggestion === "string" && d.suggestion.trim()) {
      msg = `${msg} ${d.suggestion.trim()}`;
    }
    const rawSaved = d.exam_saved ?? d.draft_saved;
    let examSaved: ExamSavedPayload | undefined;
    if (rawSaved && typeof rawSaved === "object") {
      const o = rawSaved as Record<string, unknown>;
      const eid =
        typeof o.exam_id === "string"
          ? o.exam_id
          : typeof o.draft_id === "string"
            ? o.draft_id
            : "";
      if (eid) {
        examSaved = {
          exam_id: eid,
          name: typeof o.name === "string" ? o.name : eid,
        };
      }
    }
    return { message: msg, status, examSaved };
  }
  return { message: "导出任务失败", status };
}

export function extractExamPathIdFromDir(examDir: string | null | undefined): string | null {
  if (typeof examDir !== "string" || !examDir.trim()) {
    return null;
  }
  const dirNorm = examDir.replace(/\\/g, "/").replace(/^\/+/, "");
  const m = /^exams\/(.+)$/.exec(dirNorm);
  return m?.[1] ?? null;
}
