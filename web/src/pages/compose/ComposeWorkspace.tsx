import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../api/client";
import { useContentLibraryChanged } from "../../lib/contentEvents";
import { TexSetupNotice } from "../../components/TexSetupNotice";
import { useAgentContext } from "../../contexts/AgentContext";
import { useToolBar } from "../../contexts/ToolBarContext";
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
import { ComposeBankSearchPanel } from "./ComposeBankSearchPanel";
import { ComposePaperEditorPanel } from "./ComposePaperEditorPanel";
import { ComposePdfPreviewAside } from "./ComposePdfPreviewAside";
import { NewPaperDialog } from "./NewPaperDialog";
import { PublishOnlineDialog } from "./PublishOnlineDialog";
import { useComposePublishing } from "./useComposePublishing";
import { PreviewPdfModal } from "./ComposeDialogs";
import { extractExamPathIdFromDir } from "./composeExportTasks";
import { useComposeExportTasks, type ExportSuccess } from "./useComposeExportTasks";
import { ComposeExportTaskBanner } from "./ComposeExportTaskBanner";
import { ComposeDraftRecoveryDialog } from "./ComposeDraftRecoveryDialog";

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
  const { setPageContext } = useAgentContext();
  const { setToolBar, clearToolBar } = useToolBar();
  /** 用于右侧 PDF 的考试目录标识（``标签段/学科段``），与 ``GET /api/exams/{path}/pdf-file`` 一致 */
  const [pdfExamId, setPdfExamId] = useState<string | null>(null);
  const [pdfVariant, setPdfVariant] = useState<"student" | "teacher">("student");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [metadataFilters, setMetadataFilters] = useState<MetadataFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [composeFilterExpanded, setComposeFilterExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** 左侧题库多选（qualified_id），顺序与列表一致；配合 Ctrl/⌘、Shift 桌面习惯 */
  const [selectedLeftIds, setSelectedLeftIds] = useState<string[]>([]);
  /** 用于 Shift+点击 范围选择的锚点（filteredQuestions 下标） */
  const [leftListAnchorIndex, setLeftListAnchorIndex] = useState<number | null>(null);
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
  const examLoadSequence = useRef(0);
  const currentExamIdRef = useRef<string | null>(null);
  currentExamIdRef.current = currentExamId;

  const draftScope = useComposeDraftScope({ accountId, projectRoot, currentExamId });
  useEffect(() => { setExportFailureExamIds([]); setExportPreflightFailure(null); setBusy(false); }, [currentExamId]);
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
    setSelectedLeftIds([]); setSelectedRight(null); setLeftListAnchorIndex(null); setRightListAnchor(null);
    setExportFailureExamIds([]); setMsg(null); setNewPaperDialogOpen(false); setPublishDialogOpen(false);
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
    shortcutsEnabled: toolBarActive && !newPaperDialogOpen && !publishDialogOpen && !conflictTargetId,
    onOwnerIdentityChanged: clearOwnerView,
    onRestoredMsg: () => setMsg(t("compose:messages.localDraftRestored")),
    onDiscardedMsg: () => setMsg(t("compose:messages.localDraftDiscarded")),
  });
  const { exportLabel, subject, templatePath, templateRef, bySection, scoreBySection, countBySection, scoreOverrides } = currentPaperState;
  const paperStateRef = useRef(currentPaperState);
  paperStateRef.current = currentPaperState;

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
  const selectedLeftIdsSet = useMemo(() => new Set(selectedLeftIds), [selectedLeftIds]);

  const commitSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  useEffect(() => {
    const allowed = new Set(filteredQuestions.map((q) => q.qualified_id));
    setSelectedLeftIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [filteredQuestions]);

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

  useEffect(() => {
    let active = true;
    setQuestionBindingsIndex({});
    if (!toolBarActive) return;
    const isCurrent = captureOwnerRequest();
    void apiGet<{ index: Record<string, GraphBindingNode[]> }>("/api/graph/question-bindings-index")
      .then((r) => { if (active && isCurrent()) setQuestionBindingsIndex(r.index ?? {}); })
      .catch(() => { if (active && isCurrent()) setQuestionBindingsIndex({}); });
    return () => { active = false; };
  }, [toolBarActive, captureOwnerRequest]);

  const knowledgeDistributionRows = useMemo(
    () => computeKnowledgeDistribution(bySection, questionBindingsIndex),
    [bySection, questionBindingsIndex],
  );

  const countsOk = useMemo(() => {
    if (!selectedTpl) {
      return false;
    }
    return selectedTpl.sections.every((s) => {
      if (s.type === "text") {
        return true;
      }
      if (s.type === "practice") {
        return (bySection[s.section_id]?.length ?? 0) > 0;
      }
      return (bySection[s.section_id]?.length ?? 0) === (countBySection[s.section_id] ?? s.required_count);
    });
  }, [selectedTpl, bySection, countBySection]);

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
        const anchor = leftListAnchorIndex ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const range = filteredQuestions.slice(start, end + 1).map((x) => x.qualified_id);
        setSelectedLeftIds(range);
        setLeftListAnchorIndex(index);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        setSelectedLeftIds((prev) => {
          if (prev.includes(q.qualified_id)) {
            return prev.filter((id) => id !== q.qualified_id);
          }
          return [...prev, q.qualified_id];
        });
        setLeftListAnchorIndex(index);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      setSelectedLeftIds([q.qualified_id]);
      setLeftListAnchorIndex(index);
      setSelectedRight(null);
      setRightListAnchor(null);
    },
    [filteredQuestions, leftListAnchorIndex],
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
          setSelectedLeftIds(slotIds);
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
        setSelectedLeftIds(ordered);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (selectedRight?.sectionId !== sectionId) {
          setSelectedRight({ sectionId, qids: slotIds });
          setRightListAnchor({ sectionId, slotIndex });
          setSelectedLeftIds(slotIds);
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
        setSelectedLeftIds(nextOrdered);
        return;
      }
      setSelectedRight({ sectionId, qids: slotIds });
      setRightListAnchor({ sectionId, slotIndex });
      setSelectedLeftIds(slotIds);
    },
    [bySection, rightListAnchor, selectedRight],
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

  const startExportTask = useCallback(async (
    format: ComposeExportTaskFormat, overwriteExisting: string | null,
    examIdToDelete: string | null, failureIds: string[], workspaceId: string | null,
    snapshot?: ComposePaperState,
  ) => {
    if (!selectedTpl) return;
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
  }, [exportTasks.startExportTask, selectedTpl]);

  const applyExamDocument = useCallback((doc: ExamDoc) => {
    setPreviewPdfId(null);
    setPreviewWarnings([]);
    const eid = String(doc.exam_id ?? "").trim();
    /** 同步 ref，避免首屏 subjects 请求的 `.then` 在 React 提交前读到陈旧 ref 而覆盖学科 */
    currentExamIdRef.current = eid || null;
    setCurrentExamId(eid || null);
    const parsed = examDocToPaperState(doc, { templatePath });
    resetPaperHistory(parsed.state);
    setSelectedLeftIds([]);
    setLeftListAnchorIndex(null);
    setSelectedRight(null);
    setRightListAnchor(null);
  }, [resetPaperHistory, templatePath]);

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
    addQuestionsToSection(selectedLeftIds, activeSection);
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
    if (!selectedTpl || exportTasks.isPollingOrRunning) return;
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
    if (!selectedTpl || !conflictTargetId) {
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
    ownerKey: draftScope.ownerKey, exportLabel, countsOk, persistDraftForPublish, onError, setMsg });
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
      setSearchInput("");
      setSearch("");
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
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
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
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || !selectedTpl || !templatePath.trim()}
          onClick={() => void saveDraftToServer()}
        >
          {t("compose:saveChanges")}
        </button>
      </div>
    );
    const right: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
          disabled={busy || !selectedTpl}
          onClick={() => void validate()}
        >
          {t("compose:validatePreview")}
        </button>
        {previewPdfId || pdfExamId ? <button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 xl:hidden" onClick={() => setPreviewOpen(true)}>查看预览</button> : null}
        <details className="relative group">
          <summary className="list-none cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50">导出 ▾</summary>
          <div className="absolute right-0 top-full z-30 mt-1 min-w-32 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              void exportExam();
            }}>{t("compose:exportPdf")}</button>
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              void exportWord();
            }}>{t("compose:exportWord")}</button>
            {!previewPdfId && pdfExamId ? <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => void downloadExportedBundle(pdfExamId, "pdf").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>{t("compose:downloadFinalPdf")}</button> : null}
            {!previewPdfId && (wordExamId || (pdfExamId && examSummaries.some((exam) => exam.exam_id === pdfExamId && exam.has_docx))) ? <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => void downloadExportedBundle((wordExamId || pdfExamId)!, "docx").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>{t("compose:downloadFinalWord")}</button> : null}
          </div>
        </details>
        <button
          type="button"
          className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          disabled={busy || publishBusy}
          onClick={() => void openPublishDialog()}
          title="发布线上试卷"
        >
          发布线上试卷
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
    <div className="relative flex h-full min-h-0 flex-col">
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
      <TexSetupNotice onError={onError} />
      {msg ? (
        <div
          className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"
          role="status"
        >
          {msg}
        </div>
      ) : null}
      {previewWarnings.length > 0 ? (
        <div
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
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
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600" aria-live="polite">
          {t("common:processing")}
        </div>
      ) : null}
      <ComposeExportTaskBanner task={exportTasks.activeTask} pendingSubmissionFailure={exportTasks.pendingSubmissionFailure}
        historical={exportTasks.historical}
        busy={exportTasks.taskBusy} pollError={exportTasks.pollError}
        onRetry={() => void exportTasks.retryExportTask()} onResume={() => void exportTasks.resumePolling()}
        onDismiss={exportTasks.dismissExportTask} />
      {exportPreflightFailure ? <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
        <span>{t("compose:exportPreflightFailed", { format: exportPreflightFailure.format === "pdf" ? "PDF" : "Word", reason: exportPreflightFailure.reason })}</span>
        <button type="button" disabled={busy || !countsOk || exportTasks.isPollingOrRunning} onClick={() => void exportWithConflictCheck(exportPreflightFailure.format)} className="rounded border bg-white px-2.5 py-1 disabled:opacity-50">{t("compose:exportPreflightRetry")}</button>
      </div> : null}
      <div className="flex min-h-0 flex-1 flex-row">
        <ComposeHistorySidebar
          busy={busy}
          currentExamId={currentExamId}
          composeFolders={composeFolders}
          selectedComposeFolderId={selectedComposeFolderId}
          onSelectComposeFolder={setSelectedComposeFolderId}
          onFolderCreated={(folder) => setComposeFolders((current) => [...current, folder])}
          onFolderUpdated={(folder) => setComposeFolders((current) => current.map((item) => item.id === folder.id ? folder : item))}
          onFolderDeleted={(result) => { setComposeFolders(result.folders); setComposeFolderItems(result.items); }}
          onDropItemToFolder={(itemId, folderId) => { void assignFolderItem("compose", itemId, folderId).then(() => setComposeFolderItems((items) => { const next = { ...items }; if (folderId) next[itemId] = folderId; else delete next[itemId]; return next; })).catch((error) => onError(error instanceof Error ? error.message : String(error))); }}
          draftExamRows={draftExamRows}
          exportedExamRows={exportedExamRows}
          taggedItems={taggedItems}
          onLoadDraftExam={(examId) => { void loadExamById(examId, null); }}
          onLoadExportedExam={(exam) => { setLastExportedExamId(exam.exam_id); void loadExamById(exam.exam_id, exam.has_pdf ? exam.exam_id : null, exam.has_docx ? exam.exam_id : null); }}
          onDeleteExam={(examId, opts) => { void deleteExamById(examId, opts); }}
          onError={onError}
        />


        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 md:flex-row">
        <ComposeBankSearchPanel
          subject={subject}
          onSubjectChange={(value) => commitPaperState({ ...paperStateRef.current, subject: value })}
          subjectOptions={subjectOptionsForSelect}
          namespaceFilter={namespaceFilter}
          onNamespaceFilterChange={setNamespaceFilter}
          namespaces={namespaces}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          search={search}
          onCommitSearch={commitSearch}
          metadataFilterDefinitions={metadataFilterDefinitions}
          metadataFilters={metadataFilters}
          onMetadataFiltersChange={setMetadataFilters}
          filterExpanded={composeFilterExpanded}
          onFilterExpandedChange={setComposeFilterExpanded}
          contentSyncing={contentSyncing}
          totalQuestionCount={questions.length}
          filteredQuestions={filteredQuestions}
          selectedLeftIds={selectedLeftIds}
          selectedLeftIdsSet={selectedLeftIdsSet}
          onLeftBankClick={handleLeftBankClick}
          onDropPaperItemToRemove={removeDraggedQuestion}
          onError={onError}
        />


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
          onFillSectionGaps={() => {
            if (!selectedTpl) return;
            const filled = fillSectionGapsInModel({ state: paperStateRef.current, template: selectedTpl, candidateQuestions: filteredQuestions });
            if (filled.changed) commitPaperState(filled.nextState);
            setMsg(`已补入 ${filled.addedCount} 题；不足时请放宽左侧筛选条件。`);
          }}
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
        />

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
      </div>
      <PreviewPdfModal open={previewOpen} pdfPath={composeRightPdfPath} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
