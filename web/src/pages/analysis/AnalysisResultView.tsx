import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { type ScoreAnalysis } from "./analysisTypes";
import { SvgBarChart } from "./SvgBarChart";

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
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-slate-800">{analysis.student_count}</div>
          <div className="text-xs text-slate-500">{t("studentCount")}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">
            {(analysis.class_avg_ratio * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500">{t("classAvgRatio")}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {(analysis.class_avg_fuzzy * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500">{t("classAvgFuzzy")}</div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {(["overview", "questions", "nodes", "students", "diagnosis"] as const).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => onTabChange(tabKey)}
            className={cn(
              "border-b-2 px-4 py-1.5 text-sm transition-colors",
              tab === tabKey
                ? "border-blue-600 font-medium text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            {tabKey === "overview"
              ? t("tabOverview")
              : tabKey === "questions"
                ? t("tabQuestionErr")
                : tabKey === "nodes"
                  ? t("tabKnowledge")
                  : tabKey === "students"
                    ? t("tabRanking")
                    : t("tabDiagnosis")}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="space-y-4">
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
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                {t("knowledgeMissingTitle")}
              </h4>
              <ul className="space-y-1 text-sm text-amber-700">
                {analysis.warnings.map((w) => (
                  <li key={w.question_id}>
                    <span className="font-mono font-semibold">{w.header}</span>
                    {" — "}{w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "questions" && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            题目维度
            <select
              aria-label="按题组查看题目维度"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              value={questionSectionFilter}
              onChange={(event) => onQuestionSectionFilterChange(event.target.value)}
            >
              <option value="all">全部题组</option>
              {[...new Set(analysis.question_stats.map((question) => question.section_id))].map((sectionId) => (
                <option key={sectionId} value={sectionId}>
                  {sectionId}
                </option>
              ))}
            </select>
          </label>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("thQid")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("thSection")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("thFullScore")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("thAnswered")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("thAvgScore")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("thErrRate")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.question_stats
                  .filter((question) => questionSectionFilter === "all" || question.section_id === questionSectionFilter)
                  .map((q) => (
                    <tr key={q.question_id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-700">{q.header}</td>
                      <td className="px-3 py-2 text-slate-500">{q.section_id}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{q.score_per_item}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{q.answered_count}</td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {q.avg_raw_score !== null ? q.avg_raw_score.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {q.error_rate !== null ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-semibold"
                            style={{
                              backgroundColor: errorColorFn(q.error_rate) + "22",
                              color: errorColorFn(q.error_rate),
                            }}
                          >
                            {formatPct(q.error_rate)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
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
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-700">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              <p>
                {t("noKnowledgeStats")}
                <br />
                {t("bindInGraph")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
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
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("thNode")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("thBoundQ")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("thFuzzy")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("thErrRate")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysis.node_stats.map((n) => (
                      <tr key={n.node_id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-700">{n.node_id}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{n.bound_question_count}</td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {(n.mastery_fuzzy * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-semibold"
                            style={{
                              backgroundColor: errorColorFn(n.error_rate) + "22",
                              color: errorColorFn(n.error_rate),
                            }}
                          >
                            {formatPct(n.error_rate)}
                          </span>
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
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right font-medium">{t("thRank")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("thName")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("thStudentId")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("thRawTotal")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("thScoreRate")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("thFuzzyScore")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...analysis.student_stats]
                .sort((a, b) => a.rank - b.rank)
                .map((s) => (
                  <tr key={`${s.name}-${s.student_id}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-right">
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold",
                          s.rank <= 3
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {s.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700">{s.name}</td>
                    <td className="px-3 py-2 text-slate-500">{s.student_id}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">
                      {s.raw_total}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="rounded px-1.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700">
                        {formatPct(s.score_ratio)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="rounded px-1.5 py-0.5 text-xs font-semibold bg-purple-100 text-purple-700">
                        {formatPct(s.fuzzy_score)}
                      </span>
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
