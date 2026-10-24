import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiPost, type ExamSavedPayload } from "../../api/client";
import type { ComposeExportTaskCreateRequest, ComposeExportTaskFormat, ComposeExportTaskResult, ComposeExportTaskView, ComposePaperState } from "../../types/compose";
import { createStableExportRequestKey, getExportTaskApi, isExportTaskEndpointMissingError, listExportTasksApi, parseExportTaskErrorDetail, retryExportTaskApi, submitExportTaskApi } from "./composeExportTasks";
import { clonePaperState } from "./composeModel";
import { useComposeRequestScope } from "./useComposeRequestScope";

type Context = { submitted?: ComposePaperState; idsToDelete: string[]; sourceAction: "live_submit" | "retry" | "recent_resume" };
export type PendingExportSubmissionFailure = { requestPayload: ComposeExportTaskCreateRequest; context: Context; reason: string };
export type ExportSuccess = Context & { task?: ComposeExportTaskView; format: ComposeExportTaskFormat; result: ComposeExportTaskResult; isCurrent: () => boolean };
type View = { scope: string; task: ComposeExportTaskView | null; pending: PendingExportSubmissionFailure | null; pollError: string | null; busy: boolean };
const empty = (scope: string): View => ({ scope, task: null, pending: null, pollError: null, busy: false });

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

  const apply = useCallback(async (task: ComposeExportTaskView, isCurrent: () => boolean, context?: Context, notifySuccess = true) => {
    if (!isCurrent()) return;
    if (context) contexts.current.set(task.id, context);
    setView((previous) => ({ ...previous, task, pending: null, pollError: null }));
    const terminal = `${task.id}:${task.attempt}:${task.status}`;
    if (handled.current.has(terminal)) return;
    if (task.status === "succeeded" && task.result) {
      handled.current.add(terminal);
      if (notifySuccess) await callbacks.current.onTaskSucceeded({ ...(contexts.current.get(task.id) ?? { idsToDelete: [], sourceAction: "recent_resume" }), task, format: task.format, result: task.result, isCurrent });
    } else if (task.status === "failed") {
      handled.current.add(terminal);
      callbacks.current.onTaskFailed({ task, format: task.format, sourceAction: contexts.current.get(task.id)?.sourceAction ?? "recent_resume", ...parseExportTaskErrorDetail(task.error) });
    }
  }, []);

  useEffect(() => {
    busy.current = false; contexts.current.clear(); handled.current.clear(); setView(empty(ownerKey));
    const isCurrent = capture();
    void listExportTasksApi(20).then((tasks) => {
      if (!isCurrent()) return;
      const paper = callbacks.current;
      // The list is newest first. A newer success must hide an older failure,
      // and another paper's task must never affect this editor or its cleanup.
      const candidate = tasks.find((task) => paper.currentExamId
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
    if (!view.task || busy.current) return;
    const isCurrent = capture();
    busy.current = true; setView((previous) => ({ ...previous, busy: true }));
    try { await apply(await getExportTaskApi(view.task.id), isCurrent); }
    catch (error) { if (isCurrent()) setView((previous) => ({ ...previous, pollError: error instanceof Error ? error.message : String(error) })); }
    finally { if (isCurrent()) { busy.current = false; setView((previous) => ({ ...previous, busy: false })); } }
  }, [apply, capture, view.task]);

  useEffect(() => {
    if (!view.task || !["queued", "running"].includes(view.task.status) || view.pollError) return;
    const isCurrent = capture(), taskId = view.task.id;
    const timer = window.setTimeout(() => {
      void getExportTaskApi(taskId).then((task) => apply(task, isCurrent)).catch((error) => {
        if (isCurrent()) setView((previous) => ({ ...previous, pollError: error instanceof Error ? error.message : String(error) }));
      });
    }, pollIntervalMs);
    return () => window.clearTimeout(timer);
  }, [apply, capture, pollIntervalMs, view.pollError, view.task]);

  useEffect(() => {
    if (!view.pollError) return;
    const online = () => { void resumePolling(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [resumePolling, view.pollError]);

  const submit = useCallback(async (payload: ComposeExportTaskCreateRequest, context: Context) => {
    if (busy.current) return;
    revision.current += 1;
    const isCurrent = capture(); busy.current = true;
    setView((previous) => ({ ...previous, busy: true, pollError: null })); callbacks.current.onError(null);
    let legacy = false;
    try {
      let task: ComposeExportTaskView;
      try { task = await submitExportTaskApi(payload); }
      catch (error) {
        if (!isCurrent()) return;
        if (!isExportTaskEndpointMissingError(error)) throw error;
        legacy = true;
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
      setView((previous) => ({ ...previous, pending: uncertain ? { requestPayload: payload, context, reason } : null }));
      callbacks.current.onTaskFailed({ format: payload.format, sourceAction: context.sourceAction, message: reason, status, examSaved: error instanceof ApiError ? error.examSaved : undefined });
    } finally {
      if (isCurrent()) { busy.current = false; setView((previous) => ({ ...previous, busy: false })); }
    }
  }, [apply, capture]);

  const startExportTask = useCallback(async (input: { format: ComposeExportTaskFormat; body: Omit<ComposeExportTaskCreateRequest, "format" | "request_key">; idsToDelete: string[]; submitted: ComposePaperState }) => {
    const payload = JSON.parse(JSON.stringify({ ...input.body, format: input.format, request_key: createStableExportRequestKey(input.format) })) as ComposeExportTaskCreateRequest;
    await submit(payload, { submitted: clonePaperState(input.submitted), idsToDelete: [...input.idsToDelete], sourceAction: "live_submit" });
  }, [submit]);

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

  const dismissExportTask = useCallback(() => { revision.current += 1; busy.current = false; setView(empty(ownerKey)); }, [ownerKey]);
  return { activeTask: view.task, pendingSubmissionFailure: view.pending, pollError: view.pollError, taskBusy: view.busy, isPollingOrRunning: view.busy || Boolean(view.pending) || Boolean(view.task && ["queued", "running"].includes(view.task.status)), startExportTask, retryExportTask, resumePolling, dismissExportTask };
}
