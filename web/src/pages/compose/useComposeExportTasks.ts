import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiPost, type ExamSavedPayload } from "../../api/client";
import type { ComposeExportTaskCreateRequest, ComposeExportTaskFormat, ComposeExportTaskResult, ComposeExportTaskView, ComposePaperState } from "../../types/compose";
import { createStableExportRequestKey, getExportTaskApi, isExportTaskEndpointMissingError, listExportTasksApi, parseExportTaskErrorDetail, retryExportTaskApi, submitExportTaskApi } from "./composeExportTasks";
import { clonePaperState } from "./composeModel";
import { useComposeRequestScope } from "./useComposeRequestScope";
import i18n from "../../i18n/i18n";
import { forgetExportSubmission, readExportSubmission, retainExportSubmission, type ExportSubmissionContext, type PendingExportSubmissionFailure } from "./composeExportSubmissionStorage";
export type { PendingExportSubmissionFailure } from "./composeExportSubmissionStorage";
export { useTaskProgress } from "./useTaskProgress";
export type { TaskProgressOptions, TaskProgressResult } from "./useTaskProgress";
export type { TaskProjectionView, TaskProjectionListView } from "./taskTrackingApi";

type Context = ExportSubmissionContext;
export type ExportSuccess = Context & { task?: ComposeExportTaskView; format: ComposeExportTaskFormat; result: ComposeExportTaskResult; isCurrent: () => boolean };
type View = { scope: string; task: ComposeExportTaskView | null; pending: PendingExportSubmissionFailure | null; pollError: string | null; busy: boolean; historical: boolean; pollFailures: number };
const empty = (scope: string): View => ({ scope, task: null, pending: null, pollError: null, busy: false, historical: false, pollFailures: 0 });

export function useComposeExportTasks(params: {
  ownerKey: string; pollIntervalMs?: number;
  currentExamId: string | null; exportLabel: string; subject: string;
  onTaskSucceeded: (info: ExportSuccess) => Promise<void> | void;
  onTaskFailed: (info: { task?: ComposeExportTaskView; format: ComposeExportTaskFormat; sourceAction: Context["sourceAction"]; message: string; status: number; examSaved?: ExamSavedPayload }) => void;
  onError: (message: string | null) => void;
}) {
  const { ownerKey, pollIntervalMs = 650 } = params;
  const callbacks = useRef(params); callbacks.current = params;
  const captureOwner = useComposeRequestScope(ownerKey);
  const revision = useRef(0);
  const capture = useCallback(() => {
    const isOwnerCurrent = captureOwner(), captured = revision.current;
    return () => isOwnerCurrent() && captured === revision.current;
  }, [captureOwner]);
  const [stored, setView] = useState<View>(() => empty(ownerKey));
  const view = stored.scope === ownerKey ? stored : empty(ownerKey);
  const contexts = useRef(new Map<string, Context>());
  const handled = useRef(new Set<string>());
  const busy = useRef(false);
  const pollBusy = useRef(false);

  const apply = useCallback(async (task: ComposeExportTaskView, isCurrent: () => boolean, context?: Context, notifySuccess = true) => {
    if (!isCurrent()) return;
    if (context) contexts.current.set(task.id, context);
    forgetExportSubmission(ownerKey);
    setView((previous) => ({ ...previous, task, pending: null, pollError: null, pollFailures: 0, historical: !notifySuccess && task.status === "succeeded" }));
    const terminal = `${task.id}:${task.attempt}:${task.status}`;
    if (handled.current.has(terminal)) return;
    if (task.status === "succeeded" && task.result) {
      handled.current.add(terminal);
      if (notifySuccess) await callbacks.current.onTaskSucceeded({ ...(contexts.current.get(task.id) ?? { idsToDelete: [], sourceAction: "recent_resume" }), task, format: task.format, result: task.result, isCurrent });
    } else if (task.status === "failed") {
      handled.current.add(terminal);
      callbacks.current.onTaskFailed({ task, format: task.format, sourceAction: contexts.current.get(task.id)?.sourceAction ?? "recent_resume", ...parseExportTaskErrorDetail(task.error) });
    }
  }, [ownerKey]);

  useEffect(() => {
    busy.current = false; pollBusy.current = false; contexts.current.clear(); handled.current.clear(); setView(empty(ownerKey));
    const isCurrent = capture();
    const pending = readExportSubmission(ownerKey);
    if (pending) {
      setView({ ...empty(ownerKey), pending });
      return;
    }
    void listExportTasksApi(100).then((tasks) => {
      if (!isCurrent()) return;
      const paper = callbacks.current;
      // The list is newest first. A newer success must hide an older failure,
      // and another paper's task must never affect this editor or its cleanup.
      const candidate = [...tasks].sort((left, right) => {
        const timestamp = (task: ComposeExportTaskView) => Date.parse(task.updated_at) || Date.parse(task.created_at) || 0;
        return timestamp(right) - timestamp(left);
      }).find((task) => paper.currentExamId
        ? task.exam_workspace_id === paper.currentExamId
        : !task.exam_workspace_id && task.export_label === paper.exportLabel.trim() && task.subject === paper.subject.trim());
      // Observing a past success must not replay its save, sync or download.
      // A pending task resumed here still consumes its later poll completion.
      if (candidate) return apply(candidate, isCurrent, undefined, false);
    }).catch((error) => {
      if (isCurrent() && !isExportTaskEndpointMissingError(error)) callbacks.current.onError(error instanceof Error ? error.message : String(error));
    });
  }, [apply, capture, ownerKey]);

  const resumePolling = useCallback(async () => {
    if (!view.task || busy.current || pollBusy.current) return;
    const isCurrent = capture();
    pollBusy.current = true; setView((previous) => ({ ...previous, busy: true }));
    try { await apply(await getExportTaskApi(view.task.id), isCurrent); }
    catch (error) { if (isCurrent()) setView((previous) => ({ ...previous, pollError: error instanceof Error ? error.message : String(error), pollFailures: error instanceof ApiError && [401, 403].includes(error.status) ? 3 : previous.pollFailures + 1 })); }
    finally { if (isCurrent()) { pollBusy.current = false; setView((previous) => ({ ...previous, busy: false })); } }
  }, [apply, capture, view.task]);

  useEffect(() => {
    if (!view.task || !["queued", "running"].includes(view.task.status) || view.pollFailures >= 3 || view.busy) return;
    const timer = window.setTimeout(() => {
      void resumePolling();
    }, Math.min(5000, pollIntervalMs * 2 ** view.pollFailures));
    return () => window.clearTimeout(timer);
  }, [pollIntervalMs, resumePolling, view.busy, view.pollFailures, view.task]);

  useEffect(() => {
    if (!view.pollError) return;
    const online = () => { void resumePolling(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [resumePolling, view.pollError]);

  const submit = useCallback(async (payload: ComposeExportTaskCreateRequest, context: Context) => {
    if (busy.current) return;
    revision.current += 1;
    pollBusy.current = false;
    const isCurrent = capture(); busy.current = true;
    setView((previous) => ({ ...previous, task: null, pending: null, historical: false, busy: true, pollError: null, pollFailures: 0 })); callbacks.current.onError(null);
    retainExportSubmission(ownerKey, { requestPayload: payload, context, reason: i18n.t("compose:exportSubmissionRestored") });
    let legacy = false;
    try {
      let task: ComposeExportTaskView;
      try { task = await submitExportTaskApi(payload); }
      catch (error) {
        if (!isCurrent()) return;
        if (!isExportTaskEndpointMissingError(error)) throw error;
        legacy = true;
        forgetExportSubmission(ownerKey);
        const { format, request_key: _key, ...body } = payload;
        const result = await apiPost<ComposeExportTaskResult>(format === "pdf" ? "/api/exam/export" : "/api/exam/export-word", body);
        if (isCurrent()) {
          setView((previous) => ({ ...previous, pending: null }));
          await callbacks.current.onTaskSucceeded({ ...context, format, result, isCurrent });
        }
        return;
      }
      await apply(task, isCurrent, context);
    } catch (error) {
      if (!isCurrent()) return;
      const status = error instanceof ApiError ? error.status : 0;
      const reason = error instanceof Error ? error.message : String(error);
      const uncertain = !legacy && (status === 0 || status >= 500);
      const pending = uncertain ? { requestPayload: payload, context, reason } : null;
      if (pending) retainExportSubmission(ownerKey, pending); else forgetExportSubmission(ownerKey);
      setView((previous) => ({ ...previous, task: null, historical: false, pending }));
      callbacks.current.onTaskFailed({ format: payload.format, sourceAction: context.sourceAction, message: reason, status, examSaved: error instanceof ApiError ? error.examSaved : undefined });
    } finally {
      if (isCurrent()) { busy.current = false; setView((previous) => ({ ...previous, busy: false })); }
    }
  }, [apply, capture, ownerKey]);

  const startExportTask = useCallback(async (input: { format: ComposeExportTaskFormat; body: Omit<ComposeExportTaskCreateRequest, "format" | "request_key">; idsToDelete: string[]; submitted: ComposePaperState }) => {
    const pending = view.pending ?? readExportSubmission(ownerKey);
    if (pending) { setView((previous) => ({ ...previous, task: null, pending })); return; }
    const payload = JSON.parse(JSON.stringify({ ...input.body, format: input.format, request_key: createStableExportRequestKey(input.format) })) as ComposeExportTaskCreateRequest;
    await submit(payload, { submitted: clonePaperState(input.submitted), idsToDelete: [...input.idsToDelete], sourceAction: "live_submit" });
  }, [ownerKey, submit, view.pending]);

  const retryExportTask = useCallback(async () => {
    if (view.pending) { await submit(view.pending.requestPayload, { ...view.pending.context, sourceAction: "retry" }); return; }
    if (!view.task || view.task.status !== "failed" || busy.current) return;
    revision.current += 1;
    const task = view.task, isCurrent = capture(); busy.current = true;
    setView((previous) => ({ ...previous, busy: true })); callbacks.current.onError(null);
    try {
      const retried = await retryExportTaskApi(task.id);
      const context = contexts.current.get(task.id) ?? { idsToDelete: [], sourceAction: "recent_resume" as const };
      await apply(retried, isCurrent, { ...context, sourceAction: "retry" });
    } catch (error) { if (isCurrent()) callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
    finally { if (isCurrent()) { busy.current = false; setView((previous) => ({ ...previous, busy: false })); } }
  }, [apply, capture, submit, view.pending, view.task]);

  const dismissExportTask = useCallback(() => {
    if (view.pending) return;
    revision.current += 1; busy.current = false; setView(empty(ownerKey));
  }, [ownerKey, view.pending]);
  return { activeTask: view.task, historical: view.historical, pendingSubmissionFailure: view.pending, pollError: view.pollError, taskBusy: view.busy, isPollingOrRunning: view.busy || Boolean(view.pending) || Boolean(view.task && ["queued", "running"].includes(view.task.status)), startExportTask, retryExportTask, resumePolling, dismissExportTask };
}
