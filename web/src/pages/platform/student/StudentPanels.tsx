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
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:gap-2 sm:px-3 sm:py-3 sm:text-sm ${
        selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
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
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3" aria-label="学生个人分析图">
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[56px_minmax(0,1fr)_42px] items-center gap-2 text-xs">
            <span className="text-slate-500">{label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-900" style={{ width: `${value}%` }} />
            </div>
            <span className="text-right font-semibold text-slate-700">{value}%</span>
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
      <div data-testid="student-practice-comparison-card" className="rounded-md border border-indigo-100 bg-indigo-50/30 p-3 text-xs text-indigo-700">
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
    <div data-testid="student-practice-comparison-card" className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-indigo-950">
          <span>📚 知识点复练掌握率对照</span>
        </div>
      </div>

      {isModified && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          ⚠️ 来源首考成绩已被教师复核修改（基线保持冻结原值）
        </div>
      )}

      {isMissing && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800">
          ⚠️ 来源考试已被删除或撤回，历史基线不可比
        </div>
      )}

      <div className="mt-2 divide-y divide-indigo-100/60">
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
            <div key={node.knowledge_node_id} className="flex flex-wrap items-center justify-between py-1.5">
              <div>
                <span className="font-medium text-slate-800">{data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}</span>
                {node.is_modified && (
                  <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">原分复核</span>
                )}
                {node.incomparable_reason && (
                  <span className="ml-1.5 text-[11px] text-rose-600">({node.incomparable_reason})</span>
                )}
              </div>

              <div className="flex items-center gap-4 text-slate-700">
                <span>首考: {preText}</span>
                <span>复练: {postText}</span>
                <span className="font-semibold font-mono">
                  {delta !== null ? (
                    <span className={delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-600"}>
                      {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pp
                    </span>
                  ) : (
                    <span className="text-slate-400">-</span>
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
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from(sections.entries()).map(([section, item]) => (
          <div key={section} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">{section}</p>
            <p className="mt-1">{item.count} 题 · {item.max > 0 ? `${Math.round((item.score / item.max) * 100)}%` : "暂无得分率"}</p>
          </div>
        ))}
      </div>
      {result.publication_id && (
        <StudentPracticeComparisonCard publicationId={result.publication_id} />
      )}
      <p className="text-xs text-slate-500">平均每题用时：{result.analysis?.average_time_per_question_seconds ?? 0} 秒</p>
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">逐题复盘</p>
          <button type="button" onClick={() => setWrongOnly((value) => !value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {wrongOnly ? "查看全部题目" : "只看错题"}
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {reviewAnswers.map((answer, index) => (
            <article key={answer.question_id} className={`rounded-lg border bg-white p-4 text-sm ${answer.is_correct === false ? "border-rose-200" : answer.is_correct === true ? "border-emerald-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{answer.header || `第 ${index + 1} 题`}</p>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${answer.is_correct === false ? "bg-rose-50 text-rose-700" : answer.is_correct === true ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {answer.is_correct === false ? "需订正" : answer.is_correct === true ? "回答正确" : "已评分"} · {answer.score ?? 0}/{answer.score_per_item ?? "-"} 分
                </span>
              </div>
              {answer.content ? <KatexText text={answer.content} className="mt-2 text-slate-800" /> : null}
              {answer.options ? <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">{Object.entries(answer.options).map(([key, text]) => <div key={key}><b>{key}.</b> <KatexText text={text} className="inline" /></div>)}</div> : null}
              <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
                <p>我的答案：{String(answer.answer ?? "未作答")}</p>
                <p>正确答案：{String(answer.correct_answer ?? "以教师批改为准")}</p>
              </div>
              {answer.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{answer.images.map((image) => <img key={image.name} src={image.data_url} alt={`答题图片 ${image.name}`} className="h-24 max-w-40 rounded border border-slate-200 object-contain" />)}</div> : null}
              {answer.analysis ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900"><b>题目解析：</b><KatexText text={answer.analysis} className="mt-1" /></div> : null}
              {answer.feedback ? <p className="mt-3 rounded-md bg-blue-50 p-3 text-xs text-blue-800">教师评语：<span>{answer.feedback}</span></p> : null}
            </article>
          ))}
          {reviewAnswers.length === 0 ? <p className="py-3 text-center text-xs text-slate-500">本次没有已确认错题。</p> : null}
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
    <article id={anchorId} className="scroll-mt-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{question.header}</span>
        <span>{question.section_id}</span>
        <span>{question.score_per_item} 分</span>
      </div>
      <KatexText text={question.content} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-950" />
      {imageMode ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
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
            className="block w-full text-sm text-slate-700"
          />
          {images && images.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {images.map((image) => (
                <span key={image.name} className="rounded bg-white px-2 py-1">
                  {image.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : options.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map(([key, text]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <input
                type={question.type === "multiple_choice" ? "checkbox" : "radio"}
                name={`question-${question.question_id}`}
                value={key}
                aria-label={`${key}. ${text}`}
                checked={question.type === "multiple_choice" ? value.includes(key) : value === key}
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
              />
              <span className="flex min-w-0 items-baseline gap-1">
                <span>{key}.</span>
                <KatexText text={text} className="min-w-0" />
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <AnswerRelationEditor value={value} onChange={onChange} />
          {!value.startsWith(ANSWER_LOGIC_PREFIX) ? <textarea
            data-testid={`student-answer-${question.question_id}`}
            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="可输入文字、公式说明，也可以在下方上传手写过程图片"
          /> : null}
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">上传答题图片（可多张）</p>
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
              className="block w-full text-sm text-slate-700"
            />
            {images && images.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {images.map((image) => <span key={image.name} className="rounded bg-white px-2 py-1">{image.name}</span>)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
