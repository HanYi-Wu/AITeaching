import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fetchStudentLearningProgressComparison,
  type StudentComparisonResponse,
} from "../../../platform/learningProgress";
import { ContentWithPrimeBrush as KatexText } from "../../../components/ContentWithPrimeBrush";
import {
  type StudentAnswerImage,
  type StudentQuestionRecord,
  type StudentResultRecord,
} from "../../../platform/auth";
import { AnswerRelationEditor } from '../../../components/AnswerRelationEditor';
import { ANSWER_LOGIC_PREFIX } from '../../../lib/answerLogic';
import { loadSessionToken } from "../../../platform/session";
import "../../../ui-redesign/g54/g54.css";

export function StudentNavButton({
  selected,
  disabled,
  icon,
  label,
  testId,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      data-state={selected ? "active" : "inactive"}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`or-g54-student-nav-item relative z-[1] inline-flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3 sm:py-3 sm:text-sm ${
        selected
          ? "border-transparent bg-transparent text-[var(--or-text)]"
          : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] shadow-sm hover:border-[var(--or-outline)] hover:bg-[var(--or-page)]"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate font-medium">{label}</span>
    </button>
  );
}

export function StudentAnalysisVisual({ result }: { result: StudentResultRecord }) {
  const scorePercent = Math.max(0, Math.min(100, Number(result.score_percent ?? 0)));
  const answered = Math.max(0, Number(result.analysis?.answered_count ?? result.answers.length ?? 0));
  const correct = Math.max(0, Number(result.analysis?.correct_count ?? 0));
  const wrong = Math.max(0, Number(result.analysis?.wrong_count ?? 0));
  const correctPercent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const wrongPercent = answered > 0 ? Math.round((wrong / answered) * 100) : 0;
  const rows = [
    ["得分", scorePercent],
    ["正确率", correctPercent],
    ["错题占比", wrongPercent],
  ] as const;
  return (
    <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-4" aria-label="学生个人分析图">
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[64px_minmax(0,1fr)_48px] items-center gap-3 text-sm">
            <span className="font-medium text-[var(--or-muted)]">{label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--or-inset)_70%,transparent)]">
              <div
                className="h-full rounded-full bg-[var(--or-primary)] transition-all duration-300 ease-out"
                style={{ width: `${value}%` }}
              />
            </div>
            <span className="text-right font-mono font-semibold text-[var(--or-text)]">{value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudentPracticeComparisonCard({
  publicationId,
}: {
  publicationId: string;
}) {
  const [data, setData] = useState<StudentComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const sessionToken = loadSessionToken();

  useEffect(() => {
    setData(null);
    if (!publicationId) {
      setData(null);
      return;
    }
    const curId = ++requestIdRef.current;
    setLoading(true);

    fetchStudentLearningProgressComparison({ practicePublicationId: publicationId })
      .then((res) => {
        if (curId === requestIdRef.current && loadSessionToken() === sessionToken) {
          setData(res);
        }
      })
      .catch(() => {
        if (curId === requestIdRef.current) {
          setData(null);
        }
      })
      .finally(() => {
        if (curId === requestIdRef.current) {
          setLoading(false);
        }
      });
    return () => { requestIdRef.current += 1; };
  }, [publicationId, sessionToken]);

  if (loading) {
    return (
      <div data-testid="student-practice-comparison-card" className="rounded-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_40%,transparent)] p-4 text-sm text-[var(--or-on-container)]">
        正在加载靶向复练对照数据...
      </div>
    );
  }

  if (!data || !data.comparison?.node_comparisons?.length) {
    return null;
  }

  const { comparison, source_status } = data;
  const isModified = source_status?.is_modified || comparison.is_source_modified;
  const isMissing = source_status?.is_missing || comparison.is_source_missing;

  return (
    <div data-testid="student-practice-comparison-card" className="or-g54-card-static rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary-container)_40%,transparent)] p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--or-outline)] pb-2.5">
        <div className="flex items-center gap-2 font-semibold text-[var(--or-on-container)]">
          <span>📚 知识点复练掌握率对照</span>
        </div>
      </div>

      {isModified && (
        <div className="mt-2.5 rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] px-3 py-2 text-xs font-medium text-[var(--or-on-warning)]">
          ⚠️ 来源首考成绩已被教师复核修改（基线保持冻结原值）
        </div>
      )}

      {isMissing && (
        <div className="mt-2.5 rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] px-3 py-2 text-xs font-medium text-[var(--or-on-error)]">
          ⚠️ 来源考试已被删除或撤回，历史基线不可比
        </div>
      )}

      <div className="mt-2.5 divide-y divide-indigo-100/60">
        {comparison.node_comparisons.map((node) => {
          const preText = node.pre_percentage !== null ? `${node.pre_percentage.toFixed(1)}%` : "无基线";
          let postText = "-";
          if (node.post_percentage !== null) {
            postText = `${node.post_percentage.toFixed(1)}%`;
          } else if (node.status === "target_unsubmitted") {
            postText = "未提交";
          } else if (node.status === "target_unreleased") {
            postText = "待发布";
          } else if (node.status === "target_ungraded") {
            postText = "批改中";
          } else if (node.status === "missing_target") {
            postText = "无答题";
          }

          const delta = node.delta_percentage_points;

          return (
            <div key={node.knowledge_node_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 py-2.5 sm:py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-[var(--or-text)]">
                  {data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}
                </span>
                {node.is_modified && (
                  <span className="or-g54-pill bg-[var(--or-warning-container)] px-2 py-0.5 text-xs font-semibold text-[var(--or-on-warning)]">
                    原分复核
                  </span>
                )}
                {node.incomparable_reason && (
                  <span className="text-xs text-[var(--or-on-error)]">({node.incomparable_reason})</span>
                )}
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3.5 text-[var(--or-muted)] w-full sm:w-auto">
                <span className="font-mono text-xs text-[var(--or-muted)]">首考: {preText}</span>
                <span className="font-mono text-xs font-medium text-[var(--or-text)]">复练: {postText}</span>
                <span className="min-w-[4rem] text-right font-mono font-semibold text-xs">
                  {delta !== null ? (
                    <span className={delta > 0 ? "text-[var(--or-on-success)]" : delta < 0 ? "text-[var(--or-on-error)]" : "text-[var(--or-muted)]"}>
                      {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pp
                    </span>
                  ) : (
                    <span className="text-[var(--or-muted)]">-</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StudentResultDetails({ result }: { result: StudentResultRecord }) {
  const [wrongOnly, setWrongOnly] = useState(false);
  const reviewAnswers = wrongOnly ? result.answers.filter((answer) => answer.is_correct === false) : result.answers;
  const sections = new Map<string, { score: number; max: number; count: number }>();
  result.answers.forEach((answer) => {
    const section = answer.section_id || "其他";
    const item = sections.get(section) ?? { score: 0, max: 0, count: 0 };
    item.score += Number(answer.score || 0);
    item.max += Number(answer.score_per_item || 0);
    item.count += 1;
    sections.set(section, item);
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {Array.from(sections.entries()).map(([section, item]) => (
          <div key={section} className="rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5 text-sm text-[var(--or-muted)]">
            <p className="font-semibold text-[var(--or-text)]">{section}</p>
            <p className="mt-1 font-mono text-xs text-[var(--or-muted)]">
              {item.count} 题 · {item.max > 0 ? `${Math.round((item.score / item.max) * 100)}%` : "暂无得分率"}
            </p>
          </div>
        ))}
      </div>

      {result.publication_id && (
        <StudentPracticeComparisonCard publicationId={result.publication_id} />
      )}

      <p className="text-xs text-[var(--or-muted)]">
        平均每题用时：{result.analysis?.average_time_per_question_seconds ?? 0} 秒
      </p>

      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_40%,transparent)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] pb-3">
          <p className="text-base font-semibold text-[var(--or-text)]">逐题复盘</p>
          <button
            type="button"
            onClick={() => setWrongOnly((value) => !value)}
            className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-xs font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
          >
            {wrongOnly ? "查看全部题目" : "只看错题"}
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {reviewAnswers.map((answer, index) => (
            <article
              key={answer.question_id}
              className={`rounded-2xl border bg-[var(--or-card)] p-4 sm:p-5 text-sm transition-colors ${
                answer.is_correct === false
                  ? "border-[color-mix(in_srgb,var(--or-error)_90%,transparent)]"
                  : answer.is_correct === true
                  ? "border-[color-mix(in_srgb,var(--or-success)_90%,transparent)]"
                  : "border-[var(--or-outline)]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[var(--or-text)]">
                  {answer.header || `第 ${index + 1} 题`}
                </p>
                <span
                  className={`or-g54-pill px-3 py-1 text-xs font-semibold ${
                    answer.is_correct === false
                      ? "bg-[var(--or-error-container)] text-[var(--or-on-error)] border border-[var(--or-error)]"
                      : answer.is_correct === true
                      ? "bg-[var(--or-success-container)] text-[var(--or-on-success)] border border-[var(--or-success)]"
                      : "bg-[var(--or-block)] text-[var(--or-muted)]"
                  }`}
                >
                  {answer.is_correct === false ? "需订正" : answer.is_correct === true ? "回答正确" : "已评分"} · {answer.score ?? 0}/{answer.score_per_item ?? "-"} 分
                </span>
              </div>

              {answer.content ? (
                <KatexText text={answer.content} className="mt-3 text-base sm:text-lg font-medium leading-relaxed text-[var(--or-text)]" />
              ) : null}

              {answer.options ? (
                <div className="mt-3 grid gap-2 text-sm text-[var(--or-muted)] sm:grid-cols-2">
                  {Object.entries(answer.options).map(([key, text]) => (
                    <div key={key} className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-2.5">
                      <b className="font-semibold text-[var(--or-text)]">{key}. </b>
                      <KatexText text={text} className="inline" />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-3.5 grid gap-2.5 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] p-3.5 text-xs text-[var(--or-muted)] sm:grid-cols-2">
                <p>我的答案：{String(answer.answer ?? "未作答")}</p>
                <p>正确答案：{String(answer.correct_answer ?? "以教师批改为准")}</p>
              </div>

              {answer.images?.length ? (
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {answer.images.map((image) => (
                    <img
                      key={image.name}
                      src={image.data_url}
                      alt={`答题图片 ${image.name}`}
                      className="h-28 max-w-44 rounded-xl border border-[var(--or-outline)] object-contain bg-[var(--or-page)]"
                    />
                  ))}
                </div>
              ) : null}

              {answer.analysis ? (
                <div className="mt-3.5 rounded-xl border border-[color-mix(in_srgb,var(--or-warning)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] p-3.5 text-xs text-[var(--or-on-warning)]">
                  <b className="font-semibold">题目解析：</b>
                  <KatexText text={answer.analysis} className="mt-1" />
                </div>
              ) : null}

              {answer.feedback ? (
                <p className="mt-3.5 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] p-3.5 text-xs text-[var(--or-on-container)]">
                  <span className="font-semibold">教师评语：</span>
                  <span>{answer.feedback}</span>
                </p>
              ) : null}
            </article>
          ))}
          {reviewAnswers.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--or-muted)]">本次没有已确认错题。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function QuestionAnswer({
  question,
  anchorId,
  value,
  onChange,
  imageMode,
  images,
  onImagesChange,
  onFileDialogOpen,
  onFileDialogClose,
}: {
  question: StudentQuestionRecord;
  anchorId?: string;
  value: string;
  onChange: (value: string) => void;
  imageMode?: boolean;
  images?: StudentAnswerImage[];
  onImagesChange?: (files: FileList | null) => void;
  onFileDialogOpen?: () => void;
  onFileDialogClose?: () => void;
}) {
  const options = question.options ? Object.entries(question.options) : [];
  return (
    <article id={anchorId} className="or-g54-question-card scroll-mt-6 rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 md:p-6 transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)] text-xs font-semibold">
          {question.header}
        </span>
        {false && question.section_id ? (
          <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)] text-xs font-medium">
            {question.section_id}
          </span>
        ) : null}
        <span className="or-g54-pill bg-[var(--or-primary-container)] text-[var(--or-on-container)] text-xs font-semibold">
          {question.score_per_item} 分
        </span>
      </div>

      <KatexText text={question.content} className="mt-3.5 whitespace-pre-wrap text-lg sm:text-xl leading-relaxed text-[var(--or-text)] font-medium" />

      {imageMode ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-4">
          <input
            data-testid={`student-image-${question.question_id}`}
            type="file"
            accept="image/*"
            multiple
            onClick={() => onFileDialogOpen?.()}
            onChange={(event) => {
              onImagesChange?.(event.target.files);
              onFileDialogClose?.();
            }}
            className="block w-full text-sm text-[var(--or-muted)] file:mr-3 file:rounded-xl file:border-0 file:bg-[var(--or-primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[var(--or-on-primary)] hover:file:bg-[var(--or-primary)]"
          />
          {images && images.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((image) => (
                <span key={image.name} className="or-g54-pill bg-[var(--or-card)] border border-[var(--or-outline)] text-[var(--or-muted)] text-xs">
                  {image.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : options.length > 0 ? (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {options.map(([key, text]) => {
            const isChecked = question.type === "multiple_choice" ? value.includes(key) : value === key;
            return (
              <label
                key={key}
                data-checked={isChecked ? "true" : "false"}
                className={`or-g54-option-label flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                  isChecked
                    ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] font-medium"
                    : "border-[var(--or-outline)] bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-page)_40%,transparent)]"
                }`}
              >
                <input
                  type={question.type === "multiple_choice" ? "checkbox" : "radio"}
                  name={`question-${question.question_id}`}
                  value={key}
                  aria-label={`${key}. ${text}`}
                  checked={isChecked}
                  onChange={() => {
                    if (question.type !== "multiple_choice") {
                      onChange(key);
                      return;
                    }
                    const optionKeys = options.map(([optionKey]) => optionKey);
                    const selected = new Set(optionKeys.filter((optionKey) => value.includes(optionKey)));
                    if (selected.has(key)) selected.delete(key);
                    else selected.add(key);
                    onChange(optionKeys.filter((optionKey) => selected.has(optionKey)).join(""));
                  }}
                  className="h-4 w-4 text-[var(--or-text)] focus:ring-[var(--or-focus)]"
                />
                <span className="flex min-w-0 items-baseline gap-1.5 text-base sm:text-[17px] text-[var(--or-text)]">
                  <span className="font-semibold">{key}.</span>
                  <KatexText text={text} className="min-w-0" />
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 space-y-3.5">
          <AnswerRelationEditor value={value} onChange={onChange} />
          {!value.startsWith(ANSWER_LOGIC_PREFIX) ? (
            <textarea
              data-testid={`student-answer-${question.question_id}`}
              className="min-h-28 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3.5 text-[15px] text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="可输入文字、公式说明，也可以在下方上传手写过程图片"
            />
          ) : null}
          <div className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-4">
            <p className="mb-2.5 text-xs font-semibold text-[var(--or-muted)]">上传答题图片（可多张）</p>
            <input
              data-testid={`student-image-${question.question_id}`}
              type="file"
              accept="image/*"
              multiple
              onClick={() => onFileDialogOpen?.()}
              onChange={(event) => {
                onImagesChange?.(event.target.files);
                onFileDialogClose?.();
              }}
              className="block w-full text-sm text-[var(--or-muted)] file:mr-3 file:rounded-xl file:border-0 file:bg-[var(--or-primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[var(--or-on-primary)] hover:file:bg-[var(--or-primary)]"
            />
            {images && images.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {images.map((image) => (
                  <span key={image.name} className="or-g54-pill bg-[var(--or-card)] border border-[var(--or-outline)] text-[var(--or-muted)] text-xs">
                    {image.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
