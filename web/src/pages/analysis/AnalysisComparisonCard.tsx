import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Minus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  fetchTeacherLearningProgressComparison,
  type TeacherComparisonResponse,
} from "../../platform/learningProgress";

export interface AnalysisComparisonCardProps {
  practicePublicationId?: string;
  classId?: string;
  studentId?: string;
  className?: string;
}

export function AnalysisComparisonCard({
  practicePublicationId: initialPubId = "",
  classId,
  studentId,
  className,
}: AnalysisComparisonCardProps) {
  const [pubIdInput, setPubIdInput] = useState(initialPubId);
  const [activePubId, setActivePubId] = useState(initialPubId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TeacherComparisonResponse | null>(null);
  const [showStudentDetails, setShowStudentDetails] = useState(false);

  const requestIdRef = useRef(0);

  const loadComparison = useCallback(
    async (targetPubId: string) => {
      const cleanPubId = targetPubId.trim();
      if (!cleanPubId) {
        setData(null);
        setError(null);
        return;
      }

      const curId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await fetchTeacherLearningProgressComparison({
          practicePublicationId: cleanPubId,
          classId: classId || undefined,
          studentId: studentId || undefined,
        });
        if (curId === requestIdRef.current) {
          setData(res);
          setActivePubId(cleanPubId);
        }
      } catch (err: any) {
        if (curId === requestIdRef.current) {
          setError(err?.message || "获取学习进展对照失败");
          setData(null);
        }
      } finally {
        if (curId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [classId, studentId],
  );

  useEffect(() => {
    if (initialPubId) {
      setPubIdInput(initialPubId);
      void loadComparison(initialPubId);
    }
  }, [initialPubId, loadComparison]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadComparison(pubIdInput);
  };

  const summaries = data?.class_comparison?.node_summaries ?? [];
  const matchedStudents = data?.class_comparison?.matched_students ?? [];
  const sourceStatus = data?.source_status;
  const isModified = sourceStatus?.is_modified || data?.class_comparison?.is_source_modified;
  const isMissing = sourceStatus?.is_missing || data?.class_comparison?.is_source_missing;

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-800">靶向复练前后掌握率对照</h3>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            className="w-48 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            placeholder="输入复练批次 ID"
            value={pubIdInput}
            onChange={(e) => setPubIdInput(e.target.value)}
            aria-label="复练发布批次 ID"
          />
          <button
            type="submit"
            disabled={loading || !pubIdInput.trim()}
            className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            查询
          </button>
        </form>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-xs text-slate-500">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-500" />
          正在计算前后掌握率对照...
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && !data && (
        <div className="py-6 text-center text-xs text-slate-400">
          输入关联靶向练习的发布批次 ID 后，可查看本次诊断首考与后续复练的知识点掌握率对比。
        </div>
      )}

      {!loading && !error && data && (
        <div className="mt-4 space-y-4">
          {/* Status notices */}
          {isModified && (
            <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <span className="font-semibold">来源首考成绩已被复核修改：</span>
                对比基线仍严格保持生成练习时的冻结原值，已标注修改差异。
              </div>
            </div>
          )}

          {isMissing && (
            <div className="flex items-center gap-2 rounded border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <span className="font-semibold">来源考试或批次缺失：</span>
                来源数据已被删除或撤回，历史基线已无法进行有效可比性校验。
              </div>
            </div>
          )}

          {/* Metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-slate-500" />
              <span>
                配对样本数：<strong className="text-slate-800">{matchedStudents.length}</strong> 人
              </span>
            </div>
            <div>
              复练批次：<span className="font-mono text-slate-700">{activePubId}</span>
            </div>
          </div>

          {/* Node summaries table */}
          {summaries.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400">暂无知识点对照统计数据</div>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-medium text-slate-600">
                  <tr>
                    <th className="px-3 py-2">知识点</th>
                    <th className="px-3 py-2 text-right">首考诊断掌握率</th>
                    <th className="px-3 py-2 text-right">靶向复练掌握率</th>
                    <th className="px-3 py-2 text-right">掌握率变化 (pp)</th>
                    <th className="px-3 py-2 text-center">配对样本</th>
                    <th className="px-3 py-2 text-center">题量对比 (前/后)</th>
                    <th className="px-3 py-2">状态 / 说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaries.map((s) => {
                    const delta = s.delta_percentage_points;
                    return (
                      <tr key={s.knowledge_node_id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {s.knowledge_node_id}
                          {s.is_modified && (
                            <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                              原分复核
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {s.pre_class_percentage !== null ? `${s.pre_class_percentage.toFixed(1)}%` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {s.post_class_percentage !== null ? `${s.post_class_percentage.toFixed(1)}%` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {delta !== null ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5",
                                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-600",
                              )}
                            >
                              {delta > 0 ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : delta < 0 ? (
                                <ArrowDownRight className="h-3 w-3" />
                              ) : (
                                <Minus className="h-3 w-3" />
                              )}
                              {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pp
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {s.matched_sample_size} 人
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {s.pre_question_count} 题 / {s.post_question_count} 题
                          {s.question_difference !== 0 && (
                            <span className="ml-1 text-[10px] text-slate-400">
                              ({s.question_difference > 0 ? `+${s.question_difference}` : s.question_difference})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {s.incomparable_reason ? (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
                              {s.incomparable_reason}
                            </span>
                          ) : s.status === "valid" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              可比
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                              {s.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Student breakdown toggle */}
          {Object.keys(data.student_comparisons || {}).length > 0 && (
            <div>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                onClick={() => setShowStudentDetails((v) => !v)}
              >
                {showStudentDetails ? "收起学生个人明细 ▲" : `查看学生个人明细 (${Object.keys(data.student_comparisons).length}人) ▼`}
              </button>

              {showStudentDetails && (
                <div className="mt-3 space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
                  {Object.entries(data.student_comparisons).map(([sid, sComp]) => (
                    <div key={sid} className="rounded bg-white p-2.5 shadow-sm text-xs">
                      <div className="font-semibold text-slate-700 mb-1">
                        学生 ID: <span className="font-mono">{sid}</span>
                        {sComp.status !== "valid" && (
                          <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                            {sComp.status}
                          </span>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100">
                        {sComp.node_comparisons.map((nc) => (
                          <div key={nc.knowledge_node_id} className="flex flex-wrap items-center justify-between py-1 text-slate-600">
                            <span className="font-medium text-slate-800">{nc.knowledge_node_id}</span>
                            <div className="flex items-center gap-3">
                              <span>
                                前: {nc.pre_percentage !== null ? `${nc.pre_percentage.toFixed(1)}%` : "-"}
                              </span>
                              <span>
                                后: {nc.post_percentage !== null ? `${nc.post_percentage.toFixed(1)}%` : "-"}
                              </span>
                              <span className="font-semibold">
                                {nc.delta_percentage_points !== null
                                  ? `${nc.delta_percentage_points > 0 ? "+" : ""}${nc.delta_percentage_points.toFixed(1)} pp`
                                  : (nc.incomparable_reason || "-")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
