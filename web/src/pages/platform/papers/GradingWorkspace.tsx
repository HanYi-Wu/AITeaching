import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { PaperSubmissionRecord } from "../../../platform/auth";
import { submissionStatusLabel } from "./paperHelpers";

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
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-950">线上提交批改</h3>
          <p className="mt-1 text-sm text-slate-500">图片提交在这里审核，最终分数以教师保存为准。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="paper-ai-grade-batch"
            disabled={batchBusy || submissions.length === 0}
            onClick={onBatch}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            {batchBusy ? "AI 批量处理中..." : "AI 批量预批改"}
          </button>
          <button
            type="button"
            data-testid="paper-load-submissions"
            disabled={submissionsBusy}
            onClick={onReload}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            {submissionsBusy ? "加载中..." : "刷新提交"}
          </button>
        </div>
      </div>
      {storageWarning ? (
        <p role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          本地批改草稿暂不可用；仍可使用保存按钮将批改结果提交到服务器。
        </p>
      ) : null}
      <div className="space-y-4">
        {submissions.length > 0 ? (
          <label className="block rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">
            选择学生答卷
            <select
              data-testid="paper-grading-student-select"
              value={selectedSubmission?.attempt_id ?? ""}
              onChange={(event) => onSelectSubmission(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {submissions.map((submission) => (
                <option key={submission.attempt_id} value={submission.attempt_id}>
                  {[submission.student_no, submission.student_name, submission.grading_completed_at ? "已发布" : submissionStatusLabel(submission.status)].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {children}
        {submissions.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            暂无已加载提交
          </p>
        ) : null}
      </div>
    </section>
  );
}
