import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Users, Target, Award } from "lucide-react";
import { cn } from "../../lib/utils";
import { type ScoreAnalysis } from "./analysisTypes";
import { SvgBarChart } from "./SvgBarChart";
import { G52StatCard, G52Pill } from "../../ui-redesign/g52/G52UIComponents";
import "../../ui-redesign/g52/g52-design-tokens.css";
import { Select as AppSelect } from "../../components/ui/select";

interface AnalysisResultViewProps {
  analysis: ScoreAnalysis;
  tab: "overview" | "questions" | "nodes" | "students" | "diagnosis";
  onTabChange: (tab: "overview" | "questions" | "nodes" | "students" | "diagnosis") => void;
  questionSectionFilter: string;
  onQuestionSectionFilterChange: (section: string) => void;
  errorColorFn: (v: number, warn?: boolean) => string;
  formatPct: (v: number) => string;
  children?: React.ReactNode;
}

export function AnalysisResultView({
  analysis,
  tab,
  onTabChange,
  questionSectionFilter,
  onQuestionSectionFilterChange,
  errorColorFn,
  formatPct,
  children,
}: AnalysisResultViewProps) {
  const { t } = useTranslation("analysis");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
      {/* Summary cards - Static surfaces, no hover lift, clean metrics */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">
        <G52StatCard
          label={t("studentCount")}
          value={analysis.student_count}
          icon={<Users className="h-5 w-5" />}
          valueClassName="text-[var(--or-text)]"
        />
        <G52StatCard
          label={t("classAvgRatio")}
          value={`${(analysis.class_avg_ratio * 100).toFixed(1)}%`}
          icon={<Target className="h-5 w-5 text-[var(--or-on-container)]" />}
          valueClassName="text-[var(--or-on-container)]"
        />
        <G52StatCard
          label={t("classAvgFuzzy")}
          value={`${(analysis.class_avg_fuzzy * 100).toFixed(1)}%`}
          icon={<Award className="h-5 w-5 text-purple-600" />}
          valueClassName="text-purple-600"
        />
      </div>

      {/* Tab navigation */}
      <div className="or-g52-tabs">
        {(["overview", "questions", "nodes", "students", "diagnosis"] as const).map((tabKey) => {
          const isActive = tab === tabKey;
          const label =
            tabKey === "overview"
              ? t("tabOverview")
              : tabKey === "questions"
                ? t("tabQuestionErr")
                : tabKey === "nodes"
                  ? t("tabKnowledge")
                  : tabKey === "students"
                    ? t("tabRanking")
                    : t("tabDiagnosis");

          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => onTabChange(tabKey)}
              className={cn("or-g52-tab", isActive && "or-g52-tab-active")}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="space-y-5">
          <SvgBarChart
            data={analysis.question_stats
              .filter((q) => q.error_rate !== null)
              .slice(0, 20)
              .map((q) => ({
                label: q.header,
                value: q.error_rate ?? 0,
              }))}
            title={t("chartQuestionErr")}
            colorFn={(v) => errorColorFn(v)}
            maxVal={1}
            formatVal={formatPct}
          />
          {analysis.node_stats.length > 0 && (
            <SvgBarChart
              data={analysis.node_stats.map((n) => ({
                label: n.node_id.split("/").pop() ?? n.node_id,
                value: n.error_rate,
              }))}
              title={t("chartKnowledgeErr")}
              colorFn={(v) => errorColorFn(v)}
              maxVal={1}
              formatVal={formatPct}
              warning={t("knowledgeBindHint")}
            />
          )}
          {analysis.warnings.length > 0 && (
            <div className="rounded-2xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] p-5 text-[var(--or-on-warning)] shadow-xs">
              <h4 className="mb-2 flex items-center gap-2 text-base font-semibold text-[var(--or-on-warning)]">
                <AlertTriangle className="h-5 w-5 text-[var(--or-on-warning)]" />
                {t("knowledgeMissingTitle")}
              </h4>
              <ul className="space-y-1.5 text-sm text-[var(--or-on-warning)]">
                {analysis.warnings.map((w) => (
                  <li key={w.question_id} className="flex items-center gap-2">
                    <span className="font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--or-warning-container)] text-[var(--or-on-warning)] text-xs">
                      {w.header}
                    </span>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "questions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-sm font-medium text-[var(--or-muted)]">
              <span>题目维度</span>
              <AppSelect
                aria-label="按题组查看题目维度"
                className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-sm font-normal text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
                value={questionSectionFilter}
                onValueChange={(value) => onQuestionSectionFilterChange(value)}
              >
                <option value="all">全部题组</option>
                {[...new Set(analysis.question_stats.map((question) => question.section_id))].map((sectionId) => (
                  <option key={sectionId} value={sectionId}>
                    {sectionId}
                  </option>
                ))}
              </AppSelect>
            </label>
          </div>
          <div className="or-g52-surface-card overflow-x-auto">
            <table className="or-g52-table">
              <thead>
                <tr>
                  <th className="font-semibold">{t("thQid")}</th>
                  <th className="font-semibold">{t("thSection")}</th>
                  <th className="text-right font-semibold">{t("thFullScore")}</th>
                  <th className="text-right font-semibold">{t("thAnswered")}</th>
                  <th className="text-right font-semibold">{t("thAvgScore")}</th>
                  <th className="text-right font-semibold">{t("thErrRate")}</th>
                </tr>
              </thead>
              <tbody>
                {analysis.question_stats
                  .filter((question) => questionSectionFilter === "all" || question.section_id === questionSectionFilter)
                  .map((q) => (
                    <tr key={q.question_id}>
                      <td className="font-mono font-semibold text-[var(--or-text)]">{q.header}</td>
                      <td className="text-[var(--or-muted)]">{q.section_id}</td>
                      <td className="text-right text-[var(--or-muted)]">{q.score_per_item}</td>
                      <td className="text-right text-[var(--or-muted)]">{q.answered_count}</td>
                      <td className="text-right text-[var(--or-muted)]">
                        {q.avg_raw_score !== null ? q.avg_raw_score.toFixed(2) : "—"}
                      </td>
                      <td className="text-right">
                        {q.error_rate !== null ? (
                          <G52Pill
                            style={{
                              backgroundColor: errorColorFn(q.error_rate) + "18",
                              color: errorColorFn(q.error_rate),
                              borderColor: errorColorFn(q.error_rate) + "33",
                            }}
                          >
                            {formatPct(q.error_rate)}
                          </G52Pill>
                        ) : (
                          <span className="text-[var(--or-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "nodes" && (
        <div>
          {analysis.node_stats.length === 0 ? (
            <div className="rounded-2xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_50%,transparent)] p-8 text-center text-sm text-[var(--or-on-warning)]">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-[var(--or-on-warning)]" />
              <p className="font-medium text-base text-[var(--or-on-warning)]">{t("noKnowledgeStats")}</p>
              <p className="mt-1.5 text-xs text-[var(--or-on-warning)]">{t("bindInGraph")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <SvgBarChart
                data={analysis.node_stats.map((n) => ({
                  label: n.node_id.split("/").pop() ?? n.node_id,
                  value: n.error_rate,
                }))}
                title={t("chartKnowledgeTitle")}
                colorFn={(v) => errorColorFn(v)}
                maxVal={1}
                formatVal={formatPct}
              />
              <div className="or-g52-surface-card overflow-x-auto">
                <table className="or-g52-table">
                  <thead>
                    <tr>
                      <th className="font-semibold">{t("thNode")}</th>
                      <th className="text-right font-semibold">{t("thBoundQ")}</th>
                      <th className="text-right font-semibold">{t("thFuzzy")}</th>
                      <th className="text-right font-semibold">{t("thErrRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.node_stats.map((n) => (
                      <tr key={n.node_id}>
                        <td className="font-mono text-[var(--or-text)]">{n.node_id}</td>
                        <td className="text-right text-[var(--or-muted)]">{n.bound_question_count}</td>
                        <td className="text-right text-[var(--or-muted)]">
                          {(n.mastery_fuzzy * 100).toFixed(1)}%
                        </td>
                        <td className="text-right">
                          <G52Pill
                            style={{
                              backgroundColor: errorColorFn(n.error_rate) + "18",
                              color: errorColorFn(n.error_rate),
                              borderColor: errorColorFn(n.error_rate) + "33",
                            }}
                          >
                            {formatPct(n.error_rate)}
                          </G52Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "students" && (
        <div className="or-g52-surface-card overflow-x-auto">
          <table className="or-g52-table">
            <thead>
              <tr>
                <th className="w-16 text-center font-semibold">{t("thRank")}</th>
                <th className="font-semibold">{t("thName")}</th>
                <th className="font-semibold">{t("thStudentId")}</th>
                <th className="text-right font-semibold">{t("thRawTotal")}</th>
                <th className="text-right font-semibold">{t("thScoreRate")}</th>
                <th className="text-right font-semibold">{t("thFuzzyScore")}</th>
              </tr>
            </thead>
            <tbody>
              {[...analysis.student_stats]
                .sort((a, b) => a.rank - b.rank)
                .map((s) => (
                  <tr key={`${s.name}-${s.student_id}`}>
                    <td className="text-center">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold leading-none",
                          s.rank <= 3
                            ? "bg-[var(--or-warning-container)] text-[var(--or-on-warning)] border border-[var(--or-warning)]"
                            : "bg-[var(--or-block)] text-[var(--or-muted)]",
                        )}
                      >
                        {s.rank}
                      </span>
                    </td>
                    <td className="font-medium text-[var(--or-text)]">{s.name}</td>
                    <td className="text-[var(--or-muted)] font-mono text-xs">{s.student_id}</td>
                    <td className="text-right font-mono font-medium text-[var(--or-muted)]">
                      {s.raw_total}
                    </td>
                    <td className="text-right">
                      <G52Pill variant="primary">
                        {formatPct(s.score_ratio)}
                      </G52Pill>
                    </td>
                    <td className="text-right">
                      <G52Pill
                        style={{
                          backgroundColor: "#f3e8ff",
                          color: "#7e22ce",
                        }}
                      >
                        {formatPct(s.fuzzy_score)}
                      </G52Pill>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "diagnosis" && children}
    </div>
  );
}
