import { FileImage } from "lucide-react";
import { memo } from "react";
import { ContentWithPrimeBrush as KatexText } from "../../../components/ContentWithPrimeBrush";
import type { PaperSubmissionAnswerRecord } from "../../../platform/auth";
import { G51Pill } from "../../../ui-redesign/g51/PaperUiComponents";

const MemoizedKatexText = memo(KatexText);

type Props = {
  answer: PaperSubmissionAnswerRecord;
  scoreValue: string;
  feedbackValue: string;
  statusLabel: string;
  studentAnswerText: string;
  saving: boolean;
  versionChanged: boolean;
  onScoreChange: (value: string) => void;
  onFeedbackChange: (value: string) => void;
  onSave: () => void;
};

export default function GradingQuestionCard({
  answer,
  scoreValue,
  feedbackValue,
  statusLabel,
  studentAnswerText,
  saving,
  versionChanged,
  onScoreChange,
  onFeedbackChange,
  onSave,
}: Props) {
  const isGraded = statusLabel === "已批改";

  return (
    <div className="or-g51-static-card rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-4 sm:p-5 shadow-sm space-y-4">
      {/* Question Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h4 className="text-base font-semibold text-[var(--or-text)]">
          {answer.header || answer.question_id}
        </h4>
        <G51Pill variant={isGraded ? "success" : "neutral"}>
          本题 {answer.score_per_item ?? "-"} 分 · {statusLabel}
        </G51Pill>
      </div>

      {/* Version Changed Notice */}
      {versionChanged ? (
        <p role="status" className="rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] p-2.5 text-xs font-medium text-[var(--or-on-warning)]">
          服务器批改版本已变化，本地草稿基于较早内容；保存前会请你确认。
        </p>
      ) : null}

      {/* Question Content & Formulas */}
      {answer.content ? (
        <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-3.5">
          <MemoizedKatexText
            text={answer.content}
            className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--or-text)]"
          />
        </div>
      ) : null}

      {/* Reference Answer */}
      <div className="rounded-xl border border-[var(--or-success)] bg-[color-mix(in_srgb,var(--or-success-container)_60%,transparent)] p-3 text-sm">
        <span className="font-semibold text-[var(--or-on-success)]">参考答案：</span>
        <MemoizedKatexText
          text={answer.correct_answer ?? "未配置参考答案"}
          className="inline text-[var(--or-on-success)] font-medium"
        />
      </div>

      {/* Question Options */}
      {answer.options && Object.keys(answer.options).length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(answer.options).map(([optionKey, optionText]) => (
            <div
              key={optionKey}
              className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 text-sm text-[var(--or-text)]"
            >
              <span className="mr-1.5 font-bold text-[var(--or-on-container)]">{optionKey}.</span>
              <MemoizedKatexText text={optionText} className="inline" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Student Answer */}
      <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_40%,transparent)] p-4">
        <p className="text-xs font-bold text-[var(--or-on-container)] uppercase tracking-wide">学生作答</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-[var(--or-text)]">
          {studentAnswerText}
        </p>
      </div>

      {/* Student Uploaded Images */}
      {answer.images && answer.images.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {answer.images.map((image, index) => (
            <a
              key={`${answer.question_id}:${image.name}:${index}`}
              href={image.data_url}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] transition hover:border-[var(--or-primary)]"
            >
              <img
                data-testid={`paper-answer-image-${answer.question_id}`}
                src={image.data_url}
                alt={image.name || "学生提交图片"}
                className="aspect-[4/3] w-full object-contain bg-[var(--or-page)]"
              />
              <div className="flex items-center gap-2 border-t border-[var(--or-outline)] px-3 py-1.5 text-xs text-[var(--or-muted)]">
                <FileImage className="h-3.5 w-3.5 text-[var(--or-on-container)]" />
                <span className="truncate">{image.name || `image-${index + 1}`}</span>
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {/* Score & Feedback Controls */}
      <div className="grid gap-2.5 sm:grid-cols-[130px_minmax(0,1fr)_auto] pt-1">
        <input
          data-testid={`paper-grade-${answer.question_id}`}
          className="or-g51-input text-base font-semibold w-full"
          value={scoreValue}
          placeholder="分数"
          onChange={(event) => onScoreChange(event.target.value)}
        />
        <input
          data-testid={`paper-feedback-${answer.question_id}`}
          className="or-g51-input text-sm w-full"
          value={feedbackValue}
          placeholder="批改反馈"
          onChange={(event) => onFeedbackChange(event.target.value)}
        />
        <button
          type="button"
          data-testid={`paper-save-grade-${answer.question_id}`}
          disabled={saving}
          onClick={() => void onSave()}
          className="or-g51-btn or-g51-btn-primary min-w-[80px] text-sm font-semibold w-full sm:w-auto"
        >
          {saving ? "保存中" : "保存"}
        </button>
      </div>
    </div>
  );
}
