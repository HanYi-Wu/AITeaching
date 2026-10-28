import { FileImage } from "lucide-react";
import { memo } from "react";
import { ContentWithPrimeBrush as KatexText } from "../../../components/ContentWithPrimeBrush";
import type { PaperSubmissionAnswerRecord } from "../../../platform/auth";

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
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{answer.header || answer.question_id}</span>
        <span className="text-xs text-slate-500">
          本题 {answer.score_per_item ?? "-"} 分 · {statusLabel}
        </span>
      </div>
      {versionChanged ? (
        <p role="status" className="mt-2 text-xs text-amber-700">服务器批改版本已变化，本地草稿基于较早内容；保存前会请你确认。</p>
      ) : null}
      {answer.content ? <MemoizedKatexText text={answer.content} className="mt-2 whitespace-pre-wrap text-sm text-slate-700" /> : null}
      <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm">
        <span className="font-semibold">参考答案：</span>
        <MemoizedKatexText text={answer.correct_answer ?? '未配置参考答案'} className="inline" />
      </div>
      {answer.options && Object.keys(answer.options).length > 0 ? (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {Object.entries(answer.options).map(([optionKey, optionText]) => (
            <div key={optionKey} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="mr-1 font-semibold">{optionKey}.</span>
              <MemoizedKatexText text={optionText} className="inline" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 rounded-md border border-blue-100 bg-white p-3">
        <p className="text-xs font-semibold text-blue-700">学生作答</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">
          {studentAnswerText}
        </p>
      </div>
      {answer.images && answer.images.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {answer.images.map((image, index) => (
            <a
              key={`${answer.question_id}:${image.name}:${index}`}
              href={image.data_url}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-md border border-slate-200 bg-white"
            >
              <img
                data-testid={`paper-answer-image-${answer.question_id}`}
                src={image.data_url}
                alt={image.name || "学生提交图片"}
                className="aspect-[4/3] w-full object-contain bg-white"
              />
              <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1 text-xs text-slate-500">
                <FileImage className="h-3.5 w-3.5" />
                <span className="truncate">{image.name || `image-${index + 1}`}</span>
              </div>
            </a>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
        <input
          data-testid={`paper-grade-${answer.question_id}`}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={scoreValue}
          placeholder="分数"
          onChange={(event) => onScoreChange(event.target.value)}
        />
        <input
          data-testid={`paper-feedback-${answer.question_id}`}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={feedbackValue}
          placeholder="批改反馈"
          onChange={(event) => onFeedbackChange(event.target.value)}
        />
        <button
          type="button"
          data-testid={`paper-save-grade-${answer.question_id}`}
          disabled={saving}
          onClick={() => void onSave()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          保存
        </button>
      </div>
    </div>
  );
}
