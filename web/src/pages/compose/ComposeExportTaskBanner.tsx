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
        className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_90%,transparent)] px-4 py-2.5 text-sm text-[var(--or-on-error)]"
      >
        <span className="font-medium">
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
            className="or-g49-btn border border-red-300 bg-[var(--or-card)] text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] disabled:opacity-50 py-1 px-3 text-sm"
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
    ? "border-[var(--or-error)] bg-[color-mix(in_srgb,var(--or-error-container)_95%,transparent)] text-[var(--or-on-error)]"
    : isPending
      ? "border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_95%,transparent)] text-[var(--or-on-container)]"
      : "border-[var(--or-success)] bg-[color-mix(in_srgb,var(--or-success-container)_95%,transparent)] text-[var(--or-on-success)]";

  return (
    <div
      role="status"
      data-testid="compose-export-task-banner"
      data-task-status={task.status}
      className={`shrink-0 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-sm ${toneClass}`}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-medium">
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
            <span data-testid="task-stage-label" className="or-g49-pill bg-[color-mix(in_srgb,var(--or-card)_80%,transparent)] text-[var(--or-text)] border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] shadow-xs">
              {effectiveStage}
            </span>
          ) : null
        ) : null}

        {isPending ? (
          hasFiniteProgress ? (
            <span data-testid="task-progress-value" className="font-bold tabular-nums text-[var(--or-on-container)]">
              {progressPercent}%
            </span>
          ) : (
            <span data-testid="task-progress-indeterminate" className="text-[var(--or-muted)] font-medium">
              ({t("common:processing")})
            </span>
          )
        ) : null}
      </div>

      {pollError ? <span role="alert" className="text-[var(--or-on-error)] font-medium">{t("compose:exportPollingPaused", { reason: pollError })}</span> : null}

      <div className="flex items-center gap-2">
        {isPending && pollError ? (
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="or-g49-btn border border-sky-300 bg-[var(--or-card)] text-[var(--or-on-container)] hover:bg-[var(--or-primary-container)] py-1 px-3 text-sm"
          >
            {t("compose:exportResumePolling")}
          </button>
        ) : null}

        {isFailed && canRetry ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="or-g49-btn border border-red-300 bg-[var(--or-card)] text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] disabled:opacity-50 py-1 px-3 text-sm"
          >
            {t("compose:exportTaskRetry")}
          </button>
        ) : null}

        {!isPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="rounded-lg px-2.5 py-1 text-sm font-medium opacity-80 hover:opacity-100 hover:bg-black/5 transition-opacity"
          >
            {t("compose:exportTaskDismiss")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
