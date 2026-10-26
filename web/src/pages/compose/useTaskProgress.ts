import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTaskProjectionApi,
  type TaskProjectionView,
  type TaskStatus,
} from "./taskTrackingApi";
import { useComposeRequestScope } from "./useComposeRequestScope";

export interface TaskProgressOptions {
  taskId: string | null;
  scopeKey: string;
  pollIntervalMs?: number;
  enabled?: boolean;
}

export interface TaskProgressResult {
  projection: TaskProjectionView | null;
  status: TaskStatus | null;
  progress: number | null;
  progressPercent: number | null;
  stage: string | null;
  isRetryable: boolean;
  pollError: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
}

export function parseFiniteProgress(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || Number.isNaN(raw)) {
    return null;
  }
  if (raw < 0) return 0;
  if (raw > 1) {
    if (raw <= 100) return Number((raw / 100).toFixed(4));
    return 1;
  }
  return Number(raw.toFixed(4));
}

export function useTaskProgress({
  taskId,
  scopeKey,
  pollIntervalMs = 1000,
  enabled = true,
}: TaskProgressOptions): TaskProgressResult {
  const captureScope = useComposeRequestScope(scopeKey);
  const [projection, setProjection] = useState<TaskProjectionView | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  // Invalidate old data immediately on scope change
  const previousScope = useRef(scopeKey);
  if (previousScope.current !== scopeKey) {
    previousScope.current = scopeKey;
    setProjection(null);
    setPollError(null);
    setBusy(false);
  }

  const refresh = useCallback(async () => {
    if (!taskId || !enabled) return;
    const isCurrent = captureScope();
    setBusy(true);
    try {
      const result = await getTaskProjectionApi(taskId);
      if (!isCurrent()) return;
      setProjection(result);
      setPollError(null);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setPollError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) {
        setBusy(false);
      }
    }
  }, [captureScope, enabled, taskId]);

  useEffect(() => {
    if (!taskId || !enabled) {
      setProjection(null);
      setPollError(null);
      return;
    }
    void refresh();
  }, [enabled, refresh, taskId]);

  useEffect(() => {
    if (
      !taskId ||
      !enabled ||
      !projection ||
      ["succeeded", "failed", "cancelled"].includes(projection.status)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, pollIntervalMs);
    return () => window.clearTimeout(timer);
  }, [enabled, pollIntervalMs, projection, refresh, taskId]);

  useEffect(() => {
    const handleOnline = () => {
      void refresh();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [refresh]);

  const rawProgress = projection?.progress ?? null;
  const progress = parseFiniteProgress(rawProgress);
  const progressPercent = progress !== null ? Math.round(progress * 100) : null;
  const stage = projection?.stage ?? null;
  const status = projection?.status ?? null;
  const isRetryable = projection ? Boolean(projection.is_retryable) : true;

  return {
    projection,
    status,
    progress,
    progressPercent,
    stage,
    isRetryable,
    pollError,
    busy,
    refresh,
  };
}
