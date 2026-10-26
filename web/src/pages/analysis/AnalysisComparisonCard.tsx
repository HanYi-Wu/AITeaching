import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import { loadSessionToken } from "../../platform/session";
import {
  fetchPracticePublications,
  fetchTeacherLearningProgressComparison,
  type PracticePublicationChoice,
  type TeacherComparisonResponse,
} from "../../platform/learningProgress";

export interface AnalysisComparisonCardProps {
  practicePublicationId?: string;
  sourceExamId?: string;
  sourceBatchId?: string;
  classId?: string;
  studentId?: string;
  className?: string;
}

const percentage = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
const reasons: Record<string, string> = {
  target_unsubmitted: "等待完成", target_ungraded: "等待批改", target_unreleased: "等待发布",
  missing_baseline: "缺少首考基线", missing_target: "缺少有效答题", source_missing: "来源缺失",
};

export function AnalysisComparisonCard({
  practicePublicationId = "", sourceExamId, sourceBatchId, classId, studentId, className,
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
    if (practicePublicationId) return () => { active = false; };
    setLoading(true);
    void fetchPracticePublications(sourceExamId, sourceBatchId).then((result) => {
      if (!active || loadSessionToken() !== sessionToken) return;
      setChoices(result.publications);
      setSelectedId(result.publications[0]?.id || "");
    }).catch((err) => {
      if (active && loadSessionToken() === sessionToken) setError(err?.message || "获取关联复练失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [practicePublicationId, sourceExamId, sourceBatchId, sessionToken]);

  useEffect(() => {
    let active = true;
    setData(null);
    if (!selectedId) return () => { active = false; };
    setLoading(true);
    setError(null);
    void fetchTeacherLearningProgressComparison({ practicePublicationId: selectedId, classId, studentId }).then((result) => {
      if (active && loadSessionToken() === sessionToken) setData(result);
    }).catch((err) => {
      if (active && loadSessionToken() === sessionToken) setError(err?.message || "获取复练对照失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [selectedId, sourceExamId, sourceBatchId, classId, studentId, refresh, sessionToken]);

  const summaries = data?.class_comparison?.node_summaries || [];
  const studentEntries = Object.entries(data?.student_comparisons || {});
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-4", className)} aria-label="复练前后对照">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">知识点复练前后得分率</h3>
        <div className="flex items-center gap-2">
          {choices.length > 0 && (
            <select aria-label="关联复练" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="max-w-64 rounded border px-2 py-1 text-xs">
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
            </select>
          )}
          <button type="button" aria-label="刷新复练对照" disabled={loading || !selectedId} onClick={() => setRefresh((value) => value + 1)} className="rounded border p-1.5 disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>
      {loading && <p className="mt-3 text-xs text-slate-500">正在读取复练对照…</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
      {!loading && !error && !selectedId && <p className="mt-3 text-xs text-slate-500">本次诊断尚无已发布的关联复练。发布后会在这里显示。</p>}
      {data?.source_status.is_modified && <p className="mt-3 text-xs text-amber-800">首考成绩已复核，基线保持发布复练时的原值。</p>}
      {data?.source_status.is_missing && <p className="mt-3 text-xs text-rose-700">无法核实来源，暂不计算提升。请确认来源项目和成绩批次仍可读取。</p>}
      {!loading && data && (
        <>
          {summaries.length === 0 ? <p className="mt-3 text-xs text-slate-500">暂无可配对的知识点证据。</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b text-slate-500"><tr><th className="py-2">知识点</th><th>首考</th><th>复练</th><th>变化</th><th>配对人数</th><th>题数（前/后）</th><th>待完成情况</th></tr></thead>
                <tbody>{summaries.map((node) => (
                  <tr key={node.knowledge_node_id} className="border-b border-slate-100">
                    <td className="py-2 font-medium">{data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}</td>
                    <td>{percentage(node.pre_percentage)}</td><td>{percentage(node.post_percentage)}</td>
                    <td>{node.delta_percentage_points == null ? "—" : `${node.delta_percentage_points > 0 ? "+" : ""}${node.delta_percentage_points.toFixed(1)} 个百分点`}</td>
                    <td>{node.matched_student_count} 人</td><td>{node.pre_question_count} / {node.post_question_count}</td>
                    <td>{Object.entries(node.unpaired_reasons).map(([reason, count]) => `${reasons[reason] || "不可比较"} ${count} 人`).join("，") || "已配对"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {studentEntries.length > 0 && (
            <div className="mt-3 text-xs">
              <button type="button" className="text-indigo-700" onClick={() => setShowStudents((shown) => !shown)}>{showStudents ? "收起学生明细" : "查看学生明细"}</button>
              {showStudents && studentEntries.map(([id, comparison]) => (
                <div key={id} className="mt-2 rounded bg-slate-50 p-2">
                  <p className="font-medium">{data.student_names?.[id] || "学生"}</p>
                  {comparison.node_comparisons.map((node) => <p key={node.knowledge_node_id} className="mt-1 text-slate-600">{data.knowledge_names?.[node.knowledge_node_id] || "已归档知识点"}：{percentage(node.pre_percentage)} → {percentage(node.post_percentage)}{node.incomparable_reason ? `（${node.incomparable_reason}）` : ""}</p>)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
