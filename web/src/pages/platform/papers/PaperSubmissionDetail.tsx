import type { ReactNode } from "react";
import type { PaperSubmissionRecord } from "../../../platform/auth";
import { formatLocaleDateTime } from "../../../lib/locale";
import { submissionStatusLabel } from "./paperHelpers";

type Props = {
  submission: PaperSubmissionRecord;
  busy: string | null;
  scanImageUrls: Record<string, string>;
  onSuggest: () => void;
  onLoadScan: (pageIndex: number) => void;
  onComplete: () => void;
  children: ReactNode;
};

export function PaperSubmissionDetail({ submission, busy, scanImageUrls, onSuggest, onLoadScan, onComplete, children }: Props) {
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-950">{submission.student_name || submission.student_no}</p>
          <p className="mt-1 text-xs text-slate-500">
            {[submission.student_no, submission.grading_completed_at ? "已发布" : submissionStatusLabel(submission.status), submission.submitted_at ? formatLocaleDateTime(submission.submitted_at) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={`paper-ai-grade-${submission.attempt_id}`}
            disabled={
              busy === `ai-grade:${submission.attempt_id}` ||
              submission.status !== "submitted" ||
              !submission.answers.some((answer) => (answer.grading_status || "pending") === "pending")
            }
            onClick={onSuggest}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            {busy === `ai-grade:${submission.attempt_id}` ? "AI 处理中..." : "AI 预批改"}
          </button>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {submission.score ?? "-"} / {submission.max_score ?? "-"}
          </span>
        </div>
      </div>
      {submission.scan_images && submission.scan_images.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-slate-600">线下答卷原图（{submission.scan_images.length} 页）</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {submission.scan_images.map((image, index) => (
              <div
                key={`${submission.attempt_id}:scan:${index}`}
                className="overflow-hidden rounded-md border border-slate-200 bg-white"
              >
                {scanImageUrls[`${submission.attempt_id}:${image.page_index}`] ? (
                  <a href={scanImageUrls[`${submission.attempt_id}:${image.page_index}`]} target="_blank" rel="noreferrer">
                    <img src={scanImageUrls[`${submission.attempt_id}:${image.page_index}`]} alt={`答卷第 ${index + 1} 页`} className="aspect-[4/3] w-full object-contain" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onLoadScan(image.page_index)}
                    disabled={busy === `scan:${submission.attempt_id}:${image.page_index}`}
                    className="flex aspect-[4/3] w-full items-center justify-center bg-slate-50 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                  >
                    {busy === `scan:${submission.attempt_id}:${image.page_index}` ? "正在加载..." : `加载第 ${index + 1} 页`}
                  </button>
                )}
                <p className="truncate border-t border-slate-100 px-2 py-1 text-xs text-slate-500">第 {index + 1} 页 · {image.name}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
        {submission.grading_completed_at ? (
          <span className="text-sm font-medium text-emerald-700">成绩已发布给学生</span>
        ) : (
          <span className="text-xs text-slate-500">{!submission.submitted_at && !["submitted", "completed"].includes(submission.status) ? "学生尚未提交答卷，提交后才能完成批改并发布成绩。" : "所有题目保存分数后，完成整卷批改才会向学生展示成绩。"}</span>
        )}
        <button
          type="button"
          data-testid={`paper-complete-grading-${submission.attempt_id}`}
          disabled={busy === `complete:${submission.attempt_id}` || (!submission.submitted_at && !["submitted", "completed"].includes(submission.status))}
          onClick={onComplete}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy === `complete:${submission.attempt_id}` ? "正在发布..." : "完成批改并发布成绩"}
        </button>
      </div>
    </article>
  );
}
