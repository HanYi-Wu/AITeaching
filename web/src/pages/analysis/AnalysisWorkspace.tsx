import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiAnalysisListJobs,
  apiAnalysisListFolderScripts,
  apiAnalysisListTools,
  apiAnalysisRunFolderScript,
  apiAnalysisRunBuiltin,
  apiDelete,
  apiGet,
  apiPost,
  apiPostFormData,
  resolveApiUrl,
  type AnalysisFolderScript,
  type AnalysisJob,
} from "../../api/client";
import {
  analyzePlatformPaper,
  listPlatformPapers,
  type PlatformPaperAnalysis,
  type PlatformPaperRecord,
} from "../../platform/auth";
import { PlatformPaperAnalysisCharts } from "../platform/AnalysisCharts";
import { useAgentContext } from "../../contexts/AgentContext";
import { confirmDialog } from "../../lib/confirmDialog";
import { dispatchExamsChanged } from "../../lib/examEvents";
import { saveBlobToDisk } from "../../lib/saveBlobToDisk";
import { formatLocaleDate } from "../../lib/locale";
import { cn } from "../../lib/utils";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Download,
  RefreshCw,
  Search,
  TrendingUp,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import {
  type ExamResult,
  type ExamSummary,
  type ImportResult,
  type ScoreAnalysis,
  type ToolSpec,
  type ChartSpec,
  type ChartSeries,
} from "./analysisTypes";
import { SvgBarChart } from "./SvgBarChart";
import { AnalysisBatchSelector } from "./AnalysisBatchSelector";
import { useAnalysisDiagnosis } from "./useAnalysisDiagnosis";
import { AnalysisDiagnosisPanel } from "./AnalysisDiagnosisPanel";
import { AnalysisResultView } from "./AnalysisResultView";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AnalysisWorkspace({
  onOpenExamInCompose,
  allowHostTools = false,
}: {
  onOpenExamInCompose?: (examId: string) => void;
  allowHostTools?: boolean;
} = {}) {
  const { t } = useTranslation("analysis");
  const [exams, setExams] = useState<ExamResult[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [examSummary, setExamSummary] = useState<ExamSummary | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ScoreAnalysis | null>(null);
  const [onlinePapers, setOnlinePapers] = useState<PlatformPaperRecord[]>([]);
  const [selectedOnlinePaperId, setSelectedOnlinePaperId] = useState<string | null>(null);
  const [onlineAnalysis, setOnlineAnalysis] = useState<PlatformPaperAnalysis | null>(null);
  const [loadingExams, setLoadingExams] = useState(false);
  const [loadingOnlinePapers, setLoadingOnlinePapers] = useState(false);
  const [loadingOnlineAnalysis, setLoadingOnlineAnalysis] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [browsePdfBusyId, setBrowsePdfBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<ImportResult["warnings"]>([]);
  const [tab, setTab] = useState<"overview" | "questions" | "nodes" | "students" | "diagnosis">("overview");
  const [questionSectionFilter, setQuestionSectionFilter] = useState("all");
  const [folderScripts, setFolderScripts] = useState<AnalysisFolderScript[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [selectedFolderScriptPath, setSelectedFolderScriptPath] = useState<string>("");
  const [jobOutput, setJobOutput] = useState<any | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState<56 | 64 | 72>(56);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySubject, setHistorySubject] = useState("all");
  const [historyMode, setHistoryMode] = useState<"all" | "online" | "offline">("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rightChartRef = useRef<HTMLDivElement>(null);
  const onlineAnalysisRequestIdRef = useRef(0);
  const legacyDetailRequestIdRef = useRef(0);
  const legacyAnalysisRequestIdRef = useRef(0);
  const { setPageContext } = useAgentContext();

  const loadExams = useCallback(async () => {
    setLoadingExams(true);
    try {
      const data = await apiGet<{ exams: ExamResult[] }>("/api/exams/analysis-list");
      setExams(data.exams ?? []);
    } catch (e) {
      console.error("loadExams failed", e);
    } finally {
      setLoadingExams(false);
    }
  }, []);

  const {
    diagLoading,
    diagKd,
    diagHeat,
    diagSug,
    diagStudents,
    diagStudentPick,
    setDiagStudentPick,
    remediationBusy,
    remediationPreview,
    remediationResult,
    loadDiagnosis,
    invalidateDiagnosis,
    handleCreateRemediationDraft,
    handleAiAssistRemediation,
  } = useAnalysisDiagnosis({
    selectedExamId,
    selectedBatchId,
    tab,
    loadExams,
    onOpenExamInCompose,
    setImportError,
  });

  useEffect(() => {
    const onlinePaper = onlinePapers.find((paper) => paper.paper_id === selectedOnlinePaperId);
    if (selectedOnlinePaperId && onlinePaper) {
      const submitted = onlinePaper.submitted_student_count ?? onlineAnalysis?.summary.completed_students ?? 0;
      const inProgress = onlinePaper.in_progress_student_count ?? onlineAnalysis?.summary.in_progress_students ?? 0;
      setPageContext({
        current_page: "analysis",
        selected_resource_type: "paper",
        selected_resource_id: selectedOnlinePaperId,
        summary: `试卷分析：${onlinePaper.title}（${submitted} 份已提交，${inProgress} 份答题中）`,
      });
    } else if (selectedExamId && examSummary) {
      setPageContext({
        current_page: "analysis",
        selected_resource_type: "exam",
        selected_resource_id: selectedExamId,
        summary: t("pageSummaryWithExam", { title: examSummary.exam_title || examSummary.exam_id }),
      });
    } else {
      setPageContext({
        current_page: "analysis",
        summary: t("pageSummaryPick"),
      });
    }
    return () => setPageContext(null);
  }, [selectedExamId, examSummary, selectedOnlinePaperId, onlinePapers, onlineAnalysis, setPageContext, t]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const loadOnlinePapers = useCallback(async () => {
    setLoadingOnlinePapers(true);
    try {
      const first = await listPlatformPapers({ deliveryMode: "all", status: "all", page: 1, pageSize: 100 });
      const papers = [...(first.papers ?? [])];
      for (let page = 2; page <= (first.total_pages ?? 1); page += 1) {
        const next = await listPlatformPapers({ deliveryMode: "all", status: "all", page, pageSize: 100 });
        papers.push(...(next.papers ?? []));
      }
      setOnlinePapers(papers);
    } catch {
      setOnlinePapers([]);
    } finally {
      setLoadingOnlinePapers(false);
    }
  }, []);

  useEffect(() => {
    void loadOnlinePapers();
  }, [loadOnlinePapers]);

  const selectedOnlinePaper = useMemo(
    () => onlinePapers.find((paper) => paper.paper_id === selectedOnlinePaperId) ?? null,
    [onlinePapers, selectedOnlinePaperId],
  );
  const legacyExams = useMemo(
    () => exams.filter((exam) => !onlinePapers.some((paper) => paper.exam_id === exam.exam_id)),
    [exams, onlinePapers],
  );
  const historySubjects = useMemo(() => Array.from(new Set([
    ...onlinePapers.map((item) => item.subject),
    ...legacyExams.map((item) => item.subject),
  ].filter(Boolean) as string[])).sort(), [onlinePapers, legacyExams]);
  const filteredOnlinePapers = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return onlinePapers.filter((paper) =>
      (historyMode === "all" || paper.delivery_mode === historyMode) &&
      (historySubject === "all" || paper.subject === historySubject) &&
      (!needle || `${paper.title} ${paper.exam_id} ${paper.subject || ""}`.toLowerCase().includes(needle)),
    );
  }, [historyMode, historyQuery, historySubject, onlinePapers]);
  const filteredLegacyExams = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return legacyExams.filter((exam) =>
      historyMode !== "online" &&
      (historySubject === "all" || exam.subject === historySubject) &&
      (!needle || `${exam.exam_title} ${exam.exam_id} ${exam.subject || ""}`.toLowerCase().includes(needle)),
    );
  }, [historyMode, historyQuery, historySubject, legacyExams]);

  const handleOnlinePaperSelect = useCallback(async (paper: PlatformPaperRecord, publicationId?: string, classId?: string) => {
    const requestId = ++onlineAnalysisRequestIdRef.current;
    legacyDetailRequestIdRef.current += 1;
    legacyAnalysisRequestIdRef.current += 1;
    invalidateDiagnosis();
    setSelectedOnlinePaperId(paper.paper_id);
    setSelectedExamId(null);
    setExamSummary(null);
    setSelectedBatchId(null);
    setAnalysis(null);
    setLoadingOnlineAnalysis(true);
    try {
      const data = await analyzePlatformPaper(paper.paper_id, publicationId, classId);
      if (onlineAnalysisRequestIdRef.current === requestId) {
        setOnlineAnalysis(data.analysis);
      }
    } catch (e) {
      console.error("loadOnlinePaperAnalysis failed", e);
      if (onlineAnalysisRequestIdRef.current === requestId) {
        setOnlineAnalysis(null);
      }
    } finally {
      if (onlineAnalysisRequestIdRef.current === requestId) {
        setLoadingOnlineAnalysis(false);
      }
    }
  }, [invalidateDiagnosis]);

  const loadExamDetail = useCallback(async (examId: string) => {
    const requestId = ++legacyDetailRequestIdRef.current;
    legacyAnalysisRequestIdRef.current += 1;
    onlineAnalysisRequestIdRef.current += 1;
    invalidateDiagnosis();
    setLoadingDetail(true);
    setAnalysis(null);
    setSelectedOnlinePaperId(null);
    setOnlineAnalysis(null);
    setSelectedBatchId(null);
    try {
      const data = await apiGet<ExamSummary>(`/api/exams/${encodeURIComponent(examId)}/summary`);
      if (legacyDetailRequestIdRef.current === requestId) {
        setExamSummary(data);
        if (data.latest_batch_id) {
          setSelectedBatchId(data.latest_batch_id);
        }
      }
    } catch (e) {
      console.error("loadExamDetail failed", e);
    } finally {
      if (legacyDetailRequestIdRef.current === requestId) setLoadingDetail(false);
    }
  }, [invalidateDiagnosis]);

  const loadAnalysis = useCallback(
    async (examId: string, batchId: string) => {
      const requestId = ++legacyAnalysisRequestIdRef.current;
      try {
        const data = await apiGet<ScoreAnalysis>(
          `/api/exams/${encodeURIComponent(examId)}/scores/${encodeURIComponent(batchId)}`,
        );
        if (legacyAnalysisRequestIdRef.current === requestId) {
          setAnalysis(data);
          setImportWarnings([]);
        }
      } catch (e) {
        console.error("loadAnalysis failed", e);
      }
    },
    [],
  );

  const handleExamSelect = useCallback(
    async (examId: string) => {
      setSelectedExamId(examId);
      await loadExamDetail(examId);
    },
    [loadExamDetail],
  );

  const openExamPdfWithDefaultApp = useCallback(async (examId: string) => {
    setBrowsePdfBusyId(examId);
    try {
      await apiPost<{ ok?: boolean }>(`/api/exams/${encodeURIComponent(examId)}/open-pdf`, {
        variant: "student",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg);
    } finally {
      setBrowsePdfBusyId(null);
    }
  }, []);

  useEffect(() => {
    if (selectedExamId && selectedBatchId) {
      void loadAnalysis(selectedExamId, selectedBatchId);
    }
  }, [selectedExamId, selectedBatchId, loadAnalysis]);

  const loadEduAnalysisMeta = useCallback(async () => {
    try {
      const [s, j, t] = await Promise.all([
        allowHostTools ? apiAnalysisListFolderScripts() : Promise.resolve({ scripts: [] }),
        apiAnalysisListJobs(),
        allowHostTools ? apiAnalysisListTools() : Promise.resolve({ tools: [] }),
      ]);
      setFolderScripts(s.scripts ?? []);
      setJobs(j.jobs ?? []);
      setTools((t.tools as ToolSpec[]) ?? []);
      setSelectedFolderScriptPath((previous) => s.scripts.some((script) => script.path === previous) ? previous : s.scripts[0]?.path ?? "");
    } catch (e) {
      console.error("loadEduAnalysisMeta failed", e);
    }
  }, [allowHostTools]);

  useEffect(() => {
    void loadEduAnalysisMeta();
  }, [loadEduAnalysisMeta]);

  const handleDownloadTemplate = useCallback(
    async (examId: string) => {
      try {
        const resp = await fetch(await resolveApiUrl(`/api/exams/${encodeURIComponent(examId)}/score-template`));
        if (!resp.ok) throw new Error(await resp.text());
        const blob = await resp.blob();
        const cd = resp.headers.get("Content-Disposition") ?? "";
        const match =
          /filename\*=UTF-8''([^;]+)/i.exec(cd) ??
          /filename="([^"]+)"/.exec(cd);
        const filename = decodeURIComponent(match?.[1] ?? "scores.csv");
        await saveBlobToDisk(blob, {
          defaultFileName: filename,
          title: t("downloadTemplate"),
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

  const handleImport = useCallback(
    async (examId: string, file: File) => {
      setImporting(true);
      setImportError(null);
      setImportWarnings([]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const result = await apiPostFormData<ImportResult>(
          `/api/exams/${encodeURIComponent(examId)}/scores`,
          fd,
        );
        if (result.warnings?.length) {
          setImportWarnings(result.warnings);
        }
        await loadExamDetail(examId);
        setSelectedBatchId(result.batch_id);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    },
    [loadExamDetail],
  );

  const handleRecompute = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    try {
      const data = await apiPost<ScoreAnalysis>(
        `/api/exams/${encodeURIComponent(selectedExamId)}/scores/${encodeURIComponent(selectedBatchId)}/recompute`,
        {},
      );
      setAnalysis(data);
    } catch (e) {
      console.error("recompute failed", e);
    }
  }, [selectedExamId, selectedBatchId]);

  const handleDeleteBatch = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    const ok = await confirmDialog(t("confirmDeleteBatch"));
    if (!ok) return;
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/exams/${encodeURIComponent(selectedExamId)}/scores/${encodeURIComponent(selectedBatchId)}`,
      );
      await loadExamDetail(selectedExamId);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, selectedBatchId, loadExamDetail, t]);

  const handleDeleteExam = useCallback(async () => {
    if (!selectedExamId) return;
    const ok = await confirmDialog(t("confirmDeleteExam"));
    if (!ok) return;
    const deletedId = selectedExamId;
    try {
      await apiDelete<{ ok: boolean }>(`/api/exams/${encodeURIComponent(deletedId)}`);
      setSelectedExamId(null);
      setExamSummary(null);
      setSelectedBatchId(null);
      setAnalysis(null);
      invalidateDiagnosis();
      await loadExams();
      dispatchExamsChanged({ examId: deletedId });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, loadExams, invalidateDiagnosis, t]);

  const handleRunBuiltinStudio = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    try {
      setJobError(null);
      const res = await apiAnalysisRunBuiltin({
        builtin_id: "builtin:exam_stats_v1",
        exam_id: selectedExamId,
        batch_id: selectedBatchId,
        recompute: true,
      });
      if (res.output) setJobOutput(res.output);
      if ((res as { error?: string }).error) setJobError(String((res as { error?: string }).error));
      await loadEduAnalysisMeta();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, selectedBatchId, loadEduAnalysisMeta]);

  const handleRunFolderScriptStudio = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId || !selectedFolderScriptPath) return;
    try {
      setJobError(null);
      const res = await apiAnalysisRunFolderScript({
        script_path: selectedFolderScriptPath,
        exam_id: selectedExamId,
        batch_id: selectedBatchId,
      });
      if (res.output) setJobOutput(res.output);
      if (res.error) setJobError(String(res.error));
      await loadEduAnalysisMeta();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, selectedBatchId, selectedFolderScriptPath, loadEduAnalysisMeta]);

  // SVG chart helpers
  const errorColorFn = (v: number, _warn?: boolean) => {
    if (v < 0.2) return "#22c55e";
    if (v < 0.5) return "#eab308";
    return "#ef4444";
  };

  const formatPct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const normalizedOutput = jobOutput && typeof jobOutput === "object" ? (jobOutput as Record<string, unknown>) : null;
  const outputSummary =
    normalizedOutput && typeof normalizedOutput.summary === "object"
      ? (normalizedOutput.summary as Record<string, unknown>)
      : null;
  const outputChartSpecs = Array.isArray(normalizedOutput?.chart_specs) ? (normalizedOutput!.chart_specs as ChartSpec[]) : [];
  const outputSeries = Array.isArray(normalizedOutput?.series) ? (normalizedOutput!.series as ChartSeries[]) : [];
  const firstBarSpec = outputChartSpecs.find((s) => s.type === "bar" && s.series_id);
  const firstBarSeries = firstBarSpec ? outputSeries.find((s) => s.id === firstBarSpec.series_id) : null;
  const firstBarPoints = firstBarSeries?.points ?? [];

  const handleDownloadMetadata = useCallback(async () => {
    if (!jobOutput) return;
    const blob = new Blob([JSON.stringify(jobOutput, null, 2)], { type: "application/json;charset=utf-8" });
    try {
      await saveBlobToDisk(blob, {
        defaultFileName: "analysis-metadata.json",
        title: t("downloadMeta"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [jobOutput, t]);

  const handleDownloadChartImage = useCallback(async () => {
    const svg = rightChartRef.current?.querySelector("svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    try {
      await saveBlobToDisk(blob, {
        defaultFileName: "analysis-chart.svg",
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar: exam history */}
      <div className={cn("flex shrink-0 flex-col border-r border-slate-200 bg-slate-50", leftWidth === 56 ? "w-56" : leftWidth === 64 ? "w-64" : "w-72")}>
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h3 className="text-sm font-semibold text-slate-700">{t("historyTitle")}</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setLeftWidth(56)} className={cn("rounded px-1.5 py-0.5 text-xs", leftWidth === 56 ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-200")}>S</button>
            <button onClick={() => setLeftWidth(64)} className={cn("rounded px-1.5 py-0.5 text-xs", leftWidth === 64 ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-200")}>M</button>
            <button onClick={() => setLeftWidth(72)} className={cn("rounded px-1.5 py-0.5 text-xs", leftWidth === 72 ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-200")}>L</button>
            <button
              onClick={() => {
                void loadExams();
                void loadOnlinePapers();
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              title={t("refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-white px-3 py-3">
          <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索考试名称" className="w-full rounded border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-xs" /></div>
            <div className="grid grid-cols-2 gap-2"><select value={historySubject} onChange={(event) => setHistorySubject(event.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"><option value="all">全部学科</option>{historySubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select><select value={historyMode} onChange={(event) => setHistoryMode(event.target.value as "all" | "online" | "offline")} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"><option value="all">全部形式</option><option value="online">线上</option><option value="offline">线下</option></select></div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-600">考试记录与分析</h4>
              {loadingOnlinePapers || loadingExams ? <RefreshCw className="h-3 w-3 animate-spin text-slate-400" /> : null}
            </div>
            {filteredOnlinePapers.length === 0 && filteredLegacyExams.length === 0 ? (
              <p className="text-xs text-slate-400">暂无考试记录</p>
            ) : (
              <div className="space-y-1">
                {filteredOnlinePapers.map((paper) => {
                  const hasSubmittedAnswers = (paper.submitted_student_count ?? 0) > 0;
                  const hasImportedScores = paper.score_batch_count > 0;
                  const hasBothSources = hasSubmittedAnswers && hasImportedScores;
                  return (
                    <div key={paper.paper_id} className="flex items-stretch rounded hover:bg-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          if (paper.delivery_mode === "offline" && !hasSubmittedAnswers && hasImportedScores) {
                            void handleExamSelect(paper.exam_id);
                          } else {
                            void handleOnlinePaperSelect(paper);
                          }
                        }}
                        className={cn(
                          "min-w-0 flex-1 rounded-l px-2 py-2 text-left text-xs transition-colors",
                          selectedOnlinePaperId === paper.paper_id
                            ? "bg-emerald-50 text-emerald-700"
                            : "text-slate-600",
                        )}
                      >
                        <span className="block truncate font-medium">{paper.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                          {[paper.subject, `${paper.question_count} 题`, `${paper.published_class_count} 班`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {hasSubmittedAnswers || (paper.in_progress_student_count ?? 0) > 0 ? (
                          <span className="mt-1 block truncate text-[11px] font-medium text-emerald-700">
                            {paper.submitted_student_count ?? 0} 份已提交 · {paper.in_progress_student_count ?? 0} 份答题中
                          </span>
                        ) : null}
                      </button>
                      {hasBothSources ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-r border-l border-slate-200 px-2 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                          onClick={() => void handleExamSelect(paper.exam_id)}
                          title="查看已导入的成绩批次"
                        >
                          导入成绩
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {filteredLegacyExams.map((exam) => (
                  <div key={exam.exam_id} className="flex items-stretch rounded hover:bg-slate-100">
                    <button
                      type="button"
                      onClick={() => void handleExamSelect(exam.exam_id)}
                      className={cn(
                        "min-w-0 flex-1 rounded-l px-2 py-2 text-left text-xs transition-colors",
                        selectedExamId === exam.exam_id
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600",
                      )}
                    >
                      <span className="block truncate font-medium">{exam.exam_title || exam.exam_id}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {[exam.subject, `${exam.question_count} 题`, exam.score_batch_count > 0 ? `${exam.score_batch_count} 批成绩` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {formatLocaleDate(exam.mtime)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-r border-l border-slate-200 px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      disabled={browsePdfBusyId === exam.exam_id}
                      onClick={() => void openExamPdfWithDefaultApp(exam.exam_id)}
                    >
                      {browsePdfBusyId === exam.exam_id ? "…" : t("browse")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle: results only */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-200 bg-white">
        {selectedOnlinePaperId ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 border-b border-slate-200 pb-4">
              <h2 className="text-lg font-semibold text-slate-800">
                {selectedOnlinePaper?.title ?? onlineAnalysis?.paper.title ?? "试卷分析"}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {selectedOnlinePaper?.subject ? <span>{selectedOnlinePaper.subject}</span> : null}
                {selectedOnlinePaper ? <span>{selectedOnlinePaper.question_count} 题</span> : null}
                {selectedOnlinePaper ? <span>{selectedOnlinePaper.published_class_count} 个班级</span> : null}
              </div>
            </div>
            {loadingOnlineAnalysis ? (
              <div className="flex min-h-[20rem] items-center justify-center text-slate-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t("loading")}
              </div>
            ) : onlineAnalysis ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <div className="text-2xl font-bold text-slate-800">{onlineAnalysis.summary.total_students}</div>
                    <div className="text-xs text-slate-500">学生数</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{onlineAnalysis.summary.completion_rate}%</div>
                    <div className="text-xs text-slate-500">完成率</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-600">
                      {onlineAnalysis.summary.average_score ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">平均得分率</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <div className="text-2xl font-bold text-rose-600">
                      {onlineAnalysis.proctoring.exceeded_student_count ?? onlineAnalysis.proctoring.flagged_student_count}
                    </div>
                    <div className="text-xs text-slate-500">切屏超限</div>
                  </div>
                </div>
                {(onlineAnalysis.publications?.length ?? 0) > 0 && (
                  <label className="block text-sm">发布批次
                    <select aria-label="分析发布批次" className="ml-3 max-w-full rounded border p-2" value={onlineAnalysis.publication_id ?? ""}
                      onChange={(e) => { if (selectedOnlinePaper) void handleOnlinePaperSelect(selectedOnlinePaper, e.target.value); }}>
                      {onlineAnalysis.publications?.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.created_at} · {item.id.slice(0, 8)}</option>)}
                    </select>
                  </label>
                )}
                {(onlineAnalysis.available_classes?.length ?? 0) > 0 && selectedOnlinePaper && (
                  <label className="block text-sm">分析班级
                    <select aria-label="分析班级" className="ml-3 max-w-full rounded border p-2" value={onlineAnalysis.class_id ?? ""}
                      onChange={(e) => void handleOnlinePaperSelect(selectedOnlinePaper, onlineAnalysis.publication_id ?? undefined, e.target.value || undefined)}>
                      <option value="">全部班级</option>
                      {onlineAnalysis.available_classes?.map((item) => <option key={item.id} value={item.id}>{item.name}{item.grade && !item.name.includes(item.grade) ? ` · ${item.grade}` : ""}</option>)}
                    </select>
                  </label>
                )}
                <PlatformPaperAnalysisCharts analysis={onlineAnalysis} />
              </div>
            ) : (
              <div className="flex min-h-[20rem] items-center justify-center text-sm text-slate-400">
                暂无分析数据；线下考试请先上传成绩或答卷照片。
              </div>
            )}
          </div>
        ) : !selectedExamId ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            <div className="text-center">
              <BarChart3 className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm">{t("emptyBeforeSelect")}</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : examSummary ? (
          <>
            {/* Exam header */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-800">
                {examSummary.exam_title}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {examSummary.subject && <span>{examSummary.subject}</span>}
                <span>{t("questionCount", { n: examSummary.question_count })}</span>
                <span>{t("sectionCount", { n: examSummary.section_count })}</span>
                {examSummary.score_batch_count > 0 && (
                  <span className="text-green-600">
                    <CheckCircle className="mr-1 inline h-3.5 w-3.5" />
                    {t("importCount", { n: examSummary.score_batch_count })}
                  </span>
                )}
              </div>
              {jobOutput && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {t("lastOutput", {
                    title: String(outputSummary?.title ?? t("defaultOutputTitle")),
                    status: String(outputSummary?.status ?? t("statusUnknown")),
                  })}
                </div>
              )}
              {jobError && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{jobError}</div>
              )}

              {/* Import error */}
              {importError && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {importError}
                </div>
              )}

              {/* Import warnings (unbound questions) */}
              {importWarnings.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <div className="mb-1 flex items-center gap-2 font-medium text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    {t("unboundWarning", { n: importWarnings.length })}
                  </div>
                  <ul className="space-y-0.5 text-amber-600">
                    {importWarnings.map((w) => (
                      <li key={w.question_id} className="text-xs">
                        <span className="font-mono font-semibold">{w.header}</span>
                        {": "}
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Batch selector */}
            <AnalysisBatchSelector
              batches={examSummary.score_batches}
              selectedBatchId={selectedBatchId}
              onSelectBatch={(batchId) => {
                setSelectedBatchId(batchId);
                invalidateDiagnosis();
              }}
              onDeleteBatch={() => void handleDeleteBatch()}
            />

            {/* Stats tabs */}
            {!selectedBatchId ? (
              <div className="flex flex-1 items-center justify-center text-slate-400">
                <div className="text-center">
                  <TrendingUp className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-sm">{t("importToSee")}</p>
                </div>
              </div>
            ) : analysis ? (
              <AnalysisResultView
                analysis={analysis}
                tab={tab}
                onTabChange={setTab}
                questionSectionFilter={questionSectionFilter}
                onQuestionSectionFilterChange={setQuestionSectionFilter}
                errorColorFn={errorColorFn}
                formatPct={formatPct}
              >
                <AnalysisDiagnosisPanel
                  selectedExamId={selectedExamId}
                  selectedBatchId={selectedBatchId}
                  diagLoading={diagLoading}
                  diagKd={diagKd}
                  diagHeat={diagHeat}
                  diagSug={diagSug}
                  diagStudents={diagStudents}
                  diagStudentPick={diagStudentPick}
                  onStudentPickChange={setDiagStudentPick}
                  remediationBusy={remediationBusy}
                  remediationPreview={remediationPreview}
                  remediationResult={remediationResult}
                  onRefreshDiagnosis={() => {
                    if (selectedExamId && selectedBatchId) {
                      void loadDiagnosis(selectedExamId, selectedBatchId);
                    }
                  }}
                  onCreateRemediationDraft={() => void handleCreateRemediationDraft()}
                  onAiAssistRemediation={handleAiAssistRemediation}
                  errorColorFn={errorColorFn}
                  formatPct={formatPct}
                />
              </AnalysisResultView>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t("computing")}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Right: analysis controls + agent */}
      {selectedExamId && examSummary && (
        <div className="flex w-[22rem] shrink-0 flex-col bg-slate-50">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{t("quickActions")}</div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <button onClick={() => void handleDownloadTemplate(examSummary.exam_id)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <Download className="h-4 w-4" />
                {t("downloadTemplate")}
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? t("importing") : t("importScores")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImport(examSummary.exam_id, file);
                  e.target.value = "";
                }}
              />
              <button onClick={() => void handleRecompute()} disabled={!selectedBatchId} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className="h-4 w-4" />
                {t("recompute")}
              </button>
              <button onClick={() => void handleDeleteBatch()} disabled={!selectedBatchId} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="h-3 w-3" />
                {t("deleteCurrentBatch")}
              </button>
              <button onClick={() => void handleDeleteExam()} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                {t("deleteExam")}
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              {allowHostTools && <>
              <div className="text-xs font-semibold text-slate-600">{t("scriptPickTitle")}</div>
              <select
                value={selectedFolderScriptPath}
                onChange={(e) => setSelectedFolderScriptPath(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                {folderScripts.length === 0 && <option value="">{t("noPyScripts")}</option>}
                {folderScripts.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.path}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleRunFolderScriptStudio()}
                disabled={!selectedBatchId || !selectedFolderScriptPath}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("runSelectedScript")}
              </button>
              </>}
              <button
                onClick={() => void handleRunBuiltinStudio()}
                disabled={!selectedBatchId}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("runBuiltin")}
              </button>
              {allowHostTools && <div className="text-[11px] text-slate-500">
                {t("toolScriptCount", { tools: tools.length, scripts: folderScripts.length })}
              </div>}
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-600">{t("scriptCharts")}</div>
              <div ref={rightChartRef}>
                {firstBarSpec && firstBarPoints.length > 0 ? (
                  <SvgBarChart
                    data={firstBarPoints.map((p) => ({ label: p.label, value: p.value }))}
                    title={firstBarSpec.title ?? t("chartFallback")}
                    colorFn={(v) => errorColorFn(v)}
                    maxVal={1}
                    formatVal={formatPct}
                  />
                ) : (
                  <div className="rounded bg-slate-50 p-3 text-xs text-slate-500">{t("noChart")}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void handleDownloadMetadata()} disabled={!jobOutput} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {t("downloadMeta")}
                </button>
                <button onClick={() => void handleDownloadChartImage()} disabled={!firstBarSpec || firstBarPoints.length === 0} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {t("downloadImage")}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <div className="mb-1 font-semibold text-slate-700">{t("recentJobs")}</div>
              <div className="max-h-28 overflow-y-auto space-y-1">
                {jobs.slice(0, 5).map((j) => (
                  <div key={j.job_id} className="rounded bg-slate-50 px-2 py-1">
                    <span className="font-mono">{j.job_id.slice(0, 8)}</span> · {j.kind} · {j.status}
                  </div>
                ))}
                {jobs.length === 0 && <div className="text-slate-400">{t("noJobs")}</div>}
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
