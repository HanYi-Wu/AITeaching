import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
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
import { formatSubjectLabel } from "../../lib/subjectLabels";
import { PlatformPaperAnalysisCharts } from "../platform/AnalysisCharts";
import { useAgentContext } from "../../contexts/AgentContext";
import { SelectionIndicator } from "../../design-system/SelectionIndicator";
import { confirmDialog } from "../../lib/confirmDialog";
import { dispatchExamsChanged } from "../../lib/examEvents";
import { saveBlobToDisk } from "../../lib/saveBlobToDisk";
import { isShiftSpace, rangeSelection } from "../../lib/rangeSelection";
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
  Users,
  Target,
  Clock,
  ShieldAlert,
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
import { AnalysisFoldersPanel, ANALYSIS_ITEMS_MIME, type AnalysisFolderFilter } from "./AnalysisFoldersPanel";
import { useAnalysisFolders } from "./useAnalysisFolders";
import { G52StatCard } from "../../ui-redesign/g52/G52UIComponents";
import "../../ui-redesign/g52/g52-design-tokens.css";
import { Select as AppSelect } from "../../components/ui/select";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function normalizeAnalysisProjectId(projectId: string | null | undefined): string | null {
  const normalized = projectId?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  return normalized || null;
}

export function AnalysisWorkspace({
  onOpenExamInCompose,
  allowHostTools = false,
  ownerId = null,
  projectId = null,
}: {
  onOpenExamInCompose?: (examId: string) => void;
  allowHostTools?: boolean;
  ownerId?: string | null;
  projectId?: string | null;
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
  const [mobileTab, setMobileTab] = useState<"list" | "detail" | "actions">("list");
  const mobileSegmentRef = useRef<HTMLDivElement>(null);
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
  const [analysisFolderFilter, setAnalysisFolderFilter] = useState<AnalysisFolderFilter>("all");
  const [selectedAnalysisItemIds, setSelectedAnalysisItemIds] = useState<string[]>([]);
  const analysisSelectionAnchor = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rightChartRef = useRef<HTMLDivElement>(null);
  const onlineAnalysisRequestIdRef = useRef(0);
  const legacyDetailRequestIdRef = useRef(0);
  const legacyAnalysisRequestIdRef = useRef(0);
  const examListRequestIdRef = useRef(0);
  const onlinePapersRequestIdRef = useRef(0);
  const eduAnalysisMetaRequestIdRef = useRef(0);
  const studioRunRequestIdRef = useRef(0);
  const ownerProjectScopeKey = JSON.stringify([
    ownerId?.trim() || null,
    normalizeAnalysisProjectId(projectId),
  ]);
  const metadataScopeKey = JSON.stringify([ownerProjectScopeKey, allowHostTools]);
  const importRequestIdRef = useRef(0);
  const ownerProjectScopeKeyRef = useRef(ownerProjectScopeKey);
  ownerProjectScopeKeyRef.current = ownerProjectScopeKey;
  const metadataScopeKeyRef = useRef(metadataScopeKey);
  metadataScopeKeyRef.current = metadataScopeKey;
  const selectedExamIdRef = useRef(selectedExamId);
  selectedExamIdRef.current = selectedExamId;
  const selectedBatchIdRef = useRef(selectedBatchId);
  selectedBatchIdRef.current = selectedBatchId;
  const selectedOnlinePaperIdRef = useRef(selectedOnlinePaperId);
  selectedOnlinePaperIdRef.current = selectedOnlinePaperId;
  const allowHostToolsRef = useRef(allowHostTools);
  allowHostToolsRef.current = allowHostTools;
  const { setPageContext } = useAgentContext();

  const loadExams = useCallback(async () => {
    const requestId = ++examListRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    setLoadingExams(true);
    try {
      const data = await apiGet<{ exams: ExamResult[] }>("/api/exams/analysis-list");
      if (examListRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        setExams(data.exams ?? []);
      }
    } catch (e) {
      if (examListRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        console.error("loadExams failed", e);
      }
    } finally {
      if (examListRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        setLoadingExams(false);
      }
    }
  }, [ownerProjectScopeKey]);

  const previousOwnerProjectScopeKeyRef = useRef(ownerProjectScopeKey);
  const ownerProjectScopeReady = previousOwnerProjectScopeKeyRef.current === ownerProjectScopeKey;
  const previousMetadataScopeKeyRef = useRef(metadataScopeKey);
  const metadataScopeReady = previousMetadataScopeKeyRef.current === metadataScopeKey;
  const hostToolsAvailable = allowHostTools && metadataScopeReady;
  const analysisFolders = useAnalysisFolders(ownerProjectScopeKey, ownerProjectScopeReady);

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
    scopeKey: ownerProjectScopeKey,
    scopeReady: ownerProjectScopeReady,
    tab,
    loadExams,
    onOpenExamInCompose,
    setImportError,
  });

  useEffect(() => {
    if (previousOwnerProjectScopeKeyRef.current === ownerProjectScopeKey) return;
    previousOwnerProjectScopeKeyRef.current = ownerProjectScopeKey;
    analysisSelectionAnchor.current = null;
    examListRequestIdRef.current += 1;
    onlinePapersRequestIdRef.current += 1;
    eduAnalysisMetaRequestIdRef.current += 1;
    importRequestIdRef.current += 1;
    studioRunRequestIdRef.current += 1;
    onlineAnalysisRequestIdRef.current += 1;
    legacyDetailRequestIdRef.current += 1;
    legacyAnalysisRequestIdRef.current += 1;
    invalidateDiagnosis();
    setExams([]);
    setOnlinePapers([]);
    setSelectedExamId(null);
    setExamSummary(null);
    setSelectedBatchId(null);
    setAnalysis(null);
    setSelectedOnlinePaperId(null);
    selectedOnlinePaperIdRef.current = null;
    setOnlineAnalysis(null);
    setFolderScripts([]);
    setJobs([]);
    setTools([]);
    setSelectedFolderScriptPath("");
    setJobOutput(null);
    setJobError(null);
    setImportError(null);
    setImportWarnings([]);
    setImporting(false);
    setLoadingExams(false);
    setLoadingOnlinePapers(false);
    setLoadingOnlineAnalysis(false);
    setLoadingDetail(false);
    setAnalysisFolderFilter("all");
    setSelectedAnalysisItemIds([]);
  }, [ownerProjectScopeKey, invalidateDiagnosis]);

  useEffect(() => {
    if (previousMetadataScopeKeyRef.current === metadataScopeKey) return;
    previousMetadataScopeKeyRef.current = metadataScopeKey;
    eduAnalysisMetaRequestIdRef.current += 1;
    studioRunRequestIdRef.current += 1;
    setFolderScripts([]);
    setJobs([]);
    setTools([]);
    setSelectedFolderScriptPath("");
    setJobOutput(null);
    setJobError(null);
  }, [metadataScopeKey, allowHostTools]);

  useEffect(() => {
    const onlinePaper = onlinePapers.find((paper) => paper.paper_id === selectedOnlinePaperId);
    if (ownerProjectScopeReady && selectedOnlinePaperId && onlinePaper) {
      const submitted = onlinePaper.submitted_student_count ?? onlineAnalysis?.summary.completed_students ?? 0;
      const inProgress = onlinePaper.in_progress_student_count ?? onlineAnalysis?.summary.in_progress_students ?? 0;
      setPageContext({
        current_page: "analysis",
        selected_resource_type: "paper",
        selected_resource_id: selectedOnlinePaperId,
        summary: `试卷分析：${onlinePaper.title}（${submitted} 份已提交，${inProgress} 份答题中）`,
      });
    } else if (ownerProjectScopeReady && selectedExamId && examSummary) {
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
  }, [ownerProjectScopeReady, selectedExamId, examSummary, selectedOnlinePaperId, onlinePapers, onlineAnalysis, setPageContext, t]);

  const loadOnlinePapers = useCallback(async () => {
    const requestId = ++onlinePapersRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    setLoadingOnlinePapers(true);
    try {
      const first = await listPlatformPapers({ deliveryMode: "all", status: "all", page: 1, pageSize: 100 });
      const papers = [...(first.papers ?? [])];
      for (let page = 2; page <= (first.total_pages ?? 1); page += 1) {
        if (onlinePapersRequestIdRef.current !== requestId || ownerProjectScopeKeyRef.current !== scopeKey) return;
        const next = await listPlatformPapers({ deliveryMode: "all", status: "all", page, pageSize: 100 });
        papers.push(...(next.papers ?? []));
      }
      if (onlinePapersRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        setOnlinePapers(papers);
      }
    } catch {
      if (onlinePapersRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        setOnlinePapers([]);
      }
    } finally {
      if (onlinePapersRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        setLoadingOnlinePapers(false);
      }
    }
  }, [ownerProjectScopeKey]);

  useEffect(() => {
    void loadExams();
    void loadOnlinePapers();
  }, [loadExams, loadOnlinePapers]);

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
  const visibleAnalysisItemIds = useMemo(() => [
    ...onlinePapers.map((paper) => `paper:${paper.paper_id}`),
    ...legacyExams.map((exam) => `exam:${exam.exam_id}`),
  ], [onlinePapers, legacyExams]);
  const selectedAnalysisItemSet = useMemo(() => new Set(selectedAnalysisItemIds), [selectedAnalysisItemIds]);
  const folderMatches = useCallback((itemId: string) => {
    if (analysisFolderFilter === "all") return true;
    if (analysisFolderFilter === "unassigned") return !analysisFolders.items[itemId];
    return analysisFolders.items[itemId] === analysisFolderFilter;
  }, [analysisFolderFilter, analysisFolders.items]);
  const toggleAnalysisItem = useCallback((itemId: string) => {
    setSelectedAnalysisItemIds((current) => {
      if (current.includes(itemId)) return current.filter((selectedId) => selectedId !== itemId);
      if (current.length >= 200) return current;
      return [...current, itemId];
    });
  }, []);
  const assignAnalysisItems = useCallback(async (itemIds: string[], folderId: string | null) => {
    if (await analysisFolders.assignItems(itemIds, folderId)) {
      const assigned = new Set(itemIds);
      setSelectedAnalysisItemIds((current) => current.filter((itemId) => !assigned.has(itemId)));
    }
  }, [analysisFolders.assignItems]);
  const startAnalysisItemDrag = useCallback((event: DragEvent<HTMLDivElement>, itemId: string) => {
    const ids = selectedAnalysisItemSet.has(itemId) ? selectedAnalysisItemIds : [itemId];
    event.dataTransfer.setData(ANALYSIS_ITEMS_MIME, JSON.stringify({ scope: "analysis", ids }));
    event.dataTransfer.effectAllowed = "move";
  }, [selectedAnalysisItemIds, selectedAnalysisItemSet]);

  useEffect(() => {
    const visibleIds = new Set(visibleAnalysisItemIds);
    setSelectedAnalysisItemIds((current) => current.filter((itemId) => visibleIds.has(itemId)));
  }, [visibleAnalysisItemIds]);

  const filteredOnlinePapers = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return onlinePapers.filter((paper) =>
      (historyMode === "all" || paper.delivery_mode === historyMode) &&
      (historySubject === "all" || paper.subject === historySubject) &&
      folderMatches(`paper:${paper.paper_id}`) &&
      (!needle || `${paper.title} ${paper.exam_id} ${paper.subject || ""}`.toLowerCase().includes(needle)),
    );
  }, [historyMode, historyQuery, historySubject, onlinePapers, folderMatches]);
  const filteredLegacyExams = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return legacyExams.filter((exam) =>
      historyMode !== "online" &&
      (historySubject === "all" || exam.subject === historySubject) &&
      folderMatches(`exam:${exam.exam_id}`) &&
      (!needle || `${exam.exam_title} ${exam.exam_id} ${exam.subject || ""}`.toLowerCase().includes(needle)),
    );
  }, [historyMode, historyQuery, historySubject, legacyExams, folderMatches]);
  const filteredAnalysisItemIds = useMemo(() => [
    ...filteredOnlinePapers.map((paper) => `paper:${paper.paper_id}`),
    ...filteredLegacyExams.map((exam) => `exam:${exam.exam_id}`),
  ], [filteredLegacyExams, filteredOnlinePapers]);
  const selectAnalysisRange = (itemId: string) => {
    setSelectedAnalysisItemIds((current) => {
      const next = rangeSelection(current, filteredAnalysisItemIds, analysisSelectionAnchor.current, itemId);
      return next.length > 200 ? next.slice(0, 200) : next;
    });
    analysisSelectionAnchor.current = itemId;
  };

  const handleOnlinePaperSelect = useCallback(async (paper: PlatformPaperRecord, publicationId?: string, classId?: string) => {
    if (ownerProjectScopeKeyRef.current !== ownerProjectScopeKey) return;
    setMobileTab("detail");
    const requestId = ++onlineAnalysisRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    studioRunRequestIdRef.current += 1;
    legacyDetailRequestIdRef.current += 1;
    legacyAnalysisRequestIdRef.current += 1;
    invalidateDiagnosis();
    setSelectedOnlinePaperId(paper.paper_id);
    selectedOnlinePaperIdRef.current = paper.paper_id;
    setSelectedExamId(null);
    selectedExamIdRef.current = null;
    setExamSummary(null);
    setSelectedBatchId(null);
    selectedBatchIdRef.current = null;
    setAnalysis(null);
    setOnlineAnalysis(null);
    setJobOutput(null);
    setJobError(null);
    setLoadingOnlineAnalysis(true);
    try {
      const data = await analyzePlatformPaper(paper.paper_id, publicationId, classId);
      if (onlineAnalysisRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedOnlinePaperIdRef.current === paper.paper_id) {
        setOnlineAnalysis(data.analysis);
      }
    } catch (e) {
      console.error("loadOnlinePaperAnalysis failed", e);
      if (onlineAnalysisRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedOnlinePaperIdRef.current === paper.paper_id) {
        setOnlineAnalysis(null);
      }
    } finally {
      if (onlineAnalysisRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedOnlinePaperIdRef.current === paper.paper_id) {
        setLoadingOnlineAnalysis(false);
      }
    }
  }, [invalidateDiagnosis, ownerProjectScopeKey]);

  const loadExamDetail = useCallback(async (examId: string) => {
    if (ownerProjectScopeKeyRef.current !== ownerProjectScopeKey) return;
    const requestId = ++legacyDetailRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    studioRunRequestIdRef.current += 1;
    legacyAnalysisRequestIdRef.current += 1;
    onlineAnalysisRequestIdRef.current += 1;
    invalidateDiagnosis();
    setLoadingDetail(true);
    setAnalysis(null);
    setSelectedOnlinePaperId(null);
    selectedOnlinePaperIdRef.current = null;
    setOnlineAnalysis(null);
    setSelectedBatchId(null);
    selectedBatchIdRef.current = null;
    setJobOutput(null);
    setJobError(null);
    setLoadingOnlineAnalysis(false);
    try {
      const data = await apiGet<ExamSummary>(`/api/exams/${encodeURIComponent(examId)}/summary`);
      if (legacyDetailRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedExamIdRef.current === examId) {
        setExamSummary(data);
        if (data.latest_batch_id) {
          selectedBatchIdRef.current = data.latest_batch_id;
          setSelectedBatchId(data.latest_batch_id);
        }
      }
    } catch (e) {
      if (legacyDetailRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        console.error("loadExamDetail failed", e);
      }
    } finally {
      if (legacyDetailRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedExamIdRef.current === examId) setLoadingDetail(false);
    }
  }, [invalidateDiagnosis, ownerProjectScopeKey]);

  const loadAnalysis = useCallback(
    async (examId: string, batchId: string) => {
      const requestId = ++legacyAnalysisRequestIdRef.current;
      const scopeKey = ownerProjectScopeKey;
      try {
        const data = await apiGet<ScoreAnalysis>(
          `/api/exams/${encodeURIComponent(examId)}/scores/${encodeURIComponent(batchId)}`,
        );
        if (legacyAnalysisRequestIdRef.current === requestId &&
            ownerProjectScopeKeyRef.current === scopeKey &&
            selectedExamIdRef.current === examId &&
            selectedBatchIdRef.current === batchId) {
          setAnalysis(data);
          setImportWarnings([]);
        }
      } catch (e) {
        if (legacyAnalysisRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
          console.error("loadAnalysis failed", e);
        }
      }
    },
    [ownerProjectScopeKey],
  );

  const handleExamSelect = useCallback(
    async (examId: string) => {
      setMobileTab("detail");
      selectedExamIdRef.current = examId;
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
    if (ownerProjectScopeReady && selectedExamId && selectedBatchId) {
      void loadAnalysis(selectedExamId, selectedBatchId);
    }
  }, [ownerProjectScopeReady, selectedExamId, selectedBatchId, loadAnalysis]);

  const loadEduAnalysisMeta = useCallback(async () => {
    const requestId = ++eduAnalysisMetaRequestIdRef.current;
    const scopeKey = metadataScopeKey;
    try {
      const [s, j, t] = await Promise.all([
        allowHostTools ? apiAnalysisListFolderScripts() : Promise.resolve({ scripts: [] }),
        apiAnalysisListJobs(),
        allowHostTools ? apiAnalysisListTools() : Promise.resolve({ tools: [] }),
      ]);
      if (eduAnalysisMetaRequestIdRef.current !== requestId || metadataScopeKeyRef.current !== scopeKey) return;
      setFolderScripts(s.scripts ?? []);
      setJobs(j.jobs ?? []);
      setTools((t.tools as ToolSpec[]) ?? []);
      setSelectedFolderScriptPath((previous) => s.scripts.some((script) => script.path === previous) ? previous : s.scripts[0]?.path ?? "");
    } catch (e) {
      if (eduAnalysisMetaRequestIdRef.current === requestId && metadataScopeKeyRef.current === scopeKey) {
        console.error("loadEduAnalysisMeta failed", e);
      }
    }
  }, [allowHostTools, metadataScopeKey]);

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
      const requestId = ++importRequestIdRef.current;
      const scopeKey = ownerProjectScopeKey;
      const isCurrent = () => importRequestIdRef.current === requestId &&
        ownerProjectScopeKeyRef.current === scopeKey &&
        selectedExamIdRef.current === examId;
      if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (result.warnings?.length) {
          setImportWarnings(result.warnings);
        }
        await loadExamDetail(examId);
        if (isCurrent()) {
          selectedBatchIdRef.current = result.batch_id;
          setSelectedBatchId(result.batch_id);
        }
      } catch (e) {
        if (isCurrent()) setImportError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isCurrent()) setImporting(false);
      }
    },
    [loadExamDetail, ownerProjectScopeKey],
  );

  const handleRecompute = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    const requestId = ++legacyAnalysisRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    const examId = selectedExamId;
    const batchId = selectedBatchId;
    try {
      const data = await apiPost<ScoreAnalysis>(
        `/api/exams/${encodeURIComponent(examId)}/scores/${encodeURIComponent(batchId)}/recompute`,
        {},
      );
      if (legacyAnalysisRequestIdRef.current === requestId &&
          ownerProjectScopeKeyRef.current === scopeKey &&
          selectedExamIdRef.current === examId &&
          selectedBatchIdRef.current === batchId) setAnalysis(data);
    } catch (e) {
      if (legacyAnalysisRequestIdRef.current === requestId && ownerProjectScopeKeyRef.current === scopeKey) {
        console.error("recompute failed", e);
      }
    }
  }, [selectedExamId, selectedBatchId, ownerProjectScopeKey]);

  const handleDeleteBatch = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    const scopeKey = ownerProjectScopeKey;
    const examId = selectedExamId;
    const batchId = selectedBatchId;
    const isCurrent = () => ownerProjectScopeKeyRef.current === scopeKey &&
      selectedExamIdRef.current === examId &&
      selectedBatchIdRef.current === batchId;
    const ok = await confirmDialog(t("confirmDeleteBatch"));
    if (!ok || !isCurrent()) return;
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/exams/${encodeURIComponent(examId)}/scores/${encodeURIComponent(batchId)}`,
      );
      if (isCurrent()) await loadExamDetail(examId);
    } catch (e) {
      if (isCurrent()) setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, selectedBatchId, ownerProjectScopeKey, loadExamDetail, t]);

  const handleDeleteExam = useCallback(async () => {
    if (!selectedExamId) return;
    const scopeKey = ownerProjectScopeKey;
    const deletedId = selectedExamId;
    const isCurrent = () => ownerProjectScopeKeyRef.current === scopeKey && selectedExamIdRef.current === deletedId;
    const ok = await confirmDialog(t("confirmDeleteExam"));
    if (!ok || !isCurrent()) return;
    try {
      await apiDelete<{ ok: boolean }>(`/api/exams/${encodeURIComponent(deletedId)}`);
      if (!isCurrent()) return;
      setSelectedExamId(null);
      selectedExamIdRef.current = null;
      setExamSummary(null);
      setSelectedBatchId(null);
      selectedBatchIdRef.current = null;
      setSelectedOnlinePaperId(null);
      selectedOnlinePaperIdRef.current = null;
      setAnalysis(null);
      invalidateDiagnosis();
      await loadExams();
      dispatchExamsChanged({ examId: deletedId });
    } catch (e) {
      if (isCurrent()) setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedExamId, ownerProjectScopeKey, loadExams, invalidateDiagnosis, t]);

  const handleRunBuiltinStudio = useCallback(async () => {
    if (!ownerProjectScopeReady || !selectedExamId || !selectedBatchId) return;
    const runId = ++studioRunRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    const examId = selectedExamId;
    const batchId = selectedBatchId;
    const isCurrent = () => studioRunRequestIdRef.current === runId &&
      ownerProjectScopeKeyRef.current === scopeKey &&
      selectedExamIdRef.current === examId &&
      selectedBatchIdRef.current === batchId;
    try {
      setJobError(null);
      setJobOutput(null);
      const res = await apiAnalysisRunBuiltin({
        builtin_id: "builtin:exam_stats_v1",
        exam_id: examId,
        batch_id: batchId,
        recompute: true,
      });
      if (!isCurrent()) return;
      if (res.output) setJobOutput(res.output);
      if ((res as { error?: string }).error) setJobError(String((res as { error?: string }).error));
      await loadEduAnalysisMeta();
    } catch (e) {
      if (isCurrent()) setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [ownerProjectScopeReady, selectedExamId, selectedBatchId, ownerProjectScopeKey, loadEduAnalysisMeta]);

  const handleRunFolderScriptStudio = useCallback(async () => {
    if (!ownerProjectScopeReady || !hostToolsAvailable || !allowHostToolsRef.current || !selectedExamId || !selectedBatchId || !selectedFolderScriptPath) return;
    const runId = ++studioRunRequestIdRef.current;
    const scopeKey = ownerProjectScopeKey;
    const metadataKey = metadataScopeKey;
    const examId = selectedExamId;
    const batchId = selectedBatchId;
    const scriptPath = selectedFolderScriptPath;
    const isCurrent = () => studioRunRequestIdRef.current === runId &&
      allowHostToolsRef.current &&
      metadataScopeKeyRef.current === metadataKey &&
      ownerProjectScopeKeyRef.current === scopeKey &&
      selectedExamIdRef.current === examId &&
      selectedBatchIdRef.current === batchId;
    try {
      setJobError(null);
      setJobOutput(null);
      const res = await apiAnalysisRunFolderScript({
        script_path: scriptPath,
        exam_id: examId,
        batch_id: batchId,
      });
      if (!isCurrent()) return;
      if (res.output) setJobOutput(res.output);
      if (res.error) setJobError(String(res.error));
      await loadEduAnalysisMeta();
    } catch (e) {
      if (isCurrent()) setImportError(e instanceof Error ? e.message : String(e));
    }
  }, [ownerProjectScopeReady, hostToolsAvailable, allowHostToolsRef, selectedExamId, selectedBatchId, selectedFolderScriptPath, ownerProjectScopeKey, metadataScopeKey, loadEduAnalysisMeta]);

  // SVG chart helpers
  const errorColorFn = (v: number, _warn?: boolean) => {
    if (v < 0.2) return "#10b981";
    if (v < 0.5) return "#f59e0b";
    return "#ef4444";
  };

  const formatPct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const visibleJobOutput = metadataScopeReady ? jobOutput : null;
  const visibleJobError = metadataScopeReady ? jobError : null;
  const visibleJobs = metadataScopeReady ? jobs : [];
  const normalizedOutput = visibleJobOutput && typeof visibleJobOutput === "object" ? (visibleJobOutput as Record<string, unknown>) : null;
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
    if (!metadataScopeReady || !jobOutput) return;
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
  }, [jobOutput, metadataScopeReady, t]);

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

  return ownerProjectScopeReady ? (
    <div className="flex h-full flex-col lg:flex-row overflow-hidden bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)]">
      {/* Mobile View Switcher */}
      <div className="flex lg:hidden shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2">
        <div ref={mobileSegmentRef} className="or-g52-mobile-segmented or-g52-mobile-segmented-indicator relative isolate w-full">
          <SelectionIndicator rootRef={mobileSegmentRef} selector={'[data-state="active"]'} />
          <button
            type="button"
            aria-pressed={mobileTab === "list"}
            data-state={mobileTab === "list" ? "active" : "inactive"}
            onClick={() => setMobileTab("list")}
            className={cn("or-g52-mobile-segmented-btn", mobileTab === "list" && "or-g52-mobile-segmented-btn-active")}
          >
            {t("historyTitle")}
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "detail"}
            data-state={mobileTab === "detail" ? "active" : "inactive"}
            onClick={() => setMobileTab("detail")}
            className={cn("or-g52-mobile-segmented-btn", mobileTab === "detail" && "or-g52-mobile-segmented-btn-active")}
          >
            {t("tabOverview")}
          </button>
          {selectedExamId && examSummary && (
            <button
              type="button"
              aria-pressed={mobileTab === "actions"}
              data-state={mobileTab === "actions" ? "active" : "inactive"}
              onClick={() => setMobileTab("actions")}
              className={cn("or-g52-mobile-segmented-btn", mobileTab === "actions" && "or-g52-mobile-segmented-btn-active")}
            >
              {t("quickActions")}
            </button>
          )}
        </div>
      </div>

      {/* Left sidebar: exam history */}
      <div
        className={cn(
          "shrink-0 flex-col border-r border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]",
          leftWidth === 56 ? "lg:w-56" : leftWidth === 64 ? "lg:w-64" : "lg:w-72",
          mobileTab === "list" ? "flex flex-1 w-full" : "hidden lg:flex"
        )}
      >
        <div className="flex items-center justify-between border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_70%,transparent)] px-3.5 py-2.5">
          <h3 className="text-sm font-semibold text-[var(--or-text)] tracking-tight">{t("historyTitle")}</h3>
          <div className="flex items-center gap-1.5">
            <div className="hidden lg:flex items-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-block)] p-0.5">
              <button
                type="button"
                onClick={() => setLeftWidth(56)}
                className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors", leftWidth === 56 ? "bg-[var(--or-card)] text-[var(--or-on-container)] shadow-2xs" : "text-[var(--or-muted)] hover:text-[var(--or-muted)]")}
              >
                S
              </button>
              <button
                type="button"
                onClick={() => setLeftWidth(64)}
                className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors", leftWidth === 64 ? "bg-[var(--or-card)] text-[var(--or-on-container)] shadow-2xs" : "text-[var(--or-muted)] hover:text-[var(--or-muted)]")}
              >
                M
              </button>
              <button
                type="button"
                onClick={() => setLeftWidth(72)}
                className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors", leftWidth === 72 ? "bg-[var(--or-card)] text-[var(--or-on-container)] shadow-2xs" : "text-[var(--or-muted)] hover:text-[var(--or-muted)]")}
              >
                L
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadExams();
                void loadOnlinePapers();
              }}
              className="rounded-lg p-1 text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] hover:text-[var(--or-muted)] transition-colors"
              title={t("refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <div className="space-y-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 shadow-2xs">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--or-muted)]" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索考试名称"
                className="w-full rounded-lg border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] py-1.5 pl-8 pr-2.5 text-xs text-[var(--or-text)] placeholder:text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:bg-[var(--or-card)] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <AppSelect
                value={historySubject}
                onValueChange={(value) => setHistorySubject(value)}
                className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1.5 text-xs text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none"
              >
                <option value="all">全部学科</option>
                {historySubjects.map((subject) => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </AppSelect>
              <AppSelect
                value={historyMode}
                onValueChange={(value) => setHistoryMode(value as "all" | "online" | "offline")}
                className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1.5 text-xs text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none"
              >
                <option value="all">全部形式</option>
                <option value="online">线上</option>
                <option value="offline">线下</option>
              </AppSelect>
            </div>
          </div>
          <AnalysisFoldersPanel
            folders={analysisFolders.folders}
            assignments={analysisFolders.items}
            visibleItemIds={visibleAnalysisItemIds}
            filter={analysisFolderFilter}
            onFilterChange={setAnalysisFolderFilter}
            selectedItemIds={selectedAnalysisItemIds}
            busy={analysisFolders.busy}
            loading={analysisFolders.loading}
            error={analysisFolders.error}
            onCreateFolder={analysisFolders.createFolder}
            onRenameFolder={analysisFolders.renameFolder}
            onDeleteFolder={analysisFolders.deleteFolder}
            onAssignItems={assignAnalysisItems}
          />
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h4 className="text-xs font-semibold text-[var(--or-muted)]">考试记录与分析</h4>
              {loadingOnlinePapers || loadingExams ? <RefreshCw className="h-3 w-3 animate-spin text-[var(--or-muted)]" /> : null}
            </div>
            {filteredOnlinePapers.length === 0 && filteredLegacyExams.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-[var(--or-muted)]">暂无考试记录</p>
            ) : (
              <div className="space-y-1">
                {filteredOnlinePapers.map((paper) => {
                  const hasSubmittedAnswers = (paper.submitted_student_count ?? 0) > 0;
                  const hasImportedScores = paper.score_batch_count > 0;
                  const hasBothSources = hasSubmittedAnswers && hasImportedScores;
                  const isSelected = selectedOnlinePaperId === paper.paper_id;
                  return (
                    <div
                      key={paper.paper_id}
                      className={cn(
                        "flex items-stretch rounded-xl border transition-colors",
                        isSelected
                          ? "border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] text-[var(--or-on-container)]"
                          : "border-transparent bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[var(--or-page)]",
                      )}
                      draggable
                      onDragStart={(event) => startAnalysisItemDrag(event, `paper:${paper.paper_id}`)}
                    >
                      <label className="flex w-6 shrink-0 items-start justify-center pt-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`选择归类 ${paper.title}`}
                          checked={selectedAnalysisItemSet.has(`paper:${paper.paper_id}`)}
                          disabled={!selectedAnalysisItemSet.has(`paper:${paper.paper_id}`) && selectedAnalysisItemIds.length >= 200}
                          onKeyDown={(event) => {
                            if (isShiftSpace(event)) {
                              event.preventDefault();
                              selectAnalysisRange(`paper:${paper.paper_id}`);
                            }
                          }}
                          onChange={(event) => {
                            if ((event.nativeEvent as MouseEvent).shiftKey) {
                              selectAnalysisRange(`paper:${paper.paper_id}`);
                            } else {
                              analysisSelectionAnchor.current = `paper:${paper.paper_id}`;
                              toggleAnalysisItem(`paper:${paper.paper_id}`);
                            }
                          }}
                          className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-0"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (paper.delivery_mode === "offline" && !hasSubmittedAnswers && hasImportedScores) {
                            void handleExamSelect(paper.exam_id);
                          } else {
                            void handleOnlinePaperSelect(paper);
                          }
                        }}
                        className="min-w-0 flex-1 px-2.5 py-2 text-left text-xs"
                      >
                        <span className="block truncate font-medium text-[var(--or-text)]">{paper.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--or-muted)]">
                          {[formatSubjectLabel(paper.subject), `${paper.question_count} 题`, `${paper.published_class_count} 班`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {hasSubmittedAnswers || (paper.in_progress_student_count ?? 0) > 0 ? (
                          <span className="mt-1 block truncate text-xs font-medium text-[var(--or-on-success)]">
                            {paper.submitted_student_count ?? 0} 份已提交 · {paper.in_progress_student_count ?? 0} 份答题中
                          </span>
                        ) : null}
                      </button>
                      {hasBothSources ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-r-xl border-l border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] px-2 text-xs font-medium text-[var(--or-on-container)] hover:bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] transition-colors"
                          onClick={() => void handleExamSelect(paper.exam_id)}
                          title="查看已导入的成绩批次"
                        >
                          导入成绩
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {filteredLegacyExams.map((exam) => {
                  const isSelected = selectedExamId === exam.exam_id;
                  return (
                    <div
                      key={exam.exam_id}
                      className={cn(
                        "flex items-stretch rounded-xl border transition-colors",
                        isSelected
                          ? "border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] text-[var(--or-on-container)]"
                          : "border-transparent bg-[var(--or-card)] hover:border-[var(--or-outline)] hover:bg-[var(--or-page)]",
                      )}
                      draggable
                      onDragStart={(event) => startAnalysisItemDrag(event, `exam:${exam.exam_id}`)}
                    >
                      <label className="flex w-6 shrink-0 items-start justify-center pt-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`选择归类 ${exam.exam_title || exam.exam_id}`}
                          checked={selectedAnalysisItemSet.has(`exam:${exam.exam_id}`)}
                          disabled={!selectedAnalysisItemSet.has(`exam:${exam.exam_id}`) && selectedAnalysisItemIds.length >= 200}
                          onKeyDown={(event) => {
                            if (isShiftSpace(event)) {
                              event.preventDefault();
                              selectAnalysisRange(`exam:${exam.exam_id}`);
                            }
                          }}
                          onChange={(event) => {
                            if ((event.nativeEvent as MouseEvent).shiftKey) {
                              selectAnalysisRange(`exam:${exam.exam_id}`);
                            } else {
                              analysisSelectionAnchor.current = `exam:${exam.exam_id}`;
                              toggleAnalysisItem(`exam:${exam.exam_id}`);
                            }
                          }}
                          className="h-4 w-4 shrink-0 rounded border-[var(--or-outline)] text-[var(--or-on-container)] focus:ring-0"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleExamSelect(exam.exam_id)}
                        className="min-w-0 flex-1 px-2.5 py-2 text-left text-xs"
                      >
                        <span className="block truncate font-medium text-[var(--or-text)]">{exam.exam_title || exam.exam_id}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--or-muted)]">
                          {[formatSubjectLabel(exam.subject), `${exam.question_count} 题`, exam.score_batch_count > 0 ? `${exam.score_batch_count} 批成绩` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--or-muted)]">
                          {formatLocaleDate(exam.mtime)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-r-xl border-l border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] px-2.5 text-xs font-medium text-[var(--or-on-container)] hover:bg-[color-mix(in_srgb,var(--or-primary-container)_60%,transparent)] transition-colors disabled:opacity-50"
                        disabled={browsePdfBusyId === exam.exam_id}
                        onClick={() => void openExamPdfWithDefaultApp(exam.exam_id)}
                      >
                        {browsePdfBusyId === exam.exam_id ? "…" : t("browse")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle: results only */}
      <div
        className={cn(
          "min-w-0 flex-1 flex-col overflow-hidden border-r border-[var(--or-outline)] bg-[var(--or-card)]",
          mobileTab === "detail" ? "flex w-full" : "hidden lg:flex",
        )}
      >
        {selectedOnlinePaperId ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="border-b border-[var(--or-outline)] pb-4">
              <button
                type="button"
                onClick={() => setMobileTab("list")}
                className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--or-on-container)] hover:text-[var(--or-on-container)] lg:hidden"
              >
                ← 返回考试列表
              </button>
              <h2 className="text-xl font-bold text-[var(--or-text)] tracking-tight">
                {selectedOnlinePaper?.title ?? onlineAnalysis?.paper.title ?? "试卷分析"}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-[var(--or-muted)]">
                {selectedOnlinePaper?.subject ? <span className="font-medium text-[var(--or-muted)]">{formatSubjectLabel(selectedOnlinePaper.subject)}</span> : null}
                {selectedOnlinePaper ? <span>{selectedOnlinePaper.question_count} 题</span> : null}
                {selectedOnlinePaper ? <span>{selectedOnlinePaper.published_class_count} 个班级</span> : null}
              </div>
            </div>
            {loadingOnlineAnalysis ? (
              <div className="flex min-h-[20rem] items-center justify-center text-[var(--or-muted)]">
                <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                <span>{t("loading")}</span>
              </div>
            ) : onlineAnalysis ? (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <G52StatCard
                    label="学生数"
                    value={onlineAnalysis.summary.total_students}
                    icon={<Users className="h-5 w-5" />}
                    valueClassName="text-[var(--or-text)]"
                  />
                  <G52StatCard
                    label="完成率"
                    value={`${onlineAnalysis.summary.completion_rate}%`}
                    icon={<Target className="h-5 w-5 text-[var(--or-on-container)]" />}
                    valueClassName="text-[var(--or-on-container)]"
                  />
                  <G52StatCard
                    label="平均得分率"
                    value={onlineAnalysis.summary.average_score ?? "-"}
                    icon={<Clock className="h-5 w-5 text-[var(--or-on-success)]" />}
                    valueClassName="text-[var(--or-on-success)]"
                  />
                  <G52StatCard
                    label="切屏超限"
                    value={onlineAnalysis.proctoring.exceeded_student_count ?? onlineAnalysis.proctoring.flagged_student_count}
                    icon={<ShieldAlert className="h-5 w-5 text-[var(--or-on-error)]" />}
                    valueClassName="text-[var(--or-on-error)]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-[var(--or-muted)]">
                  {(onlineAnalysis.publications?.length ?? 0) > 0 && (
                    <label className="flex items-center gap-2">
                      <span>发布批次</span>
                      <AppSelect
                        aria-label="分析发布批次"
                        className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-sm font-normal text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
                        value={onlineAnalysis.publication_id ?? ""}
                        onValueChange={(value) => {
                          if (selectedOnlinePaper) void handleOnlinePaperSelect(selectedOnlinePaper, value);
                        }}
                      >
                        {onlineAnalysis.publications?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} · {item.created_at} · {item.id.slice(0, 8)}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}
                  {(onlineAnalysis.available_classes?.length ?? 0) > 0 && selectedOnlinePaper && (
                    <label className="flex items-center gap-2">
                      <span>分析班级</span>
                      <AppSelect
                        aria-label="分析班级"
                        className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-sm font-normal text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none"
                        value={onlineAnalysis.class_id ?? ""}
                        onValueChange={(value) =>
                          void handleOnlinePaperSelect(
                            selectedOnlinePaper,
                            onlineAnalysis.publication_id ?? undefined,
                            value || undefined,
                          )
                        }
                      >
                        <option value="">全部班级</option>
                        {onlineAnalysis.available_classes?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.grade && !item.name.includes(item.grade) ? ` · ${item.grade}` : ""}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}
                </div>
                <PlatformPaperAnalysisCharts analysis={onlineAnalysis} />
              </div>
            ) : (
              <div className="flex min-h-[20rem] items-center justify-center text-sm text-[var(--or-muted)]">
                暂无分析数据；线下考试请先上传成绩或答卷照片。
              </div>
            )}
          </div>
        ) : !selectedExamId ? (
          <div className="flex h-full items-center justify-center text-[var(--or-muted)]">
            <div className="text-center">
              <BarChart3 className="mx-auto mb-3 h-12 w-12 text-[var(--or-muted)]" />
              <p className="text-sm font-medium">{t("emptyBeforeSelect")}</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex h-full items-center justify-center text-[var(--or-muted)]">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
            <span>{t("loading")}</span>
          </div>
        ) : examSummary ? (
          <>
            {/* Exam header */}
            <div className="shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-4 sm:px-6 py-4">
              <button
                type="button"
                onClick={() => setMobileTab("list")}
                className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--or-on-container)] hover:text-[var(--or-on-container)] lg:hidden"
              >
                ← 返回考试列表
              </button>
              <h2 className="text-xl font-bold text-[var(--or-text)] tracking-tight">
                {examSummary.exam_title}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-[var(--or-muted)]">
                {examSummary.subject && <span className="font-medium text-[var(--or-muted)]">{formatSubjectLabel(examSummary.subject)}</span>}
                <span>{t("questionCount", { n: examSummary.question_count })}</span>
                <span>{t("sectionCount", { n: examSummary.section_count })}</span>
                {examSummary.score_batch_count > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--or-on-success)]">
                    <CheckCircle className="h-4 w-4" />
                    {t("importCount", { n: examSummary.score_batch_count })}
                  </span>
                )}
              </div>
              {visibleJobOutput && (
                <div className="mt-3 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] px-4 py-2.5 text-xs text-[var(--or-muted)]">
                  {t("lastOutput", {
                    title: String(outputSummary?.title ?? t("defaultOutputTitle")),
                    status: String(outputSummary?.status ?? t("statusUnknown")),
                  })}
                </div>
              )}
              {visibleJobError && (
                <div className="mt-2.5 rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] px-4 py-2.5 text-sm text-[var(--or-on-error)]">
                  {visibleJobError}
                </div>
              )}

              {/* Import error */}
              {importError && (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-[var(--or-error)] bg-[var(--or-error-container)] px-4 py-2.5 text-sm text-[var(--or-on-error)]">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Import warnings (unbound questions) */}
              {importWarnings.length > 0 && (
                <div className="mt-2.5 rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] p-4 text-sm text-[var(--or-on-warning)]">
                  <div className="mb-1 flex items-center gap-2 font-medium text-[var(--or-on-warning)]">
                    <AlertTriangle className="h-4 w-4" />
                    {t("unboundWarning", { n: importWarnings.length })}
                  </div>
                  <ul className="space-y-1 text-xs text-[var(--or-on-warning)]">
                    {importWarnings.map((w) => (
                      <li key={w.question_id} className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold px-1 py-0.5 rounded bg-[var(--or-warning-container)] text-[var(--or-on-warning)]">
                          {w.header}
                        </span>
                        <span>: {w.message}</span>
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
                legacyAnalysisRequestIdRef.current += 1;
                studioRunRequestIdRef.current += 1;
                selectedBatchIdRef.current = batchId;
                setSelectedBatchId(batchId);
                setAnalysis(null);
                setJobOutput(null);
                setJobError(null);
                invalidateDiagnosis();
              }}
              onDeleteBatch={() => void handleDeleteBatch()}
            />

            {/* Stats tabs */}
            {!selectedBatchId ? (
              <div className="flex flex-1 items-center justify-center text-[var(--or-muted)]">
                <div className="text-center">
                  <TrendingUp className="mx-auto mb-3 h-12 w-12 text-[var(--or-muted)]" />
                  <p className="text-sm font-medium">{t("importToSee")}</p>
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
              <div className="flex flex-1 items-center justify-center text-[var(--or-muted)]">
                <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                <span>{t("computing")}</span>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Right: analysis controls + agent */}
      {selectedExamId && examSummary && (
        <div
          className={cn(
            "shrink-0 flex-col bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] border-l border-[var(--or-outline)] lg:w-[22rem]",
            mobileTab === "actions" ? "flex flex-1 w-full" : "hidden lg:flex",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_70%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--or-text)]">
              <span>{t("quickActions")}</span>
              <button
                type="button"
                onClick={() => setMobileTab("detail")}
                className="text-xs font-normal text-[var(--or-on-container)] hover:text-[var(--or-on-container)] lg:hidden"
              >
                查看报告 →
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
              <div className="space-y-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => void handleDownloadTemplate(examSummary.exam_id)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] transition-colors"
                >
                  <Download className="h-4 w-4 text-[var(--or-muted)]" />
                  <span>{t("downloadTemplate")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                >
                  {importing ? <RefreshCw className="h-4 w-4 animate-spin text-[var(--or-muted)]" /> : <Upload className="h-4 w-4 text-[var(--or-muted)]" />}
                  <span>{importing ? t("importing") : t("importScores")}</span>
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
                <button
                  type="button"
                  onClick={() => void handleRecompute()}
                  disabled={!selectedBatchId}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className="h-4 w-4 text-[var(--or-muted)]" />
                  <span>{t("recompute")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteBatch()}
                  disabled={!selectedBatchId}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--or-error)] bg-[var(--or-card)] px-3 py-2 text-xs font-medium text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4 text-[var(--or-on-error)]" />
                  <span>{t("deleteCurrentBatch")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteExam()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-300 bg-[var(--or-card)] px-3 py-2 text-xs font-medium text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] transition-colors"
                >
                  <Trash2 className="h-4 w-4 text-[var(--or-on-error)]" />
                  <span>{t("deleteExam")}</span>
                </button>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3.5 shadow-2xs">
                {hostToolsAvailable && (
                  <>
                    <div className="text-xs font-semibold text-[var(--or-muted)]">{t("scriptPickTitle")}</div>
                    <AppSelect
                      value={selectedFolderScriptPath}
                      onValueChange={(value) => setSelectedFolderScriptPath(value)}
                      className="w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs text-[var(--or-muted)] focus:border-[var(--or-primary)] focus:outline-none"
                    >
                      {folderScripts.length === 0 && <option value="">{t("noPyScripts")}</option>}
                      {folderScripts.map((s) => (
                        <option key={s.path} value={s.path}>
                          {s.path}
                        </option>
                      ))}
                    </AppSelect>
                    <button
                      type="button"
                      onClick={() => void handleRunFolderScriptStudio()}
                      disabled={!selectedBatchId || !selectedFolderScriptPath}
                      className="w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                    >
                      {t("runSelectedScript")}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void handleRunBuiltinStudio()}
                  disabled={!selectedBatchId}
                  className="w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                >
                  {t("runBuiltin")}
                </button>
                {hostToolsAvailable && (
                  <div className="text-xs text-[var(--or-muted)]">
                    {t("toolScriptCount", { tools: tools.length, scripts: folderScripts.length })}
                  </div>
                )}
              </div>

              <div className="space-y-2.5 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3.5 shadow-2xs">
                <div className="text-xs font-semibold text-[var(--or-muted)]">{t("scriptCharts")}</div>
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
                    <div className="rounded-lg bg-[var(--or-page)] p-4 text-center text-xs text-[var(--or-muted)]">
                      {t("noChart")}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDownloadMetadata()}
                    disabled={!metadataScopeReady || !jobOutput}
                    className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                  >
                    {t("downloadMeta")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadChartImage()}
                    disabled={!firstBarSpec || firstBarPoints.length === 0}
                    className="rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                  >
                    {t("downloadImage")}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3.5 text-xs text-[var(--or-muted)] shadow-2xs">
                <div className="mb-2 font-semibold text-[var(--or-muted)]">{t("recentJobs")}</div>
                <div className="max-h-32 overflow-y-auto space-y-1.5">
                  {visibleJobs.slice(0, 5).map((j) => (
                    <div key={j.job_id} className="flex items-center justify-between rounded-lg bg-[var(--or-page)] px-2.5 py-1.5">
                      <span className="font-mono text-xs text-[var(--or-muted)]">{j.job_id.slice(0, 8)}</span>
                      <span className="text-[var(--or-muted)]">{j.kind}</span>
                      <span className="or-g52-pill or-g52-pill-neutral !text-[11px] !px-1.5 !min-h-[18px]">
                        {j.status}
                      </span>
                    </div>
                  ))}
                  {visibleJobs.length === 0 && <div className="text-center py-2 text-[var(--or-muted)]">{t("noJobs")}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="flex h-full items-center justify-center text-[var(--or-muted)]" role="status">
      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
      <span>{t("loading")}</span>
    </div>
  );
}
