import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, LoaderCircle, WandSparkles, X } from "lucide-react";
import { apiGet, apiPost } from "../../api/client";
import type { ComposePaperState, TemplateRow } from "../../types/compose";
import type { AutoComposeOptions, AutoComposeRequest, AutoComposeResponse } from "../../types/autoCompose";
import { getSectionRequiredCount } from "./composeModel";
import { useComposeRequestScope } from "./useComposeRequestScope";

type Difficulty = "easy" | "medium" | "hard";
const DIFFICULTIES: Array<{ id: Difficulty; label: string }> = [
  { id: "easy", label: "简单" },
  { id: "medium", label: "中等" },
  { id: "hard", label: "较难" },
];
const typeLabels: Record<string, string> = {
  choice: "选择题（合计）",
  single_choice: "单选题",
  multiple_choice: "多选题",
  fill: "填空题",
  judge: "判断题",
  short_answer: "简答题",
  reasoning: "解答题",
  essay: "论述题",
  group: "材料组题",
  practice: "练习题",
};
const difficultyLabels: Record<string, string> = { easy: "简单", medium: "中等", hard: "较难", unknown: "难度未标注" };

export type AutoComposeDialogProps = {
  open: boolean;
  onClose: () => void;
  subject: string;
  template: TemplateRow | undefined;
  paperState: ComposePaperState;
  currentExamId: string | null;
  /** Includes account, project, paper, and the current paper state fingerprint. */
  requestScopeKey: string;
  /** Stable owner/paper/subject/template scope for the options catalog. */
  optionsScopeKey?: string;
  onApply: (result: AutoComposeResponse) => void;
  onViewDuplicates?: () => void;
};

function defaultSectionCounts(template: TemplateRow | undefined, paperState: ComposePaperState) {
  if (!template) return {};
  return Object.fromEntries(template.sections
    .filter((section) => section.type !== "text")
    .map((section) => [section.section_id, getSectionRequiredCount(section, paperState.countBySection)]));
}

function readWeight(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function AutoComposeDialog({
  open,
  onClose,
  subject,
  template,
  paperState,
  currentExamId,
  requestScopeKey,
  optionsScopeKey = requestScopeKey,
  onApply,
  onViewDuplicates,
}: AutoComposeDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const captureScope = useComposeRequestScope(`${requestScopeKey}::${open ? "open" : "closed"}`);
  const captureOptionsScope = useComposeRequestScope(`${optionsScopeKey}::${open ? "open" : "closed"}`);
  const [options, setOptions] = useState<AutoComposeOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState("");
  const [knowledgePoints, setKnowledgePoints] = useState<string[]>([]);
  const [coveragePercent, setCoveragePercent] = useState("80");
  const [selectedDifficulties, setSelectedDifficulties] = useState<Difficulty[]>([]);
  const [typeEnabled, setTypeEnabled] = useState(false);
  const [typeWeights, setTypeWeights] = useState<Record<string, string>>({});
  const [avoidHistory, setAvoidHistory] = useState(false);
  const [similarityPercent, setSimilarityPercent] = useState("85");
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<AutoComposeResponse | null>(null);

  const initialSectionCounts = useMemo(() => defaultSectionCounts(template, paperState), [paperState, template]);
  const initialTotal = useMemo(() => Object.values(initialSectionCounts).reduce((sum, count) => sum + count, 0), [initialSectionCounts]);
  const typeOptions = useMemo(() => {
    const counts = options?.type_counts ?? {};
    const permitted = new Set(["choice", "single_choice", "multiple_choice", "fill", "judge", "short_answer", "reasoning", "essay", "group"]);
    const entries = Object.entries(counts).filter(([type]) => permitted.has(type));
    if (counts.choice !== undefined) {
      return [["choice", (counts.choice ?? 0) + (counts.single_choice ?? 0) + (counts.multiple_choice ?? 0)] as [string, number], ...entries.filter(([type]) => !["choice", "single_choice", "multiple_choice"].includes(type))]
        .sort(([a], [b]) => a.localeCompare(b));
    }
    return entries.sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  useEffect(() => {
    if (!open || !subject.trim()) {
      setOptions(null);
      setOptionsLoading(false);
      setLoadingError(null);
      return;
    }
    const isCurrent = captureOptionsScope();
    let active = true;
    setOptionsLoading(true);
    setLoadingError(null);
    void apiGet<AutoComposeOptions>(`/api/exam/auto-compose/options?subject=${encodeURIComponent(subject.trim())}`)
      .then((result) => {
        if (!active || !isCurrent()) return;
        setOptions(result);
        setSelectedNamespaces(result.namespaces ?? []);
        setTypeWeights(Object.fromEntries(Object.keys(result.type_counts ?? {}).map((type) => [type, ""])));
      })
      .catch((error) => {
        if (!active || !isCurrent()) return;
        setLoadingError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active && isCurrent()) setOptionsLoading(false);
      });
    return () => { active = false; };
  }, [captureOptionsScope, open, optionsScopeKey, subject]);

  useEffect(() => {
    if (!open) return;
    setTotalCount(String(initialTotal));
    setSubmitError(null);
  }, [initialTotal, open, template?.path]);

  useEffect(() => {
    setGenerating(false);
    setSubmitError(null);
  }, [requestScopeKey]);

  useEffect(() => {
    if (open) return;
    setGenerating(false);
    setGeneratedResult(null);
  }, [open]);

  const toggleDifficulty = (id: Difficulty) => {
    setSelectedDifficulties((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  };

  const setTypeWeight = (key: string, value: string) => {
    setTypeWeights((previous) => ({ ...previous, [key]: value }));
  };

  const toggleKnowledge = (id: string) => {
    setKnowledgePoints((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  };

  const toggleNamespace = (namespace: string) => {
    setSelectedNamespaces((previous) => previous.includes(namespace)
      ? previous.filter((item) => item !== namespace)
      : [...previous, namespace]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setGeneratedResult(null);
    if (!template) {
      setSubmitError("请先选择组卷模板。");
      return;
    }
    const count = Number(totalCount);
    const coverage = Number(coveragePercent);
    const threshold = Number(similarityPercent);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      setSubmitError("题量需为 1 到 500 的整数。");
      return;
    }
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
      setSubmitError("知识点覆盖率需在 0% 到 100% 之间。");
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 50 || threshold > 100) {
      setSubmitError("相似度阈值需在 50% 到 100% 之间。");
      return;
    }

    const difficultyDistribution: AutoComposeRequest["difficulty_distribution"] = Object.fromEntries(
      selectedDifficulties.map((id) => [id, 1]),
    ) as AutoComposeRequest["difficulty_distribution"];

    const typeDistribution: Record<string, number> = {};
    if (typeEnabled) {
      for (const [type, raw] of Object.entries(typeWeights)) {
        const weight = readWeight(raw);
        if (raw.trim() && (weight === undefined || weight < 0)) {
          setSubmitError("题型比例只能填写 0 或正数。");
          return;
        }
        if (weight !== undefined && weight > 0) typeDistribution[type] = weight;
      }
      if (Object.keys(typeDistribution).length === 0) {
        setSubmitError("启用题型比例后，请至少填写一个大于 0 的比例。");
        return;
      }
    }

    const sections = defaultSectionCounts(template, paperState);
    const sectionsTotal = Object.values(sections).reduce((sum, value) => sum + value, 0);
    const request: AutoComposeRequest = {
      template_path: template.path,
      template_ref: template.id,
      subject: subject.trim(),
      total_count: count,
      knowledge_points: [...knowledgePoints],
      coverage_ratio: coverage / 100,
      difficulty_distribution: difficultyDistribution,
      type_distribution: typeDistribution,
      ...(Object.keys(typeDistribution).length === 0 && sectionsTotal === count ? { section_counts: sections } : {}),
      avoid_history: avoidHistory,
      exclude_exam_id: currentExamId,
      similarity_threshold: threshold / 100,
      ...(options?.namespaces.length ? { namespaces: [...selectedNamespaces] } : {}),
    };

    if ((options?.namespaces.length ?? 0) > 0 && selectedNamespaces.length === 0) {
      setSubmitError("请至少选择一个题库范围。");
      return;
    }

    const isCurrent = captureScope();
    setGenerating(true);
    try {
      const result = await apiPost<AutoComposeResponse>("/api/exam/auto-compose", request);
      if (!isCurrent()) return;
      onApply(result);
      setGeneratedResult(result);
    } catch (error) {
      if (isCurrent()) setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="fixed left-1/2 top-1/2 z-[121] flex max-h-[min(92dvh,52rem)] w-[min(calc(100vw-1.25rem),48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] shadow-2xl focus:outline-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--or-outline)] px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title id={titleId} className="flex items-center gap-2 text-lg font-semibold">
                <WandSparkles className="h-5 w-5 text-[var(--or-primary)]" aria-hidden="true" />
                按目标自动组卷
              </Dialog.Title>
              <Dialog.Description id={descriptionId} className="mt-1 text-sm text-[var(--or-muted)]">
                设定题量、知识点及可选比例，生成后应用到当前试卷，并可撤销。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭按目标自动组卷" className="rounded-lg p-2 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 p-4 sm:p-5">
              {!subject.trim() ? (
                <div role="alert" className="rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] p-3 text-sm text-[var(--or-on-warning)]">请先为当前试卷选择科目。</div>
              ) : null}
              {loadingError ? <div role="alert" className="rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] p-3 text-sm text-[var(--or-on-error)]">读取组卷条件失败：{loadingError}</div> : null}
              {submitError ? <div role="alert" className="rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] p-3 text-sm text-[var(--or-on-error)]">{submitError}</div> : null}
              {generatedResult ? <AutoComposeResultSummary result={generatedResult} options={options} onViewDuplicates={onViewDuplicates} /> : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  题量
                  <input type="number" min={1} max={500} step={1} value={totalCount} onChange={(event) => setTotalCount(event.target.value)} className="or-g49-input min-h-10 w-full px-3 py-2 tabular-nums" />
                  <span className="text-xs font-normal text-[var(--or-muted)]">模板当前题量：{initialTotal} 题</span>
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  知识点覆盖率
                  <span className="flex items-center gap-2">
                    <input type="number" min={0} max={100} step={1} value={coveragePercent} onChange={(event) => setCoveragePercent(event.target.value)} className="or-g49-input min-h-10 w-full px-3 py-2 tabular-nums" />
                    <span className="text-[var(--or-muted)]">%</span>
                  </span>
                  <span className="text-xs font-normal text-[var(--or-muted)]">未选择知识点时不设知识点目标。</span>
                </label>
              </div>

              <fieldset className="rounded-xl border border-[var(--or-outline)] p-3 sm:p-4">
                <legend className="px-1 text-sm font-semibold">知识点</legend>
                {optionsLoading ? <p role="status" className="text-sm text-[var(--or-muted)]">正在读取本学科知识点…</p> : null}
                {!optionsLoading && (options?.knowledge_points.length ?? 0) === 0 ? <p className="text-sm text-[var(--or-muted)]">当前科目暂无可用知识点。</p> : null}
                <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                  {options?.knowledge_points.map((point) => (
                    <label key={point.id} className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-1 text-sm">
                      <input type="checkbox" checked={knowledgePoints.includes(point.id)} onChange={() => toggleKnowledge(point.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--or-primary)]" />
                      <span className="min-w-0 break-words">{point.name}<span className="ml-1 text-xs text-[var(--or-muted)]">({point.question_count})</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-[var(--or-outline)] p-3 sm:p-4">
                <legend className="px-1 text-sm font-semibold">难度</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DIFFICULTIES.map(({ id, label }) => (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--or-outline)] px-3 py-2 text-sm hover:bg-[var(--or-block)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDifficulties.includes(id)}
                        onChange={() => toggleDifficulty(id)}
                        className="h-4 w-4 accent-[var(--or-primary)]"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-[var(--or-outline)] p-3 sm:p-4">
                <legend className="px-1 text-sm font-semibold">题型比例</legend>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={typeEnabled} onChange={(event) => setTypeEnabled(event.target.checked)} className="h-4 w-4 accent-[var(--or-primary)]" />
                  指定题型相对比例（默认按模板安排）
                </label>
                {typeOptions.length === 0 ? <p className="text-sm text-[var(--or-muted)]">当前科目暂无题型统计。</p> : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  {typeOptions.map(([type, count]) => (
                    <label key={type} className="grid gap-1 text-sm text-[var(--or-muted)]">
                      {typeLabels[type] ?? type}<span className="text-xs">题库 {count} 题</span>
                      <input type="number" min={0} step={1} disabled={!typeEnabled} value={typeWeights[type] ?? ""} onChange={(event) => setTypeWeight(type, event.target.value)} className="or-g49-input min-h-10 w-full px-3 py-2 tabular-nums disabled:opacity-50" />
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-xl border border-[var(--or-outline)] p-3 text-sm">
                  <input type="checkbox" checked={avoidHistory} onChange={(event) => setAvoidHistory(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--or-primary)]" />
                  <span>避开历史用题<span className="mt-0.5 block text-xs font-normal text-[var(--or-muted)]">排除已在历史试卷中出现的题目。</span></span>
                </label>
                <label className="grid gap-1.5 rounded-xl border border-[var(--or-outline)] p-3 text-sm font-medium">
                  相似度阈值
                  <span className="flex items-center gap-2">
                    <input type="number" min={50} max={100} step={1} value={similarityPercent} onChange={(event) => setSimilarityPercent(event.target.value)} className="or-g49-input min-h-10 w-full px-3 py-2 tabular-nums" />
                    <span className="text-[var(--or-muted)]">%</span>
                  </span>
                </label>
              </div>

              {options?.namespaces.length ? (
                <fieldset className="rounded-xl border border-[var(--or-outline)] p-3 sm:p-4">
                  <legend className="px-1 text-sm font-semibold">题库范围</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {options.namespaces.map((namespace) => (
                      <label key={namespace} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={selectedNamespaces.includes(namespace)} onChange={() => toggleNamespace(namespace)} className="h-4 w-4 accent-[var(--or-primary)]" />
                        {namespace}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <p className="flex items-start gap-2 rounded-xl bg-[var(--or-block)] p-3 text-xs leading-relaxed text-[var(--or-muted)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                查重依据题目文字及数字变式相似度，结果供人工复核，不代表语义判定。
              </p>
              {options?.warnings.map((warning, index) => <p key={`${warning}-${index}`} className="text-xs text-[var(--or-muted)]">{warning}</p>)}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 sm:px-5">
              <Dialog.Close asChild><button type="button" className="or-g49-btn or-g49-btn-secondary px-3 py-2 text-sm">取消</button></Dialog.Close>
              <button type="submit" disabled={generating || optionsLoading || !options || !template || !subject.trim()} className="or-g49-btn inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50">
                {generating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <WandSparkles className="h-4 w-4" aria-hidden="true" />}
                {generating ? "正在组卷…" : "生成并应用"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AutoComposeResultSummary({ result, options, onViewDuplicates }: { result: AutoComposeResponse; options: AutoComposeOptions | null; onViewDuplicates?: () => void }) {
  const actualDifficulty = { ...result.goals.difficulty.actual };
  if (actualDifficulty.unknown === undefined) actualDifficulty.unknown = 0;
  const knowledgeNames = new Map((options?.knowledge_points ?? []).map((point) => [point.id, point.name]));
  return (
    <section aria-label="自动组卷实际结果" data-testid="auto-compose-result" className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-block)] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{result.generated_count > 0 ? "组卷结果" : "未能选出题目"}</h3>
          <p className="mt-0.5 text-sm text-[var(--or-muted)]">目标 {result.requested_count} 题，实际 {result.generated_count} 题；候选 {result.candidate_count} 题。</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${result.complete ? "bg-[var(--or-success-container)] text-[var(--or-on-success)]" : "bg-[var(--or-warning-container)] text-[var(--or-on-warning)]"}`}>
          {result.complete ? "目标已达成" : "有目标未达成"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-3">
          <h4 className="text-sm font-semibold">知识点覆盖</h4>
          <p className="mt-1 text-sm">{result.goals.knowledge.target_points.length ? `${Math.round(result.goals.knowledge.coverage_ratio * 100)}% / 目标 ${Math.round(result.goals.knowledge.required_ratio * 100)}%` : "未设置知识点目标"}</p>
          <p className="mt-1 text-xs text-[var(--or-muted)]">覆盖 {result.goals.knowledge.covered_points.length} / {result.goals.knowledge.target_points.length} 个目标知识点</p>
          {result.goals.knowledge.missing_points.length ? <p className="mt-1 break-words text-xs text-[var(--or-on-warning)]">未覆盖：{result.goals.knowledge.missing_points.map((point, index) => <span key={point} title={point}>{index ? "、" : ""}{knowledgeNames.get(point) ?? point}</span>)}</p> : null}
        </div>
        <div className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-3">
          <h4 className="text-sm font-semibold">难度分布</h4>
          <p className="mt-1 text-sm">{Object.entries(actualDifficulty).map(([key, count]) => `${difficultyLabels[key] ?? key} ${count}`).join(" · ") || "暂无题目"}</p>
          <p className="mt-1 text-xs text-[var(--or-muted)]">目标：{Object.entries(result.goals.difficulty.target).map(([key, count]) => `${difficultyLabels[key] ?? key} ${count}`).join(" · ") || "不限"}</p>
        </div>
        <div className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-3">
          <h4 className="text-sm font-semibold">题型分布</h4>
          <p className="mt-1 text-sm">{Object.entries(result.goals.types.actual).map(([key, count]) => `${typeLabels[key] ?? key} ${count}`).join(" · ") || "暂无题目"}</p>
          <p className="mt-1 text-xs text-[var(--or-muted)]">目标：{Object.entries(result.goals.types.target).map(([key, count]) => `${typeLabels[key] ?? key} ${count}`).join(" · ") || "按模板"}</p>
        </div>
        <div className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-3">
          <h4 className="text-sm font-semibold">各大题数量</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {result.goals.sections.map((section) => <li key={section.section_id} className="flex flex-wrap justify-between gap-x-3"><span className="break-words">{section.section_id}</span><span className={section.actual_count < section.requested_count ? "text-[var(--or-on-warning)]" : "tabular-nums"}>{section.actual_count} / {section.requested_count}</span></li>)}
          </ul>
        </div>
      </div>
      {result.warnings.length ? <ul className="mt-3 space-y-1 text-sm text-[var(--or-on-warning)]">{result.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="rounded-lg bg-[var(--or-warning-container)] px-3 py-2">{warning}</li>)}</ul> : null}
      {onViewDuplicates ? <button type="button" onClick={onViewDuplicates} className="mt-3 inline-flex items-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-sm font-medium hover:bg-[var(--or-page)]">查看每题查重来源</button> : null}
    </section>
  );
}

