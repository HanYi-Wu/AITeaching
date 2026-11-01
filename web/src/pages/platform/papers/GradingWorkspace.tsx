import type { ReactNode } from "react";
import { RefreshCw, Sparkles, UserCheck } from "lucide-react";
import type { PaperSubmissionRecord } from "../../../platform/auth";
import { submissionStatusLabel } from "./paperHelpers";
import { G51EmptyState } from "../../../ui-redesign/g51/PaperUiComponents";
import { Select as AppSelect } from "../../../components/ui/select";

type Props = {
  submissions: PaperSubmissionRecord[];
  selectedSubmission: PaperSubmissionRecord | null;
  batchBusy: boolean;
  submissionsBusy: boolean;
  storageWarning: boolean;
  onBatch: () => void;
  onReload: () => void;
  onSelectSubmission: (attemptId: string) => void;
  children: ReactNode;
};

export function GradingWorkspace({
  submissions,
  selectedSubmission,
  batchBusy,
  submissionsBusy,
  storageWarning,
  onBatch,
  onReload,
  onSelectSubmission,
  children,
}: Props) {
  return (
    <section className="or-g51-surface p-4 sm:p-6 shadow-sm space-y-5">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--or-outline)] pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-[var(--or-on-container)]" />
            <h3 className="text-lg font-semibold text-[var(--or-text)]">线上提交批改</h3>
          </div>
          <p className="mt-1 text-sm text-[var(--or-muted)]">
            图片及手写提交审核通道；最终得分以教师保存为准。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            data-testid="paper-ai-grade-batch"
            disabled={batchBusy || submissions.length === 0}
            onClick={onBatch}
            className="or-g51-btn flex-1 sm:flex-initial text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 mr-1 text-violet-600" />
            {batchBusy ? "AI 批量处理中..." : "AI 批量预批改"}
          </button>
          <button
            type="button"
            data-testid="paper-load-submissions"
            disabled={submissionsBusy}
            onClick={onReload}
            className="or-g51-btn or-g51-btn-outline flex-1 sm:flex-initial text-sm"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${submissionsBusy ? "animate-spin" : ""}`} />
            {submissionsBusy ? "加载中..." : "刷新提交"}
          </button>
        </div>
      </div>

      {/* Storage Warning Banner */}
      {storageWarning ? (
        <p
          role="status"
          className="rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] px-4 py-3 text-sm font-medium text-[var(--or-on-warning)]"
        >
          本地批改草稿暂不可用；仍可使用保存按钮将批改结果提交到服务器。
        </p>
      ) : null}

      {/* Student Submission Selector */}
      <div className="space-y-4">
        {submissions.length > 0 ? (
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-3.5 space-y-1.5">
            <label className="block text-sm font-semibold text-[var(--or-text)]">
              选择学生答卷
            </label>
            <AppSelect
              data-testid="paper-grading-student-select"
              value={selectedSubmission?.attempt_id ?? ""}
              onValueChange={(value) => onSelectSubmission(value)}
              className="or-g51-select w-full font-medium"
            >
              {submissions.map((submission) => (
                <option key={submission.attempt_id} value={submission.attempt_id}>
                  {[
                    submission.student_no,
                    submission.student_name,
                    submission.grading_completed_at ? "已发布" : submissionStatusLabel(submission.status),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </AppSelect>
          </div>
        ) : null}

        {children}

        {submissions.length === 0 ? (
          <G51EmptyState message="暂无已加载提交" />
        ) : null}
      </div>
    </section>
  );
}
