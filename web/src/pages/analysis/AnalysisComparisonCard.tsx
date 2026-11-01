import { useEffect, useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils";
import { loadSessionToken } from "../../platform/session";
import {
  fetchPracticePublications,
  fetchTeacherLearningProgressComparison,
  type PracticePublicationChoice,
  type TeacherComparisonResponse,
} from "../../platform/learningProgress";
import { G52Pill } from "../../ui-redesign/g52/G52UIComponents";
import "../../ui-redesign/g52/g52-design-tokens.css";
import { Select as AppSelect } from "../../components/ui/select";

export interface AnalysisComparisonCardProps {
  practicePublicationId?: string;
  sourceExamId?: string;
  sourceBatchId?: string;
  classId?: string;
  studentId?: string;
  className?: string;
}

const percentage = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);
const reasons: Record<string, string> = {
  target_unsubmitted: "等待完成",
  target_ungraded: "等待批改",
  target_unreleased: "等待发布",
  missing_baseline: "缺少首考基线",
  missing_target: "缺少有效答题",
  source_missing: "来源缺失",
};

export function AnalysisComparisonCard({
  practicePublicationId = "",
  sourceExamId,
  sourceBatchId,
  classId,
  studentId,
  className,
}: AnalysisComparisonCardProps) {
  const [choices, setChoices] = useState<PracticePublicationChoice[]>([]);
  const [selectedId, setSelectedId] = useState(practicePublicationId);
  const [data, setData] = useState<TeacherComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [showStudents, setShowStudents] = useState(false);
  const sessionToken = loadSessionToken();

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setChoices([]);
    setSelectedId(practicePublicationId);
    if (practicePublicationId)
      return () => {
        active = false;
      };
    setLoading(true);
    void fetchPracticePublications(sourceExamId, sourceBatchId)
      .then((result) => {
        if (!active || loadSessionToken() !== sessionToken) return;
        setChoices(result.publications);
        setSelectedId(result.publications[0]?.id || "");
      })
      .catch((err) => {
        if (active && loadSessionToken() === sessionToken)
          setError(err?.message || "获取关联复练失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [practicePublicationId, sourceExamId, sourceBatchId, sessionToken]);

  useEffect(() => {
    let active = true;
    setData(null);
    if (!selectedId)
      return () => {
        active = false;
      };
    setLoading(true);
    setError(null);
    void fetchTeacherLearningProgressComparison({ practicePublicationId: selectedId, classId, studentId })
      .then((result) => {
        if (active && loadSessionToken() === sessionToken) setData(result);
      })
      .catch((err) => {
        if (active && loadSessionToken() === sessionToken)
          setError(err?.message || "获取复练对照失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId, sourceExamId, sourceBatchId, classId, studentId, refresh, sessionToken]);

  const summaries = data?.class_comparison?.node_summaries || [];
  const studentEntries = Object.entries(data?.student_comparisons || {});

  return (
    <section
      className={cn("or-g52-surface-card p-5", className)}
      aria-label="复练前后对照"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--or-outline)] pb-3.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[var(--or-on-container)]" />
          <h3 className="text-sm font-semibold text-[var(--or-text)]">知识点复练前后得分率</h3>
        </div>
        <div className="flex items-center gap-2">
          {choices.length > 0 && (
            <AppSelect
              aria-label="关联复练"
              value={selectedId}
              onValueChange={(value) => setSelectedId(value)}
              className="max-w-64 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </AppSelect>
          )}
          <button
            type="button"
            aria-label="刷新复练对照"
            disabled={loading || !selectedId}
            onClick={() => setRefresh((value) => value + 1)}
            className="inline-flex items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-1.5 text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {loading && <p className="mt-3.5 text-xs text-[var(--or-muted)]">正在读取复练对照…</p>}
      {error && (
        <p role="alert" className="mt-3.5 rounded-lg border border-[var(--or-error)] bg-[var(--or-error-container)] px-3 py-2 text-xs text-[var(--or-on-error)]">
          {error}
        </p>
      )}
      {!loading && !error && !selectedId && (
        <p className="mt-3.5 text-xs text-[var(--or-muted)]">本次诊断尚无已发布的关联复练。发布后会在这里显示。</p>
      )}
      {data?.source_status.is_modified && (
        <p className="mt-3 rounded-lg border border-[var(--or-warning)] bg-[var(--or-warning-container)] px-3 py-2 text-xs text-[var(--or-on-warning)]">
          首考成绩已复核，基线保持发布复练时的原值。
        </p>
      )}
      {data?.source_status.is_missing && (
        <p className="mt-3 rounded-lg border border-[var(--or-error)] bg-[var(--or-error-container)] px-3 py-2 text-xs text-[var(--or-on-error)]">
          无法核实来源，暂不计算提升。请确认来源项目和成绩批次仍可读取。
        </p>
      )}

      {!loading && data && (
        <>
          {summaries.length === 0 ? (
            <p className="mt-3.5 text-xs text-[var(--or-muted)]">暂无可配对的知识点证据。</p>
          ) : (
            <div className="mt-3.5 overflow-x-auto rounded-xl border border-[var(--or-outline)]">
              <table className="or-g52-table">
                <thead>
                  <tr>
                    <th className="font-semibold">知识点</th>
                    <th className="font-semibold">首考</th>
                    <th className="font-semibold">复练</th>
                    <th className="font-semibold">变化</th>
                    <th className="font-semibold">配对人数</th>
                    <th className="font-semibold">题数（前/后）</th>
                    <th className="font-semibold">待完成情况</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((node) => (
                    <tr key={node.knowledge_node_id}>
                      <td className="font-medium text-[var(--or-text)]">
                        {data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}
                      </td>
                      <td className="text-[var(--or-muted)] font-mono">{percentage(node.pre_percentage)}</td>
                      <td className="text-[var(--or-muted)] font-mono">{percentage(node.post_percentage)}</td>
                      <td>
                        {node.delta_percentage_points == null ? (
                          "—"
                        ) : (
                          <G52Pill
                            variant={node.delta_percentage_points > 0 ? "success" : node.delta_percentage_points < 0 ? "error" : "neutral"}
                          >
                            {node.delta_percentage_points > 0 ? "+" : ""}
                            {node.delta_percentage_points.toFixed(1)} 个百分点
                          </G52Pill>
                        )}
                      </td>
                      <td className="text-[var(--or-muted)]">{node.matched_student_count} 人</td>
                      <td className="text-[var(--or-muted)] font-mono">
                        {node.pre_question_count} / {node.post_question_count}
                      </td>
                      <td className="text-[var(--or-muted)]">
                        {Object.entries(node.unpaired_reasons)
                          .map(([reason, count]) => `${reasons[reason] || "不可比较"} ${count} 人`)
                          .join("，") || "已配对"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {studentEntries.length > 0 && (
            <div className="mt-3.5 text-xs">
              <button
                type="button"
                className="font-medium text-[var(--or-on-container)] hover:text-[var(--or-on-container)] transition-colors"
                onClick={() => setShowStudents((shown) => !shown)}
              >
                {showStudents ? "收起学生明细" : "查看学生明细"}
              </button>
              {showStudents && (
                <div className="mt-2.5 space-y-2">
                  {studentEntries.map(([id, comparison]) => (
                    <div key={id} className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3">
                      <p className="font-semibold text-[var(--or-text)]">{data.student_names?.[id] || "学生"}</p>
                      <div className="mt-1.5 space-y-1">
                        {comparison.node_comparisons.map((node) => (
                          <p key={node.knowledge_node_id} className="text-[var(--or-muted)]">
                            <span className="font-medium text-[var(--or-muted)]">
                              {data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}
                            </span>
                            {"："}
                            <span className="font-mono">{percentage(node.pre_percentage)}</span>
                            {" → "}
                            <span className="font-mono">{percentage(node.post_percentage)}</span>
                            {node.incomparable_reason ? `（${node.incomparable_reason}）` : ""}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
