import { useTranslation } from "react-i18next";
import { FileSpreadsheet, RefreshCw, Sparkles } from "lucide-react";
import { SvgBarChart } from "./SvgBarChart";
import {
  type AnalysisRemediationDraftPreviewResponse,
  type AnalysisRemediationDraftResponse,
} from "../../api/client";

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
        <p className="text-sm text-slate-500">{t("loadingDiagnosis")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
              onClick={onRefreshDiagnosis}
            >
              {t("refreshDiagnosis")}
            </button>
            <span className="text-xs text-slate-500">{t("diagnosisDeps")}</span>
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
            <p className="text-sm text-amber-700">{t("noDiagnosisData")}</p>
          )}

          {diagHeat?.matrix?.length && diagHeat?.columns?.length ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-700">{t("heatmapTitle")}</h4>
              <div className="max-h-[360px] overflow-auto">
                <table className="border-collapse text-[10px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-1 py-1 text-left">
                        {t("studentCol")}
                      </th>
                      {(diagHeat.columns as any[]).map((c) => (
                        <th
                          key={c.node_id}
                          className="min-w-[3rem] max-w-[4rem] border border-slate-200 bg-slate-50 px-0.5 py-1 text-center font-normal leading-tight text-slate-600"
                          title={c.canonical_name}
                        >
                          {String(c.canonical_name ?? c.node_id).slice(0, 4)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(diagHeat.matrix as (number | null)[][]).map((row, ri) => {
                      const rinfo = (diagHeat.rows as any[])[ri];
                      return (
                        <tr key={ri}>
                          <td className="sticky left-0 z-10 border border-slate-200 bg-white px-1 py-0.5 text-slate-700">
                            {rinfo?.name ?? ri}
                          </td>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="border border-slate-200 px-0 py-0 text-center"
                              style={{
                                backgroundColor:
                                  cell == null
                                    ? "#e2e8f0"
                                    : `hsl(${cell * 120}, 65%, ${45 + (1 - cell) * 15}%)`,
                              }}
                              title={cell == null ? t("noCellData") : `${(cell * 100).toFixed(0)}%`}
                            >
                              {cell == null ? "·" : ""}
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

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">{t("studentProfileTitle")}</h4>
            {diagStudents.length ? (
              <>
                <label className="mb-2 block text-xs text-slate-600">
                  {t("pickStudent")}
                  <select
                    className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={diagStudentPick}
                    onChange={(e) => onStudentPickChange(e.target.value)}
                  >
                    {diagStudents.map((s) => (
                      <option key={`${s.student_id}-${s.name}`} value={String(s.student_id ?? "")}>
                        {s.name} ({s.student_id || t("noStudentId")})
                      </option>
                    ))}
                  </select>
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
                    <p className="text-xs text-slate-500">{t("noStudentKData")}</p>
                  );
                })()}
              </>
            ) : (
              <p className="text-xs text-slate-500">{t("noStudentData")}</p>
            )}
          </div>

          {diagSug?.retell_priority?.length ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
              <h4 className="mb-2 text-sm font-semibold text-indigo-900">{t("retitleTitle")}</h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-indigo-950">
                {(diagSug.retell_priority as any[]).map((x) => (
                  <li key={x.node_id}>
                    <span className="font-medium">{x.canonical_name}</span>
                    <span className="text-indigo-700">
                      {t("errRateParen", { rate: formatPct(Number(x.error_rate ?? 0)) })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {remediationPreview?.nodes?.length ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <h4 className="mb-2 text-sm font-semibold text-emerald-900">{t("practiceDraftTitle")}</h4>
              <ul className="space-y-3 text-sm text-emerald-950">
                {remediationPreview.nodes.map((d) => (
                  <li key={d.node_id}>
                    <div className="font-medium">{d.canonical_name}</div>
                    <div className="mt-1 font-mono text-xs text-emerald-800">
                      {(d.selected_question_ids ?? []).join(" · ") || t("noLinkedQuestions")}
                    </div>
                    {(d.excluded_source_question_ids?.length ?? 0) > 0 ? (
                      <div className="mt-1 text-[11px] text-emerald-700">
                        {t("excludedSourceQuestions", {
                          count: d.excluded_source_question_ids?.length ?? 0,
                        })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {remediationPreview.low_count ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="font-medium">
                    {t("remediationLowCount", {
                      count: remediationPreview.selected_count,
                      threshold: remediationPreview.low_count_threshold,
                    })}
                  </div>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    onClick={onAiAssistRemediation}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("aiAssistRemediation")}
                  </button>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-emerald-800">{t("practiceHint")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-emerald-200/70 pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                  disabled={remediationBusy || !selectedBatchId || remediationPreview.selected_count <= 0}
                  onClick={onCreateRemediationDraft}
                >
                  {remediationBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                  {remediationBusy ? t("creatingRemediation") : t("createRemediationDraft")}
                </button>
                <span className="text-[11px] text-emerald-800">{t("createRemediationHint")}</span>
              </div>
              {remediationResult ? (
                <div className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-900">
                  <div className="font-medium">
                    {t("remediationCreated", {
                      examId: remediationResult.exam_id,
                      count: remediationResult.selected_count,
                    })}
                  </div>
                  {remediationResult.warnings.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-700">
                      {remediationResult.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
