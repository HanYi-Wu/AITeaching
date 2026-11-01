import { useTranslation } from "react-i18next";
import { FileSpreadsheet, RefreshCw, Sparkles, AlertCircle } from "lucide-react";
import { SvgBarChart } from "./SvgBarChart";
import { AnalysisComparisonCard } from "./AnalysisComparisonCard";
import {
  type AnalysisRemediationDraftPreviewResponse,
  type AnalysisRemediationDraftResponse,
} from "../../api/client";
import "../../ui-redesign/g52/g52-design-tokens.css";
import { Select as AppSelect } from "../../components/ui/select";

interface AnalysisDiagnosisPanelProps {
  selectedExamId: string | null;
  selectedBatchId: string | null;
  diagLoading: boolean;
  diagKd: any;
  diagHeat: any;
  diagSug: any;
  diagStudents: any[];
  diagStudentPick: string;
  onStudentPickChange: (studentId: string) => void;
  remediationBusy: boolean;
  remediationPreview: AnalysisRemediationDraftPreviewResponse | null;
  remediationResult: AnalysisRemediationDraftResponse | null;
  onRefreshDiagnosis: () => void;
  onCreateRemediationDraft: () => void;
  onAiAssistRemediation: () => void;
  errorColorFn: (v: number) => string;
  formatPct: (v: number) => string;
}

export function AnalysisDiagnosisPanel({
  selectedExamId,
  selectedBatchId,
  diagLoading,
  diagKd,
  diagHeat,
  diagSug,
  diagStudents,
  diagStudentPick,
  onStudentPickChange,
  remediationBusy,
  remediationPreview,
  remediationResult,
  onRefreshDiagnosis,
  onCreateRemediationDraft,
  onAiAssistRemediation,
  errorColorFn,
  formatPct,
}: AnalysisDiagnosisPanelProps) {
  const { t } = useTranslation("analysis");

  return (
    <div className="space-y-6">
      {diagLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--or-muted)] py-4">
          <RefreshCw className="h-4 w-4 animate-spin text-[var(--or-on-container)]" />
          <span>{t("loadingDiagnosis")}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                onClick={onRefreshDiagnosis}
              >
                <RefreshCw className="h-3.5 w-3.5 text-[var(--or-muted)]" />
                <span>{t("refreshDiagnosis")}</span>
              </button>
            </div>
            <span className="text-xs text-[var(--or-muted)]">{t("diagnosisDeps")}</span>
          </div>

          {diagKd?.nodes?.length ? (
            <SvgBarChart
              data={(diagKd.nodes as any[]).map((n) => ({
                label: String(n.canonical_name ?? n.node_id).slice(0, 12),
                value: Number(n.error_rate ?? 0),
              }))}
              title={t("classWeakTitle")}
              colorFn={(v) => errorColorFn(v)}
              maxVal={1}
              formatVal={formatPct}
            />
          ) : (
            <div className="rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_60%,transparent)] p-4 text-xs text-[var(--or-on-warning)] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-[var(--or-on-warning)]" />
              <span>{t("noDiagnosisData")}</span>
            </div>
          )}

          {diagHeat?.matrix?.length && diagHeat?.columns?.length ? (
            <div className="or-g52-surface-card p-5">
              <h4 className="mb-3 text-sm font-semibold text-[var(--or-text)] tracking-tight">
                {t("heatmapTitle")}
              </h4>
              <div className="max-h-[380px] overflow-auto rounded-xl border border-[var(--or-outline)]">
                <table className="border-collapse text-xs w-full">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-r border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-block)_90%,transparent)] px-2.5 py-1.5 text-left font-medium text-[var(--or-muted)]">
                        {t("studentCol")}
                      </th>
                      {(diagHeat.columns as any[]).map((c) => (
                        <th
                          key={c.node_id}
                          className="min-w-[3.5rem] max-w-[5rem] border-b border-r border-[var(--or-outline)] bg-[var(--or-page)] px-1 py-1.5 text-center font-normal leading-tight text-[var(--or-muted)] truncate"
                          title={c.canonical_name}
                        >
                          {String(c.canonical_name ?? c.node_id).slice(0, 5)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(diagHeat.matrix as (number | null)[][]).map((row, ri) => {
                      const rinfo = (diagHeat.rows as any[])[ri];
                      return (
                        <tr key={ri} className="border-b border-[var(--or-outline)]">
                          <td className="sticky left-0 z-10 border-r border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-[var(--or-muted)] font-medium whitespace-nowrap">
                            {rinfo?.name ?? ri}
                          </td>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="border-r border-[var(--or-outline)] px-0.5 py-1 text-center"
                              style={{
                                backgroundColor:
                                  cell == null
                                    ? "#f1f5f9"
                                    : `hsl(${cell * 120}, 65%, ${45 + (1 - cell) * 15}%)`,
                              }}
                              title={cell == null ? t("noCellData") : `${(cell * 100).toFixed(0)}%`}
                            >
                              <span className="text-[10px] text-white font-mono font-medium drop-shadow-2xs">
                                {cell == null ? "·" : ""}
                              </span>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="or-g52-surface-card p-5">
            <h4 className="mb-3 text-sm font-semibold text-[var(--or-text)] tracking-tight">
              {t("studentProfileTitle")}
            </h4>
            {diagStudents.length ? (
              <div className="space-y-4">
                <label className="flex items-center gap-2.5 text-xs text-[var(--or-muted)]">
                  <span className="font-medium text-[var(--or-muted)]">{t("pickStudent")}</span>
                  <AppSelect
                    className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
                    value={diagStudentPick}
                    onValueChange={(value) => onStudentPickChange(value)}
                  >
                    {diagStudents.map((s) => (
                      <option key={`${s.student_id}-${s.name}`} value={String(s.student_id ?? "")}>
                        {s.name} ({s.student_id || t("noStudentId")})
                      </option>
                    ))}
                  </AppSelect>
                </label>
                {(() => {
                  const st = diagStudents.find(
                    (s) => String(s.student_id ?? "") === diagStudentPick,
                  );
                  const bn = st?.by_node as Record<string, { mastery: number; canonical_name: string }> | undefined;
                  const pts = bn
                    ? Object.values(bn).map((v) => ({
                        label: String(v.canonical_name).slice(0, 10),
                        value: 1 - v.mastery,
                      }))
                    : [];
                  return pts.length ? (
                    <SvgBarChart
                      data={pts}
                      title={t("lossChartTitle")}
                      colorFn={(v) => errorColorFn(v)}
                      maxVal={1}
                      formatVal={formatPct}
                    />
                  ) : (
                    <p className="text-xs text-[var(--or-muted)]">{t("noStudentKData")}</p>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-[var(--or-muted)]">{t("noStudentData")}</p>
            )}
          </div>

          {diagSug?.retell_priority?.length ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary-container)_50%,transparent)] p-5">
              <h4 className="mb-2.5 text-sm font-semibold text-[var(--or-on-container)]">{t("retitleTitle")}</h4>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs text-[var(--or-on-container)]">
                {(diagSug.retell_priority as any[]).map((x) => (
                  <li key={x.node_id}>
                    <span className="font-medium text-[var(--or-on-container)]">{x.canonical_name}</span>
                    <span className="ml-1 text-[var(--or-on-container)]">
                      {t("errRateParen", { rate: formatPct(Number(x.error_rate ?? 0)) })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {remediationPreview?.nodes?.length ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--or-success)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-success-container)_50%,transparent)] p-5 space-y-3.5">
              <h4 className="text-sm font-semibold text-[var(--or-on-success)]">{t("practiceDraftTitle")}</h4>
              <ul className="space-y-2.5 text-xs text-[var(--or-on-success)]">
                {remediationPreview.nodes.map((d) => (
                  <li key={d.node_id} className="rounded-xl border border-[color-mix(in_srgb,var(--or-success)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-card)_70%,transparent)] p-3">
                    <div className="font-semibold text-[var(--or-on-success)]">{d.canonical_name}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--or-on-success)]">
                      {(d.selected_question_ids ?? []).join(" · ") || t("noLinkedQuestions")}
                    </div>
                    {(d.excluded_source_question_ids?.length ?? 0) > 0 ? (
                      <div className="mt-1 text-xs text-[var(--or-on-success)]">
                        {t("excludedSourceQuestions", {
                          count: d.excluded_source_question_ids?.length ?? 0,
                        })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {remediationPreview.low_count ? (
                <div className="rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_80%,transparent)] p-3 text-xs text-[var(--or-on-warning)]">
                  <div className="font-medium">
                    {t("remediationLowCount", {
                      count: remediationPreview.selected_count,
                      threshold: remediationPreview.low_count_threshold,
                    })}
                  </div>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-[var(--or-card)] px-2.5 py-1 text-xs font-medium text-[var(--or-on-warning)] hover:bg-[var(--or-warning-container)] transition-colors"
                    onClick={onAiAssistRemediation}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[var(--or-on-warning)]" />
                    <span>{t("aiAssistRemediation")}</span>
                  </button>
                </div>
              ) : null}
              <p className="text-xs text-[var(--or-on-success)]">{t("practiceHint")}</p>
              <div className="flex flex-wrap items-center gap-3 border-t border-[color-mix(in_srgb,var(--or-success)_60%,transparent)] pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-2xs"
                  disabled={remediationBusy || !selectedBatchId || remediationPreview.selected_count <= 0}
                  onClick={onCreateRemediationDraft}
                >
                  {remediationBusy ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  )}
                  <span>{remediationBusy ? t("creatingRemediation") : t("createRemediationDraft")}</span>
                </button>
                <span className="text-xs text-[var(--or-on-success)]">{t("createRemediationHint")}</span>
              </div>
              {remediationResult ? (
                <div className="rounded-xl border border-[var(--or-success)] bg-[var(--or-card)] p-3 text-xs text-[var(--or-on-success)]">
                  <div className="font-semibold">
                    {t("remediationCreated", {
                      examId: remediationResult.exam_id,
                      count: remediationResult.selected_count,
                    })}
                  </div>
                  {remediationResult.warnings.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--or-on-warning)]">
                      {remediationResult.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Comparison card (C18) */}
          <AnalysisComparisonCard
            sourceExamId={selectedExamId || undefined}
            sourceBatchId={selectedBatchId || undefined}
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}
