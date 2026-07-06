import type { PlatformPaperAnalysis } from "../../platform/auth";

type Bucket = {
  label: string;
  value: number;
  color: string;
};

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function minutes(seconds: number | null | undefined): number {
  return Math.round(Number(seconds || 0) / 60);
}

function clampPercent(value: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(value ?? 0)));
}

function makeScoreBuckets(analysis: PlatformPaperAnalysis): Bucket[] {
  const students = analysis.students.filter((student) => student.score_percent != null);
  const ranges = [
    { label: "0-50%", min: 0, max: 50, color: "bg-rose-500" },
    { label: "51-70%", min: 51, max: 70, color: "bg-amber-500" },
    { label: "71-85%", min: 71, max: 85, color: "bg-blue-500" },
    { label: "86-100%", min: 86, max: 100, color: "bg-emerald-500" },
  ];
  return ranges.map((range) => ({
    label: range.label,
    value: students.filter((student) => {
      const score = Number(student.score_percent ?? 0);
      return score >= range.min && score <= range.max;
    }).length,
    color: range.color,
  }));
}

function makeTimeBuckets(analysis: PlatformPaperAnalysis): Bucket[] {
  const students = analysis.students.filter((student) => Number(student.time_spent_seconds || 0) > 0);
  const ranges = [
    { label: "0-30 分钟", min: 0, max: 30, color: "bg-emerald-500" },
    { label: "31-60 分钟", min: 31, max: 60, color: "bg-blue-500" },
    { label: "1-2 小时", min: 61, max: 120, color: "bg-amber-500" },
    { label: "2 小时以上", min: 121, max: Number.POSITIVE_INFINITY, color: "bg-rose-500" },
  ];
  return ranges.map((range) => ({
    label: range.label,
    value: students.filter((student) => {
      const spent = minutes(student.time_spent_seconds);
      return spent >= range.min && spent <= range.max;
    }).length,
    color: range.color,
  }));
}

function makeStatusBuckets(analysis: PlatformPaperAnalysis): Bucket[] {
  return [
    { label: "已完成", value: analysis.summary.completed_students, color: "bg-emerald-500" },
    { label: "答题中", value: analysis.summary.in_progress_students, color: "bg-amber-500" },
    { label: "未开始", value: analysis.summary.not_started_students, color: "bg-slate-300" },
  ];
}

function BarRows({ rows, total }: { rows: Bucket[]; total: number }) {
  const denominator = Math.max(total, ...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const width = percent(row.value, denominator);
        return (
          <div key={row.label} className="grid grid-cols-[88px_minmax(0,1fr)_56px] items-center gap-2 text-xs">
            <span className="truncate text-slate-600">{row.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${width}%` }} />
            </div>
            <span className="text-right font-semibold text-slate-800">{row.value} 人</span>
          </div>
        );
      })}
    </div>
  );
}

function SegmentedStatus({ rows, total }: { rows: Bucket[]; total: number }) {
  const denominator = Math.max(total, 1);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {rows.map((row) => (
          <div key={row.label} className={row.color} style={{ width: `${percent(row.value, denominator)}%` }} />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md bg-slate-50 p-2 text-xs">
            <div className="flex items-center gap-2 text-slate-500">
              <span className={`h-2.5 w-2.5 rounded-full ${row.color}`} />
              {row.label}
            </div>
            <p className="mt-1 font-semibold text-slate-900">
              {row.value} 人 · {percent(row.value, denominator)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentRows({ analysis, compact }: { analysis: PlatformPaperAnalysis; compact?: boolean }) {
  const rows = [...analysis.students].sort((a, b) => clampPercent(b.score_percent) - clampPercent(a.score_percent));
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white" data-testid="paper-analysis-chart-table">
      <table className={`w-full text-sm ${compact ? "min-w-[760px]" : "min-w-[920px]"}`}>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">学生</th>
            <th className="px-3 py-2 text-left font-medium">班级</th>
            <th className="px-3 py-2 text-right font-medium">状态</th>
            <th className="px-3 py-2 text-left font-medium">得分表现</th>
            <th className="px-3 py-2 text-right font-medium">用时</th>
            <th className="px-3 py-2 text-right font-medium">切屏</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((student) => {
            const score = student.score_percent == null ? null : clampPercent(student.score_percent);
            return (
              <tr key={`${student.publication_id ?? ""}:${student.student_id}`} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{student.display_name}</div>
                  <div className="text-xs text-slate-400">{student.student_no || student.account_username || "-"}</div>
                </td>
                <td className="px-3 py-2 text-slate-500">{(student.class_names ?? []).join("、") || "-"}</td>
                <td className="px-3 py-2 text-right text-slate-600">
                  {student.status === "completed" ? "已完成" : student.status === "in_progress" ? "答题中" : "未开始"}
                </td>
                <td className="px-3 py-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-2">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={score == null ? "h-full bg-slate-300" : "h-full rounded-full bg-slate-900"}
                        style={{ width: `${score ?? 0}%` }}
                      />
                    </div>
                    <span className="text-right font-mono text-xs text-slate-700">{score == null ? "-" : `${score}%`}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{minutes(student.time_spent_seconds)} 分钟</td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      student.screen_switch_exceeded ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {student.screen_switch_count}/{student.screen_switch_limit ?? 0}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlatformPaperAnalysisCharts({
  analysis,
  compact = false,
}: {
  analysis: PlatformPaperAnalysis;
  compact?: boolean;
}) {
  const total = Math.max(analysis.summary.total_students, analysis.students.length, 0);
  const statusRows = makeStatusBuckets(analysis);
  const scoreRows = makeScoreBuckets(analysis);
  const timeRows = makeTimeBuckets(analysis);
  const completed = analysis.students.filter((student) => student.status === "completed");
  const avgTimeMinutes =
    completed.length > 0
      ? Math.round(
          completed.reduce((sum, student) => sum + Number(student.time_spent_seconds || 0), 0) /
            completed.length /
            60,
        )
      : 0;

  return (
    <div className="space-y-4" data-testid="paper-analysis-charts">
      <div className={`grid gap-3 ${compact ? "grid-cols-1" : "lg:grid-cols-3"}`}>
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="paper-analysis-chart-status">
          <h4 className="text-sm font-semibold text-slate-900">答题进度分布</h4>
          <p className="mt-1 text-xs text-slate-500">对应 PublicQ 的 Exam Taker Progress Distribution。</p>
          <div className="mt-4">
            <SegmentedStatus rows={statusRows} total={total} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="paper-analysis-chart-score">
          <h4 className="text-sm font-semibold text-slate-900">分数区间分布</h4>
          <p className="mt-1 text-xs text-slate-500">按 0-50、51-70、71-85、86-100 聚合。</p>
          <div className="mt-4">
            <BarRows rows={scoreRows} total={Math.max(analysis.students.length, 1)} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="paper-analysis-chart-time">
          <h4 className="text-sm font-semibold text-slate-900">耗时区间分布</h4>
          <p className="mt-1 text-xs text-slate-500">平均耗时 {avgTimeMinutes || "-"} 分钟。</p>
          <div className="mt-4">
            <BarRows rows={timeRows} total={Math.max(analysis.students.length, 1)} />
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs text-slate-500">完成率</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{analysis.summary.completion_rate}%</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs text-slate-500">平均得分率</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{analysis.summary.average_score ?? "-"}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs text-slate-500">切屏次数</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{analysis.proctoring.screen_switch_count}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs text-slate-500">超限学生</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {analysis.proctoring.exceeded_student_count ?? analysis.proctoring.flagged_student_count}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900">学生个人分析表</h4>
          <span className="text-xs text-slate-500">含得分、耗时、切屏超限</span>
        </div>
        {analysis.students.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无学生作答数据</p>
        ) : (
          <StudentRows analysis={analysis} compact={compact} />
        )}
      </section>
    </div>
  );
}
