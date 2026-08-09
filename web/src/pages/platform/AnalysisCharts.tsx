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

function RadarChart({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const axes = analysis.radar ?? [];
  if (axes.length < 3) {
    return <p className="text-sm text-slate-500">暂无雷达图数据</p>;
  }
  const size = 220;
  const center = size / 2;
  const radius = 76;
  const points = axes.map((axis, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
    const valueRadius = (clampPercent(axis.value) / 100) * radius;
    return {
      axis,
      line: {
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
      },
      point: {
        x: center + Math.cos(angle) * valueRadius,
        y: center + Math.sin(angle) * valueRadius,
      },
      label: {
        x: center + Math.cos(angle) * (radius + 24),
        y: center + Math.sin(angle) * (radius + 24),
      },
    };
  });
  const polygon = points.map((item) => `${item.point.x},${item.point.y}`).join(" ");
  return (
    <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]" data-testid="paper-analysis-radar">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[220px] w-[220px]">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <circle key={scale} cx={center} cy={center} r={radius * scale} fill="none" stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {points.map((item) => (
          <g key={item.axis.id}>
            <line x1={center} y1={center} x2={item.line.x} y2={item.line.y} stroke="#cbd5e1" strokeWidth="1" />
            <text x={item.label.x} y={item.label.y} textAnchor="middle" dominantBaseline="middle" className="fill-slate-500 text-[10px]">
              {item.axis.label}
            </text>
          </g>
        ))}
        <polygon points={polygon} fill="#0f172a" fillOpacity="0.16" stroke="#0f172a" strokeWidth="2" />
        {points.map((item) => (
          <circle key={`${item.axis.id}:point`} cx={item.point.x} cy={item.point.y} r="3" fill="#0f172a" />
        ))}
      </svg>
      <div className="space-y-2">
        {axes.map((axis) => (
          <div key={axis.id} className="grid grid-cols-[120px_minmax(0,1fr)_44px] items-center gap-2 text-xs">
            <span className="truncate text-slate-600">{axis.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-900" style={{ width: `${clampPercent(axis.value)}%` }} />
            </div>
            <span className="text-right font-semibold text-slate-800">{Math.round(axis.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuleReport({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const modules = analysis.modules ?? [];
  if (modules.length === 0) {
    return <p className="text-sm text-slate-500">暂无模块级报告数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-modules">
      <table className="min-w-[680px] w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">模块</th>
            <th className="px-3 py-2 text-right font-medium">题数</th>
            <th className="px-3 py-2 text-right font-medium">作答</th>
            <th className="px-3 py-2 text-right font-medium">得分率</th>
            <th className="px-3 py-2 text-right font-medium">正确率</th>
            <th className="px-3 py-2 text-right font-medium">风险</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {modules.map((item) => (
            <tr key={item.module_id}>
              <td className="px-3 py-2 font-medium text-slate-800">{item.label || item.module_id}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.question_count}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.answered_count}</td>
              <td className="px-3 py-2 text-right text-slate-600">
                {item.average_score_percent == null ? "-" : `${Math.round(item.average_score_percent)}%`}
              </td>
              <td className="px-3 py-2 text-right text-slate-600">
                {item.accuracy_rate == null ? "-" : `${Math.round(item.accuracy_rate)}%`}
              </td>
              <td className="px-3 py-2 text-right text-slate-600">{item.risk_level || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassReport({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const rows = analysis.classes ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无班级维度数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-classes">
      <table className="min-w-[720px] w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">班级</th>
            <th className="px-3 py-2 text-right font-medium">人数</th>
            <th className="px-3 py-2 text-right font-medium">完成率</th>
            <th className="px-3 py-2 text-right font-medium">平均分</th>
            <th className="px-3 py-2 text-right font-medium">平均耗时</th>
            <th className="px-3 py-2 text-right font-medium">切屏</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((item) => (
            <tr key={item.class_id}>
              <td className="px-3 py-2 font-medium text-slate-800">
                {item.class_name}
                {item.class_grade ? <span className="ml-2 text-xs font-normal text-slate-400">{item.class_grade}</span> : null}
              </td>
              <td className="px-3 py-2 text-right text-slate-600">{item.student_count}</td>
              <td className="px-3 py-2 text-right text-slate-600">{Math.round(item.completion_rate)}%</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.average_score == null ? "-" : `${Math.round(item.average_score)}%`}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.average_time_seconds == null ? "-" : `${minutes(item.average_time_seconds)} 分钟`}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.screen_switch_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionReport({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const rows = analysis.questions ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无题目维度数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-questions">
      <table className="min-w-[860px] w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">题目</th>
            <th className="px-3 py-2 text-left font-medium">模块</th>
            <th className="px-3 py-2 text-right font-medium">作答</th>
            <th className="px-3 py-2 text-right font-medium">已批</th>
            <th className="px-3 py-2 text-right font-medium">正确率</th>
            <th className="px-3 py-2 text-right font-medium">得分率</th>
            <th className="px-3 py-2 text-right font-medium">风险</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((item) => (
            <tr key={item.question_id}>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-800">{item.header || item.question_id}</div>
                <div className="max-w-[360px] truncate text-xs text-slate-400">{item.content || item.question_id}</div>
              </td>
              <td className="px-3 py-2 text-slate-600">{item.section_id || "-"}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.answered_count}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.scored_count}</td>
              <td className="px-3 py-2 text-right text-slate-600">{item.accuracy_rate == null ? "-" : `${Math.round(item.accuracy_rate)}%`}</td>
              <td className="px-3 py-2 text-right text-slate-600">
                {item.average_score_percent == null ? "-" : `${Math.round(item.average_score_percent)}%`}
              </td>
              <td className="px-3 py-2 text-right text-slate-600">{item.risk_level || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentRows({ analysis, compact }: { analysis: PlatformPaperAnalysis; compact?: boolean }) {
  const rows = [...analysis.students].sort((a, b) => clampPercent(b.score_percent) - clampPercent(a.score_percent));
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white" data-testid="paper-analysis-chart-table">
      <table className={`w-full text-sm ${compact ? "min-w-[840px]" : "min-w-[1020px]"}`}>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">学生</th>
            <th className="px-3 py-2 text-left font-medium">班级</th>
            <th className="px-3 py-2 text-right font-medium">状态</th>
            <th className="px-3 py-2 text-left font-medium">得分表现</th>
            <th className="px-3 py-2 text-right font-medium">用时</th>
            <th className="px-3 py-2 text-right font-medium">切屏</th>
            <th className="px-3 py-2 text-right font-medium">诚信风险</th>
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
                <td className="px-3 py-2 text-right">
                  {(() => {
                    const risk = Number(student.integrity_risk_score ?? 0);
                    const label = risk >= 60 ? "高风险" : risk >= 30 ? "需关注" : "低风险";
                    return (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                          risk >= 60
                            ? "bg-rose-100 text-rose-700"
                            : risk >= 30
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                        title="仅作为行为信号，需教师结合实际情况复核"
                      >
                        {risk} · {label}
                      </span>
                    );
                  })()}
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

      <div className={`grid gap-3 ${compact ? "grid-cols-1" : "lg:grid-cols-[420px_minmax(0,1fr)]"}`}>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">雷达 / 蜘蛛图</h4>
          <div className="mt-3">
            <RadarChart analysis={analysis} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">模块级报告</h4>
          <div className="mt-3">
            <ModuleReport analysis={analysis} />
          </div>
        </section>
      </div>

      <div className={`grid gap-3 ${compact ? "grid-cols-1" : "xl:grid-cols-2"}`}>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">班级维度报表</h4>
          <div className="mt-3">
            <ClassReport analysis={analysis} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">题目维度报表</h4>
          <div className="mt-3">
            <QuestionReport analysis={analysis} />
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900">学生个人分析表</h4>
          <span className="text-xs text-slate-500">含得分、耗时、切屏与可解释诚信风险（需人工复核）</span>
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
