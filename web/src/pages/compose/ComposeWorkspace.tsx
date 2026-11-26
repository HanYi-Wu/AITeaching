import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import "../../ui-redesign/g49/g49.css";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../api/client";
import { useContentLibraryChanged } from "../../lib/contentEvents";
import { TexSetupNotice } from "../../components/TexSetupNotice";
import { useAgentActions } from "../../contexts/AgentContext";
import { useToolBarActions } from "../../contexts/ToolBarContext";
import i18n from "../../i18n/i18n";
import type { SectionSlot } from "../../lib/groupQuestions";
import { confirmDialog } from "../../lib/confirmDialog";
import { dispatchExamsChanged, SOLAIRE_EXAMS_CHANGED_EVENT, type ExamsChangedDetail } from "../../lib/examEvents";
import type { MetadataFilters } from "../../lib/metadataFilters";
import { isTauriShell } from "../../lib/tauriEnv";
import { isImeCompositionActive } from "../../lib/ime";
import {
  syncPlatformPaperFromExam,
  listContentFolders,
  listFolderItems,
  listTaggedItems,
  assignFolderItem,
  moveContentItemsToFolder,
  type ContentFolder,
  type ContentTag,
} from "../../platform/auth";
import type {
  ComposeExportTaskFormat,
  ComposePaperState,
  ExamDoc,
  ExamWorkspaceSummary,
  QuestionRow,
  RightSelection,
  TemplateRow,
} from "../../types/compose";
import type { AutoComposeResponse, DuplicateQuestionReport, DuplicateReport as DuplicateReportData } from "../../types/autoCompose";
import {
  downloadExportedBundle,
  normTemplatePath,
} from "./composeHelpers";
import {
  addQuestionsToSectionInModel,
  clonePaperState,
  buildSelectedItemsForApi as buildSelectedItemsFromModel,
  computeKnowledgeDistribution,
  computeTotalScore,
  examDocToPaperState,
  fillSectionGapsInModel,
  moveQuestionsInSectionInModel,
  removeQuestionsFromSectionInModel,
  resolveActiveSectionForTemplate,
  setPerQuestionScoreModeInModel,
  setQuestionScoreOverrideInModel,
  setSectionRequiredCountInModel,
  setSectionScorePerItemInModel,
} from "./composeModel";
import { buildComposeDraftPaperKey } from "./composeDraftStorage";
import { useComposeRequestScope } from "./useComposeRequestScope";
import { useComposePaperHistory } from "./useComposePaperHistory";
import { useComposeDraftScope } from "./useComposeDraftScope";
import { useComposeBankFilter } from "./useComposeBankFilter";
import { ComposeHistorySidebar } from "./ComposeHistorySidebar";
import { ComposeBankActionBar, ComposeBankSearchPanel } from "./ComposeBankSearchPanel";
import { useBankSelectionStore } from "./bank-search/rewrite-list";
import { ComposePaperEditorPanel } from "./ComposePaperEditorPanel";
import { ComposePdfPreviewAside } from "./ComposePdfPreviewAside";
import { NewPaperDialog } from "./NewPaperDialog";
import { PublishOnlineDialog } from "./PublishOnlineDialog";
import { useComposePublishing } from "./useComposePublishing";
import { PreviewPdfModal } from "./ComposeDialogs";
import { extractExamPathIdFromDir } from "./composeExportTasks";
import { useComposeExportTasks, type ExportSuccess } from "./useComposeExportTasks";
import { ComposeExportTaskBanner } from "./ComposeExportTaskBanner";
import { useTaskProgress } from "./useTaskProgress";
import { ComposeDraftRecoveryDialog } from "./ComposeDraftRecoveryDialog";
import { AutoComposeDialog } from "./AutoComposeDialog";
import { DuplicateReport } from "./DuplicateReport";

type GraphBindingNode = { id: string; canonical_name: string; node_kind?: string };

export function ComposeWorkspace({
  onError: reportError,
  toolBarActive = true,
  openExamId = null,
  onOpenExamConsumed,
  accountId,
  projectRoot,
}: {
  onError: (s: string | null) => void;
  /** 为 false 时不占用顶栏工具栏（父级隐藏组卷视图时使用） */
  toolBarActive?: boolean;
  /** 外部页面请求打开某个考试工作区（如分析页生成补练卷后跳转）。 */
  openExamId?: string | null;
  onOpenExamConsumed?: () => void;
  onOpenPapers?: () => void;
  /** 由应用壳层传入，确保本地草稿按账号与项目隔离；缺省时 hook 才会尝试读取当前会话。 */
  accountId?: string | null;
  projectRoot?: string | null;
}) {
  const { t } = useTranslation(["compose", "common", "lib"]);
  const { setPageContext } = useAgentActions();
  const { setToolBar, clearToolBar } = useToolBarActions();
  /** 用于右侧 PDF 的考试目录标识（``标签段/学科段``），与 ``GET /api/exams/{path}/pdf-file`` 一致 */
  const [pdfExamId, setPdfExamId] = useState<string | null>(null);
  const [pdfVariant, setPdfVariant] = useState<"student" | "teacher">("student");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [metadataFilters, setMetadataFilters] = useState<MetadataFilters>({});
  const [search, setSearch] = useState("");
  const [searchDraftResetVersion, setSearchDraftResetVersion] = useState(0);
  const [composeFilterExpanded, setComposeFilterExpanded] = useState(false);
  const [activeComposePanel, setActiveComposePanel] = useState<"paper" | "bank">("paper");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelectPortalContainer, setHistorySelectPortalContainer] = useState<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** 左侧题库差量订阅模型（qualified_id），按 ID 局部通知更新 */
  const bankSelectionStore = useBankSelectionStore([]);
  const [selectedRight, setSelectedRight] = useState<RightSelection | null>(null);
  /** 试卷栏 Shift 区间锚点（仅与 `section_id` 组合有效，不跨题型） */
  const [rightListAnchor, setRightListAnchor] = useState<{ sectionId: string; slotIndex: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [contentSyncing, setContentSyncing] = useState(false);
  const contentRequestIdRef = useRef(0);
  const templateRequestIdRef = useRef(0);

  const [currentExamId, setCurrentExamId] = useState<string | null>(null);
  /** 导出失败后服务端自动保存的考试工作区 id；下次导出成功时一并删除 */
  const [exportFailureExamIds, setExportFailureExamIds] = useState<string[]>([]);
  const [examSummaries, setExamSummaries] = useState<ExamWorkspaceSummary[]>([]);
  const [composeFolders, setComposeFolders] = useState<ContentFolder[]>([]);
  const [composeFolderItems, setComposeFolderItems] = useState<Record<string, string>>({});
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [selectedComposeFolderId, setSelectedComposeFolderId] = useState<string | null>(null);
  const [selectedComposeItemIds, setSelectedComposeItemIds] = useState<string[]>([]);
  const [movingComposeItems, setMovingComposeItems] = useState(false);
  const [conflictTargetId, setConflictTargetId] = useState<string | null>(null);
  const [conflictExportKind, setConflictExportKind] = useState<"pdf" | "word" | null>(null);
  const [exportPreflightFailure, setExportPreflightFailure] = useState<{ format: ComposeExportTaskFormat; reason: string } | null>(null);
  /** 最近一次导出成功后的考试目录标识（用于在未打开侧栏项时仍可从右侧打开 PDF） */
  const [lastExportedExamId, setLastExportedExamId] = useState<string | null>(null);
  const [viewPdfBusy, setViewPdfBusy] = useState(false);
  const [viewWordBusy, setViewWordBusy] = useState(false);
  const [wordExamId, setWordExamId] = useState<string | null>(null);
  /** 校验生成的临时预览会话 id（不入历史试卷） */
  const [previewPdfId, setPreviewPdfId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [questionBindingsIndex, setQuestionBindingsIndex] = useState<Record<string, GraphBindingNode[]>>({});
  const [newPaperDialogOpen, setNewPaperDialogOpen] = useState(false);
  const [dlgExportLabel, setDlgExportLabel] = useState("");
  const [dlgSubject, setDlgSubject] = useState("");
  const [dlgTemplatePath, setDlgTemplatePath] = useState("");
  const dialogTemplate = templates.find((item) => normTemplatePath(item.path) === normTemplatePath(dlgTemplatePath)) ?? templates[0];
  const [dlgMode, setDlgMode] = useState<"scratch" | "history">("scratch");
  /** 从历史复制时的源考试目录标识（须为已导出试卷的 ``exam_id``） */
  const [dlgHistorySourceExamId, setDlgHistorySourceExamId] = useState("");
  /** 从历史复制时的新考试标签（学科沿用源导出） */
  const [dlgHistoryExportLabel, setDlgHistoryExportLabel] = useState("");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [autoComposeOpen, setAutoComposeOpen] = useState(false);
  const [duplicateReportOpen, setDuplicateReportOpen] = useState(false);
  const [duplicateCheckLoading, setDuplicateCheckLoading] = useState(false);
  const [duplicateCheckError, setDuplicateCheckError] = useState<string | null>(null);
  const [duplicateReportRecord, setDuplicateReportRecord] = useState<{
    contextKey: string;
    selectionFingerprint: string;
    report: DuplicateReportData;
    stale: boolean;
  } | null>(null);
  const duplicateRequestIdRef = useRef(0);
  const examLoadSequence = useRef(0);
  const currentExamIdRef = useRef<string | null>(null);
  currentExamIdRef.current = currentExamId;

  const draftScope = useComposeDraftScope({ accountId, projectRoot, currentExamId });
  useEffect(() => {
    setExportFailureExamIds([]);
    setExportPreflightFailure(null);
    setBusy(false);
    setAutoComposeOpen(false);
    setDuplicateReportOpen(false);
    setDuplicateCheckLoading(false);
    setDuplicateCheckError(null);
  }, [currentExamId]);
  const captureOwnerRequest = useComposeRequestScope(draftScope.ownerKey);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const errorOwner = useRef(draftScope.ownerKey); errorOwner.current = draftScope.ownerKey;
  const onError = useCallback((message: string | null) => {
    if (mounted.current && errorOwner.current === draftScope.ownerKey) reportError(message);
  }, [draftScope.ownerKey, reportError]);
  const capturePaperRequest = useComposeRequestScope(`${draftScope.ownerKey}::${currentExamId ?? "scratch"}`);
  const clearOwnerView = useCallback(() => {
    currentExamIdRef.current = null;
    setCurrentExamId(null); setPdfExamId(null); setWordExamId(null); setLastExportedExamId(null);
    setPreviewPdfId(null); setPreviewOpen(false); setPreviewWarnings([]);
    bankSelectionStore.clear(); setSelectedRight(null); setRightListAnchor(null);
    setExportFailureExamIds([]); setMsg(null); setNewPaperDialogOpen(false); setPublishDialogOpen(false);
    setAutoComposeOpen(false); setDuplicateReportOpen(false); setDuplicateReportRecord(null); setDuplicateCheckLoading(false); setDuplicateCheckError(null);
    setBusy(false);
    setConflictTargetId(null); setConflictExportKind(null);
    setExportPreflightFailure(null);
  }, []);
  const {
    paperState: currentPaperState, selectedTpl, recoverableDraft, draftStorageStatus,
    isDirty, canUndo, canRedo, commitEdit: commitPaperState,
    resetPaperBaseline: resetPaperHistory, updateWithoutHistory, acceptSavedState,
    undo: undoCompose, redo: redoCompose, restoreLocalDraft, discardLocalDraft,
  } = useComposePaperHistory({
    initialExportLabel: i18n.t("defaultExamLabel", { ns: "compose" }),
    initialSubject: i18n.t("defaultSubject", { ns: "compose" }), templates,
    scope: draftScope.scope, storageKey: draftScope.storageKey, ownerKey: draftScope.ownerKey,
    shortcutsEnabled: toolBarActive && !newPaperDialogOpen && !publishDialogOpen && !conflictTargetId && !autoComposeOpen && !duplicateReportOpen,
    onOwnerIdentityChanged: clearOwnerView,
    onRestoredMsg: () => setMsg(t("compose:messages.localDraftRestored")),
    onDiscardedMsg: () => setMsg(t("compose:messages.localDraftDiscarded")),
  });
  const { exportLabel, subject, templatePath, templateRef, bySection, scoreBySection, countBySection, scoreOverrides } = currentPaperState;
  const paperStateRef = useRef(currentPaperState);
  paperStateRef.current = currentPaperState;
  const autoComposeRequestScopeKey = `${draftScope.ownerKey}::${currentExamId ?? "scratch"}::${JSON.stringify(currentPaperState)}`;
  const autoComposeOptionsScopeKey = `${draftScope.ownerKey}::${currentExamId ?? "scratch"}::${currentPaperState.subject}::${selectedTpl?.path ?? ""}::${selectedTpl?.id ?? ""}`;
  const reportContextKey = `${draftScope.ownerKey}::${currentExamId ?? "scratch"}`;
  const paperSelectionFingerprint = JSON.stringify(currentPaperState.bySection);
  const captureDuplicateRequest = useComposeRequestScope(autoComposeRequestScopeKey);
  useEffect(() => {
    duplicateRequestIdRef.current += 1;
    setDuplicateCheckLoading(false);
    setDuplicateCheckError(null);
  }, [autoComposeRequestScopeKey]);
  const currentDuplicateRecord = duplicateReportRecord?.contextKey === reportContextKey ? duplicateReportRecord : null;
  const duplicateThreshold = currentDuplicateRecord?.report.threshold ?? 0.85;
  const duplicateReportStale = Boolean(currentDuplicateRecord && (
    currentDuplicateRecord.stale || currentDuplicateRecord.selectionFingerprint !== paperSelectionFingerprint
  ));
  const duplicateQuestionMap = useMemo(() => {
    if (!currentDuplicateRecord || duplicateReportStale) return new Map<string, DuplicateQuestionReport>();
    return new Map(currentDuplicateRecord.report.questions
      .filter((question) => question.match_count > 0 || question.matches.length > 0 || question.occurrences > 1)
      .map((question) => [question.qualified_id, question]));
  }, [currentDuplicateRecord, duplicateReportStale]);

  useEffect(() => {
    if (!currentDuplicateRecord || currentDuplicateRecord.stale || currentDuplicateRecord.selectionFingerprint === paperSelectionFingerprint) return;
    setDuplicateReportRecord((previous) => previous && previous.contextKey === reportContextKey
      ? { ...previous, stale: true }
      : previous);
  }, [currentDuplicateRecord, paperSelectionFingerprint, reportContextKey]);

  const applyAutoComposeResult = useCallback((result: AutoComposeResponse) => {
    const nextBySection = Object.fromEntries((selectedTpl?.sections ?? []).map((section) => [section.section_id, [] as string[]]));
    for (const item of result.selected_items) {
      if (item.section_id in nextBySection) nextBySection[item.section_id] = [...item.question_ids];
    }
    const selectedCount = Object.values(nextBySection).reduce((sum, ids) => sum + ids.length, 0);
    if (result.generated_count <= 0 || selectedCount <= 0) {
      const gaps = result.goals.sections.filter((section) => section.actual_count < section.requested_count)
        .map((section) => `${section.section_id} ${section.actual_count}/${section.requested_count}`);
      const missing = result.goals.knowledge.missing_points;
      setMsg(`未能选出题目，当前试卷未更改。${gaps.length ? `小节缺口：${gaps.join("、")}。` : ""}${missing.length ? `未覆盖知识点：${missing.join("、")}。` : ""}${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`);
      return;
    }
    if (!selectedTpl || normTemplatePath(result.template_path) !== normTemplatePath(selectedTpl.path) || result.template_ref !== selectedTpl.id) {
      setMsg("组卷结果的模板与当前试卷不一致，未应用；请重新生成。");
      return;
    }

    const itemBySection = new Map(result.selected_items.map((item) => [item.section_id, item]));
    const nextCounts: Record<string, number> = {};
    for (const section of selectedTpl.sections) {
      if (section.type === "text") continue;
      const count = itemBySection.get(section.section_id)?.required_count;
      if (count !== undefined && count !== section.required_count) nextCounts[section.section_id] = count;
    }
    const nextOverrides: Record<string, Record<string, number>> = {};
    for (const [sectionId, ids] of Object.entries(nextBySection)) {
      const selectedIds = new Set(ids);
      const overrides = paperStateRef.current.scoreOverrides[sectionId];
      const retained = overrides
        ? Object.fromEntries(Object.entries(overrides).filter(([qid]) => selectedIds.has(qid)))
        : {};
      if (Object.keys(retained).length > 0) nextOverrides[sectionId] = retained;
    }

    const nextState: ComposePaperState = {
      ...paperStateRef.current,
      bySection: nextBySection,
      countBySection: nextCounts,
      scoreOverrides: nextOverrides,
    };
    const nextSelectionFingerprint = JSON.stringify(nextState.bySection);
    setDuplicateReportRecord({
      contextKey: reportContextKey,
      selectionFingerprint: nextSelectionFingerprint,
      report: result.duplicate_report,
      stale: false,
    });
    commitPaperState(nextState);
    setSelectedRight(null);
    setRightListAnchor(null);
    if (!result.complete) {
      const missing = result.goals.knowledge.missing_points;
      const gaps = result.goals.sections.filter((section) => section.actual_count < section.requested_count)
        .map((section) => `${section.section_id} ${section.actual_count}/${section.requested_count}`);
      setMsg(`已生成 ${selectedCount} 题，部分目标未达成。${gaps.length ? `小节缺口：${gaps.join("、")}。` : ""}${missing.length ? `未覆盖知识点：${missing.join("、")}。` : ""}${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`);
    } else {
      setMsg(`已按目标生成并应用 ${selectedCount} 题，可使用撤销恢复此前试卷。`);
    }
  }, [commitPaperState, reportContextKey, selectedTpl]);

  const checkDuplicates = useCallback(async () => {
    const questionIds = Object.values(paperStateRef.current.bySection).flat();
    if (questionIds.length === 0) {
      setMsg("当前试卷还没有题目，无法查重。");
      return;
    }
    const isCurrent = captureDuplicateRequest();
    const requestId = ++duplicateRequestIdRef.current;
    setDuplicateReportOpen(true);
    setDuplicateCheckLoading(true);
    setDuplicateCheckError(null);
    setMsg(null);
    try {
      const report = await apiPost<DuplicateReportData>("/api/exam/check-duplicates", {
        question_ids: questionIds,
        exclude_exam_id: currentExamId,
        similarity_threshold: duplicateThreshold,
      });
      if (!isCurrent() || requestId !== duplicateRequestIdRef.current) return;
      setDuplicateReportRecord({
        contextKey: reportContextKey,
        selectionFingerprint: JSON.stringify(paperStateRef.current.bySection),
        report,
        stale: false,
      });
    } catch (error) {
      if (!isCurrent() || requestId !== duplicateRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setDuplicateCheckError(message);
      setMsg(`查重失败：${message}`);
    } finally {
      if (isCurrent() && requestId === duplicateRequestIdRef.current) setDuplicateCheckLoading(false);
    }
  }, [captureDuplicateRequest, currentExamId, duplicateThreshold, reportContextKey]);

  const locateQuestionFromReport = useCallback((qualifiedId: string) => {
    const sectionId = Object.entries(paperStateRef.current.bySection)
      .find(([, ids]) => ids.includes(qualifiedId))?.[0];
    if (!sectionId) return;
    setActiveSection(sectionId);
    setSelectedRight({ sectionId, qids: [qualifiedId] });
    setActiveComposePanel("paper");
    setHistoryOpen(false);
    setDuplicateReportOpen(false);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([listContentFolders("compose"), listFolderItems("compose"), listTaggedItems("compose")]).then(([folders, items, tags]) => {
      if (active) { setComposeFolders(folders.folders); setComposeFolderItems(items.items); setTaggedItems(tags.items); }
    }).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openViewPdfExternally = useCallback(async () => {
    const id = pdfExamId ?? lastExportedExamId;
    if (!id) {
      return;
    }
    if (isTauriShell()) {
      setViewPdfBusy(true);
      try {
        await apiPost<{ ok?: boolean }>(`/api/exams/${encodeURIComponent(id)}/open-pdf`, {
          variant: pdfVariant,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        window.alert(errMsg);
      } finally {
        setViewPdfBusy(false);
      }
    } else {
      const url = `${window.location.origin}/api/exams/${encodeURIComponent(id)}/pdf-file?variant=${pdfVariant}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [pdfExamId, lastExportedExamId, pdfVariant]);


  const openViewWordExternally = useCallback(async () => {
    const summaryId = wordExamId ?? pdfExamId;
    const summaryHasDocx = summaryId
      ? examSummaries.find((ex) => ex.exam_id === summaryId)?.has_docx === true
      : false;
    const id = wordExamId ?? (summaryHasDocx ? summaryId : null);
    if (!id) {
      return;
    }
    if (isTauriShell()) {
      setViewWordBusy(true);
      try {
        await apiPost<{ ok?: boolean }>(`/api/exams/${encodeURIComponent(id)}/open-docx`, {
          variant: pdfVariant,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        window.alert(errMsg);
      } finally {
        setViewWordBusy(false);
      }
    } else {
      const url = `${window.location.origin}/api/exams/${encodeURIComponent(id)}/docx-file?variant=${pdfVariant}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [examSummaries, pdfExamId, pdfVariant, wordExamId]);
  const refreshTemplates = useCallback(async () => {
    const isCurrent = captureOwnerRequest();
    const requestId = ++templateRequestIdRef.current;
    const r = await apiGet<{ templates: TemplateRow[] }>("/api/templates");
    const next = r.templates ?? [];
    if (!isCurrent()) return [];
    if (requestId === templateRequestIdRef.current) setTemplates(next);
    return next;
  }, [captureOwnerRequest]);

  const refreshContentLibrary = useCallback(async () => {
    const isCurrent = captureOwnerRequest();
    const requestId = ++contentRequestIdRef.current;
    const templateRequestId = ++templateRequestIdRef.current;
    const [templateData, questionData, subjectData] = await Promise.all([
      apiGet<{ templates: TemplateRow[] }>("/api/templates"),
      apiGet<{ questions: QuestionRow[] }>("/api/questions"),
      apiGet<{ subjects: string[] }>("/api/bank/subjects"),
    ]);
    if (!isCurrent() || requestId !== contentRequestIdRef.current) return false;
    const nextTemplates = templateData.templates ?? [];
    if (templateRequestId === templateRequestIdRef.current) setTemplates(nextTemplates);
    setQuestions(questionData.questions);
    const list = subjectData.subjects.length
      ? subjectData.subjects
      : [...new Set(questionData.questions.map((item) => item.subject).filter(Boolean) as string[])];
    setSubjectOptions(list);
    if (!currentExamIdRef.current) {
      updateWithoutHistory((previous) => list.length && !list.includes(previous.subject.trim())
        ? { ...previous, subject: list[0] ?? previous.subject } : previous);
    }
    return true;
  }, [captureOwnerRequest, updateWithoutHistory]);

  useEffect(() => {
    const parts: string[] = [];
    parts.push(t("compose:pageContext.subject", { v: subject.trim() || "—" }));
    if (templatePath) {
      const leaf = templatePath.includes("/") ? templatePath.split("/").pop() : templatePath;
      if (leaf) parts.push(t("compose:pageContext.template", { v: leaf }));
    }
    if (exportLabel.trim()) parts.push(t("compose:pageContext.exportLabel", { v: exportLabel.trim() }));
    setPageContext({
      current_page: "compose",
      summary: parts.length ? parts.join("；") : t("compose:pageContext.default"),
    });
    return () => setPageContext(null);
  }, [subject, templatePath, exportLabel, setPageContext, t]);

  /** 题库目录导出的 subjects 可能不含当前试卷学科；必须把 exam 中的学科并入选项，否则 select 无匹配项、界面表现为未切到该学科 */
  const subjectOptionsForSelect = useMemo(() => {
    const base = subjectOptions.length > 0 ? subjectOptions : [];
    const merged = new Set<string>(base);
    const cur = subject.trim();
    if (cur) {
      merged.add(cur);
    }
    const dlg = dlgSubject.trim();
    if (dlg) {
      merged.add(dlg);
    }
    const arr = [...merged];
    arr.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    if (arr.length > 0) {
      return arr;
    }
    return cur ? [cur] : dlg ? [dlg] : [];
  }, [subjectOptions, subject, dlgSubject]);

  const { namespaces, metadataFilterDefinitions, filteredQuestions } = useComposeBankFilter({
    questions, subject, namespaceFilter, typeFilter, metadataFilters, search,
  });
  const commitSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  useEffect(() => {
    const allowed = new Set(filteredQuestions.map((q) => q.qualified_id));
    bankSelectionStore.pruneFiltered(allowed);
  }, [filteredQuestions, bankSelectionStore]);

  useEffect(() => {
    onError(null);
    void refreshContentLibrary()
      .catch((e: Error) => onError(e.message));
  }, [onError, refreshContentLibrary]);

  useContentLibraryChanged(() => {
    setContentSyncing(true);
    void refreshContentLibrary()
      .catch((error: Error) => {
        onError(error.message);
        return true;
      })
      .then((latest) => {
        if (latest) setContentSyncing(false);
      });
  });

  useEffect(() => {
    setNamespaceFilter("__all__");
    setTypeFilter("__all__");
  }, [subject]);

  useEffect(() => {
    setActiveSection((previous) => resolveActiveSectionForTemplate(previous, selectedTpl));
  }, [selectedTpl]);

  const refreshExamSummaries = useCallback(async () => {
    const isCurrent = captureOwnerRequest();
    try {
      const r = await apiGet<{ exams: ExamWorkspaceSummary[] }>("/api/exams");
      if (isCurrent()) setExamSummaries(r.exams ?? []);
    } catch {
      /* ignore */
    }
  }, [captureOwnerRequest]);

  useEffect(() => {
    void refreshExamSummaries();
  }, [refreshExamSummaries]);

  useEffect(() => {
    const onExamsChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<ExamsChangedDetail>).detail ?? {};
      void refreshExamSummaries();
      const examId = detail.examId;
      if (!examId) {
        return;
      }
      if (currentExamIdRef.current === examId) {
        setCurrentExamId(null);
        updateWithoutHistory((previous) => ({ ...previous, draftName: "" }));
        setPdfExamId(null);
        setPreviewPdfId(null);
      }
      setLastExportedExamId((prev) => (prev === examId ? null : prev));
      setPdfExamId((prev) => (prev === examId ? null : prev));
      setWordExamId((prev) => (prev === examId ? null : prev));
      setDlgHistorySourceExamId((prev) => (prev === examId ? "" : prev));
      setExportFailureExamIds((prev) => prev.filter((x) => x !== examId));
      setConflictTargetId((prev) => (prev === examId ? null : prev));
      setConflictExportKind(null);
      onError(null);
    };
    window.addEventListener(SOLAIRE_EXAMS_CHANGED_EVENT, onExamsChanged);
    return () => window.removeEventListener(SOLAIRE_EXAMS_CHANGED_EVENT, onExamsChanged);
  }, [refreshExamSummaries, onError]);

  const hasSelectedQuestions = useMemo(
    () => Object.values(bySection).some((questions) => questions.length > 0),
    [bySection],
  );

  useEffect(() => {
    setQuestionBindingsIndex((current) => Object.keys(current).length === 0 ? current : {});
    // This index only affects the breakdown when the paper already has selected questions.
    if (!toolBarActive || !hasSelectedQuestions) return;
    let active = true;
    const isCurrent = captureOwnerRequest();
    void apiGet<{ index: Record<string, GraphBindingNode[]> }>("/api/graph/question-bindings-index")
      .then((r) => { if (active && isCurrent()) setQuestionBindingsIndex(r.index ?? {}); })
      .catch(() => { if (active && isCurrent()) setQuestionBindingsIndex({}); });
    return () => { active = false; };
  }, [toolBarActive, hasSelectedQuestions, captureOwnerRequest]);

  const knowledgeDistributionRows = useMemo(
    () => computeKnowledgeDistribution(bySection, questionBindingsIndex),
    [bySection, questionBindingsIndex],
  );

  const countsOk = useMemo(() => {
    if (!selectedTpl) {
      return false;
    }
    return hasSelectedQuestions && selectedTpl.sections.every((s) => {
      if (s.type === "text") {
        return true;
      }
      if (s.type === "practice") {
        return (bySection[s.section_id]?.length ?? 0) > 0;
      }
      return (bySection[s.section_id]?.length ?? 0) === (countBySection[s.section_id] ?? s.required_count);
    });
  }, [selectedTpl, hasSelectedQuestions, bySection, countBySection]);

  const totalScore = useMemo(
    () => computeTotalScore(selectedTpl, bySection, scoreBySection, scoreOverrides),
    [selectedTpl, bySection, scoreBySection, scoreOverrides],
  );

  const questionMap = useMemo(() => {
    const m = new Map<string, QuestionRow>();
    for (const q of questions) {
      m.set(q.qualified_id, q);
    }
    return m;
  }, [questions]);

  const handleLeftBankClick = useCallback(
    (q: QuestionRow, index: number, e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (e.shiftKey) {
        bankSelectionStore.selectRange(q.qualified_id, index, filteredQuestions);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        bankSelectionStore.toggle(q.qualified_id);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      bankSelectionStore.selectSingle(q.qualified_id);
      setSelectedRight(null);
      setRightListAnchor(null);
    },
    [filteredQuestions, bankSelectionStore],
  );

  const handleRightPaperSlotClick = useCallback(
    (
      sectionId: string,
      slots: SectionSlot<QuestionRow>[],
      slotIndex: number,
      slot: SectionSlot<QuestionRow>,
      e: MouseEvent<HTMLButtonElement>,
    ) => {
      e.preventDefault();
      const slotIds = slot.kind === "single" ? [slot.qid] : [...slot.qids];
      const sectionQids = bySection[sectionId] ?? [];
      const mergeOrder = (ids: Set<string>) => sectionQids.filter((id) => ids.has(id));

      if (e.shiftKey) {
        if (rightListAnchor && rightListAnchor.sectionId !== sectionId) {
          setSelectedRight({ sectionId, qids: slotIds });
          setRightListAnchor({ sectionId, slotIndex });
          bankSelectionStore.setSelectedIds(slotIds);
          return;
        }
        const anchorSlot =
          rightListAnchor && rightListAnchor.sectionId === sectionId ? rightListAnchor.slotIndex : slotIndex;
        const start = Math.min(anchorSlot, slotIndex);
        const end = Math.max(anchorSlot, slotIndex);
        const ordered: string[] = [];
        for (let i = start; i <= end; i++) {
          const sl = slots[i];
          if (!sl) {
            continue;
          }
          if (sl.kind === "single") {
            ordered.push(sl.qid);
          } else {
            ordered.push(...sl.qids);
          }
        }
        setSelectedRight({ sectionId, qids: ordered });
        setRightListAnchor({ sectionId, slotIndex });
        bankSelectionStore.setSelectedIds(ordered);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (selectedRight?.sectionId !== sectionId) {
          setSelectedRight({ sectionId, qids: slotIds });
          setRightListAnchor({ sectionId, slotIndex });
          bankSelectionStore.setSelectedIds(slotIds);
          return;
        }
        const cur = new Set(selectedRight.qids);
        const allIn = slotIds.every((id) => cur.has(id));
        if (allIn) {
          slotIds.forEach((id) => cur.delete(id));
        } else {
          slotIds.forEach((id) => cur.add(id));
        }
        const nextOrdered = mergeOrder(cur);
        setSelectedRight(nextOrdered.length ? { sectionId, qids: nextOrdered } : null);
        setRightListAnchor({ sectionId, slotIndex });
        bankSelectionStore.setSelectedIds(nextOrdered);
        return;
      }
      setSelectedRight({ sectionId, qids: slotIds });
      setRightListAnchor({ sectionId, slotIndex });
      bankSelectionStore.setSelectedIds(slotIds);
    },
    [bankSelectionStore, bySection, rightListAnchor, selectedRight],
  );

  const dlgSelectedPastExam = useMemo(
    () => examSummaries.find((ex) => ex.exam_id === dlgHistorySourceExamId),
    [examSummaries, dlgHistorySourceExamId],
  );

  const draftExamRows = useMemo(
    () => examSummaries.filter((e) => (e.status ?? "draft") !== "exported" && (!selectedComposeFolderId || composeFolderItems[e.exam_id] === selectedComposeFolderId)),
    [examSummaries, selectedComposeFolderId, composeFolderItems],
  );
  const exportedExamRows = useMemo(
    () => examSummaries.filter((e) => e.status === "exported" && (!selectedComposeFolderId || composeFolderItems[e.exam_id] === selectedComposeFolderId)),
    [examSummaries, selectedComposeFolderId, composeFolderItems],
  );
  const visibleComposeItemIds = useMemo(
    () => [...draftExamRows, ...exportedExamRows].map((exam) => exam.exam_id),
    [draftExamRows, exportedExamRows],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleComposeItemIds);
    setSelectedComposeItemIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [visibleComposeItemIds]);

  useEffect(() => {
    setSelectedComposeItemIds([]);
    setMovingComposeItems(false);
  }, [draftScope.ownerKey]);

  const toggleComposeItem = useCallback((itemId: string) => {
    setSelectedComposeItemIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
  }, []);
  const toggleVisibleComposeItems = useCallback((visibleIds: string[]) => {
    setSelectedComposeItemIds((current) => {
      const visible = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (allVisibleSelected) return current.filter((id) => !visible.has(id));
      return [...current.filter((id) => !visible.has(id)), ...visibleIds];
    });
  }, []);
  const clearComposeItems = useCallback(() => setSelectedComposeItemIds([]), []);
  const moveComposeItemsToFolder = useCallback(async (itemIds: string[], folderId: string | null) => {
    const isCurrent = captureOwnerRequest();
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return;
    setMovingComposeItems(true);
    try {
      await moveContentItemsToFolder("compose", ids, folderId);
      if (!isCurrent()) return;
      setComposeFolderItems((current) => {
        const next = { ...current };
        for (const id of ids) {
          if (folderId) next[id] = folderId;
          else delete next[id];
        }
        return next;
      });
      setSelectedComposeItemIds([]);
    } catch (error) {
      if (isCurrent()) onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (isCurrent()) setMovingComposeItems(false);
    }
  }, [captureOwnerRequest, onError]);

  const buildSelectedItemsForApi = useCallback(() => {
    return buildSelectedItemsFromModel(selectedTpl, paperStateRef.current);
  }, [selectedTpl]);

  const consumeExportResult = useCallback(async ({ format, result, submitted, idsToDelete, isCurrent }: ExportSuccess) => {
    if (!isCurrent()) return;
    const examPathId = extractExamPathIdFromDir(result.exam_dir);
    const deletedIds = result.deleted_exam_ids ?? idsToDelete;
    let baselineWarning = "";
    // Saving the submitted baseline must preserve edits made while the job ran.
    if (submitted) acceptSavedState(submitted, submitted);
    else if (examPathId && currentExamId === examPathId) {
      try {
        const response = await apiGet<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(examPathId)}`);
        if (!isCurrent()) return;
        const saved = examDocToPaperState(response.exam).state;
        acceptSavedState(saved, saved);
      } catch (error) {
        baselineWarning = `；已完成导出，但未能读取已保存试卷：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!isCurrent()) return;
    setLastExportedExamId(examPathId);
    if (examPathId) {
      setPdfVariant("student");
      if (format === "pdf") setPdfExamId(examPathId);
      else { setWordExamId(examPathId); if (examSummaries.find((exam) => exam.exam_id === examPathId)?.has_pdf) setPdfExamId(examPathId); }
    }
    setExportFailureExamIds([]);
    void refreshExamSummaries();
    let message = t(format === "pdf" ? "compose:messages.exportOk" : "compose:messages.exportWordOk", {
      student: result[format === "pdf" ? "student_pdf" : "student_docx"] ?? "",
      teacher: result[format === "pdf" ? "teacher_pdf" : "teacher_docx"] ?? "", dir: result.exam_dir,
    });
    message += baselineWarning;
    if (deletedIds.length) message += t("compose:messages.draftRemovedAfterExport");
    setMsg(message);
    if (examPathId) {
      try { await syncPlatformPaperFromExam(examPathId); }
      catch (error) { message += `；试卷中心同步未完成：${error instanceof Error ? error.message : String(error)}`; }
      if (!isCurrent()) return;
      try { await downloadExportedBundle(examPathId, format); }
      catch (error) { message += `；文件已保存在服务器，但浏览器下载失败：${error instanceof Error ? error.message : String(error)}`; }
      if (isCurrent()) setMsg(message);
    }
    if (isCurrent() && currentExamId && deletedIds.includes(currentExamId)) {
      // Older servers may remove the workspace that is still open locally.
      // Keep its current content, but save future edits as a new workspace.
      const nextScope = draftScope.scope && { ...draftScope.scope, paperKey: buildComposeDraftPaperKey(null) };
      const baseline = submitted ?? paperStateRef.current;
      acceptSavedState(baseline, baseline, nextScope);
      currentExamIdRef.current = null;
      setCurrentExamId(null);
    }
  }, [acceptSavedState, currentExamId, draftScope.scope, examSummaries, refreshExamSummaries, t]);

  const exportTasks = useComposeExportTasks({
    ownerKey: `${draftScope.ownerKey}::${currentExamId ?? "scratch"}`,
    currentExamId, exportLabel, subject,
    onTaskSucceeded: consumeExportResult,
    onTaskFailed: ({ message, examSaved, sourceAction }) => {
      if (examSaved) {
        if (sourceAction !== "recent_resume") setExportFailureExamIds((previous) => [...new Set([...previous, examSaved.exam_id])]);
        void refreshExamSummaries();
        onError(t("compose:errors.exportWithDraftSaved", { name: examSaved.name, detail: message }));
      } else onError(message);
    },
    onError,
  });

  const taskProgress = useTaskProgress({
    taskId: exportTasks.activeTask?.id ?? null,
    scopeKey: `${draftScope.ownerKey}::${currentExamId ?? "scratch"}`,
    pollIntervalMs: 650,
    enabled: Boolean(exportTasks.activeTask && ["queued", "running"].includes(exportTasks.activeTask.status)),
  });

  const startExportTask = useCallback(async (
    format: ComposeExportTaskFormat, overwriteExisting: string | null,
    examIdToDelete: string | null, failureIds: string[], workspaceId: string | null,
    snapshot?: ComposePaperState,
  ) => {
    if (!selectedTpl || !countsOk) return;
    const submitted = clonePaperState(snapshot ?? paperStateRef.current);
    const idsToDelete = [...new Set([examIdToDelete, ...failureIds].filter((id): id is string => Boolean(id)))];
    await exportTasks.startExportTask({ format, submitted, idsToDelete, body: {
      export_label: submitted.exportLabel.trim(), subject: submitted.subject.trim(), metadata_title: submitted.exportLabel.trim(),
      template_ref: submitted.templateRef, template_path: submitted.templatePath,
      selected_items: buildSelectedItemsFromModel(selectedTpl, submitted),
      ...(overwriteExisting ? { overwrite_existing: overwriteExisting } : {}),
      ...(workspaceId ? { exam_workspace_id: workspaceId } : {}),
      ...(idsToDelete.length ? { exam_ids_to_delete_on_success: idsToDelete } : {}),
    } });
  }, [countsOk, exportTasks.startExportTask, selectedTpl]);

  const applyExamDocument = useCallback((doc: ExamDoc) => {
    setPreviewPdfId(null);
    setPreviewWarnings([]);
    const eid = String(doc.exam_id ?? "").trim();
    /** 同步 ref，避免首屏 subjects 请求的 `.then` 在 React 提交前读到陈旧 ref 而覆盖学科 */
    currentExamIdRef.current = eid || null;
    setCurrentExamId(eid || null);
    const parsed = examDocToPaperState(doc, { templatePath });
    resetPaperHistory(parsed.state);
    bankSelectionStore.clear();
    setSelectedRight(null);
    setRightListAnchor(null);
  }, [bankSelectionStore, resetPaperHistory, templatePath]);

  function addQuestionsToSection(questionIds: string[], sectionId: string | null) {
    const result = addQuestionsToSectionInModel({
      state: paperStateRef.current,
      template: selectedTpl,
      sectionId,
      questionIds,
      questionMap,
    });
    if (!result.ok) {
      if (result.errorCode === "typeMismatch") {
        onError(t("compose:errors.typeMismatch", { need: result.need, got: result.got }));
      } else {
        onError(t(`compose:errors.${result.errorCode}`));
      }
      return;
    }
    if (!result.changed) return;
    onError(null);
    commitPaperState(result.nextState);
    if (result.skippedTypeCount > 0) {
      setMsg(t("compose:messages.multiAddSkipped", { n: result.skippedTypeCount }));
    }
  }

  function addFromLeft() {
    addQuestionsToSection([...bankSelectionStore.getOrderedIds()], activeSection);
  }

  function fillSectionGaps() {
    if (!selectedTpl) return;
    const filled = fillSectionGapsInModel({
      state: paperStateRef.current,
      template: selectedTpl,
      candidateQuestions: filteredQuestions,
    });
    if (filled.changed) commitPaperState(filled.nextState);
    setMsg(`已补入 ${filled.addedCount} 题；不足时请放宽左侧筛选条件。`);
  }

  function removeDraggedQuestion(sectionId: string, qid: string) {
    const result = removeQuestionsFromSectionInModel(paperStateRef.current, sectionId, [qid]);
    if (!result.ok || !result.changed) return;
    commitPaperState(result.nextState);
    setSelectedRight(null);
    onError(null);
  }

  function removeFromRight() {
    if (!selectedRight || selectedRight.qids.length === 0) {
      onError(t("compose:errors.selectPaperItemFirst"));
      return;
    }
    const removeIds = selectedRight.qids;
    const secId = selectedRight.sectionId;
    onError(null);
    const result = removeQuestionsFromSectionInModel(paperStateRef.current, secId, removeIds);
    if (result.ok && result.changed) commitPaperState(result.nextState);
    setSelectedRight(null);
    setRightListAnchor(null);
  }

  function moveSelectedRight(direction: "up" | "down") {
    if (!selectedRight || selectedRight.qids.length === 0) {
      return;
    }
    const result = moveQuestionsInSectionInModel(
      paperStateRef.current,
      selectedRight.sectionId,
      selectedRight.qids,
      direction,
      questionMap,
    );
    if (result.changed) {
      commitPaperState(result.nextState);
    }
  }

  async function validate() {
    const isCurrent = capturePaperRequest();
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    setPreviewWarnings([]);
    try {
      const selected_items = buildSelectedItemsForApi();
      const res = await apiPost<{
        ok: boolean;
        preview_id: string;
        warnings?: string[];
      }>("/api/exam/preview-pdf", {
        export_label: exportLabel.trim() || t("compose:previewDefaultLabel"),
        subject: subject.trim() || t("compose:previewDefaultSubject"),
        metadata_title: exportLabel.trim() || t("compose:previewDefaultLabel"),
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      });
      setPreviewPdfId(res.preview_id);
      setPreviewOpen(true);
      const w = res.warnings ?? [];
      setPreviewWarnings(w);
      setMsg(
        w.length > 0
          ? t("compose:messages.previewPdfReadyWithWarnings", { n: w.length })
          : t("compose:messages.previewPdfReady"),
      );
    } catch (e) {
      if (!isCurrent()) return;
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function confirmNewPaperDialog() {
    const isCurrent = captureOwnerRequest();
    onError(null);
    if (dlgMode === "history") {
      if (!dlgHistorySourceExamId.trim()) {
        onError(t("compose:errors.pickHistoryExam"));
        return;
      }
      if (!dlgHistoryExportLabel.trim()) {
        onError(t("compose:errors.historyExamLabelRequired"));
        return;
      }
      setBusy(true);
      try {
        const r = await apiPost<{ exam: ExamDoc }>(
          `/api/exams/from-exam/${encodeURIComponent(dlgHistorySourceExamId.trim())}`,
          { export_label: dlgHistoryExportLabel.trim() },
        );
        if (!isCurrent()) return;
      applyExamDocument(r.exam);
        setPdfExamId(null);
        setNewPaperDialogOpen(false);
        const eid = String(r.exam.exam_id ?? "").trim();
        setMsg(
          eid
            ? t("compose:messages.draftLoadedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
            : t("compose:messages.draftLoaded"),
        );
        void refreshExamSummaries();
      } catch (e) {
      if (!isCurrent()) return;
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    const tpl = dialogTemplate;
    if (!tpl) {
      onError(t("compose:errors.selectTemplateForDraft"));
      return;
    }
    if (!dlgExportLabel.trim() || !dlgSubject.trim()) {
      onError(t("compose:errors.examLabelAndSubjectRequired"));
      return;
    }
    setBusy(true);
    try {
      const selected_items = tpl.sections.map((s) => ({
        section_id: s.section_id,
        question_ids: [] as string[],
        score_per_item: null as number | null,
        score_overrides: null as Record<string, number> | null,
      }));
      const r = await apiPost<{ exam: ExamDoc }>("/api/exams", {
        name: undefined,
        auto_rename: true,
        export_label: dlgExportLabel.trim(),
        subject: dlgSubject.trim(),
        template_ref: tpl.id,
        template_path: tpl.path,
        selected_items,
      });
      if (!isCurrent()) return;
      applyExamDocument(r.exam);
      setPdfExamId(null);
      setNewPaperDialogOpen(false);
      const eid = String(r.exam.exam_id ?? "").trim();
      setMsg(
        eid
          ? t("compose:messages.draftSavedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
          : t("compose:messages.draftSaved"),
      );
      void refreshExamSummaries();
    } catch (e) {
      if (!isCurrent()) return;
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function exportWithConflictCheck(format: ComposeExportTaskFormat) {
    const isCurrent = capturePaperRequest();
    if (!selectedTpl || !countsOk || exportTasks.isPollingOrRunning) return;
    const submitted = clonePaperState(paperStateRef.current);
    exportTasks.dismissExportTask();
    setExportPreflightFailure(null);
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const check = await apiPost<{ conflict: boolean; existing_exam_id: string | null }>(
        "/api/exam/export/check-conflict", {
          export_label: submitted.exportLabel.trim(), subject: submitted.subject.trim(),
        },
      );
      if (!isCurrent()) return;
      if (check.conflict && check.existing_exam_id) {
        setConflictExportKind(format === "pdf" ? "pdf" : "word");
        setConflictTargetId(check.existing_exam_id);
        return;
      }
      await startExportTask(format, null, null, exportFailureExamIds, currentExamId, submitted);
    } catch (error) {
      if (!isCurrent()) return;
      const reason = error instanceof Error ? error.message : String(error);
      setExportPreflightFailure({ format, reason });
      onError(reason);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const exportExam = () => exportWithConflictCheck("pdf");
  const exportWord = () => exportWithConflictCheck("docx");

  async function confirmOverwriteExport() {
    const isCurrent = capturePaperRequest();
    if (!selectedTpl || !countsOk || !conflictTargetId) {
      return;
    }
    const overwriteId = conflictTargetId;
    const kind = conflictExportKind ?? "pdf";
    const examIdSnapshot = currentExamId;
    setConflictTargetId(null);
    setConflictExportKind(null);
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const hasWorkspace = Boolean(examIdSnapshot);
      if (kind === "word") {
        await startExportTask(
          "docx",
          overwriteId,
          hasWorkspace ? null : examIdSnapshot,
          exportFailureExamIds,
          hasWorkspace ? examIdSnapshot : null,
        );
      } else {
        await startExportTask(
          "pdf",
          overwriteId,
          hasWorkspace ? null : examIdSnapshot,
          exportFailureExamIds,
          hasWorkspace ? examIdSnapshot : null,
        );
      }
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ApiError && e.examSaved) {
        setExportFailureExamIds((prev) => [...new Set([...prev, e.examSaved!.exam_id])]);
        void refreshExamSummaries();
        onError(
          t("compose:errors.exportWithDraftSaved", { name: e.examSaved.name, detail: e.message }),
        );
      } else {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const persistDraftForPublish = useCallback(async (): Promise<ExamDoc | null> => {
    if (isImeCompositionActive()) return null;
    if (!selectedTpl || !templatePath.trim()) {
      onError(t("compose:errors.selectTemplateForDraft")); return null;
    }
    const isCurrent = capturePaperRequest();
    const submitted = clonePaperState(paperStateRef.current);
    const body = {
      name: submitted.draftName.trim() || undefined, subject: submitted.subject.trim(),
      export_label: submitted.exportLabel.trim(), template_ref: submitted.templateRef,
      template_path: submitted.templatePath, selected_items: buildSelectedItemsFromModel(selectedTpl, submitted),
    };
    try {
      const response = currentExamId
        ? await apiPut<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(currentExamId)}`, body)
        : await apiPost<{ exam: ExamDoc }>("/api/exams", body);
      if (!isCurrent()) return null;
      const parsed = examDocToPaperState(response.exam, submitted);
      const nextScope = draftScope.scope && { ...draftScope.scope, paperKey: buildComposeDraftPaperKey(parsed.examId) };
      acceptSavedState(parsed.state, submitted, nextScope);
      currentExamIdRef.current = parsed.examId;
      setCurrentExamId(parsed.examId);
      void refreshExamSummaries();
      return response.exam;
    } catch (error) {
      if (isCurrent()) onError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [acceptSavedState, capturePaperRequest, currentExamId, draftScope.scope, onError, refreshExamSummaries, selectedTpl, t, templatePath]);

  const saveDraftToServer = useCallback(async () => {
    const isCurrent = captureOwnerRequest();
    const updating = Boolean(currentExamId);
    onError(null); setBusy(true);
    try {
      const doc = await persistDraftForPublish();
      if (!isCurrent() || !doc) return;
      setMsg(updating ? t("compose:messages.draftUpdated") : t("compose:messages.draftSavedWithPath", { path: `exams/${doc.exam_id}` }));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [captureOwnerRequest, currentExamId, onError, persistDraftForPublish, t]);

  const publishing = useComposePublishing({ open: publishDialogOpen, setOpen: setPublishDialogOpen,
    ownerKey: draftScope.ownerKey, exportLabel, countsOk, composeSubject: subject, persistDraftForPublish, onError, setMsg });
  const { openPublishDialog, publishBusy } = publishing;

  async function deleteExamById(examId: string, opts?: { exported?: boolean }) {
    const ok = opts?.exported
      ? await confirmDialog(t("compose:messages.confirmDeleteExportedExam"))
      : await confirmDialog(t("compose:messages.confirmDeleteDraft"));
    if (!ok) {
      return;
    }
    onError(null);
    setBusy(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/exams/${encodeURIComponent(examId)}`);
      if (currentExamId === examId) {
        setCurrentExamId(null);
        updateWithoutHistory((previous) => ({ ...previous, draftName: "" }));
        setPdfExamId(null);
        setPreviewPdfId(null);
      }
      setLastExportedExamId((prev) => (prev === examId ? null : prev));
      setPdfExamId((prev) => (prev === examId ? null : prev));
      setWordExamId((prev) => (prev === examId ? null : prev));
      setMsg(opts?.exported ? t("compose:messages.exportedExamDeleted") : t("compose:messages.draftDeleted"));
      void refreshExamSummaries();
      dispatchExamsChanged({ examId });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadExamById(examId: string, pdfForViewer: string | null, wordForViewer: string | null = null) {
    const isCurrent = captureOwnerRequest();
    const sequence = ++examLoadSequence.current;
    onError(null);
    setBusy(true);
    try {
      const r = await apiGet<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(examId)}`);
      await refreshTemplates();
      if (!isCurrent() || sequence !== examLoadSequence.current) return;
      applyExamDocument(r.exam);
      setNamespaceFilter("__all__");
      setTypeFilter("__all__");
      setSearch("");
      setSearchDraftResetVersion((version) => version + 1);
      setComposeFilterExpanded(false);
      const items = r.exam.selected_items ?? [];
      const firstSec = items[0]?.section_id;
      if (firstSec) {
        setActiveSection(firstSec);
      }
      setPreviewPdfId(null);
      setPdfExamId(pdfForViewer);
      setWordExamId(wordForViewer);
      setPdfVariant("student");
      setMsg(t("compose:messages.draftLoaded"));
    } catch (e) {
      if (isCurrent()) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent() && sequence === examLoadSequence.current) setBusy(false);
    }
  }

  useEffect(() => {
    const eid = (openExamId ?? "").trim();
    if (!eid) return;
    void loadExamById(eid, null).finally(() => onOpenExamConsumed?.());
    // loadExamById intentionally stays a local workflow function; this effect only reacts
    // to explicit one-shot open requests from sibling pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openExamId]);

  useEffect(() => {
    if (!toolBarActive) {
      return;
    }
    const left: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="or-g49-btn or-g49-btn-primary"
          disabled={busy}
          onClick={() => {
            onError(null);
            setBusy(true);
            void refreshTemplates().then((latest) => {
              const preferred = latest.find((item) => normTemplatePath(item.path) === normTemplatePath(templatePath)) ?? latest[0];
              setDlgExportLabel(exportLabel.trim() || i18n.t("defaultExamLabel", { ns: "compose" }));
              setDlgSubject(subject.trim());
              setDlgTemplatePath(preferred?.path ?? "");
              setDlgMode("scratch");
              setDlgHistorySourceExamId(exportedExamRows[0]?.exam_id ?? "");
              setDlgHistoryExportLabel("");
              setNewPaperDialogOpen(true);
            }).catch((error) => onError(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        >
          {t("compose:newPaper")}
        </button>
        <button
          type="button"
          className="or-g49-btn or-g49-btn-secondary"
          disabled={busy || !selectedTpl || !templatePath.trim()}
          onClick={() => void saveDraftToServer()}
        >
          {t("compose:saveChanges")}
        </button>
        <button
          type="button"
          className="or-g49-btn or-g49-btn-secondary"
          onClick={() => setHistoryOpen(true)}
          aria-haspopup="dialog"
        >
          历史
        </button>
      </div>
    );
    const right: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="or-g49-btn or-g49-btn-secondary"
          disabled={busy || !selectedTpl}
          onClick={() => void validate()}
        >
          {t("compose:validatePreview")}
        </button>
        {previewPdfId || pdfExamId ? <button type="button" className="or-g49-btn or-g49-btn-secondary or-g49-preview-toggle" onClick={() => setPreviewOpen(true)}>查看预览</button> : null}
        <details className="relative group">
          <summary className="list-none cursor-pointer or-g49-btn or-g49-btn-secondary">导出 ▾</summary>
          <div className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-1.5 shadow-xl">
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--or-block)] disabled:opacity-50" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              void exportExam();
            }}>{t("compose:exportPdf")}</button>
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--or-block)] disabled:opacity-50" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              void exportWord();
            }}>{t("compose:exportWord")}</button>
            {!previewPdfId && pdfExamId ? <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--or-block)]" onClick={() => void downloadExportedBundle(pdfExamId, "pdf").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>{t("compose:downloadFinalPdf")}</button> : null}
            {!previewPdfId && (wordExamId || (pdfExamId && examSummaries.some((exam) => exam.exam_id === pdfExamId && exam.has_docx))) ? <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--or-block)]" onClick={() => void downloadExportedBundle((wordExamId || pdfExamId)!, "docx").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>{t("compose:downloadFinalWord")}</button> : null}
          </div>
        </details>
        <button
          type="button"
          className="or-g49-btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={busy || publishBusy}
          onClick={() => void openPublishDialog()}
          title={countsOk ? "发布当前试卷" : "选择发布历史错题或专项巩固练习"}
        >
          {countsOk ? "发布线上试卷" : "发布历史练习"}
        </button>
      </div>
    );
    setToolBar({ left, right });
    return () => clearToolBar();
  }, [
    toolBarActive,
    t,
    busy,
    selectedTpl,
    countsOk,
    templatePath,
    saveDraftToServer,
    setToolBar,
    clearToolBar,
    exportLabel,
    subject,
    templates,
    exportedExamRows,
    publishBusy,
    exportTasks.isPollingOrRunning,
    startExportTask,
    previewPdfId,
    pdfExamId,
    wordExamId,
    examSummaries,
  ]);

  useEffect(() => {
    if (!toolBarActive) {
      clearToolBar();
    }
  }, [toolBarActive, clearToolBar]);

  const pdfApiPath =
    pdfExamId != null
      ? `/api/exams/${encodeURIComponent(pdfExamId)}/pdf-file?variant=${pdfVariant}`
      : null;

  const previewSessionPdfPath =
    previewPdfId != null
      ? `/api/exam/preview-pdf/${encodeURIComponent(previewPdfId)}/file?variant=${pdfVariant}`
      : null;

  /** 右侧 PDF：优先显示校验预览；否则显示所选历史导出试卷 */
  const composeRightPdfPath = previewSessionPdfPath ?? pdfApiPath;
  const activeDocumentExamId = wordExamId ?? pdfExamId;
  const activeDocumentSummary = activeDocumentExamId
    ? examSummaries.find((ex) => ex.exam_id === activeDocumentExamId)
    : undefined;
  const wordOpenExamId = wordExamId ?? (activeDocumentSummary?.has_docx ? activeDocumentExamId : null);

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-agent-target={currentExamId ? "compose-draft" : undefined}
      data-agent-resource-id={currentExamId ?? undefined} tabIndex={currentExamId ? -1 : undefined}>
      <NewPaperDialog
        open={newPaperDialogOpen} busy={busy} mode={dlgMode} onModeChange={setDlgMode}
        exportLabel={dlgExportLabel} onExportLabelChange={setDlgExportLabel}
        subject={dlgSubject} onSubjectChange={setDlgSubject} subjectOptions={subjectOptionsForSelect}
        templates={templates} selectedTemplate={dialogTemplate} onTemplatePathChange={setDlgTemplatePath}
        exportedExamRows={exportedExamRows} historySourceExamId={dlgHistorySourceExamId}
        onHistorySourceExamIdChange={setDlgHistorySourceExamId}
        historyExportLabel={dlgHistoryExportLabel} onHistoryExportLabelChange={setDlgHistoryExportLabel}
        selectedPastExam={dlgSelectedPastExam} onCancel={() => setNewPaperDialogOpen(false)}
        onConfirm={() => void confirmNewPaperDialog()}
      />
      <PublishOnlineDialog {...publishing.dialogProps} />
      <ComposeDraftRecoveryDialog record={recoverableDraft} busy={busy} onRestore={restoreLocalDraft} onDiscard={discardLocalDraft} />
      <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="or-g49-compose-history-overlay fixed inset-0 z-[80] bg-slate-950/40 backdrop-blur-[2px]" />
          <Dialog.Content
            ref={setHistorySelectPortalContainer}
            aria-describedby="compose-history-description"
            className="pointer-events-none fixed inset-0 z-[81] outline-none"
          >
            <div className="pointer-events-auto or-g49-compose-history-dialog absolute right-0 top-0 flex h-full w-[min(92vw,34rem)] flex-col overflow-hidden border-l border-[var(--or-outline)] bg-[var(--or-card)] shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--or-outline)] px-4 py-3">
                <Dialog.Title className="text-base font-semibold text-[var(--or-text)]">
                  {t("compose:historySidebarTitle")}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-lg leading-none text-[var(--or-muted)] transition-colors hover:bg-[var(--or-block)] hover:text-[var(--or-text)]"
                    aria-label="关闭历史试卷"
                  >
                    ×
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description id="compose-history-description" className="sr-only">
                查看草稿和已导出试卷，并将内容归入文件夹。
              </Dialog.Description>
              <ComposeHistorySidebar
                hideTitle
                selectPortalContainer={historySelectPortalContainer}
                busy={busy}
                currentExamId={currentExamId}
                composeFolders={composeFolders}
                selectedComposeFolderId={selectedComposeFolderId}
                onSelectComposeFolder={setSelectedComposeFolderId}
                onFolderCreated={(folder) => setComposeFolders((current) => [...current, folder])}
                onFolderUpdated={(folder) => setComposeFolders((current) => current.map((item) => item.id === folder.id ? folder : item))}
                onFolderDeleted={(result) => { setComposeFolders(result.folders); setComposeFolderItems(result.items); }}
                onDropItemToFolder={(itemId, folderId) => { void assignFolderItem("compose", itemId, folderId).then(() => setComposeFolderItems((items) => { const next = { ...items }; if (folderId) next[itemId] = folderId; else delete next[itemId]; return next; })).catch((error) => onError(error instanceof Error ? error.message : String(error))); }}
                selectedComposeItemIds={selectedComposeItemIds}
                movingComposeItems={movingComposeItems}
                onToggleComposeItem={toggleComposeItem}
                onToggleVisibleComposeItems={toggleVisibleComposeItems}
                onClearComposeItems={clearComposeItems}
                onMoveComposeItemsToFolder={moveComposeItemsToFolder}
                draftExamRows={draftExamRows}
                exportedExamRows={exportedExamRows}
                taggedItems={taggedItems}
                onLoadDraftExam={(examId) => { setHistoryOpen(false); setActiveComposePanel("paper"); void loadExamById(examId, null); }}
                onLoadExportedExam={(exam) => { setHistoryOpen(false); setActiveComposePanel("paper"); setLastExportedExamId(exam.exam_id); void loadExamById(exam.exam_id, exam.has_pdf ? exam.exam_id : null, exam.has_docx ? exam.exam_id : null); }}
                onDeleteExam={(examId, opts) => { void deleteExamById(examId, opts); }}
                onError={onError}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <TexSetupNotice onError={onError} />
      {msg ? (
        <div
          className="shrink-0 border-b border-[var(--or-success)] bg-[var(--or-success-container)] px-4 py-2 text-sm font-medium text-[var(--or-on-success)]"
          role="status"
        >
          {msg}
        </div>
      ) : null}
      {previewWarnings.length > 0 ? (
        <div
          className="shrink-0 border-b border-[var(--or-warning)] bg-[var(--or-warning-container)] px-4 py-2.5 text-sm text-[var(--or-on-warning)]"
          role="status"
        >
          <p className="font-medium">{t("compose:previewWarningsTitle")}</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {previewWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {busy ? (
        <div className="shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-page)] px-4 py-1.5 text-sm font-medium text-[var(--or-muted)]" aria-live="polite">
          {t("common:processing")}
        </div>
      ) : null}
      <ComposeExportTaskBanner
        task={exportTasks.activeTask}
        stage={taskProgress.stage}
        progress={taskProgress.progress}
        isRetryable={taskProgress.isRetryable}
        projection={taskProgress.projection}
        pendingSubmissionFailure={exportTasks.pendingSubmissionFailure}
        historical={exportTasks.historical}
        busy={exportTasks.taskBusy}
        pollError={exportTasks.pollError || taskProgress.pollError}
        onRetry={() => void exportTasks.retryExportTask()}
        onResume={() => {
          void exportTasks.resumePolling();
          void taskProgress.refresh();
        }}
        onDismiss={exportTasks.dismissExportTask}
      />
      {exportPreflightFailure ? <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--or-error)] bg-[var(--or-error-container)] px-3 py-2 text-xs text-[var(--or-on-error)]">
        <span>{t("compose:exportPreflightFailed", { format: exportPreflightFailure.format === "pdf" ? "PDF" : "Word", reason: exportPreflightFailure.reason })}</span>
        <button type="button" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={() => void exportWithConflictCheck(exportPreflightFailure.format)} className="rounded border bg-[var(--or-card)] px-2.5 py-1 disabled:opacity-50">{t("compose:exportPreflightRetry")}</button>
      </div> : null}
      <div
        className={`or-g49-compose-workspace${composeRightPdfPath ? " has-pdf" : ""}`}
        data-active-panel={activeComposePanel}
      >
        <div className="or-g49-compose-panel-switcher" role="group" aria-label="组卷面板">
          <span className="or-g49-compose-panel-marker" aria-hidden="true" />
          <button
            type="button"
            className="or-g49-compose-panel-button"
            aria-pressed={activeComposePanel === "paper"}
            onClick={() => setActiveComposePanel("paper")}
          >
            编辑试卷
          </button>
          <button
            type="button"
            className="or-g49-compose-panel-button"
            aria-pressed={activeComposePanel === "bank"}
            onClick={() => setActiveComposePanel("bank")}
          >
            题库
          </button>
        </div>

        <div className="or-g49-compose-bank-panel">
        <ComposeBankSearchPanel
          subject={subject}
          onSubjectChange={(value) => commitPaperState({ ...paperStateRef.current, subject: value })}
          subjectOptions={subjectOptionsForSelect}
          namespaceFilter={namespaceFilter}
          onNamespaceFilterChange={setNamespaceFilter}
          namespaces={namespaces}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          search={search}
          onCommitSearch={commitSearch}
          searchDraftResetVersion={searchDraftResetVersion}
          metadataFilterDefinitions={metadataFilterDefinitions}
          metadataFilters={metadataFilters}
          onMetadataFiltersChange={setMetadataFilters}
          filterExpanded={composeFilterExpanded}
          onFilterExpandedChange={setComposeFilterExpanded}
          contentSyncing={contentSyncing}
          totalQuestionCount={questions.length}
          filteredQuestions={filteredQuestions}
          bankSelectionStore={bankSelectionStore}
          onLeftBankClick={handleLeftBankClick}
          onDropPaperItemToRemove={removeDraggedQuestion}
          onError={onError}
        />
          {activeComposePanel === "bank" && !historyOpen ? (
            <ComposeBankActionBar
              store={bankSelectionStore}
              disabled={busy || contentSyncing}
              onAdd={() => { addFromLeft(); setActiveComposePanel("paper"); }}
              onFill={fillSectionGaps}
              onEditPaper={() => setActiveComposePanel("paper")}
            />
          ) : null}
        </div>

        <div className="or-g49-compose-paper-panel">
        <ComposePaperEditorPanel
          busy={busy}
          contentSyncing={contentSyncing}
          templatesCount={templates.length}
          selectedTpl={selectedTpl}
          paperState={currentPaperState}
          activeSection={activeSection}
          onActiveSectionChange={setActiveSection}
          onSelectSectionAndFilter={(sectionId, filterType) => { setActiveSection(sectionId); setTypeFilter(filterType); }}
          countsOk={countsOk}
          totalScore={totalScore}
          knowledgeDistributionRows={knowledgeDistributionRows}
          questionMap={questionMap}
          selectedRight={selectedRight}
          showBankTools={activeComposePanel === "bank" && !historyOpen}
          onFillSectionGaps={fillSectionGaps}
          onAddFromLeft={addFromLeft}
          onRemoveFromRight={removeFromRight}
          onMoveSelectedRight={moveSelectedRight}
          onDropBankQuestionsToSection={(questionIds, sectionId) => addQuestionsToSection(questionIds, sectionId)}
          onRightPaperSlotClick={handleRightPaperSlotClick}
          onSectionRequiredCountChange={(sectionId, rawValue) => commitPaperState(setSectionRequiredCountInModel(paperStateRef.current, sectionId, rawValue))}
          onSectionScorePerItemChange={(sectionId, rawValue) => commitPaperState(setSectionScorePerItemInModel(paperStateRef.current, sectionId, rawValue))}
          onPerQuestionModeChange={(sectionId, enabled) => commitPaperState(setPerQuestionScoreModeInModel(paperStateRef.current, sectionId, enabled))}
          onQuestionScoreOverrideChange={(sectionId, qid, rawValue) => commitPaperState(setQuestionScoreOverrideInModel(paperStateRef.current, sectionId, qid, rawValue))}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undoCompose}
          onRedo={redoCompose}
          isDirty={isDirty}
          draftScopeReady={draftScope.scopeReady}
          draftStorageStatus={draftStorageStatus}
          recoverableDraft={recoverableDraft}
          onRestoreLocalDraft={restoreLocalDraft}
          onDiscardLocalDraft={discardLocalDraft}
          currentExamId={currentExamId}
          composeFolders={composeFolders}
          composeFolderItems={composeFolderItems}
          onAssignCurrentExamFolder={(examId, folderId) => { void assignFolderItem("compose", examId, folderId || null).then(() => setComposeFolderItems((items) => ({ ...items, [examId]: folderId }))).catch((error) => onError(error instanceof Error ? error.message : String(error))); }}
          onRefreshTaggedItems={() => { void listTaggedItems("compose").then(({ items }) => setTaggedItems(items)); }}
          conflictOpen={Boolean(conflictTargetId)}
          onCancelConflictOverwrite={() => { setConflictTargetId(null); setConflictExportKind(null); }}
          onConfirmConflictOverwrite={() => void confirmOverwriteExport()}
          onError={onError}
          onOpenAutoCompose={() => setAutoComposeOpen(true)}
          onOpenDuplicateReport={() => void checkDuplicates()}
          duplicateReportStale={duplicateReportStale}
          duplicateFlaggedCount={duplicateReportStale ? 0 : currentDuplicateRecord?.report.summary.flagged_count ?? 0}
          duplicateQuestionMap={duplicateQuestionMap}
        />
        </div>

        <ComposePdfPreviewAside
          busy={busy}
          pdfVariant={pdfVariant}
          onPdfVariantChange={setPdfVariant}
          pdfExamId={pdfExamId}
          previewPdfId={previewPdfId}
          wordOpenExamId={wordOpenExamId}
          composeRightPdfPath={composeRightPdfPath}
          viewPdfBusy={viewPdfBusy}
          viewWordBusy={viewWordBusy}
          onDownloadPdfBundle={(examId) => { void downloadExportedBundle(examId, "pdf").catch((error) => onError(error instanceof Error ? error.message : String(error))); }}
          onDownloadWordBundle={(examId) => { void downloadExportedBundle(examId, "docx").catch((error) => onError(error instanceof Error ? error.message : String(error))); }}
          onOpenPdfExternally={() => void openViewPdfExternally()}
          onOpenWordExternally={() => void openViewWordExternally()}
        />
      </div>
      <AutoComposeDialog
        open={autoComposeOpen}
        onClose={() => setAutoComposeOpen(false)}
        subject={currentPaperState.subject}
        template={selectedTpl}
        paperState={currentPaperState}
        currentExamId={currentExamId}
        requestScopeKey={autoComposeRequestScopeKey}
        optionsScopeKey={autoComposeOptionsScopeKey}
        onApply={applyAutoComposeResult}
        onViewDuplicates={() => setDuplicateReportOpen(true)}
      />
      <DuplicateReport
        open={duplicateReportOpen}
        onClose={() => setDuplicateReportOpen(false)}
        report={currentDuplicateRecord?.report ?? null}
        stale={duplicateReportStale}
        loading={duplicateCheckLoading}
        error={duplicateCheckError}
        onRefresh={() => void checkDuplicates()}
        onLocateQuestion={locateQuestionFromReport}
      />
      <PreviewPdfModal open={previewOpen} pdfPath={composeRightPdfPath} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
