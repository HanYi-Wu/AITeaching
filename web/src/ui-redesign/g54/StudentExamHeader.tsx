import { AlertTriangle, Clock } from "lucide-react";
import { formatCountdown } from "../../pages/platform/student/useStudentExam";

interface StudentExamHeaderProps {
  title: string;
  subject?: string | null;
  questionCount: number;
  answeredCount: number;
  remainingSeconds: number | null;
  saveStatus: "saved" | "dirty" | "saving" | "error" | "restored";
  localTextRestored?: boolean;
  localImagesRestored?: boolean;
  hasTextConflicts?: boolean;
  onRecoverTextConflicts?: () => void;
  textDraftIssue?: "too_large" | "unavailable" | "corrupt" | null;
  hasImageConflicts?: boolean;
  onRecoverImageConflicts?: () => void;
  imageDraftIssue?: "too_large" | "unavailable" | "corrupt" | null;
  imageDraftStored?: boolean;
}

export function StudentExamHeader({
  title,
  subject,
  questionCount,
  answeredCount,
  remainingSeconds,
  saveStatus,
  localTextRestored,
  localImagesRestored,
  hasTextConflicts,
  onRecoverTextConflicts,
  textDraftIssue,
  hasImageConflicts,
  onRecoverImageConflicts,
  imageDraftIssue,
  imageDraftStored,
}: StudentExamHeaderProps) {
  const saveStatusText =
    saveStatus === "restored"
      ? "草稿已恢复"
      : saveStatus === "dirty"
      ? "有未保存修改"
      : saveStatus === "saving"
      ? "正在保存草稿…"
      : saveStatus === "error"
      ? "草稿保存失败，请重试"
      : "草稿已保存";
  const saveStatusTone =
    saveStatus === "error"
      ? "text-or-error"
      : saveStatus === "dirty" || saveStatus === "saving"
        ? "text-or-warning"
        : saveStatus === "restored"
          ? "text-or-success"
          : "text-[var(--or-muted)]";

  return (
    <div className="mb-5 space-y-4" role="group" aria-label={`${title} · ${subject || "未分科"}答题状态`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center justify-center rounded-full bg-[var(--or-block)] px-3 py-1 text-xs font-semibold text-[var(--or-muted)]">
              已作答 {answeredCount} / {questionCount}
            </span>
            <span className={`text-xs font-medium ${saveStatusTone}`} role="status">
              {saveStatusText}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="or-g54-timer-pill" aria-label="剩余时间">
            <Clock className="h-4 w-4" />
            <span>{formatCountdown(remainingSeconds)}</span>
          </div>
          <div className="or-g54-proctor-pill">
            <AlertTriangle className="h-4 w-4 shrink-0 text-or-warning" />
            <span>已记录切屏、复制粘贴、右键与退出全屏；选择答题图片不会计为切屏</span>
          </div>
        </div>
      </div>

      {localTextRestored ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          已恢复本机文本草稿，等待保存到服务器。
        </div>
      ) : null}

      {localImagesRestored ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          已恢复本机图片草稿，等待保存到服务器。
        </div>
      ) : null}

      {hasTextConflicts ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          服务器答案已有其他更新，本机文本草稿仍保留。
          <button
            type="button"
            onClick={onRecoverTextConflicts}
            className="ml-2 font-semibold underline hover:brightness-95"
          >
            恢复本机文本草稿
          </button>
        </div>
      ) : null}

      {textDraftIssue === "unavailable" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机文本存储不可用；草稿暂留在当前标签页内存，刷新或关闭可能丢失，请先保存到服务器。
        </div>
      ) : null}

      {textDraftIssue === "too_large" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机文本草稿超过暂存限额，请先保存到服务器。
        </div>
      ) : null}

      {textDraftIssue === "corrupt" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机文本草稿损坏，未自动恢复；请检查答案并保存到服务器。
        </div>
      ) : null}

      {hasImageConflicts ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          服务器图片答案已有其他更新，本机图片草稿仍保留。
          <button
            type="button"
            onClick={onRecoverImageConflicts}
            className="ml-2 font-semibold underline hover:brightness-95"
          >
            恢复本机图片草稿
          </button>
        </div>
      ) : null}

      {imageDraftIssue === "unavailable" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机图片存储暂不可用；图片按账号暂留在当前标签页内存，刷新或关闭可能丢失，请先保存到服务器。
        </div>
      ) : null}

      {imageDraftIssue === "too_large" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机图片草稿超过 20 MB 限额，未能暂存；请及时保存到服务器。
        </div>
      ) : null}

      {imageDraftIssue === "corrupt" ? (
        <div className="or-g54-status-warning rounded-xl px-4 py-2.5 text-sm" role="status">
          本机图片草稿损坏，未自动恢复；请检查图片后保存到服务器。
        </div>
      ) : null}

      {imageDraftStored && !imageDraftIssue ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-2.5 text-sm text-[var(--or-muted)]" role="status">
          图片已暂存在本机，尚未确认保存到服务器。
        </div>
      ) : null}
    </div>
  );
}
