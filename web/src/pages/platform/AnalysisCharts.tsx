import type { PlatformPaperAnalysis } from "../../platform/auth";
import { G52Pill } from "../../ui-redesign/g52/G52UIComponents";
import "../../ui-redesign/g52/g52-design-tokens.css";

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

export function formatAnalysisDuration(seconds: number | null | undefined): string {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.round(value / 60)} 分钟`;
  return `${(value / 3600).toFixed(1)} 小时`;
}

function riskLabel(level?: string | null): string {
  return (
    ({ low: "低风险", medium: "中风险", high: "高风险" } as Record<string, string>)[
      String(level || "").toLowerCase()
    ] ??
    level ??
    "-"
  );
}

function classDisplayName(name: string, grade?: string | null): string {
  return grade && !name.includes(grade) ? `${name} · ${grade}` : name;
}

function clampPercent(value: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(value ?? 0)));
}

const RADAR_LABELS: Record<string, string> = {
  completion: "完成率",
  score: "得分率",
  time_efficiency: "时间效率",
  proctoring: "考试行为稳定度",
  module_mastery: "模块掌握度",
};

function makeScoreBuckets(analysis: PlatformPaperAnalysis): Bucket[] {
  const students = analysis.students.filter((student) => student.score_percent != null);
  const ranges = [
    { label: "0-50%", min: 0, max: 50, color: "bg-rose-500" },
    { label: "51-70%", min: 51, max: 70, color: "bg-amber-500" },
    { label: "71-85%", min: 71, max: 85, color: "bg-[var(--or-primary)]" },
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
    { label: "31-60 分钟", min: 31, max: 60, color: "bg-[var(--or-primary)]" },
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
    { label: "未开始", value: analysis.summary.not_started_students, color: "bg-[var(--or-outline)]" },
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
            <span className="truncate text-[var(--or-muted)] font-medium">{row.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--or-block)]">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${width}%` }} />
            </div>
            <span className="text-right font-semibold text-[var(--or-text)]">{row.value} 人</span>
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
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--or-block)]">
        {rows.map((row) => (
          <div key={row.label} className={row.color} style={{ width: `${percent(row.value, denominator)}%` }} />
        ))}
      </div>
      <div className="mt-3.5 grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-2.5 text-xs">
            <div className="flex items-center gap-1.5 text-[var(--or-muted)]">
              <span className={`h-2 w-2 rounded-full ${row.color}`} />
              <span className="font-medium">{row.label}</span>
            </div>
            <p className="mt-1 font-semibold text-[var(--or-text)] text-sm">
              {row.value} 人 · {percent(row.value, denominator)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RadarChart({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const axes = (analysis.radar ?? []).map((axis) => ({
    ...axis,
    label: RADAR_LABELS[axis.id] ?? axis.label,
  }));
  if (axes.length < 3) {
    return <p className="text-sm text-[var(--or-muted)] py-4 text-center">暂无雷达图数据</p>;
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
    <div
      className="grid min-w-0 gap-4 overflow-hidden md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
      data-testid="paper-analysis-radar"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[220px]">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <circle key={scale} cx={center} cy={center} r={radius * scale} fill="none" stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {points.map((item) => (
          <g key={item.axis.id}>
            <line x1={center} y1={center} x2={item.line.x} y2={item.line.y} stroke="#cbd5e1" strokeWidth="1" />
            <text
              x={item.label.x}
              y={item.label.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-500 text-[10px] font-medium"
            >
              {item.axis.label}
            </text>
          </g>
        ))}
        <polygon points={polygon} fill="#007aff" fillOpacity="0.14" stroke="#007aff" strokeWidth="2" />
        {points.map((item) => (
          <circle key={`${item.axis.id}:point`} cx={item.point.x} cy={item.point.y} r="3" fill="#007aff" />
        ))}
      </svg>
      <div className="min-w-0 space-y-2.5 self-center">
        {axes.map((axis) => (
          <div key={axis.id} className="grid min-w-0 grid-cols-[minmax(0,96px)_minmax(40px,1fr)_36px] items-center gap-2 text-xs">
            <span className="truncate text-[var(--or-muted)] font-medium">{axis.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--or-block)]">
              <div className="h-full rounded-full bg-[var(--or-primary)]" style={{ width: `${clampPercent(axis.value)}%` }} />
            </div>
            <span className="text-right font-semibold text-[var(--or-text)]">{Math.round(axis.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuleReport({ analysis }: { analysis: PlatformPaperAnalysis }) {
  const modules = analysis.modules ?? [];
  if (modules.length === 0) {
    return <p className="text-sm text-[var(--or-muted)] py-4 text-center">暂无模块级报告数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-modules">
      <table className="min-w-[680px] w-full or-g52-table">
        <thead>
          <tr>
            <th className="font-semibold">模块</th>
            <th className="text-right font-semibold">题数</th>
            <th className="text-right font-semibold">作答</th>
            <th className="text-right font-semibold">得分率</th>
            <th className="text-right font-semibold">正确率</th>
            <th className="text-right font-semibold">风险</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((item) => (
            <tr key={item.module_id}>
              <td className="font-medium text-[var(--or-text)]">{item.label || item.module_id}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.question_count}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.answered_count}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.average_score_percent == null ? "-" : `${Math.round(item.average_score_percent)}%`}
              </td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.accuracy_rate == null ? "-" : `${Math.round(item.accuracy_rate)}%`}
              </td>
              <td className="text-right">
                <G52Pill
                  variant={
                    item.risk_level === "high"
                      ? "error"
                      : item.risk_level === "medium"
                        ? "warning"
                        : "success"
                  }
                >
                  {riskLabel(item.risk_level)}
                </G52Pill>
              </td>
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
    return <p className="text-sm text-[var(--or-muted)] py-4 text-center">暂无班级维度数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-classes">
      <table className="min-w-[720px] w-full or-g52-table">
        <thead>
          <tr>
            <th className="font-semibold">班级</th>
            <th className="text-right font-semibold">人数</th>
            <th className="text-right font-semibold">完成率</th>
            <th className="text-right font-semibold">平均分</th>
            <th className="text-right font-semibold">平均耗时</th>
            <th className="text-right font-semibold">切屏</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.class_id}>
              <td className="font-medium text-[var(--or-text)]">
                {classDisplayName(item.class_name, item.class_grade)}
              </td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.student_count}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">{Math.round(item.completion_rate)}%</td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.average_score == null ? "-" : `${Math.round(item.average_score)}%`}
              </td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.average_time_seconds == null ? "-" : formatAnalysisDuration(item.average_time_seconds)}
              </td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.screen_switch_count}</td>
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
    return <p className="text-sm text-[var(--or-muted)] py-4 text-center">暂无题目维度数据</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="paper-analysis-questions">
      <table className="min-w-[860px] w-full or-g52-table">
        <thead>
          <tr>
            <th className="font-semibold">题目</th>
            <th className="font-semibold">模块</th>
            <th className="text-right font-semibold">作答</th>
            <th className="text-right font-semibold">已批</th>
            <th className="text-right font-semibold">正确率</th>
            <th className="text-right font-semibold">得分率</th>
            <th className="text-right font-semibold">风险</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.question_id}>
              <td className="max-w-[320px]">
                <div className="font-semibold text-[var(--or-text)]">{item.header || item.question_id}</div>
                <div className="truncate text-xs text-[var(--or-muted)] mt-0.5">{item.content || item.question_id}</div>
              </td>
              <td className="text-[var(--or-muted)]">{item.section_id || "-"}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.answered_count}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">{item.scored_count}</td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.accuracy_rate == null ? "-" : `${Math.round(item.accuracy_rate)}%`}
              </td>
              <td className="text-right text-[var(--or-muted)] font-mono">
                {item.average_score_percent == null ? "-" : `${Math.round(item.average_score_percent)}%`}
              </td>
              <td className="text-right">
                <G52Pill
                  variant={
                    item.risk_level === "high"
                      ? "error"
                      : item.risk_level === "medium"
                        ? "warning"
                        : "success"
                  }
                >
                  {riskLabel(item.risk_level)}
                </G52Pill>
              </td>
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
    <div className="overflow-x-auto or-g52-surface-card" data-testid="paper-analysis-chart-table">
      <table className={`w-full or-g52-table ${compact ? "min-w-[840px]" : "min-w-[1020px]"}`}>
        <thead>
          <tr>
            <th className="font-semibold">学生</th>
            <th className="font-semibold">班级</th>
            <th className="text-right font-semibold">状态</th>
            <th className="font-semibold">得分表现</th>
            <th className="text-right font-semibold">用时</th>
            <th className="text-right font-semibold">切屏</th>
            <th className="text-right font-semibold">需关注行为</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => {
            const score = student.score_percent == null ? null : clampPercent(student.score_percent);
            return (
              <tr key={`${student.publication_id ?? ""}:${student.student_id}`}>
                <td>
                  <div className="font-semibold text-[var(--or-text)]">{student.display_name}</div>
                  <div className="text-xs text-[var(--or-muted)] font-mono">{student.student_no || student.account_username || "-"}</div>
                </td>
                <td className="text-[var(--or-muted)]">{(student.class_names ?? []).join("、") || "-"}</td>
                <td className="text-right">
                  <G52Pill
                    variant={
                      student.status === "completed"
                        ? "success"
                        : student.status === "in_progress"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {student.status === "completed" ? "已完成" : student.status === "in_progress" ? "答题中" : "未开始"}
                  </G52Pill>
                </td>
                <td>
                  <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-2">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--or-block)]">
                      <div
                        className={score == null ? "h-full bg-[var(--or-outline)]" : "h-full rounded-full bg-[var(--or-primary)]"}
                        style={{ width: `${score ?? 0}%` }}
                      />
                    </div>
                    <span className="text-right font-mono text-xs font-medium text-[var(--or-muted)]">
                      {score == null ? "-" : `${score}%`}
                    </span>
                  </div>
                </td>
                <td className="text-right text-[var(--or-muted)] font-mono">
                  {formatAnalysisDuration(student.time_spent_seconds)}
                </td>
                <td className="text-right">
                  <G52Pill variant={student.screen_switch_exceeded ? "error" : "success"}>
                    {student.screen_switch_count}/{student.screen_switch_limit ?? 0}
                  </G52Pill>
                </td>
                <td className="text-right">
                  {(() => {
                    const risk = Number(student.integrity_risk_score ?? 0);
                    const label = risk >= 60 ? "高风险" : risk >= 30 ? "需关注" : "低风险";
                    const variant = risk >= 60 ? "error" : risk >= 30 ? "warning" : "success";
                    return (
                      <G52Pill variant={variant} title="仅作为行为信号，需教师结合实际情况复核">
                        {risk} · {label}
                      </G52Pill>
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

  return (
    <div className="space-y-6" data-testid="paper-analysis-charts">
      <div className={`grid gap-4 ${compact ? "grid-cols-1" : "lg:grid-cols-3"}`}>
        <section className="or-g52-surface-card p-5" data-testid="paper-analysis-chart-status">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">答题进度分布</h4>
          <div className="mt-4">
            <SegmentedStatus rows={statusRows} total={total} />
          </div>
        </section>
        <section className="or-g52-surface-card p-5" data-testid="paper-analysis-chart-score">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">分数区间分布</h4>
          <div className="mt-4">
            <BarRows rows={scoreRows} total={Math.max(analysis.students.length, 1)} />
          </div>
        </section>
        <section className="or-g52-surface-card p-5" data-testid="paper-analysis-chart-time">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">耗时区间分布</h4>
          <div className="mt-4">
            <BarRows rows={timeRows} total={Math.max(analysis.students.length, 1)} />
          </div>
        </section>
      </div>

      <section className="or-g52-surface-card p-5">
        <p className="mb-4 rounded-xl bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] px-3.5 py-2.5 text-xs text-[var(--or-muted)] leading-relaxed">
          风险等级说明：低风险表示当前数据较稳定；中风险建议关注；高风险需要教师结合答卷和课堂情况复核。风险是提示，不是对学生的定性。
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5">
            <p className="text-xs font-medium text-[var(--or-muted)]">完成率</p>
            <p className="mt-1 text-xl font-bold text-[var(--or-text)]">{analysis.summary.completion_rate}%</p>
          </div>
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5">
            <p className="text-xs font-medium text-[var(--or-muted)]">平均得分率</p>
            <p className="mt-1 text-xl font-bold text-[var(--or-text)]">{analysis.summary.average_score ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5">
            <p className="text-xs font-medium text-[var(--or-muted)]">切屏次数</p>
            <p className="mt-1 text-xl font-bold text-[var(--or-text)]">{analysis.proctoring.screen_switch_count}</p>
          </div>
          <div className="rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5">
            <p className="text-xs font-medium text-[var(--or-muted)]">超限学生</p>
            <p className="mt-1 text-xl font-bold text-[var(--or-text)]">
              {analysis.proctoring.exceeded_student_count ?? analysis.proctoring.flagged_student_count}
            </p>
          </div>
        </div>
      </section>

      <div className={`grid min-w-0 gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"}`}>
        <section className="min-w-0 overflow-hidden or-g52-surface-card p-5">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">雷达 / 蜘蛛图</h4>
          <div className="mt-3.5">
            <RadarChart analysis={analysis} />
          </div>
        </section>
        <section className="or-g52-surface-card p-5">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">模块级报告</h4>
          <div className="mt-3.5">
            <ModuleReport analysis={analysis} />
          </div>
        </section>
      </div>

      <div className={`grid gap-4 ${compact ? "grid-cols-1" : "xl:grid-cols-2"}`}>
        <section className="or-g52-surface-card p-5">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">班级维度报表</h4>
          <div className="mt-3.5">
            <ClassReport analysis={analysis} />
          </div>
        </section>
        <section className="or-g52-surface-card p-5">
          <h4 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">题目维度报表</h4>
          <div className="mt-3.5">
            <QuestionReport analysis={analysis} />
          </div>
        </section>
      </div>

      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h4 className="text-base font-semibold text-[var(--or-text)] tracking-tight">学生个人分析表</h4>
          <span className="text-xs text-[var(--or-muted)]">含得分、耗时、切屏与考试行为稳定度（仅供教师复核，不自动判定作弊）</span>
        </div>
        {analysis.students.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--or-outline)] p-6 text-center text-sm text-[var(--or-muted)]">
            暂无学生作答数据
          </p>
        ) : (
          <StudentRows analysis={analysis} compact={compact} />
        )}
      </section>
    </div>
  );
}
