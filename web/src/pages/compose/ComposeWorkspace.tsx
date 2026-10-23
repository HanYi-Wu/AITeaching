import { fillSectionGaps } from "../../lib/manualPaperShortcuts";
import { QuestionHoverDetails } from '../../components/QuestionHoverDetails';
import { ContentFolderHelp, ContentFolders } from '../../components/ContentFolders';
import { ContentTags, TagChips } from '../../components/ContentTags';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../api/client";
import { useContentLibraryChanged } from "../../lib/contentEvents";
import { AdaptivePracticeSelector } from "../../components/AdaptivePracticeSelector";
import { KatexPlainPreview } from "../../components/KatexText";
import { PdfPreview } from "../../components/PdfPreview";
import { MetadataFilterControls } from "../../components/MetadataFilterControls";
import { TexSetupNotice } from "../../components/TexSetupNotice";
import { useAgentContext } from "../../contexts/AgentContext";
import { useToolBar } from "../../contexts/ToolBarContext";
import i18n from "../../i18n/i18n";
import { collapseGroupRowsForList, clusterAdjacentGroupSlots, type SectionSlot } from "../../lib/groupQuestions";
import { confirmDialog } from "../../lib/confirmDialog";
import { dispatchExamsChanged, SOLAIRE_EXAMS_CHANGED_EVENT, type ExamsChangedDetail } from "../../lib/examEvents";
import { QUESTION_TYPE_OPTIONS, normalizeQuestionTypeForFilter } from "../../lib/questionTypes";
import { cn } from "../../lib/utils";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  matchesMetadataFilters,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import { isTauriShell } from "../../lib/tauriEnv";
import { isImeComposingKeyboardEvent, isImeCompositionActive } from "../../lib/ime";
import {
  listTeacherAssignedClasses,
  listTeacherClassStudents,
  listClassPracticeHistory,
  publishPlatformPaper,
  publishReinforcementPractice,
  publishWrongQuestionPractice,
  syncPlatformPaperFromExam,
  listContentFolders,
  listFolderItems,
  listTaggedItems,
  assignFolderItem,
  createContentFolder,
  updateContentFolder,
  type ContentFolder,
  type ContentTag,
  type PracticeHistoryRecord,
  type PracticePublishMode,
  type PaperSubmissionMode,
  type TeacherClassRecord,
  type TeacherClassStudentRecord,
} from "../../platform/auth";
import type { ExamDoc, ExamWorkspaceSummary, QuestionRow, RightSelection, TemplateRow } from "../../types/compose";
import {
  downloadExportedBundle,
  normTemplatePath,
  questionTypeMatchesSection,
  sectionTypeToFilter,
} from "./composeHelpers";

type GraphBindingNode = { id: string; canonical_name: string; node_kind?: string };

export function ComposeWorkspace({
  onError,
  toolBarActive = true,
  openExamId = null,
  onOpenExamConsumed,
}: {
  onError: (s: string | null) => void;
  /** 为 false 时不占用顶栏工具栏（父级隐藏组卷视图时使用） */
  toolBarActive?: boolean;
  /** 外部页面请求打开某个考试工作区（如分析页生成补练卷后跳转）。 */
  openExamId?: string | null;
  onOpenExamConsumed?: () => void;
  onOpenPapers?: () => void;
}) {
  const { t } = useTranslation(["compose", "common", "lib"]);
  const { setPageContext } = useAgentContext();
  const { setToolBar, clearToolBar } = useToolBar();
  /** 用于右侧 PDF 的考试目录标识（``标签段/学科段``），与 ``GET /api/exams/{path}/pdf-file`` 一致 */
  const [pdfExamId, setPdfExamId] = useState<string | null>(null);
  const [pdfVariant, setPdfVariant] = useState<"student" | "teacher">("student");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [exportLabel, setExportLabel] = useState(() => i18n.t("defaultExamLabel", { ns: "compose" }));
  const [subject, setSubject] = useState(() => i18n.t("defaultSubject", { ns: "compose" }));
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [templatePath, setTemplatePath] = useState("");
  const [templateRef, setTemplateRef] = useState("");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [metadataFilters, setMetadataFilters] = useState<MetadataFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [composeFilterExpanded, setComposeFilterExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [bySection, setBySection] = useState<Record<string, string[]>>({});
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

  const [scoreBySection, setScoreBySection] = useState<Record<string, number | undefined>>({});
  const [countBySection, setCountBySection] = useState<Record<string, number>>({});
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, Record<string, number>>>({});
  const [perQuestionMode, setPerQuestionMode] = useState<Record<string, boolean>>({});
  const [currentExamId, setCurrentExamId] = useState<string | null>(null);
  /** 导出失败后服务端自动保存的考试工作区 id；下次导出成功时一并删除 */
  const [exportFailureExamIds, setExportFailureExamIds] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [examSummaries, setExamSummaries] = useState<ExamWorkspaceSummary[]>([]);
  const [composeFolders, setComposeFolders] = useState<ContentFolder[]>([]);
  const [composeFolderItems, setComposeFolderItems] = useState<Record<string, string>>({});
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [selectedComposeFolderId, setSelectedComposeFolderId] = useState<string | null>(null);
  const [conflictTargetId, setConflictTargetId] = useState<string | null>(null);
  const [conflictExportKind, setConflictExportKind] = useState<"pdf" | "word" | null>(null);
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
  const [publishClasses, setPublishClasses] = useState<TeacherClassRecord[]>([]);
  const [publishClassIds, setPublishClassIds] = useState<string[]>([]);
  const [publishFolders, setPublishFolders] = useState<ContentFolder[]>([]);
  const [publishFolderId, setPublishFolderId] = useState("");
  const [publishRecipientScope, setPublishRecipientScope] = useState<"class" | "student">("class");
  const [publishStudents, setPublishStudents] = useState<TeacherClassStudentRecord[]>([]);
  const [publishStudentIds, setPublishStudentIds] = useState<string[]>([]);
  const [publishStudentSearch, setPublishStudentSearch] = useState("");
  const [publishNewFolderName, setPublishNewFolderName] = useState("");
  const [publishSubmissionMode, setPublishSubmissionMode] = useState<PaperSubmissionMode>("online");
  const [publishMaxScreenSwitches, setPublishMaxScreenSwitches] = useState(0);
  const [publishStartAt, setPublishStartAt] = useState("");
  const [publishEndAt, setPublishEndAt] = useState("");
  const [publishTimeLimitMinutes, setPublishTimeLimitMinutes] = useState(0);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMode, setPublishMode] = useState<PracticePublishMode>("current");
  const [practiceHistory, setPracticeHistory] = useState<PracticeHistoryRecord[]>([]);
  const [practiceSourceIds, setPracticeSourceIds] = useState<string[]>([]);
  const [practiceMaxQuestionsPerStudent, setPracticeMaxQuestionsPerStudent] = useState(20);
  const [practiceHistoryLoading, setPracticeHistoryLoading] = useState(false);

  const currentExamIdRef = useRef<string | null>(null);
  currentExamIdRef.current = currentExamId;

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
  const selectedTpl = useMemo(() => {
    const tp = normTemplatePath(templatePath);
    if (!tp) {
      return undefined;
    }
    const found = templates.find((t) => normTemplatePath(t.path) === tp);
    if (found) {
      return found;
    }
    if (templateRef === "remediation_practice") {
      const sectionIds = Object.keys(bySection);
      const sectionId = sectionIds[0] ?? "练习题";
      return {
        id: "remediation_practice",
        path: templatePath,
        layout: "single_column",
        sections: [
          {
            section_id: sectionId,
            type: "practice",
            required_count: bySection[sectionId]?.length ?? 0,
            score_per_item: scoreBySection[sectionId] ?? 5,
          },
        ],
      } satisfies TemplateRow;
    }
    return undefined;
  }, [bySection, scoreBySection, templates, templatePath, templateRef]);

  const refreshTemplates = useCallback(async () => {
    const requestId = ++templateRequestIdRef.current;
    const r = await apiGet<{ templates: TemplateRow[] }>("/api/templates");
    const next = r.templates ?? [];
    if (requestId === templateRequestIdRef.current) setTemplates(next);
    return next;
  }, []);

  const refreshContentLibrary = useCallback(async () => {
    const requestId = ++contentRequestIdRef.current;
    const templateRequestId = ++templateRequestIdRef.current;
    const [templateData, questionData, subjectData] = await Promise.all([
      apiGet<{ templates: TemplateRow[] }>("/api/templates"),
      apiGet<{ questions: QuestionRow[] }>("/api/questions"),
      apiGet<{ subjects: string[] }>("/api/bank/subjects"),
    ]);
    if (requestId !== contentRequestIdRef.current) return false;
    const nextTemplates = templateData.templates ?? [];
    if (templateRequestId === templateRequestIdRef.current) setTemplates(nextTemplates);
    setQuestions(questionData.questions);
    const list = subjectData.subjects.length
      ? subjectData.subjects
      : [...new Set(questionData.questions.map((item) => item.subject).filter(Boolean) as string[])];
    setSubjectOptions(list);
    if (!currentExamIdRef.current) {
      setSubject((previous) => {
        const value = previous.trim();
        return list.length && !list.includes(value) ? list[0] ?? previous : previous;
      });
    }
    return true;
  }, []);

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

  const questionsForSubject = useMemo(() => {
    const s = subject.trim();
    return questions.filter((q) => (q.subject ?? "") === s);
  }, [questions, subject]);

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

  const namespaces = useMemo(() => {
    const s = new Set<string>();
    for (const q of questionsForSubject) {
      s.add(q.collection ?? q.namespace);
    }
    return [...s].sort();
  }, [questionsForSubject]);

  const collapsedQuestionsForSubject = useMemo(
    () => collapseGroupRowsForList(questionsForSubject),
    [questionsForSubject],
  );

  const metadataScopeQuestions = useMemo(() => {
    const ns = namespaceFilter === "__all__" ? null : namespaceFilter;
    return collapsedQuestionsForSubject.filter((q) => {
      const coll = q.collection ?? q.namespace;
      if (ns && coll !== ns) {
        return false;
      }
      if (typeFilter !== "__all__" && !questionTypeMatchesSection(q.type, typeFilter, q.answer)) {
        return false;
      }
      return true;
    });
  }, [collapsedQuestionsForSubject, namespaceFilter, typeFilter]);

  const metadataFilterDefinitions = useMemo(
    () => buildMetadataFilterDefinitions(metadataScopeQuestions),
    [metadataScopeQuestions],
  );
  const deferredSearch = useDeferredValue(search);
  const deferredMetadataFilters = useDeferredValue(metadataFilters);
  const activeMetadataFilters = useMemo(
    () => (hasActiveMetadataFilters(deferredMetadataFilters) ? deferredMetadataFilters : null),
    [deferredMetadataFilters],
  );
  const metadataScopeSearchQuestions = useMemo(
    () =>
      metadataScopeQuestions.map((question) => ({
        question,
        searchText: [
          question.id,
          question.qualified_id,
          question.content_preview,
          normalizeQuestionTypeForFilter(question.type, question.answer),
          question.group_id ?? "",
          question.group_material ?? "",
          JSON.stringify(question.metadata ?? {}),
        ]
          .join("\n")
          .toLowerCase(),
      })),
    [metadataScopeQuestions],
  );

  const filteredQuestions = useMemo(() => {
    const qlow = deferredSearch.trim().toLowerCase();
    return metadataScopeSearchQuestions
      .filter(({ question, searchText }) => {
        if (activeMetadataFilters && !matchesMetadataFilters(question.metadata, activeMetadataFilters)) {
          return false;
        }
        return !qlow || searchText.includes(qlow);
      })
      .map(({ question }) => question);
  }, [activeMetadataFilters, metadataScopeSearchQuestions, deferredSearch]);
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

  /** 首屏默认模板：仅在尚未关联考试且未选模板时写入，避免与 loadExamById / applyExamDocument 竞态 */
  useEffect(() => {
    if (templates.length === 0) {
      return;
    }
    if (currentExamId) {
      return;
    }
    if (templatePath.trim()) {
      return;
    }
    const first = templates[0];
    if (!first) {
      return;
    }
    setTemplatePath(first.path);
    setTemplateRef(first.id);
    const init: Record<string, string[]> = {};
    for (const s of first.sections) {
      init[s.section_id] = [];
    }
    setBySection(init);
    setActiveSection(first.sections[0]?.section_id ?? null);
  }, [templates, currentExamId, templatePath]);

  /**
   * 已保存的 exam.yaml 可能出现 template_ref 与 template_path 不一致（例如仅重命名了
   * templates/ 下文件）。列表以 path 为准匹配 selectedTpl；此处按 ref 回退到实际文件路径，
   * 避免「顶栏显示 — 却仍发出旧 path」或预览 400。
   */
  useEffect(() => {
    if (templates.length === 0 || !templatePath.trim()) {
      return;
    }
    const tp = normTemplatePath(templatePath);
    if (templates.some((x) => normTemplatePath(x.path) === tp)) {
      return;
    }
    const ref = templateRef.trim();
    if (!ref) {
      return;
    }
    const byRef = templates.find((x) => x.id === ref);
    if (byRef && normTemplatePath(byRef.path) !== tp) {
      setTemplatePath(byRef.path);
    }
  }, [templates, templatePath, templateRef]);

  useEffect(() => {
    setNamespaceFilter("__all__");
    setTypeFilter("__all__");
  }, [subject]);

  useEffect(() => {
    const t = selectedTpl;
    if (!t) {
      return;
    }
    setTemplateRef(t.id);
    setBySection((prev) => {
      const next: Record<string, string[]> = {};
      for (const s of t.sections) {
        next[s.section_id] = prev[s.section_id] ?? [];
      }
      return next;
    });
    const sectionIds = new Set(t.sections.map((s) => s.section_id));
    setActiveSection((prev) => {
      if (prev && sectionIds.has(prev)) {
        return prev;
      }
      return t.sections[0]?.section_id ?? null;
    });
  }, [templatePath, selectedTpl]);

  useEffect(() => {
    const t = selectedTpl;
    if (!t) {
      return;
    }
    setScoreBySection((prev) => {
      const next: Record<string, number | undefined> = {};
      for (const s of t.sections) {
        next[s.section_id] = prev[s.section_id];
      }
      return next;
    });
    setScoreOverrides((prev) => {
      const next: Record<string, Record<string, number>> = {};
      for (const s of t.sections) {
        if (prev[s.section_id]) {
          next[s.section_id] = { ...prev[s.section_id] };
        }
      }
      return next;
    });
    setPerQuestionMode((prev) => {
      const next: Record<string, boolean> = {};
      for (const s of t.sections) {
        if (prev[s.section_id]) {
          next[s.section_id] = prev[s.section_id]!;
        }
      }
      return next;
    });
  }, [selectedTpl]);

  const refreshExamSummaries = useCallback(async () => {
    try {
      const r = await apiGet<{ exams: ExamWorkspaceSummary[] }>("/api/exams");
      setExamSummaries(r.exams ?? []);
    } catch {
      /* ignore */
    }
  }, []);

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
        setDraftName("");
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
    void apiGet<{ index: Record<string, GraphBindingNode[]> }>("/api/graph/question-bindings-index")
      .then((r) => setQuestionBindingsIndex(r.index ?? {}))
      .catch(() => setQuestionBindingsIndex({}));
  }, []);

  const knowledgeDistributionRows = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const ids of Object.values(bySection)) {
      for (const qid of ids) {
        const nodes = questionBindingsIndex[qid] ?? [];
        if (nodes.length === 0) {
          unassigned += 1;
        } else {
          for (const n of nodes) {
            const name = (n.canonical_name || n.id).trim() || n.id;
            counts.set(name, (counts.get(name) ?? 0) + 1);
          }
        }
      }
    }
    const rows: [string, number][] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (unassigned > 0) {
      rows.push(["__unassigned__", unassigned]);
    }
    return rows.slice(0, 14);
  }, [bySection, questionBindingsIndex]);

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

  const totalScore = useMemo(() => {
    if (!selectedTpl) {
      return 0;
    }
    let t = 0;
    for (const s of selectedTpl.sections) {
      if (s.type === "text") {
        continue;
      }
      const ids = bySection[s.section_id] ?? [];
      const base = scoreBySection[s.section_id] ?? s.score_per_item;
      const ov = scoreOverrides[s.section_id] ?? {};
      for (const qid of ids) {
        t += ov[qid] !== undefined ? ov[qid]! : base;
      }
    }
    return Math.round(t * 1000) / 1000;
  }, [selectedTpl, bySection, scoreBySection, scoreOverrides]);

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
    if (!selectedTpl) {
      return [];
    }
    return selectedTpl.sections.map((s) => {
      const def = s.score_per_item;
      const spi = scoreBySection[s.section_id];
      const score_per_item = spi !== undefined && spi !== def ? spi : null;
      const rawOv = scoreOverrides[s.section_id];
      const score_overrides =
        rawOv && Object.keys(rawOv).length > 0 ? { ...rawOv } : null;
      return {
        section_id: s.section_id,
        question_ids: bySection[s.section_id] ?? [],
        score_per_item,
        score_overrides,
        required_count: countBySection[s.section_id] ?? null,
      };
    });
  }, [selectedTpl, bySection, scoreBySection, scoreOverrides, countBySection]);

  const applyExamDocument = useCallback((doc: ExamDoc) => {
    setPreviewPdfId(null);
    setPreviewWarnings([]);
    setExportLabel(String(doc.export_label ?? ""));
    setSubject(String(doc.subject ?? ""));
    const tp = normTemplatePath(String(doc.template_path ?? ""));
    if (tp) {
      setTemplatePath(tp);
    }
    setTemplateRef(String(doc.template_ref ?? ""));
    const eid = String(doc.exam_id ?? "").trim();
    /** 同步 ref，避免首屏 subjects 请求的 `.then` 在 React 提交前读到陈旧 ref 而覆盖学科 */
    currentExamIdRef.current = eid || null;
    setCurrentExamId(eid || null);
    setDraftName(String(doc.name ?? ""));
    const items = doc.selected_items ?? [];
    const by: Record<string, string[]> = {};
    const sc: Record<string, number | undefined> = {};
    const counts: Record<string, number> = {};
    const ov: Record<string, Record<string, number>> = {};
    const perQ: Record<string, boolean> = {};
    for (const it of items) {
      by[it.section_id] = [...(it.question_ids ?? [])];
      if (it.score_per_item !== undefined && it.score_per_item !== null) {
        sc[it.section_id] = Number(it.score_per_item);
      }
      if (it.required_count !== undefined && it.required_count !== null) counts[it.section_id] = Number(it.required_count);
      if (it.score_overrides && Object.keys(it.score_overrides).length > 0) {
        ov[it.section_id] = { ...it.score_overrides };
        perQ[it.section_id] = true;
      }
    }
    setBySection(by);
    setScoreBySection(sc);
    setCountBySection(counts);
    setScoreOverrides(ov);
    setPerQuestionMode(perQ);
    setSelectedLeftIds([]);
    setLeftListAnchorIndex(null);
    setSelectedRight(null);
    setRightListAnchor(null);
  }, []);

  function addQuestionsToSection(questionIds: string[], sectionId: string | null) {
    if (!selectedTpl || !sectionId || questionIds.length === 0) {
      onError(t("compose:errors.selectQuestionFirst"));
      return;
    }
    const sec = selectedTpl.sections.find((s) => s.section_id === sectionId);
    if (!sec) {
      onError(t("compose:errors.sectionNotFound"));
      return;
    }
    if (sec.type === "text") {
      onError(t("compose:errors.textSectionNoPick"));
      return;
    }
    const compatible = questionIds.filter((qid) => {
      const row = questionMap.get(qid);
      return row && questionTypeMatchesSection(row.type, sec.type, row.answer);
    });
    const skippedType = questionIds.length - compatible.length;
    if (compatible.length === 0) {
      const first = questionMap.get(questionIds[0]);
      onError(
        t("compose:errors.typeMismatch", {
          need: sectionTypeToFilter(sec),
          got: first ? normalizeQuestionTypeForFilter(first.type, first.answer) : "?",
        }),
      );
      return;
    }
    const cur = bySection[sectionId] ?? [];
    const newIds = compatible.filter((id) => !cur.includes(id));
    if (newIds.length === 0) {
      return;
    }
    if (sec.type !== "practice" && cur.length + newIds.length > (countBySection[sectionId] ?? sec.required_count)) {
      onError(t("compose:errors.sectionFull"));
      return;
    }
    onError(null);
    setBySection((prev) => ({
      ...prev,
      [sectionId]: [...(prev[sectionId] ?? []), ...newIds],
    }));
    if (skippedType > 0) {
      setMsg(t("compose:messages.multiAddSkipped", { n: skippedType }));
    }
  }

  function addFromLeft() {
    addQuestionsToSection(selectedLeftIds, activeSection);
  }

  function removeDraggedQuestion(sectionId: string, qid: string) {
    setBySection((prev) => ({ ...prev, [sectionId]: (prev[sectionId] ?? []).filter((id) => id !== qid) }));
    setScoreOverrides((prev) => {
      if (!prev[sectionId] || !(qid in prev[sectionId])) return prev;
      const nextSection = { ...prev[sectionId] };
      delete nextSection[qid];
      return { ...prev, [sectionId]: nextSection };
    });
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
    setBySection((prev) => ({
      ...prev,
      [secId]: (prev[secId] ?? []).filter((x) => !removeIds.includes(x)),
    }));
    setScoreOverrides((prev) => {
      const so = prev[secId];
      if (!so) {
        return prev;
      }
      const next = { ...so };
      for (const id of removeIds) {
        delete next[id];
      }
      const out = { ...prev };
      if (Object.keys(next).length === 0) {
        delete out[secId];
      } else {
        out[secId] = next;
      }
      return out;
    });
    setSelectedRight(null);
    setRightListAnchor(null);
  }

  async function validate() {
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
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmNewPaperDialog() {
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
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runExport(
    overwriteExisting: string | null,
    examIdToDeleteAfterSuccess: string | null,
    failureExamIdsToDeleteAfterSuccess: string[],
    examWorkspaceIdForExport: string | null,
  ) {
    if (!selectedTpl) {
      return;
    }
    const selected_items = buildSelectedItemsForApi();
    const idsToDelete = [
      ...new Set(
        [
          ...(examIdToDeleteAfterSuccess ? [examIdToDeleteAfterSuccess] : []),
          ...failureExamIdsToDeleteAfterSuccess,
        ].filter(Boolean),
      ),
    ];
    const res = await apiPost<{
      ok: boolean;
      exam_dir: string;
      student_pdf: string;
      teacher_pdf: string;
    }>("/api/exam/export", {
      export_label: exportLabel.trim(),
      subject: subject.trim(),
      metadata_title: exportLabel.trim(),
      template_ref: templateRef,
      template_path: templatePath,
      selected_items,
      overwrite_existing: overwriteExisting ?? undefined,
      ...(examWorkspaceIdForExport ? { exam_workspace_id: examWorkspaceIdForExport } : {}),
      ...(idsToDelete.length ? { exam_ids_to_delete_on_success: idsToDelete } : {}),
    });
    const dirNorm = res.exam_dir.replace(/\\/g, "/").replace(/^\/+/, "");
    const m = /^exams\/(.+)$/.exec(dirNorm);
    const examPathId = m ? m[1]! : null;
    setLastExportedExamId(examPathId);
    if (examPathId) {
      setPdfExamId(examPathId);
      setPdfVariant("student");
    }
    let successText = t("compose:messages.exportOk", {
      student: res.student_pdf,
      teacher: res.teacher_pdf,
      dir: res.exam_dir,
    });
    if (examPathId) {
      try {
        await syncPlatformPaperFromExam(examPathId);
        await downloadExportedBundle(examPathId, "pdf");
      } catch (error) {
        successText += `；文件已保存在服务器，但浏览器下载失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (idsToDelete.length) {
      setCurrentExamId((cur) => (cur && idsToDelete.includes(cur) ? null : cur));
      setExportFailureExamIds([]);
      successText += t("compose:messages.draftRemovedAfterExport");
    }
    setMsg(successText);
    void refreshExamSummaries();
  }


  async function runWordExport(
    overwriteExisting: string | null,
    examIdToDeleteAfterSuccess: string | null,
    failureExamIdsToDeleteAfterSuccess: string[],
    examWorkspaceIdForExport: string | null,
  ) {
    if (!selectedTpl) {
      return;
    }
    const selected_items = buildSelectedItemsForApi();
    const idsToDelete = [
      ...new Set(
        [
          ...(examIdToDeleteAfterSuccess ? [examIdToDeleteAfterSuccess] : []),
          ...failureExamIdsToDeleteAfterSuccess,
        ].filter(Boolean),
      ),
    ];
    const res = await apiPost<{
      ok: boolean;
      exam_dir: string;
      student_docx: string;
      teacher_docx: string;
    }>("/api/exam/export-word", {
      export_label: exportLabel.trim(),
      subject: subject.trim(),
      metadata_title: exportLabel.trim(),
      template_ref: templateRef,
      template_path: templatePath,
      selected_items,
      overwrite_existing: overwriteExisting ?? undefined,
      ...(examWorkspaceIdForExport ? { exam_workspace_id: examWorkspaceIdForExport } : {}),
      ...(idsToDelete.length ? { exam_ids_to_delete_on_success: idsToDelete } : {}),
    });
    const dirNorm = res.exam_dir.replace(/\\/g, "/").replace(/^\/+/, "");
    const m = /^exams\/(.+)$/.exec(dirNorm);
    const examPathId = m ? m[1]! : null;
    setLastExportedExamId(examPathId);
    setWordExamId(examPathId);
    if (examPathId && examSummaries.find((ex) => ex.exam_id === examPathId)?.has_pdf) {
      setPdfExamId(examPathId);
    }
    if (examPathId) {
      setPdfVariant("student");
    }
    let successText = t("compose:messages.exportWordOk", {
      student: res.student_docx,
      teacher: res.teacher_docx,
      dir: res.exam_dir,
    });
    if (examPathId) {
      try {
        await syncPlatformPaperFromExam(examPathId);
        await downloadExportedBundle(examPathId, "docx");
      } catch (error) {
        successText += `；文件已保存在服务器，但浏览器下载失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (idsToDelete.length) {
      setCurrentExamId((cur) => (cur && idsToDelete.includes(cur) ? null : cur));
      setExportFailureExamIds([]);
      successText += t("compose:messages.draftRemovedAfterExport");
    }
    setMsg(successText);
    void refreshExamSummaries();
  }
  async function exportExam() {
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const check = await apiPost<{
        conflict: boolean;
        existing_exam_id: string | null;
      }>("/api/exam/export/check-conflict", {
        export_label: exportLabel.trim(),
        subject: subject.trim(),
      });
      if (check.conflict && check.existing_exam_id) {
        setConflictExportKind("pdf");
        setConflictTargetId(check.existing_exam_id);
        setBusy(false);
        return;
      }
      const examIdSnapshot = currentExamId;
      const hasWorkspace = Boolean(examIdSnapshot);
      await runExport(
        null,
        hasWorkspace ? null : examIdSnapshot,
        exportFailureExamIds,
        hasWorkspace ? examIdSnapshot : null,
      );
    } catch (e) {
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
      setBusy(false);
    }
  }


  async function exportWord() {
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const check = await apiPost<{
        conflict: boolean;
        existing_exam_id: string | null;
      }>("/api/exam/export/check-conflict", {
        export_label: exportLabel.trim(),
        subject: subject.trim(),
      });
      if (check.conflict && check.existing_exam_id) {
        setConflictExportKind("word");
        setConflictTargetId(check.existing_exam_id);
        setBusy(false);
        return;
      }
      const examIdSnapshot = currentExamId;
      const hasWorkspace = Boolean(examIdSnapshot);
      await runWordExport(
        null,
        hasWorkspace ? null : examIdSnapshot,
        exportFailureExamIds,
        hasWorkspace ? examIdSnapshot : null,
      );
    } catch (e) {
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
      setBusy(false);
    }
  }
  async function confirmOverwriteExport() {
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
        await runWordExport(
          overwriteId,
          hasWorkspace ? null : examIdSnapshot,
          exportFailureExamIds,
          hasWorkspace ? examIdSnapshot : null,
        );
      } else {
        await runExport(
          overwriteId,
          hasWorkspace ? null : examIdSnapshot,
          exportFailureExamIds,
          hasWorkspace ? examIdSnapshot : null,
        );
      }
    } catch (e) {
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
      setBusy(false);
    }
  }

  const saveDraftToServer = useCallback(async () => {
    if (isImeCompositionActive()) return;
    if (!selectedTpl || !templatePath.trim()) {
      onError(t("compose:errors.selectTemplateForDraft"));
      return;
    }
    onError(null);
    setBusy(true);
    try {
      const selected_items = buildSelectedItemsForApi();
      const body = {
        name: draftName.trim() || undefined,
        subject: subject.trim(),
        export_label: exportLabel.trim(),
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      };
      if (currentExamId) {
        const r = await apiPut<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(currentExamId)}`, {
          ...body,
        });
        applyExamDocument(r.exam);
        setMsg(t("compose:messages.draftUpdated"));
      } else {
        const r = await apiPost<{ exam: ExamDoc }>("/api/exams", body);
        applyExamDocument(r.exam);
        const eid = String(r.exam.exam_id ?? "").trim();
        setMsg(
          eid
            ? t("compose:messages.draftSavedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
            : t("compose:messages.draftSaved"),
        );
      }
      void refreshExamSummaries();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    applyExamDocument,
    buildSelectedItemsForApi,
    currentExamId,
    draftName,
    exportLabel,
    onError,
    refreshExamSummaries,
    selectedTpl,
    subject,
    t,
    templatePath,
    templateRef,
  ]);

  const persistDraftForPublish = useCallback(async (): Promise<ExamDoc | null> => {
    if (isImeCompositionActive()) return null;
    if (!selectedTpl || !templatePath.trim()) {
      onError(t("compose:errors.selectTemplateForDraft"));
      return null;
    }
    onError(null);
    try {
      const selected_items = buildSelectedItemsForApi();
      const body = {
        name: draftName.trim() || undefined,
        subject: subject.trim(),
        export_label: exportLabel.trim(),
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      };
      const response = currentExamId
        ? await apiPut<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(currentExamId)}`, body)
        : await apiPost<{ exam: ExamDoc }>("/api/exams", body);
      applyExamDocument(response.exam);
      void refreshExamSummaries();
      return response.exam;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [
    applyExamDocument,
    buildSelectedItemsForApi,
    currentExamId,
    draftName,
    exportLabel,
    onError,
    refreshExamSummaries,
    selectedTpl,
    subject,
    t,
    templatePath,
    templateRef,
  ]);

  async function openPublishDialog() {
    setPublishBusy(true);
    onError(null);
    try {
      const [data, folderData] = await Promise.all([listTeacherAssignedClasses(), listContentFolders("paper")]);
      setPublishClasses(data.classes);
      setPublishFolders(folderData.folders);
      setPublishFolderId("");
      setPublishRecipientScope("class");
      setPublishStudentIds([]);
      setPublishClassIds([]);
      setPublishSubmissionMode("online");
      setPublishMaxScreenSwitches(0);
      setPublishStartAt("");
      setPublishEndAt("");
      setPublishTimeLimitMinutes(0);
      setPublishMode("current");
      setPracticeHistory([]);
      setPracticeSourceIds([]);
      setPracticeMaxQuestionsPerStudent(20);
      setPublishDialogOpen(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishBusy(false);
    }
  }

  useEffect(() => {
    if (!publishDialogOpen || publishClassIds.length !== 1) {
      setPracticeHistory([]);
      setPracticeSourceIds([]);
      if (publishClassIds.length > 1) setPublishMode("current");
      return;
    }
    let cancelled = false;
    setPracticeHistoryLoading(true);
    void listClassPracticeHistory(publishClassIds[0])
      .then((data) => {
        if (!cancelled) setPracticeHistory(data.publications);
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPracticeHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, publishClassIds, publishDialogOpen]);

  useEffect(() => {
    if (!publishDialogOpen || publishRecipientScope !== "student" || publishClassIds.length !== 1) { setPublishStudents([]); return; }
    let active = true;
    void listTeacherClassStudents(publishClassIds[0]).then(({ students }) => { if (active) setPublishStudents(students); }).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, [publishDialogOpen, publishRecipientScope, publishClassIds, onError]);

  function togglePublishClass(classId: string) {
    if (publishRecipientScope === "student") { setPublishClassIds([classId]); setPublishStudentIds([]); return; }
    setPublishClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  async function publishCurrentPaperOnline() {
    if (publishClassIds.length === 0) {
      onError("请先选择要发布的班级");
      return;
    }
    if (!publishFolderId) { onError("发布前请选择试卷文件夹或归类文件夹"); return; }
    if (publishRecipientScope === "student" && (publishStudentIds.length === 0 || publishFolders.find((folder) => folder.id === publishFolderId)?.kind !== "paper")) { onError("指定学生发布须选择学生和试卷文件夹"); return; }
    setPublishBusy(true);
    onError(null);
    try {
      const adaptiveSettings = {
        class_id: publishClassIds[0],
        title:
          exportLabel.trim() ||
          (publishMode === "wrong_questions" ? "历史错题巩固" : publishMode === "reinforcement" ? "专项巩固" : "在线试卷"),
        start_at: publishStartAt || null,
        end_at: publishEndAt || null,
        submission_mode: publishSubmissionMode,
        max_screen_switches: publishMaxScreenSwitches,
        time_limit_minutes: publishTimeLimitMinutes > 0 ? publishTimeLimitMinutes : null,
      };
      if (publishMode === "wrong_questions") {
        if (publishClassIds.length !== 1 || practiceSourceIds.length !== 1) {
          throw new Error("历史错题卷需要选择一个班级和一份历史试卷");
        }
        const result = await publishWrongQuestionPractice({
          ...adaptiveSettings,
          source_publication_id: practiceSourceIds[0],
          max_questions_per_student: practiceMaxQuestionsPerStudent,
        });
        setMsg(`历史错题卷已发布：${result.assigned_student_count} 人收到，${result.skipped_student_count} 人无错题`);
        setPublishDialogOpen(false);
        return;
      }
      if (publishMode === "reinforcement") {
        if (publishClassIds.length !== 1 || practiceSourceIds.length < 3) {
          throw new Error("专项巩固卷需要选择一个班级和至少 3 份历史试卷");
        }
        const result = await publishReinforcementPractice({
          ...adaptiveSettings,
          source_publication_ids: practiceSourceIds,
          questions_per_student: practiceMaxQuestionsPerStudent,
        });
        setMsg(
          `专项巩固卷已发布：${result.assigned_student_count} 人收到，AI 使用 ${result.generation.total_tokens} tokens`,
        );
        setPublishDialogOpen(false);
        return;
      }
      if (!countsOk) {
        throw new Error("当前试卷题量尚未满足模板要求；可改选历史错题卷或专项巩固卷");
      }
      const saved = await persistDraftForPublish();
      const examId = String(saved?.exam_id ?? currentExamIdRef.current ?? "").trim();
      if (!examId) {
        throw new Error("保存试卷失败，无法取得试卷编号");
      }
      const synced = await syncPlatformPaperFromExam(examId);
      await publishPlatformPaper(synced.paper.paper_id, {
        class_ids: publishClassIds,
        student_ids: publishRecipientScope === "student" ? publishStudentIds : [],
        folder_id: publishFolderId,
        title: exportLabel.trim() || synced.paper.title,
        start_at: publishStartAt || null,
        end_at: publishEndAt || null,
        submission_mode: publishSubmissionMode,
        max_screen_switches: publishMaxScreenSwitches,
        time_limit_minutes: publishTimeLimitMinutes > 0 ? publishTimeLimitMinutes : null,
      });
      setMsg("已发布为线上答题试卷");
      setPublishDialogOpen(false);
      setPublishClassIds([]);
      dispatchExamsChanged({ examId });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishBusy(false);
    }
  }

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
        setDraftName("");
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
    onError(null);
    setBusy(true);
    try {
      const r = await apiGet<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(examId)}`);
      await refreshTemplates();
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
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50" disabled={busy || !countsOk} onClick={() => void exportExam()}>{t("compose:exportPdf")}</button>
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50" disabled={busy || !countsOk} onClick={() => void exportWord()}>{t("compose:exportWord")}</button>
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
    previewPdfId,
    pdfExamId,
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
      {newPaperDialogOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-paper-dialog-title"
        >
          <div className="max-w-lg w-full rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="new-paper-dialog-title" className="text-base font-semibold text-slate-900">
              {t("compose:newPaperDialogTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t("compose:newPaperDialogHint")}</p>
            <div className="mt-4 flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="np-mode"
                  checked={dlgMode === "scratch"}
                  onChange={() => setDlgMode("scratch")}
                />
                {t("compose:newPaperModeScratch")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="np-mode"
                  checked={dlgMode === "history"}
                  onChange={() => setDlgMode("history")}
                />
                {t("compose:newPaperModeHistory")}
              </label>
            </div>
            {dlgMode === "history" ? (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:newPaperPickHistory")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgHistorySourceExamId}
                    onChange={(e) => setDlgHistorySourceExamId(e.target.value)}
                  >
                    <option value="">{t("compose:newPaperPickHistoryPlaceholder")}</option>
                    {exportedExamRows.map((ex) => (
                        <option key={ex.exam_id} value={ex.exam_id}>
                          {ex.export_label || ex.name || ex.exam_id}
                          {ex.subject ? ` · ${ex.subject}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:examLabel")}
                  <input
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgHistoryExportLabel}
                    onChange={(e) => setDlgHistoryExportLabel(e.target.value)}
                    placeholder={t("compose:newPaperHistoryExamLabelPlaceholder")}
                    autoComplete="off"
                  />
                </label>
                <div className="mt-4">
                  <div className="text-xs font-medium text-slate-600">
                    {t("compose:subjectFromHistoryReadonly")}
                  </div>
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800">
                    {dlgSelectedPastExam?.subject?.trim() || "—"}
                  </div>
                </div>
              </>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:examLabel")}
                  <input
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgExportLabel}
                    onChange={(e) => setDlgExportLabel(e.target.value)}
                  />
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:subjectPdf")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgSubject}
                    onChange={(e) => setDlgSubject(e.target.value)}
                  >
                    {subjectOptionsForSelect.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:template")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dialogTemplate?.path ?? ""}
                    onChange={(e) => setDlgTemplatePath(e.target.value)}
                  >
                    {templates.length === 0 && <option value="">{t("compose:templatesMissing")}</option>}
                    {templates.map((tp) => (
                      <option key={tp.path} value={tp.path}>
                        {tp.id}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                disabled={busy}
                onClick={() => setNewPaperDialogOpen(false)}
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={busy || (dlgMode === "scratch" && !dialogTemplate)}
                onClick={() => void confirmNewPaperDialog()}
              >
                {t("compose:newPaperDialogConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {publishDialogOpen ? (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-online-dialog-title"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="publish-online-dialog-title" className="text-base font-semibold text-slate-900">
              发布线上答题试卷
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              将当前组卷保存为试卷，并发布给选中的班级。线上发布不依赖 PDF 编译。
            </p>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => { setPublishRecipientScope("class"); setPublishStudentIds([]); }} className={`rounded border px-3 py-1.5 text-sm ${publishRecipientScope === "class" ? "bg-slate-900 text-white" : ""}`}>发布到班级</button><button type="button" onClick={() => { setPublishRecipientScope("student"); setPublishClassIds([]); setPublishMode("current"); }} className={`rounded border px-3 py-1.5 text-sm ${publishRecipientScope === "student" ? "bg-slate-900 text-white" : ""}`}>指定学生</button></div>
            <ContentFolderHelp paper /><label className="mt-3 block text-sm">试卷归类（必选）<select aria-label="组卷发布文件夹" value={publishFolderId} onChange={(event) => setPublishFolderId(event.target.value)} className="mt-1 w-full rounded border px-2 py-2"><option value="">请选择文件夹</option>{publishFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}</option>)}</select></label>
            {publishRecipientScope === "student" && publishFolderId && publishFolders.find((folder) => folder.id === publishFolderId)?.kind === "category" ? <button type="button" className="mt-2 rounded border border-violet-300 px-2 py-1 text-xs text-violet-700" onClick={() => void updateContentFolder(publishFolderId, { kind: "paper" }).then(({ folder }) => setPublishFolders((current) => current.map((item) => item.id === folder.id ? folder : item))).catch((error) => onError(error instanceof Error ? error.message : String(error)))}>将空文件夹转为试卷文件夹</button> : null}
            <div className="mt-2 flex gap-2"><input aria-label="组卷新建文件夹名称" value={publishNewFolderName} onChange={(event) => setPublishNewFolderName(event.target.value)} placeholder="新文件夹名称" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" /><button type="button" disabled={!publishNewFolderName.trim()} onClick={() => { const parent = publishFolders.find((folder) => folder.id === publishFolderId && folder.kind === "category") ?? publishFolders.find((folder) => folder.kind === "category" && !folder.parent_id); void createContentFolder({ scope: "paper", name: publishNewFolderName.trim(), kind: publishRecipientScope === "student" ? "paper" : "category", parent_id: publishRecipientScope === "student" ? parent?.id : (parent?.id ?? null) }).then(({ folder }) => { setPublishFolders((current) => [...current, folder]); setPublishFolderId(folder.id); setPublishNewFolderName(""); }).catch((error) => onError(error instanceof Error ? error.message : String(error))); }} className="rounded border px-2 py-1 text-xs disabled:opacity-50">新建并选择</button></div>
            <div className="mt-4 max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2">
              {publishClasses.map((klass) => (
                <label
                  key={klass.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type={publishRecipientScope === "student" ? "radio" : "checkbox"}
                    name={publishRecipientScope === "student" ? "compose-personal-class" : undefined}
                    checked={publishClassIds.includes(klass.id)}
                    onChange={() => togglePublishClass(klass.id)}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{klass.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ") || "未分组"}
                    </span>
                  </span>
                </label>
              ))}
              {publishClasses.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  暂无可发布班级，请先在学校端给教师分配班级。
                </p>
              ) : null}
            </div>
            {publishRecipientScope === "student" && publishClassIds.length === 1 ? <div className="mt-3 rounded border p-3"><input aria-label="组卷搜索指定学生" value={publishStudentSearch} onChange={(event) => setPublishStudentSearch(event.target.value)} placeholder="搜索姓名或学号" className="mb-2 w-full rounded border px-2 py-1.5 text-sm" /><div className="max-h-32 overflow-auto">{publishStudents.filter((student) => `${student.display_name} ${student.student_no}`.toLowerCase().includes(publishStudentSearch.toLowerCase())).map((student) => <label key={student.id} className="flex gap-2 p-1 text-sm"><input type="checkbox" checked={publishStudentIds.includes(student.id)} onChange={() => setPublishStudentIds((ids) => ids.includes(student.id) ? ids.filter((id) => id !== student.id) : [...ids, student.id])} />{student.display_name} · {student.student_no}</label>)}</div></div> : null}
            <AdaptivePracticeSelector
              mode={publishMode}
              history={practiceHistory}
              selectedIds={practiceSourceIds}
              maxQuestionsPerStudent={practiceMaxQuestionsPerStudent}
              loading={practiceHistoryLoading}
              disabled={publishClassIds.length !== 1}
              onModeChange={(mode) => {
                setPublishMode(mode);
                setPracticeMaxQuestionsPerStudent(mode === "reinforcement" ? 5 : 20);
              }}
              onSelectionChange={setPracticeSourceIds}
              onMaxQuestionsChange={setPracticeMaxQuestionsPerStudent}
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ["online", "网页答题"],
                ["image_manual", "图片人工批改"],
                ["image_ai", "图片 OCR+AI"],
              ].map(([mode, label]) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    publishSubmissionMode === mode ? "border-emerald-700 bg-emerald-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="compose-publish-submission-mode"
                    value={mode}
                    checked={publishSubmissionMode === mode}
                    onChange={() => setPublishSubmissionMode(mode as PaperSubmissionMode)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              允许切屏次数
              <input
                type="number"
                min={0}
                max={999}
                value={publishMaxScreenSwitches}
                onChange={(event) => setPublishMaxScreenSwitches(Math.max(0, Number(event.target.value || 0)))}
                className="mt-1 w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block text-sm font-medium text-slate-700">
                开始时间
                <input
                  type="datetime-local"
                  value={publishStartAt}
                  onChange={(event) => setPublishStartAt(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                结束时间
                <input
                  type="datetime-local"
                  value={publishEndAt}
                  onChange={(event) => setPublishEndAt(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                做题时长
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={publishTimeLimitMinutes}
                  onChange={(event) => setPublishTimeLimitMinutes(Math.max(0, Number(event.target.value || 0)))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                disabled={publishBusy}
                onClick={() => setPublishDialogOpen(false)}
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                data-testid="compose-publish-online-confirm"
                className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                disabled={
                  publishBusy ||
                  publishClassIds.length === 0 ||
                  !publishFolderId ||
                  (publishRecipientScope === "student" && (publishStudentIds.length === 0 || publishFolders.find((folder) => folder.id === publishFolderId)?.kind !== "paper")) ||
                  (publishMode === "current" && !countsOk) ||
                  (publishMode === "wrong_questions" && (publishClassIds.length !== 1 || practiceSourceIds.length !== 1)) ||
                  (publishMode === "reinforcement" && (publishClassIds.length !== 1 || practiceSourceIds.length < 3))
                }
                onClick={() => void publishCurrentPaperOnline()}
              >
                {publishBusy
                  ? publishMode === "reinforcement"
                    ? "AI 正在生成每位学生的专项题…"
                    : "发布中..."
                  : publishMode === "wrong_questions"
                    ? "发布历史错题卷"
                    : publishMode === "reinforcement"
                      ? "生成并发布专项巩固卷"
                      : "发布线上试卷"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

      <div className="flex min-h-0 flex-1 flex-row">
        <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50 xl:w-56">
          <div className="shrink-0 p-2"><ContentFolders scope="compose" folders={composeFolders} selectedId={selectedComposeFolderId} onSelect={setSelectedComposeFolderId} onCreated={(folder) => setComposeFolders((current) => [...current, folder])} onUpdated={(folder) => setComposeFolders((current) => current.map((item) => item.id === folder.id ? folder : item))} onDeleted={(result) => { setComposeFolders(result.folders); setComposeFolderItems(result.items); }} onDropItem={(id, folderId) => void assignFolderItem("compose", id, folderId).then(() => setComposeFolderItems((items) => ({ ...items, [id]: folderId }))).catch((error) => onError(error instanceof Error ? error.message : String(error)))} onError={onError} /></div>
          <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-2">
            <h2 className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
              {t("compose:historySidebarTitle")}
            </h2>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            <div>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("compose:draftsGroup")}
              </p>
              {draftExamRows.length === 0 ? (
                <p className="px-1 text-xs text-slate-500">{t("compose:historyDraftEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {draftExamRows.map((d) => (
                    <li key={d.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("application/x-or-content-item", JSON.stringify({ scope: "compose", id: d.exam_id }))}
                        className={cn(
                          "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs",
                          currentExamId === d.exam_id
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                        disabled={busy}
                        onClick={() => {
                          void loadExamById(d.exam_id, null);
                        }}
                      >
                        <span className="font-medium text-slate-900">{d.name || d.exam_id}</span>
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">临时</span>
                        {(taggedItems[d.exam_id]?.length ?? 0) > 0 ? <TagChips tags={taggedItems[d.exam_id]} /> : null}
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {t("compose:examStatusEditing")}
                        </span>
                        {d.export_label ? (
                          <span className="mt-0.5 block text-[10px] text-slate-500">{d.export_label}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                        disabled={busy}
                        title={t("compose:deleteDraft")}
                        aria-label={t("compose:deleteDraft")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteExamById(d.exam_id);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("compose:historyGroup")}
              </p>
              {exportedExamRows.length === 0 ? (
                <p className="px-1 text-xs text-slate-500">{t("compose:historyExamEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {exportedExamRows.map((ex) => (
                    <li key={ex.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("application/x-or-content-item", JSON.stringify({ scope: "compose", id: ex.exam_id }))}
                        className={cn(
                          "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs",
                          currentExamId === ex.exam_id
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                        disabled={busy}
                        onClick={() => {
                          setLastExportedExamId(ex.exam_id);
                          void loadExamById(
                            ex.exam_id,
                            ex.has_pdf ? ex.exam_id : null,
                            ex.has_docx ? ex.exam_id : null,
                          );
                        }}
                      >
                        <span className="font-medium text-slate-900">
                          {ex.export_label || ex.name || ex.exam_id}
                        </span>
                        {(taggedItems[ex.exam_id]?.length ?? 0) > 0 ? <TagChips tags={taggedItems[ex.exam_id]} /> : null}
                        {ex.subject ? (
                          <span className="mt-0.5 block text-[10px] text-slate-500">{ex.subject}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                        disabled={busy}
                        title={t("compose:deleteExportedExam")}
                        aria-label={t("compose:deleteExportedExam")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteExamById(ex.exam_id, { exported: true });
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 md:flex-row">
        <section className="hidden w-full min-w-0 shrink-0 flex-col border-slate-200 bg-white md:flex md:w-56 md:border-r xl:w-72" onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-originreach-paper-item')) event.preventDefault(); }} onDrop={(event) => { const raw = event.dataTransfer.getData('application/x-originreach-paper-item'); if (!raw) return; event.preventDefault(); try { const item = JSON.parse(raw) as { sectionId: string; qid: string }; removeDraggedQuestion(item.sectionId, item.qid); } catch { onError('无法读取拖动的题目'); } }}>
          <div className="border-b border-slate-100 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("compose:bankSearchTitle")}</h2>
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100"
              onClick={() => setComposeFilterExpanded((v) => !v)}
            >
              <span>{t("compose:filter")} · {Number(namespaceFilter !== "__all__") + Number(typeFilter !== "__all__") + Number(Boolean(search.trim())) + Number(hasActiveMetadataFilters(metadataFilters))} 项</span>
              <span className="truncate pl-2 text-[10px] font-normal text-slate-500">
                {composeFilterExpanded
                  ? t("common:collapseHint")
                  : t("compose:filterSummary", {
                      subject,
                      collection: namespaceFilter === "__all__" ? t("compose:allCollections") : namespaceFilter,
                      type:
                        typeFilter === "__all__"
                          ? t("compose:allTypes")
                          : typeFilter === "group"
                            ? t("compose:groupOption")
                            : t(`lib:questionTypes.${typeFilter}`, { defaultValue: typeFilter }),
                      search: `${search.trim() ? t("common:searchingSuffix") : ""}${hasActiveMetadataFilters(metadataFilters) ? " · metadata" : ""}`,
                    })}
              </span>
            </button>
            {composeFilterExpanded && (
              <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="组卷筛选" onClick={() => setComposeFilterExpanded(false)}><div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">筛选题目</h3><button type="button" aria-label="关闭组卷筛选" onClick={() => setComposeFilterExpanded(false)}>×</button></div><div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:subjectForExport")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  >
                    {subjectOptionsForSelect.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:collection")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={namespaceFilter}
                    onChange={(e) => setNamespaceFilter(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    {namespaces.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:questionType")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    <option value="group">{t("compose:groupOption")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:search")}
                  <input
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400"
                    placeholder={t("compose:searchPlaceholder")}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || isImeComposingKeyboardEvent(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      commitSearch(e.currentTarget.value);
                    }}
                    onBlur={(e) => commitSearch(e.currentTarget.value)}
                  />
                </label>
                <MetadataFilterControls
                  definitions={metadataFilterDefinitions}
                  filters={metadataFilters}
                  onChange={setMetadataFilters}
                />
              </div><div className="mt-4 flex justify-end"><button type="button" onClick={() => setComposeFilterExpanded(false)} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">查看结果</button></div></div></div>
            )}
            <p className="mt-2 text-[10px] leading-snug text-slate-500">可将题目拖入右侧小节；多选后也可用箭头加入。</p>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto p-2">
            {contentSyncing ? (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-700">正在更新内容库...</div>
            ) : questions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                <p className="font-medium text-slate-800">{t("compose:emptyBank")}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("compose:emptyBankHint")}</p>
              </li>
            ) : filteredQuestions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                <p className="font-medium text-slate-800">{t("compose:emptyFilter")}</p>
                <p className="mt-2 text-xs text-slate-500">{t("compose:emptyFilterHint")}</p>
              </li>
            ) : (
              filteredQuestions.map((q, index) => {
                const isBundle = q.type === "group";
                return (
                  <li key={q.qualified_id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData('application/x-originreach-bank-qids', JSON.stringify(selectedLeftIdsSet.has(q.qualified_id) ? selectedLeftIds : [q.qualified_id]))}
                      onClick={(e) => handleLeftBankClick(q, index, e)}
                      className={cn(
                        "mb-1 w-full rounded-lg border px-2 py-2 text-left text-sm transition-colors",
                        selectedLeftIdsSet.has(q.qualified_id)
                          ? "border-slate-900 bg-slate-100"
                          : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white",
                      )}
                    >
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {t(`lib:questionTypes.${q.type}`, { defaultValue: q.type })}
                      </span>
                      {isBundle ? (
                        <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                          {t("compose:bundleBadge")}
                        </span>
                      ) : null}
                      <span className="ml-1 font-mono text-[11px] text-slate-800">{q.qualified_id}</span>
                      <QuestionHoverDetails id={q.qualified_id}><KatexPlainPreview
                        text={q.content_preview}
                        className="mt-1 line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                      /></QuestionHoverDetails>
                      {Object.keys(q.metadata ?? {}).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(q.metadata ?? {}).map(([k, v]) => (
                            <span key={k} className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-600">
                              {k}:{String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <div className="flex w-full shrink-0 flex-row items-center justify-center gap-2 border-y border-slate-200 bg-slate-100/90 py-2 md:w-11 md:flex-col md:justify-start md:gap-3 md:border-x md:border-y-0 md:py-4">
          <button type="button" disabled={!selectedTpl} className="rounded border bg-white p-1 text-xs" title="按当前筛选题目补齐各大题空缺；保留已选题目，不重复添加" onClick={() => {
            if (!selectedTpl) return;
            const next = fillSectionGaps(selectedTpl.sections.map((section) => ({ ...section, required_count: countBySection[section.section_id] ?? section.required_count })), bySection, filteredQuestions, questionTypeMatchesSection);
            const added = Object.values(next).flat().length - Object.values(bySection).flat().length;
            setBySection(next);
            setMsg(`已补入 ${added} 题；不足时请放宽左侧筛选条件。`);
          }}>补齐空缺</button>
          <button
            type="button"
            title={t("compose:addToSection")}
            onClick={addFromLeft}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            title={t("compose:removeFromPaper")}
            onClick={removeFromRight}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        <section className="min-h-0 min-w-0 flex-1 basis-0 overflow-auto bg-slate-50 p-4 lg:min-w-0">
          {currentExamId ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-xs"><span>当前试卷归类</span><select aria-label="组卷所在文件夹" value={composeFolderItems[currentExamId] ?? ""} onChange={(event) => { const folderId = event.target.value; void assignFolderItem("compose", currentExamId, folderId || null).then(() => setComposeFolderItems((items) => ({ ...items, [currentExamId]: folderId }))).catch((error) => onError(error instanceof Error ? error.message : String(error))); }} className="rounded border px-2 py-1"><option value="">未归类</option>{composeFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><ContentTags scope="compose" itemId={currentExamId} onError={onError} onChange={() => void listTaggedItems("compose").then(({ items }) => setTaggedItems(items))} /></div> : null}
          {conflictTargetId ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="overwrite-dialog-title"
            >
              <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
                <h2 id="overwrite-dialog-title" className="text-base font-semibold text-slate-900">
                  {t("compose:overwriteTitle")}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{t("compose:overwriteBody")}</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                    onClick={() => {
                      setConflictTargetId(null);
                      setConflictExportKind(null);
                    }}
                  >
                    {t("common:cancel")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    disabled={busy}
                    onClick={() => void confirmOverwriteExport()}
                  >
                    {t("compose:overwriteExport")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:examLabel")}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{exportLabel.trim() || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:subjectPdf")}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{subject.trim() || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:template")}</p>
                <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{selectedTpl?.id ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:totalScoreLabel")}</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">{totalScore}</p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-700">{t("compose:knowledgeDistributionTitle")}</p>
              {knowledgeDistributionRows.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">{t("compose:knowledgeDistributionEmpty")}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {knowledgeDistributionRows.map(([name, n]) => (
                    <li
                      key={name}
                      className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-800"
                    >
                      {name === "__unassigned__" ? t("compose:knowledgeUnassigned") : name}
                      <span className="text-slate-500"> · {n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {contentSyncing ? null : templates.length === 0 && (
            <p className="text-sm text-red-600">{t("compose:templatesMissing")}</p>
          )}

          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {t("compose:activeSection")}
              <select
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                value={activeSection ?? ""}
                onChange={(e) => setActiveSection(e.target.value || null)}
              >
                {selectedTpl?.sections.map((s) => (
                  <option key={s.section_id} value={s.section_id}>
                    {s.section_id}
                    {s.type === "text"
                      ? t("compose:sectionOptionText")
                      : s.type === "practice"
                        ? t("compose:sectionOptionPractice")
                      : t("compose:sectionOptionNeed", { n: countBySection[s.section_id] ?? s.required_count })}
                  </option>
                ))}
              </select>
            </p>
            <p className="text-[10px] leading-snug text-slate-500">拖回左侧题库可从试卷移除；点击题目可多选后用箭头移除。</p>

            {selectedTpl?.sections.map((s) => {
              const n = bySection[s.section_id]?.length ?? 0;
              const isText = s.type === "text";
              const isPractice = s.type === "practice";
              const ok = isText || (isPractice ? n > 0 : n === (countBySection[s.section_id] ?? s.required_count));
              const sectionBaseScore = scoreBySection[s.section_id] ?? s.score_per_item;
              const slots = clusterAdjacentGroupSlots(bySection[s.section_id] ?? [], questionMap);
              return (
                <div
                  key={s.section_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveSection(s.section_id);
                    setSubject(subject);
                    if (s.type === "text") {
                      setTypeFilter("__all__");
                    } else {
                      setTypeFilter(sectionTypeToFilter(s));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setActiveSection(s.section_id);
                      setSubject(subject);
                      if (s.type === "text") {
                        setTypeFilter("__all__");
                      } else {
                        setTypeFilter(sectionTypeToFilter(s));
                      }
                    }
                  }}
                  onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-originreach-bank-qids')) event.preventDefault(); }}
                  onDrop={(event) => { const raw = event.dataTransfer.getData('application/x-originreach-bank-qids'); if (!raw) return; event.preventDefault(); event.stopPropagation(); try { addQuestionsToSection(JSON.parse(raw) as string[], s.section_id); setActiveSection(s.section_id); } catch { onError('无法读取拖动的题目'); } }}
                  className={cn(
                    "rounded-xl border bg-white shadow-sm transition-shadow",
                    activeSection === s.section_id ? "border-slate-900 ring-1 ring-slate-900/10" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <div className="border-b border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">{s.section_id}</h3>
                      <p className="text-[11px] text-slate-500">
                        {isText ? (
                          <>
                            {t("compose:textSectionLine")}
                            {ok && <span className="ml-2 text-emerald-600">{t("compose:configured")}</span>}
                          </>
                        ) : isPractice ? (
                          <>
                            {t("compose:practicePickedCount", { n })}
                            {ok && <span className="ml-2 text-emerald-600">{t("compose:satisfied")}</span>}
                          </>
                        ) : (
                          <>
                            {t("compose:pickedCount", { n, need: countBySection[s.section_id] ?? s.required_count })}
                            {ok && <span className="ml-2 text-emerald-600">{t("compose:satisfied")}</span>}
                          </>
                        )}
                      </p>
                      {s.describe ? (
                        <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">{s.describe}</p>
                      ) : null}
                      {!isText ? (
                        <div
                          className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-50 pt-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {s.type !== "practice" ? <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">题目数量<input aria-label={`${s.section_id}题目数量`} type="number" min={0} max={500} value={countBySection[s.section_id] ?? s.required_count} onChange={(event) => setCountBySection((current) => ({ ...current, [s.section_id]: Math.max(0, Math.min(500, Number(event.target.value) || 0)) }))} className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-sm" /></label> : null}
                          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            {t("compose:scorePerItem")}
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              className="w-20 rounded-md border border-slate-300 px-1.5 py-1 text-sm"
                              value={scoreBySection[s.section_id] ?? s.score_per_item}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                setScoreBySection((prev) => ({
                                  ...prev,
                                  [s.section_id]: Number.isFinite(v) ? v : undefined,
                                }));
                              }}
                            />
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={perQuestionMode[s.section_id] ?? false}
                              onChange={(e) =>
                                setPerQuestionMode((p) => ({
                                  ...p,
                                  [s.section_id]: e.target.checked,
                                }))
                              }
                            />
                            {t("compose:perQuestionScores")}
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <ul className="space-y-1 p-3">
                    {isText ? (
                      <li className="text-center text-xs text-slate-500">{t("compose:textSectionNoPickHere")}</li>
                    ) : (
                      <>
                        {slots.map((slot, si) => {
                          if (slot.kind === "single") {
                            const qid = slot.qid;
                            const selectedHere =
                              selectedRight?.sectionId === s.section_id && selectedRight.qids.includes(qid);
                            return (
                              <li key={qid}>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData('application/x-originreach-paper-item', JSON.stringify({ sectionId: s.section_id, qid })); }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRightPaperSlotClick(s.section_id, slots, si, slot, e);
                                    setLeftListAnchorIndex(null);
                                  }}
                                  className={cn(
                                    "w-full rounded-md border px-2 py-2 text-left text-sm",
                                    selectedHere ? "border-slate-900 bg-slate-100" : "border-slate-100 bg-slate-50 hover:bg-white",
                                  )}
                                >
                                  <span className="font-mono text-xs text-slate-800">{qid}</span>
                                  <QuestionHoverDetails id={qid}><KatexPlainPreview
                                    text={questionMap.get(qid)?.content_preview ?? ""}
                                    className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                  /></QuestionHoverDetails>
                                  {perQuestionMode[s.section_id] ? (
                                    <div
                                      className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span className="text-[10px] text-slate-500">{t("compose:scoreThisQuestion")}</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                        value={
                                          scoreOverrides[s.section_id]?.[qid] !== undefined
                                            ? scoreOverrides[s.section_id]![qid]
                                            : ""
                                        }
                                        placeholder={String(sectionBaseScore)}
                                        onChange={(e) => {
                                          const raw = e.target.value.trim();
                                          setScoreOverrides((prev) => {
                                            const cur = { ...(prev[s.section_id] ?? {}) };
                                            if (raw === "") {
                                              delete cur[qid];
                                            } else {
                                              const v = parseFloat(raw);
                                              if (Number.isFinite(v)) {
                                                cur[qid] = v;
                                              }
                                            }
                                            const next = { ...prev };
                                            if (Object.keys(cur).length === 0) {
                                              delete next[s.section_id];
                                            } else {
                                              next[s.section_id] = cur;
                                            }
                                            return next;
                                          });
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                </button>
                              </li>
                            );
                          }
                          const headQid = slot.qids[0];
                          const mat = slot.rep.group_material?.trim();
                          const prevText = mat
                            ? mat.replace(/\s+/g, " ").slice(0, 120) + (mat.length > 120 ? "…" : "")
                            : questionMap.get(headQid)?.content_preview;
                          const selectedHere =
                            selectedRight?.sectionId === s.section_id &&
                            slot.qids.every((q) => selectedRight.qids.includes(q));
                          return (
                            <li key={`grp-${slot.rep.group_id}-${si}`}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRightPaperSlotClick(s.section_id, slots, si, slot, e);
                                  setLeftListAnchorIndex(null);
                                }}
                                className={cn(
                                  "w-full rounded-md border px-2 py-2 text-left text-sm",
                                  selectedHere ? "border-slate-900 bg-slate-100" : "border-slate-100 bg-slate-50 hover:bg-white",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                                    {t("compose:groupBadge", { count: slot.qids.length })}
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-800">{slot.rep.group_id}</span>
                                </div>
                                <p className="mt-0.5 font-mono text-[10px] leading-tight text-slate-500">{slot.qids.join(" · ")}</p>
                                <QuestionHoverDetails id={headQid}><KatexPlainPreview
                                  text={prevText ?? ""}
                                  className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                /></QuestionHoverDetails>
                                {perQuestionMode[s.section_id] ? (
                                  <div
                                    className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="text-[10px] text-slate-500">{t("compose:groupScore")}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                      value={
                                        scoreOverrides[s.section_id]?.[headQid] !== undefined
                                          ? scoreOverrides[s.section_id]![headQid]
                                          : ""
                                      }
                                      placeholder={String(sectionBaseScore)}
                                      onChange={(e) => {
                                        const raw = e.target.value.trim();
                                        setScoreOverrides((prev) => {
                                          const cur = { ...(prev[s.section_id] ?? {}) };
                                          if (raw === "") {
                                            delete cur[headQid];
                                          } else {
                                            const v = parseFloat(raw);
                                            if (Number.isFinite(v)) {
                                              cur[headQid] = v;
                                            }
                                          }
                                          const next = { ...prev };
                                          if (Object.keys(cur).length === 0) {
                                            delete next[s.section_id];
                                          } else {
                                            next[s.section_id] = cur;
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                        {(bySection[s.section_id] ?? []).length === 0 && (
                          <li className="text-center text-xs text-slate-400">{t("compose:emptySlotHint")}</li>
                        )}
                      </>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          {!countsOk && selectedTpl && (
            <p className="mt-2 text-xs text-slate-500">{t("compose:exportWhenReady")}</p>
          )}
        </section>
        <aside className="hidden min-h-0 w-full flex-col border-slate-200 bg-white shadow-xl xl:relative xl:z-auto xl:flex xl:translate-x-0 xl:shadow-none xl:static xl:h-auto xl:w-auto xl:min-w-0 xl:flex-1 xl:basis-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-600">{t("compose:pdfVariantLabel")}</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              value={pdfVariant}
              onChange={(e) => setPdfVariant(e.target.value === "teacher" ? "teacher" : "student")}
            >
              <option value="student">{t("compose:pdfVariantStudent")}</option>
              <option value="teacher">{t("compose:pdfVariantTeacher")}</option>
            </select>
            {pdfExamId && !previewPdfId ? (
              <button type="button" className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800" onClick={() => void downloadExportedBundle(pdfExamId, "pdf").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>下载正式 PDF</button>
            ) : null}
            {pdfExamId && !previewPdfId ? (
              <button
                type="button"
                className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
                disabled={busy || viewPdfBusy}
                onClick={() => void openViewPdfExternally()}
              >
                {t("compose:openPdfExternal")}
              </button>
            ) : null}
            {wordOpenExamId && !previewPdfId ? (
              <button type="button" className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800" onClick={() => void downloadExportedBundle(wordOpenExamId, "docx").catch((error) => onError(error instanceof Error ? error.message : String(error)))}>下载正式 Word</button>
            ) : null}
            {wordOpenExamId && !previewPdfId ? (
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
                disabled={busy || viewWordBusy}
                onClick={() => void openViewWordExternally()}
              >
                {t("compose:openWordExternal")}
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {composeRightPdfPath ? (
              <PdfPreview apiPath={composeRightPdfPath} className="min-h-[min(70vh,560px)]" />
            ) : (
              <p className="text-xs text-slate-500">{t("compose:previewPdfEmptyHint")}</p>
            )}
          </div>
        </aside>
        </div>
      </div>
      {previewOpen && composeRightPdfPath ? <div className="fixed inset-0 z-[80] flex flex-col bg-slate-900/70 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="试卷预览">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-t-lg bg-white px-4 py-2"><h2 className="text-sm font-semibold">试卷预览</h2><button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={() => setPreviewOpen(false)}>关闭</button></div>
        <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto rounded-b-lg bg-white p-3"><PdfPreview apiPath={composeRightPdfPath} className="min-h-full" /></div>
      </div> : null}
    </div>
  );
}
