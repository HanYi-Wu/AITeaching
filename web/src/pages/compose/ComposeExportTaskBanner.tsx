import { useTranslation } from "react-i18next";
import type { ComposeExportTaskView } from "../../types/compose";
import { parseExportTaskErrorDetail } from "./composeExportTasks";
import type { PendingExportSubmissionFailure } from "./useComposeExportTasks";
import type { TaskProjectionView } from "./taskTrackingApi";

export function ComposeExportTaskBanner({
  task,
  pendingSubmissionFailure,
  busy,
  pollError,
  onResume,
  onRetry,
  onDismiss,
  historical = false,
  progress,
  stage,
  isRetryable,
  projection,
}: {
  task: ComposeExportTaskView | null;
  pendingSubmissionFailure: PendingExportSubmissionFailure | null;
  busy: boolean;
  pollError: string | null;
  onResume: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  historical?: boolean;
  progress?: number | null;
  stage?: string | null;
  isRetryable?: boolean;
  projection?: TaskProjectionView | null;
}) {
  const { t } = useTranslation(["compose", "common"]);

  if (pendingSubmissionFailure) {
    const formatLabel = pendingSubmissionFailure.requestPayload.format === "docx" ? "Word" : "PDF";
    return (
      <div
        role="status"
        data-testid="compose-export-task-banner"
        data-task-status="failed"
        className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900"
      >
        <span>
          {t("compose:exportSubmissionUnconfirmed", {
            format: formatLabel,
            reason: pendingSubmissionFailure.reason,
          })}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="rounded border border-red-300 bg-white px-2.5 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            {t("compose:exportTaskRetry")}
          </button>
        </div>
      </div>
    );
  }

  if (!task) {
    return null;
  }

  const formatLabel = task.format === "docx" ? "Word" : "PDF";
  const isPending = task.status === "queued" || task.status === "running";
  const isFailed = task.status === "failed";
  const failureDetail = isFailed ? parseExportTaskErrorDetail(task.error).message : "";

  const effectiveStage = stage ?? projection?.stage ?? null;
  const effectiveProgress = progress !== undefined ? progress : (projection?.progress ?? null);
  const hasFiniteProgress = typeof effectiveProgress === "number" && Number.isFinite(effectiveProgress) && !Number.isNaN(effectiveProgress);
  const progressPercent = hasFiniteProgress ? Math.round(effectiveProgress * 100) : null;
  const canRetry = isFailed && (isRetryable ?? projection?.is_retryable ?? true);

  const toneClass = isFailed
    ? "border-red-200 bg-red-50 text-red-900"
    : isPending
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div
      role="status"
      data-testid="compose-export-task-banner"
      data-task-status={task.status}
      className={`shrink-0 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 text-xs ${toneClass}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span>
          {task.status === "queued"
            ? t("compose:exportTaskQueued", { format: formatLabel, attempt: task.attempt })
            : task.status === "running"
              ? t("compose:exportTaskRunning", { format: formatLabel, attempt: task.attempt })
              : task.status === "failed"
                ? t("compose:exportTaskFailed", { format: formatLabel, reason: failureDetail })
                : t(historical ? "compose:exportTaskHistoricalSucceeded" : "compose:exportTaskSucceeded", { format: formatLabel })}
        </span>

        {isPending ? (
          effectiveStage ? (
            <span data-testid="task-stage-label" className="font-medium text-slate-700 bg-white/60 px-1.5 py-0.5 rounded">
              {effectiveStage}
            </span>
          ) : null
        ) : null}

        {isPending ? (
          hasFiniteProgress ? (
            <span data-testid="task-progress-value" className="font-semibold text-blue-700">
              {progressPercent}%
            </span>
          ) : (
            <span data-testid="task-progress-indeterminate" className="text-slate-500">
              ({t("common:processing")})
            </span>
          )
        ) : null}
      </div>

      {pollError ? <span role="alert">{t("compose:exportPollingPaused", { reason: pollError })}</span> : null}

      <div className="flex items-center gap-2">
        {isPending && pollError ? (
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="rounded border border-blue-300 bg-white px-2.5 py-0.5 font-medium disabled:opacity-50"
          >
            {t("compose:exportResumePolling")}
          </button>
        ) : null}

        {isFailed && canRetry ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="rounded border border-red-300 bg-white px-2.5 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            {t("compose:exportTaskRetry")}
          </button>
        ) : null}

        {!isPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="rounded px-1.5 py-0.5 text-xs opacity-80 hover:opacity-100"
          >
            {t("compose:exportTaskDismiss")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
