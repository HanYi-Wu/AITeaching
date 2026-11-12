import { useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { DuplicateMatch, DuplicateQuestionReport, DuplicateReport as DuplicateReportData } from "../../types/autoCompose";

export type DuplicateReportProps = {
  open: boolean;
  onClose: () => void;
  report: DuplicateReportData | null;
  stale: boolean;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onLocateQuestion?: (qualifiedId: string) => void;
};

const sourceLabels: Record<DuplicateMatch["source"], string> = {
  bank: "题库",
  history: "历史试卷",
  paper: "本卷",
};

const kindLabels: Record<DuplicateMatch["kind"], string> = {
  exact: "文字完全相同",
  similar: "文字或数字变式相似",
  reused: "重复使用同题",
};

function formatSimilarity(value: number) {
  return `${Math.round(value * 100)}%`;
}

function QuestionCard({
  question,
  onLocateQuestion,
}: {
  question: DuplicateQuestionReport;
  onLocateQuestion?: (qualifiedId: string) => void;
}) {
  const flagged = question.match_count > 0 || question.matches.length > 0;
  return (
    <article className="min-w-0 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        {onLocateQuestion ? (
          <button type="button" onClick={() => onLocateQuestion(question.qualified_id)} className="min-w-0 break-all text-left font-mono text-sm font-semibold text-[var(--or-primary)] underline-offset-2 hover:underline">
            {question.qualified_id}
          </button>
        ) : (
          <span className="min-w-0 break-all font-mono text-sm font-semibold">{question.qualified_id}</span>
        )}
        <span className={`or-g49-pill shrink-0 ${flagged ? "bg-[var(--or-warning-container)] text-[var(--or-on-warning)]" : "bg-[var(--or-block)] text-[var(--or-muted)]"}`}>
          {flagged ? `发现 ${question.match_count || question.matches.length} 处` : "未发现重复"}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--or-muted)]">本卷出现 {question.occurrences} 次</p>
      {question.matches.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {question.matches.map((match, index) => (
            <li key={`${match.source}:${match.qualified_id}:${index}`} className="min-w-0 rounded-lg bg-[var(--or-block)] p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-full border border-[var(--or-outline)] px-2 py-0.5">{sourceLabels[match.source]}</span>
                <span className="rounded-full border border-[var(--or-outline)] px-2 py-0.5">{kindLabels[match.kind]}</span>
                <span className="font-semibold tabular-nums">相似度 {formatSimilarity(match.similarity)}</span>
              </div>
              <div className="mt-1 break-all font-mono text-xs text-[var(--or-muted)]">{match.qualified_id}</div>
              {match.exam_title || match.exam_id ? (
                <p className="mt-1 break-words text-xs text-[var(--or-muted)]">来源试卷：{match.exam_title || match.exam_id}{match.exam_title && match.exam_id ? `（${match.exam_id}）` : ""}</p>
              ) : null}
              {match.content_preview ? <p className="mt-1.5 break-words text-sm leading-relaxed">{match.content_preview}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {question.truncated ? <p className="mt-2 text-xs text-[var(--or-muted)]">其余匹配项已折叠。</p> : null}
    </article>
  );
}

export function DuplicateReport({
  open,
  onClose,
  report,
  stale,
  loading,
  error = null,
  onRefresh,
  onLocateQuestion,
}: DuplicateReportProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="fixed left-1/2 top-1/2 z-[121] flex max-h-[min(92dvh,54rem)] w-[min(calc(100vw-1.25rem),54rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] shadow-2xl focus:outline-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--or-outline)] px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title id={titleId} className="text-lg font-semibold">试卷查重报告</Dialog.Title>
              <Dialog.Description id={descriptionId} className="mt-1 text-sm text-[var(--or-muted)]">
                检查本卷内部重复、题库相似题和历史用题，结果供人工复核。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭查重报告" className="rounded-lg p-2 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {stale ? (
              <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] p-3 text-sm text-[var(--or-on-warning)]">
                <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />试卷题目清单已变化，这份报告已失效，请重新查重。</span>
                <button type="button" disabled={loading} onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-text)] disabled:opacity-50">
                  {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  重新查重
                </button>
              </div>
            ) : null}

            {error ? <p role="alert" className="mb-4 rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] p-3 text-sm text-[var(--or-on-error)]">查重失败：{error}</p> : null}
            {loading && !report ? <p role="status" className="py-10 text-center text-sm text-[var(--or-muted)]">正在检查当前试卷…</p> : null}
            {!loading && !report && !error ? <p className="py-10 text-center text-sm text-[var(--or-muted)]">暂无查重报告。选择“查重”开始检查。</p> : null}

            {report ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <SummaryCard label="检查题数" value={report.summary.question_count} />
                  <SummaryCard label="涉及题数" value={report.summary.flagged_count} />
                  <SummaryCard label="完全相同" value={report.summary.exact_count} />
                  <SummaryCard label="相似题" value={report.summary.similar_count} />
                  <SummaryCard label="历史用题" value={report.summary.history_count} />
                  <SummaryCard label="本卷重复" value={report.summary.within_paper_count} />
                </div>
                <p className="mt-3 rounded-lg bg-[var(--or-block)] px-3 py-2 text-xs leading-relaxed text-[var(--or-muted)]">
                  文字与数字变式比对，阈值 {formatSimilarity(report.threshold)}。相似结果仅供人工复核，不代表语义判定。
                </p>
                {report.warnings.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-sm text-[var(--or-on-warning)]">
                    {report.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="rounded-lg bg-[var(--or-warning-container)] px-3 py-2">{warning}</li>)}
                  </ul>
                ) : null}
                <div className="mt-4 space-y-3">
                  {report.questions.map((question) => <QuestionCard key={question.qualified_id} question={question} onLocateQuestion={onLocateQuestion} />)}
                </div>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 sm:px-5">
            <p className="max-w-2xl text-xs text-[var(--or-muted)]">相似度用于辅助人工核对。</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={loading} onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm font-medium text-[var(--or-text)] disabled:opacity-50">
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {report ? "重新查重" : "开始查重"}
              </button>
              <Dialog.Close asChild><button type="button" className="or-g49-btn or-g49-btn-secondary px-3 py-2 text-sm">关闭</button></Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-xl border border-[var(--or-outline)] bg-[var(--or-block)] p-2.5 text-center">
    <div className="text-xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-[var(--or-muted)]">{label}</div>
  </div>;
}

