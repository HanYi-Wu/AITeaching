import { apiGet, apiPost } from "../../api/client";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface TaskProjectionView {
  task_id: string;
  owner: string;
  project_scope: string;
  task_type: string;
  source_id?: string | null;
  attempt: number;
  status: TaskStatus;
  event_version: number;
  progress: number | null;
  stage: string | null;
  title: string | null;
  result_summary?: Record<string, unknown> | null;
  error_summary?: Record<string, unknown> | null;
  is_retryable: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskProjectionListView {
  tasks: TaskProjectionView[];
  total: number;
  project_scope: string;
}

export async function getTaskProjectionApi(taskId: string): Promise<TaskProjectionView> {
  return apiGet<TaskProjectionView>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function listTaskProjectionsApi(options?: {
  task_type?: string;
  status?: string;
  limit?: number;
}): Promise<TaskProjectionListView> {
  const params = new URLSearchParams();
  if (options?.task_type) params.set("task_type", options.task_type);
  if (options?.status) params.set("status", options.status);
  if (typeof options?.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiGet<TaskProjectionListView>(`/api/tasks${query}`);
}

export async function retryTaskProjectionApi(taskId: string): Promise<TaskProjectionView> {
  return apiPost<TaskProjectionView>(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {});
}
