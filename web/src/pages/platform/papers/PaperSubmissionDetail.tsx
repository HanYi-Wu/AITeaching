import type { ReactNode } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import type { PaperSubmissionRecord } from "../../../platform/auth";
import { formatLocaleDateTime } from "../../../lib/locale";
import { submissionStatusLabel } from "./paperHelpers";
import { G51Pill } from "../../../ui-redesign/g51/PaperUiComponents";

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
  const isAiBusy = busy === `ai-grade:${submission.attempt_id}`;
  const isCompleteBusy = busy === `complete:${submission.attempt_id}`;
  const canSuggest =
    !isAiBusy &&
    submission.status === "submitted" &&
    submission.answers.some((answer) => (answer.grading_status || "pending") === "pending");

  const canComplete =
    !isCompleteBusy &&
    (Boolean(submission.submitted_at) || ["submitted", "completed"].includes(submission.status));

  return (
    <article className="or-g51-static-card rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 shadow-sm space-y-5">
      {/* Student Meta Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-[var(--or-outline)] pb-4">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-[var(--or-text)]">
            {submission.student_name || submission.student_no}
          </h4>
          <p className="mt-1 text-[13px] text-[var(--or-muted)]">
            {[
              submission.student_no,
              submission.grading_completed_at ? "已发布" : submissionStatusLabel(submission.status),
              submission.submitted_at ? formatLocaleDateTime(submission.submitted_at) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            data-testid={`paper-ai-grade-${submission.attempt_id}`}
            disabled={!canSuggest}
            onClick={onSuggest}
            className="or-g51-btn text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 disabled:opacity-50 py-1.5 px-3"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1 text-violet-600" />
            {isAiBusy ? "AI 处理中..." : "AI 预批改"}
          </button>
          <G51Pill variant="primary" className="text-sm font-semibold px-3 py-1">
            {submission.score ?? "-"} / {submission.max_score ?? "-"} 分
          </G51Pill>
        </div>
      </div>

      {/* Offline Scan Images */}
      {submission.scan_images && submission.scan_images.length > 0 ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4 space-y-3">
          <p className="text-sm font-semibold text-[var(--or-text)]">
            线下答卷原图（{submission.scan_images.length} 页）
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {submission.scan_images.map((image, index) => {
              const urlKey = `${submission.attempt_id}:${image.page_index}`;
              const imageUrl = scanImageUrls[urlKey];
              const isScanBusy = busy === `scan:${submission.attempt_id}:${image.page_index}`;

              return (
                <div
                  key={`${submission.attempt_id}:scan:${index}`}
                  className="overflow-hidden rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] transition hover:border-[var(--or-outline)]"
                >
                  {imageUrl ? (
                    <a href={imageUrl} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={imageUrl}
                        alt={`答卷第 ${index + 1} 页`}
                        className="aspect-[4/3] w-full object-contain bg-[color-mix(in_srgb,var(--or-block)_60%,transparent)]"
                      />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onLoadScan(image.page_index)}
                      disabled={isScanBusy}
                      className="flex aspect-[4/3] w-full items-center justify-center bg-[var(--or-page)] text-sm font-semibold text-[var(--or-on-container)] hover:bg-[var(--or-primary-container)] transition disabled:opacity-60"
                    >
                      {isScanBusy ? "正在加载..." : `加载第 ${index + 1} 页`}
                    </button>
                  )}
                  <p className="truncate border-t border-[var(--or-outline)] px-3 py-1.5 text-xs text-[var(--or-muted)]">
                    第 {index + 1} 页 · {image.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Questions Grading List */}
      <div className="space-y-4">{children}</div>

      {/* Completion Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[var(--or-outline)] pt-4">
        {submission.grading_completed_at ? (
          <span className="text-sm font-semibold text-[var(--or-on-success)]">成绩已发布给学生</span>
        ) : (
          <span className="text-[13px] text-[var(--or-muted)]">
            {!submission.submitted_at && !["submitted", "completed"].includes(submission.status)
              ? "学生尚未提交答卷，提交后才能完成批改并发布成绩。"
              : "所有题目保存分数后，完成整卷批改才会向学生展示成绩。"}
          </span>
        )}
        <button
          type="button"
          data-testid={`paper-complete-grading-${submission.attempt_id}`}
          disabled={!canComplete}
          onClick={onComplete}
          className="or-g51-btn text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-2.5 px-5 rounded-xl w-full sm:w-auto"
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5 inline" />
          {isCompleteBusy ? "正在发布..." : "完成批改并发布成绩"}
        </button>
      </div>
    </article>
  );
}
