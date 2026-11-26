import analysisPrintCss from "./analysisPrint.css?raw";
import { ChangeEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectionIndicator } from "../../../design-system/SelectionIndicator";
import {
  BarChart3,
  ChevronDown,
  ClipboardList,
  Download,
  FolderPlus,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { apiDownloadBlob, apiGet } from "../../../api/client";
import { DeferredMount } from "../../../components/DeferredMount";
import { scheduleWorkspaceWork, useAfterWorkspaceTransition } from "../../../lib/workspaceWorkScheduler";
import { formatSubjectLabel } from "../../../lib/subjectLabels";
import { useCollapsedPanelInert } from "../../../hooks/useCollapsedPanelInert";
import { ContentTags, TagChips } from "../../../components/ContentTags";
import {
  analyzePlatformPaper,
  completePaperAttemptGrading,
  downloadPaperAnalysisReport,
  downloadOfflineAnswerUploader,
  downloadOfflineScanImage,
  gradePaperAnswer,
  getAccountProfile,
  analyzePaperFolder,
  createContentFolder,
  listContentFolders,
  listTaggedItems,
  movePaperToFolder,
  moveContentItemsToFolder,
  updateContentFolder,
  listTeacherClassStudents,
  listPaperSubmissions,
  listPlatformPaperPublications,
  listPlatformPapers,
  listTeacherAssignedClasses,
  loadSessionToken,
  LEGACY_SESSION_STORAGE_KEY,
  publishPlatformPaper,
  revokePlatformPaperPublication,
  suggestAiGradesForAttempt,
  updatePlatformPaperPublication,
  updatePlatformPaperDeliveryMode,
  uploadPaperScores,
  type PaperPublicationRecord,
  type PaperSubmissionMode,
  type PaperSubmissionRecord,
  type PlatformPaperAnalysis,
  type PlatformPaperRecord,
  type TeacherClassRecord,
  type TeacherClassStudentRecord,
  type ContentFolder,
  type ContentTag,
} from "../../../platform/auth";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import {
  applyGradingSuggestions,
  getGradingDraft,
  gradingFeedbackForSave,
  markGradingDraftSaved,
  parseGradingScore,
  reconcileGradingDrafts,
  restoreGradingDraft,
  updateGradingDraft,
  type GradingDraftSource,
  type GradingDrafts,
} from "./gradingModel";
import { usePaperGrading } from "./usePaperGrading";
import { PaperListSidebar } from "./PaperListSidebar";
import { G51EmptyState, G51Panel, G51Pill } from "../../../ui-redesign/g51/PaperUiComponents";
import "../../../ui-redesign/g51/g51Styles.css";
import {
  readGradingDraft,
  writeGradingDraft,
  type GradingDraftStorageScope,
} from "./gradingDraftStorage";
import {
  type PaperQuery,
  type PageMeta,
  mergeMeta,
  htmlEscape,
  downloadBlob,
  gradingStatusLabel,
  formatStudentAnswer,
} from "./paperHelpers";
import { Select as AppSelect } from "../../../components/ui/select";

export type ProjectScopeProp =
  | { ready: false; value: null }
  | { ready: true; value: string | null };

const EMPTY_PAPERS: PlatformPaperRecord[] = [];
const EMPTY_CLASSES: TeacherClassRecord[] = [];
const EMPTY_PAPER_META: PageMeta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };

const LazyPlatformPaperAnalysisCharts = lazy(() =>
  import("../AnalysisCharts").then(({ PlatformPaperAnalysisCharts }) => ({ default: PlatformPaperAnalysisCharts })),
);
const LazyGradingWorkspace = lazy(() =>
  import("./GradingWorkspace").then(({ GradingWorkspace }) => ({ default: GradingWorkspace })),
);
const LazyPaperSubmissionDetail = lazy(() =>
  import("./PaperSubmissionDetail").then(({ PaperSubmissionDetail }) => ({ default: PaperSubmissionDetail })),
);
const LazyGradingQuestionCard = lazy(() => import("./GradingQuestionCard"));
const LazyPaperClassPublishPanel = lazy(() =>
  import("./PaperClassPublishPanel").then(({ PaperClassPublishPanel }) => ({ default: PaperClassPublishPanel })),
);
const LazyPaperPublishingSidebar = lazy(() =>
  import("./PaperPublishingSidebar").then(({ PaperPublishingSidebar }) => ({ default: PaperPublishingSidebar })),
);

type Props = {
  openTarget?: { paperId: string; attemptId: string; title: string } | null;
  onOpenTargetConsumed?: () => void;
  onOpenAnalysis?: (examId: string) => void;
  onOpenBank?: () => void;
  onOpenTemplates?: () => void;
  onOpenCompose?: () => void;
  onError?: (message: string | null) => void;
  assignStudent?: { classId: string; studentId: string; name: string } | null;
  onAssignStudentConsumed?: () => void;
  projectScope?: ProjectScopeProp;
};

type AnalysisBusyOwner = {
  id: number;
  value: string;
};

type AnalysisRequestOperation = {
  requestId: number;
  ownerKey: string;
  scopeKey: string;
  scopeGeneration: number;
  sessionToken: string | null;
  sessionGeneration: number;
  paperId: string;
  busyOwner: AnalysisBusyOwner;
};

type AnalysisReportOperation = {
  id: number;
  scopeKey: string;
  scopeGeneration: number;
  sessionToken: string | null;
  sessionGeneration: number;
  busyOwner: AnalysisBusyOwner;
};

type AnalysisSnapshotState = {
  ownerKey: string;
  requestId: number;
  sessionToken: string | null;
  analysis: PlatformPaperAnalysis;
};

type AnalysisFilterSelection = {
  ownerKey: string;
  publicationId: string | undefined;
  classId: string | undefined;
};

type PaperViewMountStages = {
  scopeToken: string;
  publishForm: boolean;
  publicationHistory: boolean;
  manageUtilities: boolean;
  gradingWorkspace: boolean;
  gradingAttemptId: string | null;
};

const EMPTY_PAPER_VIEW_MOUNT_STAGES: Omit<PaperViewMountStages, "scopeToken"> = {
  publishForm: false,
  publicationHistory: false,
  manageUtilities: false,
  gradingWorkspace: false,
  gradingAttemptId: null,
};

type AcceptedAiSuggestion = {
  attemptId: string;
  questionId: string;
  status?: string;
  suggestedScore?: number | null;
  feedback?: string | null;
  fields: Array<"score" | "feedback">;
};

function paperHasPublicationHistory(paper: PlatformPaperRecord): boolean {
  return paper.publication_count > 0 || paper.has_publication_history === true;
}

function useWorkspaceScopeToken(scopeKey: string): string {
  const generationRef = useRef({ scopeKey, generation: 0 });
  if (generationRef.current.scopeKey !== scopeKey) {
    generationRef.current = { scopeKey, generation: generationRef.current.generation + 1 };
  }
  return `${scopeKey}\u0000${generationRef.current.generation}`;
}

function PaperSelectPlaceholder({ label, className }: { label: string; className: string }) {
  return (
    <span className={`or-select-trigger ${className}`} aria-hidden="true">
      <span className="or-select-balance" />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown className="or-select-arrow h-4 w-4" />
    </span>
  );
}

function PaperPublishPanelPlaceholder({
  recipientScope,
  folderLabel,
  subjectLabel,
}: {
  recipientScope: "class" | "student";
  folderLabel: string;
  subjectLabel: string;
}) {
  const scopeButtonClass = (active: boolean) => `flex-1 sm:flex-initial rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
    active
      ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] border-[var(--or-primary)] shadow-sm"
      : "bg-[var(--or-card)] text-[var(--or-muted)] border-[var(--or-outline)]"
  }`;

  return (
    <div className="min-w-0" role="status" aria-label="正在准备发布面板">
      <span className="sr-only">正在准备发布面板…</span>
      <G51Panel title="发布试卷" icon={<Wifi className="h-5 w-5 text-[var(--or-on-container)]" />}>
        <div className="space-y-5" aria-hidden="true">
          <div className="flex w-full gap-2 sm:w-auto">
            <span className={scopeButtonClass(recipientScope === "class")}>发布到班级</span>
            <span className={scopeButtonClass(recipientScope === "student")}>指定学生</span>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--or-text)]">
              试卷归类（必选） <span className="text-[var(--or-on-error)]">*</span>
            </label>
            <PaperSelectPlaceholder label={folderLabel} className="or-g51-select w-full" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <span className="or-g51-input flex min-w-0 flex-1 items-center">
              <span className="h-3.5 w-28 rounded bg-[var(--or-block)]" />
            </span>
            <span className="or-g51-btn or-g51-btn-outline w-full shrink-0 px-3 py-2 text-xs sm:w-auto sm:py-1.5">
              <FolderPlus className="mr-1 inline h-4 w-4" />
              新建并选择
            </span>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--or-text)]">发布学科</label>
            <PaperSelectPlaceholder label={subjectLabel} className="or-g51-select w-full" />
          </div>
          <div className="min-h-56 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]">
            滚动到班级选择区域后加载…
          </div>
          <div className="min-h-64 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]">
            滚动到提交设置后加载…
          </div>
        </div>
      </G51Panel>
    </div>
  );
}

function PaperPublicationHistoryPlaceholder({ publications }: { publications: PaperPublicationRecord[] }) {
  const reservedHeight = Math.min(publications.length, 4) * 172;
  return (
    <div className="min-w-0" role="status" aria-label="正在准备发布记录">
      <span className="sr-only">正在准备发布记录…</span>
      <G51Panel title="发布记录" icon={<History className="h-5 w-5 text-[var(--or-on-container)]" />}>
        {publications.length === 0 ? (
          <G51EmptyState message="暂无发布记录" />
        ) : (
          <div
            className="rounded-xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-4"
            style={{ minHeight: reservedHeight }}
            aria-hidden="true"
          />
        )}
      </G51Panel>
    </div>
  );
}

function PaperManageUtilitiesPlaceholder({ analysisAvailable }: { analysisAvailable: boolean }) {
  return (
    <aside className="space-y-5" role="status" aria-label="正在准备成绩与分析工具">
      <div className="space-y-5" aria-hidden="true">
        <Panel title="线下成绩" icon={<Upload className="h-5 w-5 text-[var(--or-on-container)]" />}>
          <div className="flex flex-col gap-2.5">
            <button type="button" disabled className="or-g51-btn or-g51-btn-outline w-full text-sm font-medium">下载成绩模板</button>
            <button type="button" disabled className="or-g51-btn or-g51-btn-primary w-full text-sm font-semibold">上传成绩</button>
          </div>
        </Panel>
        <Panel title="分析" icon={<BarChart3 className="h-5 w-5 text-[var(--or-on-container)]" />}>
          <button type="button" disabled className="or-g51-btn or-g51-btn-primary w-full text-sm font-semibold">查看分析摘要</button>
          {analysisAvailable ? <p className="mt-2.5 text-xs font-medium text-[var(--or-on-success)]">分析已在大窗口中打开</p> : null}
          <button type="button" disabled className="or-g51-btn or-g51-btn-outline mt-2.5 w-full text-sm font-medium">打开分析</button>
        </Panel>
      </div>
    </aside>
  );
}

function readPaperLargeScreen(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(min-width: 1024px)").matches;
  } catch {
    return true;
  }
}

function usePaperLargeScreen(): boolean {
  const [largeScreen, setLargeScreen] = useState(readPaperLargeScreen);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(min-width: 1024px)");
    } catch {
      return;
    }
    const update = () => setLargeScreen(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    if (typeof media.addListener === "function") {
      media.addListener(update);
      return () => media.removeListener(update);
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return largeScreen;
}

export function PapersWorkspace({ openTarget, onOpenTargetConsumed, onOpenAnalysis, onOpenBank, onOpenTemplates, onOpenCompose, onError, assignStudent, onAssignStudentConsumed, projectScope }: Props) {
  const largeScreen = usePaperLargeScreen();
  const sessionToken = loadSessionToken();
  const [, setSessionStorageRevision] = useState(0);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEGACY_SESSION_STORAGE_KEY || event.key === null) {
        setSessionStorageRevision((current) => current + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const sessionGenerationRef = useRef({ token: sessionToken, generation: 0 });
  if (sessionGenerationRef.current.token !== sessionToken) {
    sessionGenerationRef.current = {
      token: sessionToken,
      generation: sessionGenerationRef.current.generation + 1,
    };
  }
  const sessionGeneration = sessionGenerationRef.current.generation;
  const [accountProfileState, setAccountProfileState] = useState<{
    sessionToken: string | null;
    accountId: string | null;
    subjects: string[];
    ready: boolean;
    failed: boolean;
  }>({ sessionToken: null, accountId: null, subjects: [], ready: false, failed: false });
  const accountProfileReady = accountProfileState.sessionToken === sessionToken && accountProfileState.ready;
  const accountProfileFailed = accountProfileState.sessionToken === sessionToken && accountProfileState.failed;
  const gradingAccountId = accountProfileReady ? accountProfileState.accountId : null;
  const teacherSubjects = accountProfileReady ? accountProfileState.subjects : [];
  const [paperCollectionState, setPaperCollectionState] = useState<{
    scopeKey: string;
    papers: PlatformPaperRecord[];
    classes: TeacherClassRecord[];
    meta: PageMeta;
  }>({
    scopeKey: "",
    papers: [],
    classes: [],
    meta: { total: 0, page: 1, pageSize: 10, totalPages: 1 },
  });
  const [paperQuery, setPaperQuery] = useState<PaperQuery>({
    q: "",
    deliveryMode: "all",
    status: "all",
    page: 1,
    pageSize: 10,
  });
  const [publicationState, setPublicationState] = useState<{
    ownerKey: string;
    publications: PaperPublicationRecord[];
  }>({ ownerKey: "", publications: [] });
  const [submissionState, setSubmissionState] = useState<{
    ownerKey: string;
    submissions: PaperSubmissionRecord[];
  }>({ ownerKey: "", submissions: [] });
  const [selectedGradingAttemptId, setSelectedGradingAttemptId] = useState("");
  const [submissionMode, setSubmissionMode] = useState<PaperSubmissionMode>("online");
  const [maxScreenSwitches, setMaxScreenSwitches] = useState(0);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(0);
  const [publishStartAt, setPublishStartAt] = useState("");
  const [publishEndAt, setPublishEndAt] = useState("");
  const [paperDetailView, setPaperDetailView] = useState<"manage" | "grading">("manage");
  const mobileSegmentRef = useRef<HTMLDivElement>(null);
  const deliveryModeSegmentRef = useRef<HTMLDivElement>(null);
  const detailViewSegmentRef = useRef<HTMLDivElement>(null);
  const detailScrollRootRef = useRef<HTMLElement | null>(null);
  const [gradingDraftState, setGradingDraftState] = useState<{
    scopeKey: string;
    draftsByPaper: Record<string, GradingDrafts>;
  }>({ scopeKey: "", draftsByPaper: {} });
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [movingSelectedPapers, setMovingSelectedPapers] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [browserFolderId, setBrowserFolderId] = useState<string | null>(null);
  const [publishFolderId, setPublishFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [recipientScope, setRecipientScope] = useState<"class" | "student">("class");
  const [classStudents, setClassStudents] = useState<TeacherClassStudentRecord[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [folderAnalysis, setFolderAnalysis] = useState<Awaited<ReturnType<typeof analyzePaperFolder>> | null>(null);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<AnalysisSnapshotState | null>(null);
  const [analysisDialogOwnerKey, setAnalysisDialogOwnerKey] = useState<string | null>(null);
  const [analysisFilterSelection, setAnalysisFilterSelection] = useState<AnalysisFilterSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanImageUrls, setScanImageUrls] = useState<Record<string, string>>({});
  const scanObjectUrlsRef = useRef<string[]>([]);
  const publicationRequestIdRef = useRef(0);
  const submissionRequestIdRef = useRef(0);
  const analysisRequestIdRef = useRef(0);
  const activeAnalysisRequestRef = useRef<AnalysisRequestOperation | null>(null);
  const reportRequestIdRef = useRef(0);
  const activeAnalysisReportsRef = useRef(new Map<number, AnalysisReportOperation>());
  const analysisBusyOwnerIdRef = useRef(0);
  const analysisBusyOwnerRef = useRef<AnalysisBusyOwner | null>(null);
  const analysisMountedRef = useRef(false);
  const [localGradingProjectId, setLocalGradingProjectId] = useState<string | null>(null);
  const [localGradingProjectReady, setLocalGradingProjectReady] = useState(false);
  const listRequestIdRef = useRef(0);
  const [gradingDraftStorageWarning, setGradingDraftStorageWarning] = useState<{ ownerKey: string; visible: boolean }>({ ownerKey: "", visible: false });
  const gradingDraftSourceVersionsRef = useRef(new Map<string, string | null>());
  const restoredGradingDraftKeysRef = useRef(new Set<string>());
  const pendingGradingDraftRestoreKeysRef = useRef(new Set<string>());

  function setGradingDrafts(update: GradingDrafts | ((current: GradingDrafts) => GradingDrafts)) {
    setGradingDraftState((current) => {
      if (
        gradingDraftOwnerRef.current !== gradingOwnerKey ||
        gradingOwnerGenerationRef.current.generation !== gradingOwnerGeneration
      ) return current;
      const draftsByPaper = current.scopeKey === gradingDraftScopeKey ? current.draftsByPaper : {};
      const existing = draftsByPaper[selectedPaperId] ?? {};
      const drafts = typeof update === "function" ? update(existing) : update;
      return {
        scopeKey: gradingDraftScopeKey,
        draftsByPaper: { ...draftsByPaper, [selectedPaperId]: drafts },
      };
    });
  }

  const clearScanObjectUrls = useCallback(() => {
    scanObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    scanObjectUrlsRef.current = [];
    setScanImageUrls({});
  }, []);

  useEffect(() => {
    return () => scanObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let active = true;
    // A changed token already makes the previous profile ineligible through
    // accountProfileReady's token check; don't schedule a redundant pending render.
    void getAccountProfile()
      .then(({ profile }) => {
        if (!active || loadSessionToken() !== sessionToken) return;
        const subjects = profile.subjects ?? [];
        setFolders([]);
        setTaggedItems({});
        setClassStudents([]);
        setAnalysisSnapshot(null);
        setAnalysisDialogOwnerKey(null);
        analysisFilterSelectionRef.current = null;
        setAnalysisFilterSelection(null);
        setFolderAnalysis(null);
        setSelectedClassIds([]);
        setSelectedStudentIds([]);
        setSelectedSubject(subjects.length === 1 ? subjects[0] : "");
        setAccountProfileState({
          sessionToken,
          accountId: profile.id || null,
          subjects,
          ready: true,
          failed: false,
        });
      })
      .catch((error) => {
        if (!active || loadSessionToken() !== sessionToken) return;
        setAccountProfileState({ sessionToken, accountId: null, subjects: [], ready: false, failed: true });
        reportError(error);
      });
    return () => { active = false; };
  }, [sessionToken]);

  useEffect(() => {
    if (projectScope !== undefined) return;
    let active = true;
    void apiGet<{ bound?: boolean; root?: string | null; project_id?: string | null }>("/api/project/info")
      .then((info) => {
        if (!active) return;
        const projectId = info.bound
          ? (info.project_id || info.root || "").trim().replace(/\\/g, "/").replace(/\/+$/, "")
          : "";
        setLocalGradingProjectId(projectId || null);
        setLocalGradingProjectReady(true);
      })
      .catch(() => {
        if (!active) return;
        setLocalGradingProjectId(null);
        setLocalGradingProjectReady(true);
      });
    return () => { active = false; };
  }, [projectScope]);

  const gradingProjectId = projectScope !== undefined
    ? (projectScope.ready ? projectScope.value : null)
    : localGradingProjectId;
  const gradingProjectScopeReady = projectScope !== undefined ? projectScope.ready : localGradingProjectReady;
  const gradingDraftScopeKey = [gradingAccountId ?? "account-unavailable", gradingProjectId ?? "project-unavailable"].join("/");
  const paperFolderScopeKey = [
    sessionGeneration,
    accountProfileReady ? gradingAccountId ?? "account-unavailable" : "profile-unconfirmed",
    gradingProjectId ?? "project-unavailable",
  ].join("/");
  const paperFolderScopeRef = useRef(paperFolderScopeKey);
  paperFolderScopeRef.current = paperFolderScopeKey;
  const paperFolderScopeGenerationRef = useRef({ key: paperFolderScopeKey, generation: 0 });
  if (paperFolderScopeGenerationRef.current.key !== paperFolderScopeKey) {
    paperFolderScopeGenerationRef.current = {
      key: paperFolderScopeKey,
      generation: paperFolderScopeGenerationRef.current.generation + 1,
    };
  }
  const hasCurrentPaperCollection = accountProfileReady && paperCollectionState.scopeKey === paperFolderScopeKey;
  const papers = hasCurrentPaperCollection ? paperCollectionState.papers : EMPTY_PAPERS;
  const classes = hasCurrentPaperCollection ? paperCollectionState.classes : EMPTY_CLASSES;
  const paperMeta = hasCurrentPaperCollection ? paperCollectionState.meta : EMPTY_PAPER_META;

  function updatePapers(
    update: PlatformPaperRecord[] | ((current: PlatformPaperRecord[]) => PlatformPaperRecord[]),
  ) {
    const scopeKey = paperFolderScopeKey;
    setPaperCollectionState((current) => {
      if (paperFolderScopeRef.current !== scopeKey || current.scopeKey !== scopeKey) return current;
      const papers = typeof update === "function" ? update(current.papers) : update;
      return { ...current, papers };
    });
  }

  const movablePaperIds = useMemo(
    () => papers.filter((paper) => paper.publication_count === 0).map((paper) => paper.paper_id),
    [papers],
  );

  useEffect(() => {
    setSelectedPaperIds((current) => current.length === 0 ? current : []);
    setMovingSelectedPapers((current) => current ? false : current);
  }, [paperFolderScopeKey, paperQuery.q, paperQuery.deliveryMode, paperQuery.status, paperQuery.page, paperQuery.pageSize, browserFolderId]);

  useEffect(() => {
    const visibleIds = new Set(movablePaperIds);
    setSelectedPaperIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [movablePaperIds]);

  useEffect(() => {
    if (!accountProfileReady) {
      setFolders((current) => current.length === 0 ? current : []);
      setTaggedItems((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }
    let active = true;
    let cancelCommit: (() => void) | null = null;
    const requestScope = paperFolderScopeKey;
    const requestScopeGeneration = paperFolderScopeGenerationRef.current.generation;
    const foldersRequest = listContentFolders("paper");
    const tagsRequest = listTaggedItems("paper");
    void Promise.allSettled([foldersRequest, tagsRequest]).then(([foldersResult, tagsResult]) => {
      if (
        !active ||
        paperFolderScopeRef.current !== requestScope ||
        paperFolderScopeGenerationRef.current.generation !== requestScopeGeneration
      ) return;
      if (foldersResult.status === "rejected") reportError(foldersResult.reason);
      if (tagsResult.status === "rejected") reportError(tagsResult.reason);
      cancelCommit = scheduleWorkspaceWork(() => {
        if (
          !active ||
          paperFolderScopeRef.current !== requestScope ||
          paperFolderScopeGenerationRef.current.generation !== requestScopeGeneration
        ) return;
        if (foldersResult.status === "fulfilled") setFolders(foldersResult.value.folders);
        if (tagsResult.status === "fulfilled") setTaggedItems(tagsResult.value.items);
      });
    });
    return () => {
      active = false;
      cancelCommit?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperFolderScopeKey, accountProfileReady]);

  useEffect(() => {
    if (!accountProfileReady || recipientScope !== "student" || selectedClassIds.length !== 1) {
      setClassStudents((current) => current.length === 0 ? current : []);
      return;
    }
    let active = true;
    const requestScope = paperFolderScopeKey;
    void listTeacherClassStudents(selectedClassIds[0])
      .then((result) => {
        if (active && paperFolderScopeRef.current === requestScope) setClassStudents(result.students);
      })
      .catch((error) => {
        if (active && paperFolderScopeRef.current === requestScope) reportError(error);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientScope, selectedClassIds.join(","), paperFolderScopeKey, accountProfileReady]);

  const selectedPaperIdRef = useRef(selectedPaperId);
  selectedPaperIdRef.current = selectedPaperId;
  const paperQueryRef = useRef(paperQuery);
  paperQueryRef.current = paperQuery;
  const browserFolderIdRef = useRef(browserFolderId);
  browserFolderIdRef.current = browserFolderId;

  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.paper_id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );
  const gradingOwnerKey = [gradingDraftScopeKey, selectedPaper?.paper_id ?? selectedPaperId].join("/");
  const gradingOwnerGenerationRef = useRef({ ownerKey: gradingOwnerKey, generation: 0 });
  if (gradingOwnerGenerationRef.current.ownerKey !== gradingOwnerKey) {
    gradingOwnerGenerationRef.current = {
      ownerKey: gradingOwnerKey,
      generation: gradingOwnerGenerationRef.current.generation + 1,
    };
  }
  const gradingOwnerGeneration = gradingOwnerGenerationRef.current.generation;
  const requestOwnerKey = [paperFolderScopeKey, selectedPaper?.paper_id ?? selectedPaperId].join("/");
  const requestOwnerKeyRef = useRef(requestOwnerKey);
  requestOwnerKeyRef.current = requestOwnerKey;
  const accountProfileReadyRef = useRef(accountProfileReady);
  accountProfileReadyRef.current = accountProfileReady;
  const paperFolderScopeGeneration = paperFolderScopeGenerationRef.current.generation;
  const analysis = analysisSnapshot &&
    analysisSnapshot.ownerKey === requestOwnerKey &&
    analysisSnapshot.sessionToken === sessionToken &&
    accountProfileReady &&
    loadSessionToken() === sessionToken
    ? analysisSnapshot.analysis
    : null;
  const analysisDialogOpen = analysisDialogOwnerKey === requestOwnerKey &&
    accountProfileReady &&
    loadSessionToken() === sessionToken;
  const analysisPending = activeAnalysisRequestRef.current?.requestId === analysisRequestIdRef.current &&
    activeAnalysisRequestRef.current.ownerKey === requestOwnerKey;
  const analysisSnapshotIsCurrent = analysisSnapshot?.requestId === analysisRequestIdRef.current;
  const analysisFilterSelectionRef = useRef(analysisFilterSelection);
  analysisFilterSelectionRef.current = analysisFilterSelection;
  function getCurrentAnalysisFilters(): AnalysisFilterSelection {
    const requested = analysisFilterSelectionRef.current;
    if (requested?.ownerKey === requestOwnerKey) return requested;
    return {
      ownerKey: requestOwnerKey,
      publicationId: analysis?.publication_id ?? undefined,
      classId: analysis?.class_id ?? undefined,
    };
  }

  function beginAnalysisBusy(value: string): AnalysisBusyOwner {
    const owner = { id: ++analysisBusyOwnerIdRef.current, value };
    analysisBusyOwnerRef.current = owner;
    setBusy(value);
    return owner;
  }

  function releaseAnalysisBusy(owner: AnalysisBusyOwner) {
    if (analysisBusyOwnerRef.current?.id !== owner.id) return;
    analysisBusyOwnerRef.current = null;
    setBusy((current) =>
      current === owner.value && analysisBusyOwnerRef.current === null ? null : current,
    );
  }

  function invalidateAnalysisLifecycle() {
    const activeRequest = activeAnalysisRequestRef.current;
    analysisRequestIdRef.current += 1;
    activeAnalysisRequestRef.current = null;
    setAnalysisSnapshot(null);
    setAnalysisDialogOwnerKey(null);
    analysisFilterSelectionRef.current = null;
    setAnalysisFilterSelection(null);
    if (activeRequest) releaseAnalysisBusy(activeRequest.busyOwner);
  }

  function isCurrentAnalysisRequest(operation: AnalysisRequestOperation): boolean {
    return analysisMountedRef.current &&
      activeAnalysisRequestRef.current?.requestId === operation.requestId &&
      analysisRequestIdRef.current === operation.requestId &&
      requestOwnerKeyRef.current === operation.ownerKey &&
      paperFolderScopeRef.current === operation.scopeKey &&
      paperFolderScopeGenerationRef.current.generation === operation.scopeGeneration &&
      sessionGenerationRef.current.generation === operation.sessionGeneration &&
      accountProfileReadyRef.current &&
      loadSessionToken() === operation.sessionToken;
  }

  function isCurrentAnalysisReport(operation: AnalysisReportOperation): boolean {
    return analysisMountedRef.current &&
      activeAnalysisReportsRef.current.get(operation.id) === operation &&
      paperFolderScopeRef.current === operation.scopeKey &&
      paperFolderScopeGenerationRef.current.generation === operation.scopeGeneration &&
      sessionGenerationRef.current.generation === operation.sessionGeneration &&
      accountProfileReadyRef.current &&
      loadSessionToken() === operation.sessionToken;
  }

  useEffect(() => {
    analysisMountedRef.current = true;
    return () => {
      analysisMountedRef.current = false;
      analysisRequestIdRef.current += 1;
      activeAnalysisRequestRef.current = null;
      activeAnalysisReportsRef.current.clear();
      analysisBusyOwnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    invalidateAnalysisLifecycle();
    // requestOwnerKey includes the current session, account, project, and selected paper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestOwnerKey]);

  useEffect(() => {
    const activeReports = [...activeAnalysisReportsRef.current.values()];
    activeAnalysisReportsRef.current.clear();
    activeReports.forEach((operation) => releaseAnalysisBusy(operation.busyOwner));
    // paperFolderScopeKey excludes the selected paper so reports may finish after same-scope paper switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperFolderScopeKey]);

  const submissionScopeSeenRef = useRef(requestOwnerKey);
  const submissionScopeReloadPendingRef = useRef(false);
  const publicationOwnerKeyRef = useRef(requestOwnerKey);
  publicationOwnerKeyRef.current = requestOwnerKey;
  const submissionsOwnerKeyRef = useRef(requestOwnerKey);
  submissionsOwnerKeyRef.current = requestOwnerKey;
  const publications = accountProfileReady && publicationState.ownerKey === requestOwnerKey
    ? publicationState.publications
    : [];
  const submissions = accountProfileReady && submissionState.ownerKey === requestOwnerKey
    ? submissionState.submissions
    : [];
  const selectedGradingSubmission =
    submissions.find((submission) => submission.attempt_id === selectedGradingAttemptId) ?? submissions[0] ?? null;
  const gradingDraftOwnerRef = useRef(gradingOwnerKey);
  if (gradingDraftOwnerRef.current !== gradingOwnerKey) {
    gradingDraftOwnerRef.current = gradingOwnerKey;
    publicationRequestIdRef.current += 1;
    submissionRequestIdRef.current += 1;
    gradingDraftSourceVersionsRef.current.clear();
    restoredGradingDraftKeysRef.current.clear();
    pendingGradingDraftRestoreKeysRef.current.clear();
  }
  const gradingDrafts = gradingDraftState.scopeKey === gradingDraftScopeKey
    ? gradingDraftState.draftsByPaper[selectedPaperId] ?? {}
    : {};
  const gradingRequests = usePaperGrading(requestOwnerKey);
  const gradingStorageScope = gradingAccountId && gradingProjectId && selectedPaper
    ? { accountId: gradingAccountId, projectId: gradingProjectId, paperId: selectedPaper.paper_id }
    : null;
  const gradingStorageScopeKey = gradingStorageScope
    ? [gradingStorageScope.accountId, gradingStorageScope.projectId, gradingStorageScope.paperId].join("/")
    : null;
  const [gradingDraftRestorationState, setGradingDraftRestorationState] = useState<{
    ownerKey: string;
    ownerGeneration: number;
    attemptId: string;
    storageScopeKey: string | null;
    ready: boolean;
  }>({ ownerKey: "", ownerGeneration: -1, attemptId: "", storageScopeKey: null, ready: false });
  const selectedGradingDraftsReady = !selectedGradingSubmission || (
    accountProfileReady &&
    gradingProjectScopeReady &&
    (!gradingStorageScope || (
    gradingDraftRestorationState.ownerKey === gradingOwnerKey &&
    gradingDraftRestorationState.ownerGeneration === gradingOwnerGeneration &&
    gradingDraftRestorationState.attemptId === selectedGradingSubmission.attempt_id &&
    gradingDraftRestorationState.storageScopeKey === gradingStorageScopeKey &&
    gradingDraftRestorationState.ready
    ))
  );

  function setSubmissions(
    update: PaperSubmissionRecord[] | ((current: PaperSubmissionRecord[]) => PaperSubmissionRecord[]),
  ) {
    const ownerKey = requestOwnerKey;
    setSubmissionState((current) => {
      if (submissionsOwnerKeyRef.current !== ownerKey) return current;
      const existing = current.ownerKey === ownerKey ? current.submissions : [];
      const submissions = typeof update === "function" ? update(existing) : update;
      return { ownerKey, submissions };
    });
  }

  useEffect(() => {
    if (!selectedGradingSubmission) return;
    const ownerKey = gradingOwnerKey;
    const ownerGeneration = gradingOwnerGeneration;
    const attemptId = selectedGradingSubmission.attempt_id;
    setGradingDraftRestorationState({ ownerKey, ownerGeneration, attemptId, storageScopeKey: gradingStorageScopeKey, ready: !gradingStorageScope });
    if (!gradingStorageScope) return;

    let active = true;
    let nextIndex = 0;
    let cancelBatch: (() => void) | null = null;
    let foundStorageIssue = false;
    const restoredKeys = new Set<string>();
    const restoreEntries: Array<{
      key: string;
      questionId: string;
      storageKey: string;
      source: GradingDraftSource;
      currentVersion: string | null;
      record: NonNullable<ReturnType<typeof readGradingDraft>["draft"]>;
    }> = [];
    const answers = selectedGradingSubmission.answers;
    const scopeKey = paperFolderScopeKey;
    const scopeGeneration = paperFolderScopeGenerationRef.current.generation;
    const runBatch = () => {
      if (
        !active ||
        paperFolderScopeRef.current !== scopeKey ||
        paperFolderScopeGenerationRef.current.generation !== scopeGeneration ||
        gradingDraftOwnerRef.current !== ownerKey ||
        gradingOwnerGenerationRef.current.generation !== ownerGeneration ||
        selectedPaperIdRef.current !== (selectedPaper?.paper_id ?? "")
      ) return;

      const batchEnd = Math.min(nextIndex + 8, answers.length);
      const restoreEntryStartIndex = restoreEntries.length;
      for (; nextIndex < batchEnd; nextIndex += 1) {
        const answer = answers[nextIndex];
        const key = gradeKey(attemptId, answer.question_id);
        const storageKey = `${ownerKey}/${attemptId}/${answer.question_id}`;
        if (restoredGradingDraftKeysRef.current.has(storageKey)) continue;
        restoredKeys.add(storageKey);
        const result = readGradingDraft(
          gradingDraftStorageScope(gradingStorageScope, attemptId, answer.question_id),
        );
        if (result.status === "corrupted" || result.status === "unavailable") foundStorageIssue = true;
        if (result.draft) {
          restoreEntries.push({
            key,
            questionId: answer.question_id,
            storageKey,
            source: toGradingDraftSource(answer),
            currentVersion: answer.grading_version ?? null,
            record: result.draft,
          });
        }
      }

      const batchEntries = restoreEntries.slice(restoreEntryStartIndex);
      if (batchEntries.length > 0) {
        setGradingDrafts((current) => {
          const next = { ...current };
          batchEntries.forEach(({ key, source, record }) => {
            next[key] = restoreGradingDraft(getGradingDraft(current, key, source), record);
          });
          return next;
        });
      }

      if (nextIndex < answers.length) {
        cancelBatch = scheduleWorkspaceWork(runBatch);
        return;
      }

      if (
        !active ||
        paperFolderScopeRef.current !== scopeKey ||
        paperFolderScopeGenerationRef.current.generation !== scopeGeneration ||
        gradingDraftOwnerRef.current !== ownerKey ||
        gradingOwnerGenerationRef.current.generation !== ownerGeneration ||
        selectedPaperIdRef.current !== (selectedPaper?.paper_id ?? "")
      ) return;

      restoredKeys.forEach((storageKey) => restoredGradingDraftKeysRef.current.add(storageKey));
      restoreEntries.forEach(({ key, questionId, storageKey, source, currentVersion, record }) => {
        const restoredDraft = restoreGradingDraft(getGradingDraft(gradingDrafts, key, source), record);
        const isClean = !restoredDraft.score.dirty && !restoredDraft.feedback.dirty;
        if (!gradingDraftSourceVersionsRef.current.has(key)) {
          gradingDraftSourceVersionsRef.current.set(key, isClean ? currentVersion : record.sourceVersion);
        }
        if (isClean && !writeGradingDraft(
          gradingDraftStorageScope(gradingStorageScope, attemptId, questionId),
          restoredDraft,
          currentVersion,
        )) {
          foundStorageIssue = true;
        }
        pendingGradingDraftRestoreKeysRef.current.add(storageKey);
      });
      if (foundStorageIssue) setGradingDraftStorageWarning({ ownerKey, visible: true });
      setGradingDraftRestorationState({ ownerKey, ownerGeneration, attemptId, storageScopeKey: gradingStorageScopeKey, ready: true });
    };

    cancelBatch = scheduleWorkspaceWork(runBatch);
    return () => {
      active = false;
      cancelBatch?.();
    };
  }, [
    gradingOwnerKey,
    gradingOwnerGeneration,
    gradingStorageScope?.accountId,
    gradingStorageScope?.projectId,
    gradingStorageScope?.paperId,
    paperFolderScopeKey,
    selectedGradingSubmission?.attempt_id,
    selectedPaper?.paper_id,
  ]);

  useEffect(() => {
    if (!gradingStorageScope || !selectedGradingSubmission) return;
    if (
      gradingDraftRestorationState.ownerKey !== gradingOwnerKey ||
      gradingDraftRestorationState.ownerGeneration !== gradingOwnerGeneration ||
      gradingDraftRestorationState.attemptId !== selectedGradingSubmission.attempt_id ||
      gradingDraftRestorationState.storageScopeKey !== gradingStorageScopeKey ||
      !gradingDraftRestorationState.ready
    ) return;
    selectedGradingSubmission.answers.forEach((answer) => {
      const key = gradeKey(selectedGradingSubmission.attempt_id, answer.question_id);
      const storageKey = `${gradingOwnerKey}/${selectedGradingSubmission.attempt_id}/${answer.question_id}`;
      if (pendingGradingDraftRestoreKeysRef.current.has(storageKey)) {
        pendingGradingDraftRestoreKeysRef.current.delete(storageKey);
        return;
      }
      const draft = gradingDrafts[key];
      if (!draft) return;
      if (!draft.score.dirty && !draft.feedback.dirty) {
        gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
      } else if (!gradingDraftSourceVersionsRef.current.has(key)) {
        gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
      }
      const ok = writeGradingDraft(
        gradingDraftStorageScope(gradingStorageScope, selectedGradingSubmission.attempt_id, answer.question_id),
        draft,
        gradingDraftSourceVersionsRef.current.get(key) ?? null,
      );
      if (!ok) setGradingDraftStorageWarning({ ownerKey: gradingOwnerKey, visible: true });
    });
  }, [
    gradingDrafts,
    gradingDraftRestorationState,
    gradingOwnerGeneration,
    gradingDraftScopeKey,
    gradingStorageScope?.accountId,
    gradingStorageScope?.projectId,
    gradingStorageScope?.paperId,
    gradingStorageScopeKey,
    gradingOwnerKey,
    selectedGradingSubmission,
  ]);
  const activePublishedClassIds = useMemo(() => {
    const ids = new Set<string>();
    publications
      .filter((publication) => publication.status !== "revoked" && publication.recipient_scope !== "student")
      .forEach((publication) => {
        publication.class_ids.forEach((classId) => ids.add(classId));
      });
    return ids;
  }, [publications]);

  function reportError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    onError?.(text);
    setMessage(text);
  }

  async function loadPublications(paperId: string) {
    if (!accountProfileReady) return;
    const ownerKey = requestOwnerKey;
    const requestId = ++publicationRequestIdRef.current;
    try {
      const data = await listPlatformPaperPublications(paperId);
      if (
        publicationRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === paperId &&
        publicationOwnerKeyRef.current === ownerKey &&
        paperFolderScopeRef.current === paperFolderScopeKey
      ) {
        setPublicationState({ ownerKey, publications: data.publications });
      }
    } catch (e) {
      if (
        publicationRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === paperId &&
        publicationOwnerKeyRef.current === ownerKey &&
        paperFolderScopeRef.current === paperFolderScopeKey
      ) {
        reportError(e);
      }
    }
  }

  async function refresh(targetQuery: PaperQuery = paperQueryRef.current, targetFolderId: string | null = browserFolderIdRef.current) {
    if (!accountProfileReady) return;
    const requestId = ++listRequestIdRef.current;
    const ownerScopeKey = paperFolderScopeKey;
    setLoading(true);
    onError?.(null);
    setMessage(null);
    try {
      const [paperData, classData] = await Promise.all([
        listPlatformPapers({
          q: targetQuery.q,
          deliveryMode: targetQuery.deliveryMode,
          status: targetQuery.status,
          page: targetQuery.page,
          pageSize: targetQuery.pageSize,
          folderId: targetFolderId,
          ...(targetQuery.directId ? { paperId: targetQuery.directId, q: null, folderId: null } : {}),
        }),
        listTeacherAssignedClasses(),
      ]);
      if (listRequestIdRef.current !== requestId || paperFolderScopeRef.current !== ownerScopeKey) return;
      setPaperCollectionState({
        scopeKey: ownerScopeKey,
        papers: paperData.papers,
        classes: classData.classes,
        meta: mergeMeta(paperData, targetQuery, paperData.papers.length),
      });
      const currentSelected = selectedPaperIdRef.current;
      const nextPaperId =
        currentSelected && paperData.papers.some((paper) => paper.paper_id === currentSelected)
          ? currentSelected
          : paperData.papers[0]?.paper_id ?? "";
      if (selectedPaperIdRef.current !== nextPaperId) {
        setSelectedPaperId(nextPaperId);
      } else if (nextPaperId) {
        await loadPublications(nextPaperId);
      } else {
        setPublicationState({ ownerKey: requestOwnerKey, publications: [] });
      }
    } catch (e) {
      if (listRequestIdRef.current === requestId && paperFolderScopeRef.current === ownerScopeKey) reportError(e);
    } finally {
      if (listRequestIdRef.current === requestId && paperFolderScopeRef.current === ownerScopeKey) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!accountProfileReady) return;
    void refresh(paperQuery, browserFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperQuery.q, paperQuery.deliveryMode, paperQuery.status, paperQuery.page, paperQuery.pageSize, paperQuery.directId, browserFolderId, paperFolderScopeKey, accountProfileReady]);

  useEffect(() => {
    if (!openTarget) return;
    setPaperQuery((current) => ({ ...current, q: openTarget.title, directId: openTarget.paperId, deliveryMode: "all", status: "all", page: 1 }));
    setBrowserFolderId(null);
  }, [openTarget?.paperId]);

  useEffect(() => {
    if (!openTarget || !papers.some((paper) => paper.paper_id === openTarget.paperId)) return;
    setSelectedPaperId(openTarget.paperId);
    setPaperDetailView("grading");
    setMobileTab("detail");
  }, [openTarget?.paperId, papers]);

  useEffect(() => {
    submissionRequestIdRef.current += 1;
    publicationRequestIdRef.current += 1;
    setBusy((current) => current?.startsWith("grade:") || current?.startsWith("ai-grade:") || current?.startsWith("submissions:") ? null : current);
    if (selectedPaperId) {
      if (accountProfileReady) void loadPublications(selectedPaperId);
    } else {
      setPublicationState({ ownerKey: requestOwnerKey, publications: [] });
    }
    setSubmissions([]);
    setSelectedGradingAttemptId("");
    setGradingDrafts({});
    clearScanObjectUrls();
    setSelectedClassIds(assignStudent && selectedPaperId ? [assignStudent.classId] : []);
    setPublishFolderId("");
    setSelectedStudentIds(assignStudent && selectedPaperId ? [assignStudent.studentId] : []);
    if (assignStudent && selectedPaperId) { setRecipientScope("student"); onAssignStudentConsumed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPaperId, clearScanObjectUrls, paperFolderScopeKey, accountProfileReady]);

  async function setDeliveryMode(paper: PlatformPaperRecord, mode: PlatformPaperRecord["delivery_mode"]) {
    setBusy(`mode:${paper.paper_id}`);
    setMessage(null);
    try {
      const updated = await updatePlatformPaperDeliveryMode(paper.paper_id, mode);
      updatePapers((current) =>
        current.map((item) => (item.paper_id === paper.paper_id ? { ...item, delivery_mode: updated.paper.delivery_mode } : item)),
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function toggleClass(classId: string) {
    if (recipientScope === "class" && activePublishedClassIds.has(classId)) {
      return;
    }
    if (recipientScope === "student") {
      setSelectedClassIds([classId]);
      setSelectedStudentIds([]);
      return;
    }
    setSelectedClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  async function publishSelectedPaper() {
    if (!selectedPaper) return;
    if (selectedPaper.question_count <= 0) {
      setMessage("试卷至少需要包含 1 道题后才能发布。");
      return;
    }
    if (selectedClassIds.length === 0) {
      setMessage("请选择要发布的班级。");
      return;
    }
    if (!publishFolderId) { setMessage("请选择试卷文件夹或归类文件夹。"); return; }
    if (recipientScope === "student" && selectedStudentIds.length === 0) { setMessage("请选择接收练习的学生。"); return; }
    if (recipientScope === "student" && folders.find((folder) => folder.id === publishFolderId)?.kind !== "paper") {
      setMessage("指定学生发布须选择试卷文件夹。"); return;
    }
    if (teacherSubjects.length > 1 && !selectedSubject) {
      setMessage("你设置了多个学科，请选择本次发布所用学科。");
      return;
    }
    setBusy(`publish:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await publishPlatformPaper(selectedPaper.paper_id, {
        class_ids: selectedClassIds,
        student_ids: recipientScope === "student" ? selectedStudentIds : [],
        folder_id: publishFolderId,
        title: selectedPaper.title,
        start_at: publishStartAt ? new Date(publishStartAt).toISOString() : null,
        end_at: publishEndAt ? new Date(publishEndAt).toISOString() : null,
        submission_mode: submissionMode,
        max_screen_switches: maxScreenSwitches,
        time_limit_minutes: timeLimitMinutes > 0 ? timeLimitMinutes : null,
        subject: selectedSubject || teacherSubjects[0] || selectedPaper.subject,
      });
      updatePapers((current) =>
        current.map((item) =>
          item.paper_id === selectedPaper.paper_id
            ? {
                ...item,
                delivery_mode: "online",
                status: "published",
                publication_count: item.publication_count + 1,
                published_class_count: item.published_class_count + selectedClassIds.length,
              }
            : item,
        ),
      );
      setSelectedClassIds([]);
      setSelectedStudentIds([]);
      setMessage("已发布");
      await loadPublications(selectedPaper.paper_id);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function revokePublication(publication: PaperPublicationRecord) {
    if (!selectedPaper) return;
    setBusy(`revoke:${publication.id}`);
    setMessage(null);
    try {
      await revokePlatformPaperPublication(selectedPaper.paper_id, publication.id);
      await refresh();
      setMessage("已撤回发布");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function togglePublicationPause(publication: PaperPublicationRecord) {
    if (!selectedPaper) return;
    const nextStatus = publication.status === "paused" ? "published" : "paused";
    setBusy(`pause:${publication.id}`);
    setMessage(null);
    try {
      await updatePlatformPaperPublication(selectedPaper.paper_id, publication.id, { status: nextStatus });
      await loadPublications(selectedPaper.paper_id);
      setMessage(nextStatus === "paused" ? "已暂停收取提交" : "已恢复收取提交");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function downloadScoreTemplate() {
    if (!selectedPaper) return;
    try {
      const { blob, filename } = await apiDownloadBlob(`/api/exams/${encodeURIComponent(selectedPaper.exam_id)}/score-template`);
      downloadBlob(blob, filename || "成绩模板.csv");
    } catch (error) {
      reportError(error);
    }
  }

  async function uploadScores(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedPaper) return;
    setBusy(`scores:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await uploadPaperScores(selectedPaper.exam_id, file);
      await refresh();
      setMessage("成绩已上传");
    } catch (e) {
      reportError(e);
    } finally {
      event.target.value = "";
      setBusy(null);
    }
  }

  async function loadSelectedAnalysis(publicationId?: string, classId?: string) {
    if (!selectedPaper || !accountProfileReady) return;
    const requestId = ++analysisRequestIdRef.current;
    const busyOwner = beginAnalysisBusy("analysis:" + selectedPaper.paper_id);
    const operation: AnalysisRequestOperation = {
      requestId,
      ownerKey: requestOwnerKey,
      scopeKey: paperFolderScopeKey,
      scopeGeneration: paperFolderScopeGeneration,
      sessionToken,
      sessionGeneration,
      paperId: selectedPaper.paper_id,
      busyOwner,
    };
    activeAnalysisRequestRef.current = operation;
    setAnalysisDialogOwnerKey(operation.ownerKey);
    const filters: AnalysisFilterSelection = { ownerKey: operation.ownerKey, publicationId, classId };
    analysisFilterSelectionRef.current = filters;
    setAnalysisFilterSelection(filters);
    setMessage(null);
    try {
      const result = await analyzePlatformPaper(operation.paperId, publicationId, classId);
      if (!isCurrentAnalysisRequest(operation)) return;
      const resolvedFilters: AnalysisFilterSelection = {
        ownerKey: operation.ownerKey,
        publicationId: result.analysis.publication_id ?? undefined,
        classId: result.analysis.class_id ?? undefined,
      };
      analysisFilterSelectionRef.current = resolvedFilters;
      setAnalysisFilterSelection(resolvedFilters);
      setAnalysisSnapshot({
        ownerKey: operation.ownerKey,
        requestId: operation.requestId,
        sessionToken: operation.sessionToken,
        analysis: result.analysis,
      });
    } catch (e) {
      if (isCurrentAnalysisRequest(operation)) {
        setAnalysisSnapshot(null);
        setAnalysisDialogOwnerKey(null);
        analysisFilterSelectionRef.current = null;
        setAnalysisFilterSelection(null);
        reportError(e);
      }
    } finally {
      if (activeAnalysisRequestRef.current?.requestId === operation.requestId) {
        activeAnalysisRequestRef.current = null;
      }
      releaseAnalysisBusy(operation.busyOwner);
    }
  }

  async function downloadSelectedReport(format: "xlsx" | "pdf") {
    if (!selectedPaper || !analysis || !analysisSnapshotIsCurrent || analysisPending || !accountProfileReady) return;
    const paperId = selectedPaper.paper_id;
    const filename = (selectedPaper.title || selectedPaper.exam_id) + "-analysis-report." + format;
    const publicationId = analysis.publication_id ?? undefined;
    const classId = analysis.class_id ?? undefined;
    const operation: AnalysisReportOperation = {
      id: ++reportRequestIdRef.current,
      scopeKey: paperFolderScopeKey,
      scopeGeneration: paperFolderScopeGeneration,
      sessionToken,
      sessionGeneration,
      busyOwner: beginAnalysisBusy("report:" + format + ":" + paperId),
    };
    activeAnalysisReportsRef.current.set(operation.id, operation);
    setMessage(null);
    try {
      const blob = await downloadPaperAnalysisReport(paperId, format, publicationId, classId);
      if (!isCurrentAnalysisReport(operation)) return;
      downloadBlob(blob, filename);
    } catch (e) {
      if (isCurrentAnalysisReport(operation)) reportError(e);
    } finally {
      if (activeAnalysisReportsRef.current.get(operation.id) === operation) {
        activeAnalysisReportsRef.current.delete(operation.id);
      }
      releaseAnalysisBusy(operation.busyOwner);
    }
  }

  function downloadAnalysisReport() {
    void downloadSelectedReport("xlsx");
  }

  async function printAnalysisReport() {
    if (Date.now() >= 0) {
      await downloadSelectedReport("pdf");
      return;
    }
    if (!analysis) return;
    const rows = analysis.students
      .map(
        (student) =>
          `<tr><td>${htmlEscape(student.display_name)}</td><td>${htmlEscape(student.student_no || "")}</td><td>${htmlEscape(student.status)}</td><td>${htmlEscape(student.score_percent ?? "")}</td><td>${htmlEscape(student.screen_switch_count)}</td></tr>`,
      )
      .join("");
    const modules = (analysis.modules ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.label || item.module_id)}</td><td>${htmlEscape(item.question_count)}</td><td>${htmlEscape(item.answered_count)}</td><td>${htmlEscape(item.average_score_percent ?? "")}</td><td>${htmlEscape(item.risk_level ?? "")}</td></tr>`,
      )
      .join("");
    const classes = (analysis.classes ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.class_name)}</td><td>${htmlEscape(item.student_count)}</td><td>${htmlEscape(item.completion_rate)}%</td><td>${htmlEscape(item.average_score ?? "")}</td><td>${htmlEscape(item.screen_switch_count)}</td></tr>`,
      )
      .join("");
    const questions = (analysis.questions ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.header || item.question_id)}</td><td>${htmlEscape(item.section_id || "")}</td><td>${htmlEscape(item.answered_count)}</td><td>${htmlEscape(item.accuracy_rate ?? "")}</td><td>${htmlEscape(item.average_score_percent ?? "")}</td><td>${htmlEscape(item.risk_level ?? "")}</td></tr>`,
      )
      .join("");
    const popup = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>${htmlEscape(analysis.paper.title)} Analysis</title>
      <style>${analysisPrintCss}</style></head><body>
      <h1>${htmlEscape(analysis.paper.title)}</h1>
      <p>${htmlEscape(analysis.paper.subject || "")} ${htmlEscape(analysis.paper.exam_id || "")}</p>
      <div class="grid">
        <div class="metric">完成率<br/><strong>${analysis.summary.completion_rate}%</strong></div>
        <div class="metric">平均分<br/><strong>${analysis.summary.average_score ?? "-"}</strong></div>
        <div class="metric">切屏<br/><strong>${analysis.proctoring.screen_switch_count}</strong></div>
        <div class="metric">超限<br/><strong>${analysis.proctoring.exceeded_student_count ?? analysis.proctoring.flagged_student_count}</strong></div>
      </div>
      <h2>模块报告</h2>
      <table><thead><tr><th>模块</th><th>题数</th><th>作答</th><th>得分率</th><th>风险</th></tr></thead><tbody>${modules}</tbody></table>
      <h2>班级报表</h2>
      <table><thead><tr><th>班级</th><th>人数</th><th>完成率</th><th>平均分</th><th>切屏</th></tr></thead><tbody>${classes}</tbody></table>
      <h2>题目报表</h2>
      <table><thead><tr><th>题目</th><th>模块</th><th>作答</th><th>正确率</th><th>得分率</th><th>风险</th></tr></thead><tbody>${questions}</tbody></table>
      <h2>学生分析</h2>
      <table><thead><tr><th>学生</th><th>学号</th><th>状态</th><th>得分率</th><th>切屏</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function loadSelectedSubmissions() {
    if (!selectedPaper || !accountProfileReady) return;
    submissionScopeReloadPendingRef.current = false;
    const targetPaperId = selectedPaper.paper_id;
    const ownerKey = requestOwnerKey;
    const requestId = ++submissionRequestIdRef.current;
    const gradingRefresh = gradingRequests.beginRefresh();
    clearScanObjectUrls();
    setBusy(`submissions:${targetPaperId}`);
    setMessage(null);
    try {
      const result = await listPaperSubmissions(targetPaperId);
      if (
        submissionRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === targetPaperId &&
        submissionsOwnerKeyRef.current === ownerKey &&
        paperFolderScopeRef.current === paperFolderScopeKey &&
        gradingRequests.isCurrentRefresh(gradingRefresh)
      ) {
        const sources = result.submissions.flatMap((submission) =>
          submission.answers.map((answer) => ({
            key: gradeKey(submission.attempt_id, answer.question_id),
            source: toGradingDraftSource(answer),
          })),
        );
        const refreshableFields = new Map<string, { score: boolean; feedback: boolean }>();
        sources.forEach(({ key }) => {
          refreshableFields.set(key, {
            score: gradingRequests.acceptRefreshField(gradingRefresh, key, "score"),
            feedback: gradingRequests.acceptRefreshField(gradingRefresh, key, "feedback"),
          });
        });
        setSubmissions((current) => reconcileSubmissionSnapshot(current, result.submissions, refreshableFields));
        setGradingDrafts((current) => reconcileGradingDrafts(
          current,
          sources,
          (key, field) => refreshableFields.get(key)?.[field] ?? true,
        ));
        setSelectedGradingAttemptId((current) => {
          if (result.submissions.some((item) => item.attempt_id === current)) return current;
          return (
            result.submissions.find((item) => item.status === "submitted" && item.answers.length > 0)?.attempt_id ??
            result.submissions[0]?.attempt_id ??
            ""
          );
        });
      }
    } catch (e) {
      if (
        submissionRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === targetPaperId &&
        submissionsOwnerKeyRef.current === ownerKey &&
        paperFolderScopeRef.current === paperFolderScopeKey &&
        gradingRequests.isCurrentRefresh(gradingRefresh)
      ) {
        reportError(e);
      }
    } finally {
      if (
        submissionRequestIdRef.current === requestId &&
        selectedPaperIdRef.current === targetPaperId &&
        submissionsOwnerKeyRef.current === ownerKey &&
        paperFolderScopeRef.current === paperFolderScopeKey &&
        gradingRequests.isCurrentRefresh(gradingRefresh)
      ) {
        setBusy((current) => current === `submissions:${targetPaperId}` ? null : current);
      }
    }
  }

  useEffect(() => {
    if (submissionScopeSeenRef.current !== requestOwnerKey) {
      submissionScopeSeenRef.current = requestOwnerKey;
      submissionScopeReloadPendingRef.current = true;
    }
    if (!submissionScopeReloadPendingRef.current || !accountProfileReady || paperDetailView !== "grading" || !selectedPaper) return;
    submissionScopeReloadPendingRef.current = false;
    void loadSelectedSubmissions();
    // Reload the visible grading list after its session, project, or paper scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountProfileReady, paperFolderScopeKey, requestOwnerKey, paperDetailView, selectedPaper?.paper_id]);

  useEffect(() => {
    if (!openTarget || selectedPaperId !== openTarget.paperId) return;
    setSelectedGradingAttemptId(openTarget.attemptId);
    void loadSelectedSubmissions().finally(() => onOpenTargetConsumed?.());
    // This navigation runs once after the target paper is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget?.paperId, selectedPaperId]);

  function gradeKey(attemptId: string, questionId: string) {
    return `${attemptId}:${questionId}`;
  }

  async function saveGrade(submission: PaperSubmissionRecord, questionId: string) {
    if (!selectedPaper) return;
    const key = gradeKey(submission.attempt_id, questionId);
    const answer = submission.answers.find((item) => item.question_id === questionId);
    const source = answer ? toGradingDraftSource(answer) : {};
    const draft = getGradingDraft(gradingDrafts, key, source);
    const score = parseGradingScore(draft.score.value);
    if (score === null) {
      setMessage("请输入有效分数。");
      return;
    }
    const feedback = gradingFeedbackForSave(draft.feedback);
    const currentVersion = answer?.grading_version ?? null;
    const sourceVersion = gradingDraftSourceVersionsRef.current.has(key)
      ? gradingDraftSourceVersionsRef.current.get(key) ?? null
      : currentVersion;
    const versionChanged = gradingDraftSourceVersionsRef.current.has(key) && sourceVersion !== currentVersion;
    if (versionChanged && !window.confirm("服务器批改版本已变化。本地分数或评语基于较早版本，继续保存将以当前服务器版本为准覆盖相应内容，是否继续？")) {
      setMessage("已取消保存；本地批改草稿仍保留，请核对服务器内容后再试。");
      return;
    }
    const confirmedVersion = versionChanged ? answer?.grading_version : undefined;
    const gradingSave = gradingRequests.beginSave(key);
    setBusy(`grade:${key}`);
    setMessage(null);
    try {
      const payload = {
        score,
        feedback,
        is_correct: null,
      };
      const queuedSave = await gradingRequests.enqueueSave(gradingSave, async () => {
        const latestSourceVersion = gradingDraftSourceVersionsRef.current.get(key);
        const queueAdvancedVersion = latestSourceVersion !== undefined && latestSourceVersion !== sourceVersion && latestSourceVersion !== null
          ? latestSourceVersion
          : undefined;
        const expectedVersion = queueAdvancedVersion ?? confirmedVersion ?? latestSourceVersion ?? currentVersion ?? undefined;
        const result = expectedVersion
          ? await gradePaperAnswer(selectedPaper.paper_id, submission.attempt_id, questionId, payload, expectedVersion)
          : await gradePaperAnswer(selectedPaper.paper_id, submission.attempt_id, questionId, payload);
        if (gradingRequests.isCurrentScope(gradingSave.scopeVersion)) {
          gradingDraftSourceVersionsRef.current.set(key, result.answer.grading_version ?? expectedVersion ?? null);
        }
        return result;
      });
      if (!queuedSave.started) return;
      const result = queuedSave.value;
      const accepted = gradingRequests.acceptSave(gradingSave);
      if (!accepted.current) return;
      setSubmissions((current) =>
        current.map((item) =>
          item.attempt_id === submission.attempt_id
            ? {
                ...item,
                answers: item.answers.map((answer) =>
                  answer.question_id === questionId ? { ...answer, ...result.answer } : answer,
                ),
              }
            : item,
        ),
      );
      setGradingDrafts((current) => ({
        ...current,
        [key]: markGradingDraftSaved(
          current[key] ?? draft,
          {
            score: String(result.answer.score ?? score),
            feedback: result.answer.feedback ?? feedback ?? "",
          },
          (Object.keys(accepted.fields) as Array<keyof typeof accepted.fields>).filter((field) => accepted.fields[field]),
        ),
      }));
      await loadSelectedSubmissions();
      if (gradingRequests.isCurrentSave(gradingSave)) setMessage(gradingSaveMessage(accepted.fields));
    } catch (e) {
      gradingRequests.finishSave(gradingSave);
      if (gradingRequests.isCurrentSave(gradingSave)) reportError(e);
    } finally {
      if (gradingRequests.isCurrentSave(gradingSave)) setBusy((current) => current === `grade:${key}` ? null : current);
    }
  }

  async function completeGrading(submission: PaperSubmissionRecord) {
    if (!selectedPaper) return;
    if (!submission.submitted_at && !["submitted", "completed"].includes(submission.status)) {
      setMessage("该学生尚未提交答卷，提交后才能发布批改结果。");
      return;
    }
    setBusy(`complete:${submission.attempt_id}`);
    setMessage(null);
    try {
      await completePaperAttemptGrading(selectedPaper.paper_id, submission.attempt_id);
      await Promise.all([loadSelectedSubmissions(), refresh()]);
      setMessage(`已完成 ${submission.student_name || submission.student_no || "该学生"} 的批改并向学生发布成绩。`);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  async function suggestSubmissionGrades(submission: PaperSubmissionRecord) {
    if (!selectedPaper) return;
    const pendingQuestionIds = submission.answers
      .filter((answer) => (answer.grading_status || "pending") === "pending")
      .map((answer) => answer.question_id);
    if (pendingQuestionIds.length === 0) {
      setMessage("该答卷没有待预批改题目。");
      return;
    }
    const questionIds = pendingQuestionIds.slice(0, 50);
    const gradingAiRequest = gradingRequests.beginAiRequest(questionIds.map((id) => gradeKey(submission.attempt_id, id)));
    setBusy(`ai-grade:${submission.attempt_id}`);
    setMessage(null);
    try {
      const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
      let filteredSuggestionFieldCount = 0;
      let fullyFilteredSuggestionCount = 0;
      const acceptedSuggestions: AcceptedAiSuggestion[] = result.suggestions.flatMap((suggestion) => {
        const key = gradeKey(submission.attempt_id, suggestion.question_id);
        const offeredFields = [
          ...(suggestion.suggested_score != null ? ["score" as const] : []),
          ...(suggestion.feedback ? ["feedback" as const] : []),
        ];
        if (offeredFields.length === 0) return [];
        const fields = gradingRequests.isCurrentAiRequest(gradingAiRequest, key)
          ? gradingRequests.acceptAiFields(gradingAiRequest, key, offeredFields)
          : [];
        filteredSuggestionFieldCount += offeredFields.length - fields.length;
        if (fields.length === 0) fullyFilteredSuggestionCount += 1;
        return fields.length > 0
          ? [{
              attemptId: submission.attempt_id,
              questionId: suggestion.question_id,
              status: suggestion.status,
              suggestedScore: suggestion.suggested_score,
              feedback: suggestion.feedback,
              fields,
            }]
          : [];
      });
      const suggestions = new Map(acceptedSuggestions.map((item) => [item.questionId, item]));
      setSubmissions((current) =>
        current.map((item) =>
          item.attempt_id === submission.attempt_id
            ? {
                ...item,
                answers: item.answers.map((answer) => {
                  const suggestion = suggestions.get(answer.question_id);
                  return suggestion
                    ? {
                        ...answer,
                        grading_status: suggestion.status || "needs_review",
                        ...(suggestion.fields.includes("score") ? { ai_suggested_score: suggestion.suggestedScore ?? null } : {}),
                        ...(suggestion.fields.includes("feedback") ? { ai_feedback: suggestion.feedback ?? null } : {}),
                      }
                    : answer;
                }),
              }
            : item,
        ),
      );
      setGradingDrafts((current) => applyGradingSuggestions(current, acceptedSuggestions.map((suggestion) => ({
        key: gradeKey(suggestion.attemptId, suggestion.questionId),
        score: suggestion.fields.includes("score") ? suggestion.suggestedScore : null,
        feedback: suggestion.fields.includes("feedback") ? suggestion.feedback : null,
      }))));
      const generatedCount = acceptedSuggestions.filter((item) => item.status === "needs_review" || !item.status).length;
      const retryableCount = acceptedSuggestions.filter((item) => item.status === "pending").length;
      const remainingCount = Math.max(0, pendingQuestionIds.length - questionIds.length);
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        const filteredNotice = filteredSuggestionFieldCount > 0 ? `；忽略了 ${filteredSuggestionFieldCount} 个过期字段` : "";
        const message = acceptedSuggestions.length === 0 && fullyFilteredSuggestionCount > 0
          ? "AI 预批改结果已过期，当前分数和评语未被覆盖；请重新发起预批改。"
          : generatedCount > 0
            ? `已生成 ${generatedCount} 条 AI 预批改建议${filteredNotice}；${retryableCount + remainingCount} 题仍待处理，请教师复核后保存。`
            : `本次未生成有效 AI 建议${filteredNotice}，${retryableCount + remainingCount} 题仍保持待处理，可检查模型/OCR 后重试。`;
        setMessage(message);
      }
    } catch (e) {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) reportError(e);
    } finally {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        setBusy((current) => current === `ai-grade:${submission.attempt_id}` ? null : current);
      }
    }
  }

  async function suggestLoadedPendingGrades() {
    if (!selectedPaper) return;
    const candidates = submissions
      .filter(
        (submission) =>
          submission.status === "submitted" &&
          submission.answers.some((answer) => (answer.grading_status || "pending") === "pending"),
      )
      .slice(0, 10);
    if (candidates.length === 0) {
      setMessage("当前已加载答卷中没有待预批改内容。");
      return;
    }
    let remainingQuestionBudget = 50;
    const batchPlan = candidates
      .map((submission) => {
        const questionIds = submission.answers
          .filter((answer) => (answer.grading_status || "pending") === "pending")
          .map((answer) => answer.question_id)
          .slice(0, remainingQuestionBudget);
        remainingQuestionBudget -= questionIds.length;
        return { submission, questionIds };
      })
      .filter((item) => item.questionIds.length > 0);
    const plannedQuestionCount = batchPlan.reduce((total, item) => total + item.questionIds.length, 0);
    if (!window.confirm(`将为 ${batchPlan.length} 份答卷的 ${plannedQuestionCount} 道题生成 AI 建议（本次最多 50 题），是否继续？`)) return;
    const gradingAiRequest = gradingRequests.beginAiRequest(batchPlan.flatMap(({ submission, questionIds }) =>
      questionIds.map((questionId) => gradeKey(submission.attempt_id, questionId)),
    ));
    setBusy("ai-grade:batch");
    setMessage(null);
    const completed: Array<{
      attemptId: string;
      suggestions: Array<{ question_id: string; suggested_score?: number | null; feedback?: string | null; status: string }>;
    }> = [];
    let failed = 0;
    let filteredSuggestionFieldCount = 0;
    let fullyFilteredSuggestionCount = 0;
    try {
      for (const { submission, questionIds } of batchPlan) {
        if (!gradingRequests.isCurrentAiBatch(gradingAiRequest)) break;
        try {
          const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
          completed.push({ attemptId: submission.attempt_id, suggestions: result.suggestions });
        } catch {
          failed += 1;
        }
      }
      const acceptedSuggestions: AcceptedAiSuggestion[] = completed.flatMap(({ attemptId, suggestions }) =>
        suggestions.flatMap((suggestion) => {
          const key = gradeKey(attemptId, suggestion.question_id);
          const offeredFields = [
            ...(suggestion.suggested_score != null ? ["score" as const] : []),
            ...(suggestion.feedback ? ["feedback" as const] : []),
          ];
          if (offeredFields.length === 0) return [];
          const fields = gradingRequests.isCurrentAiRequest(gradingAiRequest, key)
            ? gradingRequests.acceptAiFields(gradingAiRequest, key, offeredFields)
            : [];
          filteredSuggestionFieldCount += offeredFields.length - fields.length;
          if (fields.length === 0) fullyFilteredSuggestionCount += 1;
          return fields.length > 0
            ? [{
                attemptId,
                questionId: suggestion.question_id,
                status: suggestion.status,
                suggestedScore: suggestion.suggested_score,
                feedback: suggestion.feedback,
                fields,
              }]
            : [];
        }),
      );
      const byAttempt = new Map<string, Map<string, AcceptedAiSuggestion>>();
      acceptedSuggestions.forEach((suggestion) => {
        const byQuestion = byAttempt.get(suggestion.attemptId) ?? new Map<string, AcceptedAiSuggestion>();
        byQuestion.set(suggestion.questionId, suggestion);
        byAttempt.set(suggestion.attemptId, byQuestion);
      });
      setSubmissions((current) =>
        current.map((submission) => {
          const suggestions = byAttempt.get(submission.attempt_id);
          if (!suggestions) return submission;
          return {
            ...submission,
            answers: submission.answers.map((answer) => {
              const suggestion = suggestions.get(answer.question_id);
              return suggestion
                ? {
                    ...answer,
                    grading_status: suggestion.status || "needs_review",
                    ...(suggestion.fields.includes("score") ? { ai_suggested_score: suggestion.suggestedScore ?? null } : {}),
                    ...(suggestion.fields.includes("feedback") ? { ai_feedback: suggestion.feedback ?? null } : {}),
                  }
                : answer;
            }),
          };
        }),
      );
      setGradingDrafts((current) => applyGradingSuggestions(current, acceptedSuggestions.map((suggestion) => ({
        key: gradeKey(suggestion.attemptId, suggestion.questionId),
        score: suggestion.fields.includes("score") ? suggestion.suggestedScore : null,
        feedback: suggestion.fields.includes("feedback") ? suggestion.feedback : null,
      }))));
      const generatedCount = acceptedSuggestions.filter((suggestion) => suggestion.status === "needs_review" || !suggestion.status).length;
      const retryableCount = acceptedSuggestions.filter((suggestion) => suggestion.status === "pending").length;
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        const filteredNotice = filteredSuggestionFieldCount > 0 ? `，忽略 ${filteredSuggestionFieldCount} 个过期字段` : "";
        const message = acceptedSuggestions.length === 0 && fullyFilteredSuggestionCount > 0
          ? `AI 批量预批改结果已过期，当前批改内容未被覆盖${failed ? `，${failed} 份处理失败` : ""}。`
          : `AI 批量预批改完成：生成 ${generatedCount} 条建议，${retryableCount} 题可重试${filteredNotice}${failed ? `，${failed} 份处理失败` : ""}。请教师逐题复核。`;
        setMessage(message);
      }
    } finally {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        setBusy((current) => current === "ai-grade:batch" ? null : current);
      }
    }
  }

  async function downloadOfflineUploader() {
    setBusy("offline-uploader");
    setMessage(null);
    try {
      const blob = await downloadOfflineAnswerUploader();
      downloadBlob(blob, "OriginReach-Offline-Answer-Uploader.exe");
      setMessage("线下答卷采集器已下载。当前程序未做商业代码签名，Windows 可能提示“未知发布者”；请确认文件来自本系统后再运行。");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function loadOfflineScanImage(submission: PaperSubmissionRecord, pageIndex: number) {
    if (!selectedPaper) return;
    const key = `${submission.attempt_id}:${pageIndex}`;
    if (scanImageUrls[key]) return;
    setBusy(`scan:${key}`);
    try {
      const blob = await downloadOfflineScanImage(selectedPaper.paper_id, submission.attempt_id, pageIndex);
      const url = URL.createObjectURL(blob);
      scanObjectUrlsRef.current.push(url);
      setScanImageUrls((current) => ({ ...current, [key]: url }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  const togglePaperSelection = useCallback((paperId: string) => {
    setSelectedPaperIds((current) => current.includes(paperId)
      ? current.filter((id) => id !== paperId)
      : [...current, paperId]);
  }, []);

  const toggleVisiblePaperSelection = useCallback((visibleIds: string[]) => {
    setSelectedPaperIds((current) => {
      const visible = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (allVisibleSelected) return current.filter((id) => !visible.has(id));
      return [...current.filter((id) => !visible.has(id)), ...visibleIds];
    });
  }, []);

  const moveSelectedPapersToFolder = useCallback(async (itemIds: string[], folderId: string | null) => {
    const requestScope = paperFolderScopeKey;
    const ids = [...new Set(itemIds)];
    if (!ids.length) return;
    if (!folderId) {
      reportError(new Error("请选择试卷文件夹"));
      return;
    }
    setMovingSelectedPapers(true);
    try {
      await moveContentItemsToFolder("paper", ids, folderId);
      if (paperFolderScopeRef.current !== requestScope) return;
      setSelectedPaperIds([]);
      await refresh(paperQueryRef.current, browserFolderIdRef.current);
    } catch (error) {
      if (paperFolderScopeRef.current === requestScope) reportError(error);
    } finally {
      if (paperFolderScopeRef.current === requestScope) setMovingSelectedPapers(false);
    }
  }, [paperFolderScopeKey]);

  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");
  const [detailVisitedScopeKey, setDetailVisitedScopeKey] = useState<string | null>(
    largeScreen ? paperFolderScopeKey : null,
  );
  const detailHasBeenVisited = detailVisitedScopeKey === paperFolderScopeKey;
  useEffect(() => {
    if (largeScreen || mobileTab === "detail") {
      setDetailVisitedScopeKey((current) => current === paperFolderScopeKey ? current : paperFolderScopeKey);
    }
  }, [largeScreen, mobileTab, paperFolderScopeKey]);
  const [listCollapsed, setListCollapsed] = useState(false);
  const paperListInnerRef = useCollapsedPanelInert(listCollapsed, 1024);

  // The list panel stays mounted when mobile switches to the paper detail (and
  // remains visible on desktop). Keep its event props stable so detail-only
  // state changes do not ask every folder/filter/list row to render again.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const reportErrorRef = useRef(reportError);
  reportErrorRef.current = reportError;
  const invalidateAnalysisLifecycleRef = useRef(invalidateAnalysisLifecycle);
  invalidateAnalysisLifecycleRef.current = invalidateAnalysisLifecycle;
  const onSelectPaperListFolder = useCallback((id: string | null) => {
    setBrowserFolderId(id);
    setPaperQuery((query) => ({ ...query, directId: undefined, page: 1 }));
  }, []);
  const onPaperFolderCreated = useCallback((folder: ContentFolder) => {
    setFolders((current) => [...current, folder]);
  }, []);
  const onPaperFolderUpdated = useCallback((folder: ContentFolder) => {
    setFolders((current) => current.map((item) => item.id === folder.id ? folder : item));
  }, []);
  const onPaperFolderDeleted = useCallback((result: { folders: ContentFolder[] }) => {
    setFolders(result.folders);
    setFolderAnalysis(null);
    setPublishFolderId((current) => current && !result.folders.some((folder) => folder.id === current) ? "" : current);
  }, []);
  const onPaperDropItem = useCallback(async (id: string, folderId: string) => {
    const requestScope = paperFolderScopeRef.current;
    try {
      await movePaperToFolder(id, folderId);
      if (paperFolderScopeRef.current !== requestScope) return;
      await refreshRef.current();
    } catch (error) {
      if (paperFolderScopeRef.current === requestScope) reportErrorRef.current(error);
    }
  }, []);
  const onPaperFolderAnalyze = useCallback(async (folderId: string) => {
    const requestScope = paperFolderScopeRef.current;
    try {
      const result = await analyzePaperFolder(folderId);
      if (paperFolderScopeRef.current !== requestScope) return;
      setFolderAnalysis(result);
    } catch (error) {
      if (paperFolderScopeRef.current === requestScope) reportErrorRef.current(error);
    }
  }, []);
  const onPaperError = useCallback((error: unknown) => {
    reportErrorRef.current(error);
  }, []);
  const onPaperSearchChange = useCallback((q: string) => {
    setPaperQuery((current) => ({ ...current, q, directId: undefined, page: 1 }));
  }, []);
  const onPaperDeliveryModeChange = useCallback((deliveryMode: PaperQuery["deliveryMode"]) => {
    setPaperQuery((current) => ({ ...current, deliveryMode, directId: undefined, page: 1 }));
  }, []);
  const onPaperStatusChange = useCallback((status: string) => {
    setPaperQuery((current) => ({ ...current, status, directId: undefined, page: 1 }));
  }, []);
  const onPaperSelect = useCallback((paper: PlatformPaperRecord) => {
    invalidateAnalysisLifecycleRef.current();
    setSelectedPaperId(paper.paper_id);
    setDetailVisitedScopeKey(paperFolderScopeKey);
    setMobileTab("detail");
  }, [paperFolderScopeKey]);
  const onPaperPageChange = useCallback((page: number) => {
    setPaperQuery((current) => ({ ...current, page }));
  }, []);
  const onPaperPageSizeChange = useCallback((pageSize: number) => {
    setPaperQuery((current) => ({ ...current, pageSize, page: 1 }));
  }, []);
  const onClearPaperSelection = useCallback(() => {
    setSelectedPaperIds([]);
  }, []);

  const modeBusy = selectedPaper ? busy === `mode:${selectedPaper.paper_id}` : false;
  const publishBusy = selectedPaper ? busy === `publish:${selectedPaper.paper_id}` : false;
  const scoresBusy = selectedPaper ? busy === `scores:${selectedPaper.paper_id}` : false;
  const analysisBusy = selectedPaper ? busy === `analysis:${selectedPaper.paper_id}` : false;
  const submissionsBusy = selectedPaper ? busy === `submissions:${selectedPaper.paper_id}` : false;

  const detailContentAvailable = largeScreen || mobileTab === "detail" || detailHasBeenVisited;
  const detailIsVisible = largeScreen || mobileTab === "detail";
  const detailEntryScopeKey = `${requestOwnerKey}/${detailHasBeenVisited ? "visited-detail" : "unvisited-detail"}`;
  const detailModeScopeKey = `${detailEntryScopeKey}/${paperDetailView}`;
  const ownerScopeToken = useWorkspaceScopeToken(paperFolderScopeKey);
  const detailEntryScopeToken = useWorkspaceScopeToken(detailEntryScopeKey);
  const detailModeScopeToken = useWorkspaceScopeToken(detailModeScopeKey);
  const { ready: detailToolsTransitionReady, schedule: scheduleDetailTools } = useAfterWorkspaceTransition(detailEntryScopeToken);
  const { ready: detailModeTransitionReady, schedule: scheduleDetailMode } = useAfterWorkspaceTransition(detailModeScopeToken);
  const [detailToolsStage, setDetailToolsStage] = useState<{ scopeToken: string; ownerScopeToken: string; paperId: string }>({
    scopeToken: "",
    ownerScopeToken: "",
    paperId: "",
  });
  const detailToolsReady = detailToolsStage.scopeToken === detailEntryScopeToken && detailToolsStage.paperId === selectedPaper?.paper_id;
  const mountedDetailToolsPaperId = detailToolsReady && detailToolsStage.ownerScopeToken === ownerScopeToken
    ? detailToolsStage.paperId
    : "";
  const mountedDetailToolsPaper = papers.find((paper) => paper.paper_id === mountedDetailToolsPaperId) ?? null;
  const [detailMountState, setDetailMountState] = useState<PaperViewMountStages>({
    scopeToken: "",
    ...EMPTY_PAPER_VIEW_MOUNT_STAGES,
  });
  const detailMountStages: PaperViewMountStages = detailMountState.scopeToken === detailModeScopeToken
    ? detailMountState
    : { scopeToken: detailModeScopeToken, ...EMPTY_PAPER_VIEW_MOUNT_STAGES };
  const detailMountStagesRef = useRef(detailMountStages);
  detailMountStagesRef.current = detailMountStages;
  const selectedPublishFolder = folders.find((folder) => folder.id === publishFolderId);
  const publishFolderLabel = selectedPublishFolder
    ? `${selectedPublishFolder.name} · ${selectedPublishFolder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}`
    : "请选择文件夹";
  const publishSubjectLabel = selectedSubject
    ? formatSubjectLabel(selectedSubject)
    : teacherSubjects.length === 1
      ? formatSubjectLabel(teacherSubjects[0])
      : teacherSubjects.length > 1
        ? "请选择学科"
        : formatSubjectLabel(selectedPaper?.subject ?? "", "通用");
  const updateDetailMountStages = useCallback((scopeToken: string, patch: Partial<Omit<PaperViewMountStages, "scopeToken">>) => {
    setDetailMountState((current) => {
      const base = current.scopeToken === scopeToken
        ? current
        : { scopeToken, ...EMPTY_PAPER_VIEW_MOUNT_STAGES };
      return { ...base, ...patch, scopeToken };
    });
  }, []);

  useEffect(() => {
    if (!detailIsVisible || !selectedPaper || !detailToolsTransitionReady) return;
    if (detailToolsStage.scopeToken === detailEntryScopeToken && detailToolsStage.paperId === selectedPaper.paper_id) return;
    const paperId = selectedPaper.paper_id;
    return scheduleDetailTools(() => setDetailToolsStage({
      scopeToken: detailEntryScopeToken,
      ownerScopeToken,
      paperId,
    }));
  }, [detailEntryScopeToken, detailIsVisible, detailToolsStage, detailToolsTransitionReady, ownerScopeToken, scheduleDetailTools, selectedPaper?.paper_id]);

  useEffect(() => {
    if (!detailIsVisible || !selectedPaper || !detailModeTransitionReady) return;
    const current = detailMountStagesRef.current.scopeToken === detailModeScopeToken
      ? detailMountStagesRef.current
      : { scopeToken: detailModeScopeToken, ...EMPTY_PAPER_VIEW_MOUNT_STAGES };
    const cancelJobs: Array<() => void> = [];
    if (paperDetailView === "manage") {
      if (!current.publishForm) {
        cancelJobs.push(scheduleDetailMode(() => updateDetailMountStages(detailModeScopeToken, { publishForm: true })));
      }
      if (!current.publicationHistory) {
        cancelJobs.push(scheduleDetailMode(() => updateDetailMountStages(detailModeScopeToken, { publicationHistory: true })));
      }
      if (!current.manageUtilities) {
        cancelJobs.push(scheduleDetailMode(() => updateDetailMountStages(detailModeScopeToken, { manageUtilities: true })));
      }
    } else if (!current.gradingWorkspace) {
      cancelJobs.push(scheduleDetailMode(() => updateDetailMountStages(detailModeScopeToken, { gradingWorkspace: true })));
    }
    return () => cancelJobs.forEach((cancel) => cancel());
  }, [detailIsVisible, detailModeScopeToken, detailModeTransitionReady, paperDetailView, scheduleDetailMode, selectedPaper?.paper_id, updateDetailMountStages]);

  useEffect(() => {
    if (!detailIsVisible || paperDetailView !== "grading" || !detailModeTransitionReady || !selectedGradingSubmission || !selectedGradingDraftsReady) return;
    if (
      detailMountStagesRef.current.scopeToken === detailModeScopeToken &&
      detailMountStagesRef.current.gradingAttemptId === selectedGradingSubmission.attempt_id
    ) return;
    const attemptId = selectedGradingSubmission.attempt_id;
    return scheduleDetailMode(() => updateDetailMountStages(detailModeScopeToken, { gradingAttemptId: attemptId }));
  }, [detailIsVisible, detailModeScopeToken, detailModeTransitionReady, paperDetailView, scheduleDetailMode, selectedGradingDraftsReady, selectedGradingSubmission?.attempt_id, updateDetailMountStages]);

  const canPublish =
    Boolean(selectedPaper) && !publishBusy && Number(selectedPaper?.question_count || 0) > 0 && selectedClassIds.length > 0 && Boolean(publishFolderId) && (recipientScope === "class" || selectedStudentIds.length > 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--or-page)] text-[var(--or-text)]">
      <header className="flex shrink-0 flex-col items-stretch gap-3 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[var(--or-text)]">试卷管理</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="paper-download-offline-uploader"
            onClick={() => void downloadOfflineUploader()}
            disabled={!accountProfileReady || busy === "offline-uploader"}
            className="or-g51-btn or-g51-btn-tonal text-xs sm:text-sm py-2 px-3.5"
          >
            <Download className="h-4 w-4 mr-1" />
            {busy === "offline-uploader" ? "准备下载..." : "下载线下答卷采集器"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!accountProfileReady || loading}
            className="or-g51-btn or-g51-btn-outline text-xs sm:text-sm py-2 px-3.5"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </header>

      {/* Mobile master-detail switcher */}
      <div className="flex lg:hidden shrink-0 items-center justify-between border-b border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2">
        <div ref={mobileSegmentRef} className="or-g51-segmented or-g51-segmented-indicator relative isolate w-full">
          <SelectionIndicator rootRef={mobileSegmentRef} selector={'[data-state="active"]'} />
          <button
            type="button"
            aria-pressed={mobileTab === "list"}
            data-state={mobileTab === "list" ? "active" : "inactive"}
            onClick={() => setMobileTab("list")}
            className={`or-g51-segment-item flex-1 ${mobileTab === "list" ? "active" : ""}`}
          >
            试卷列表 ({papers.length})
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "detail"}
            data-state={mobileTab === "detail" ? "active" : "inactive"}
            onClick={() => {
              setDetailVisitedScopeKey(paperFolderScopeKey);
              setMobileTab("detail");
            }}
            className={`or-g51-segment-item flex-1 ${mobileTab === "detail" ? "active" : ""}`}
          >
            {selectedPaper ? "试卷内容" : "未选试卷"}
          </button>
        </div>
      </div>

      <div className="or-g51-papers-workspace flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className={`or-g51-paper-list-panel min-h-0 flex-col lg:flex ${listCollapsed ? "is-collapsed" : ""} ${mobileTab === "list" ? "flex flex-1" : "hidden"}`}>
          <div ref={paperListInnerRef} className="or-g51-paper-list-inner">
            <PaperListSidebar
              scopeKey={paperFolderScopeKey}
              papers={papers}
              selectedPaper={selectedPaper}
              loading={loading || !accountProfileReady}
              workspaceStatus={!accountProfileReady
                ? accountProfileFailed ? "当前账号信息加载失败，请刷新重试。" : "正在加载当前账号数据…"
                : loading && papers.length === 0 ? "正在加载试卷…" : null}
              query={paperQuery}
              meta={paperMeta}
              folders={folders}
              selectedFolderId={browserFolderId}
              taggedItems={taggedItems}
              onSelectFolder={onSelectPaperListFolder}
              onFolderCreated={onPaperFolderCreated}
              onFolderUpdated={onPaperFolderUpdated}
              onFolderDeleted={onPaperFolderDeleted}
              onDropItem={onPaperDropItem}
              onDropItems={moveSelectedPapersToFolder}
              selectedPaperIds={selectedPaperIds}
              movingSelectedPapers={movingSelectedPapers}
              onTogglePaper={togglePaperSelection}
              onToggleVisiblePapers={toggleVisiblePaperSelection}
              onClearSelectedPapers={onClearPaperSelection}
              onMoveSelectedPapers={moveSelectedPapersToFolder}
              onError={onPaperError}
              onAnalyzeFolder={onPaperFolderAnalyze}
              onSearchChange={onPaperSearchChange}
              onDeliveryModeChange={onPaperDeliveryModeChange}
              onStatusChange={onPaperStatusChange}
              onSelectPaper={onPaperSelect}
              onPage={onPaperPageChange}
              onPageSize={onPaperPageSizeChange}
            />
          </div>
          <button
            type="button"
            className="or-sidebar-toggle or-g51-paper-collapse-btn hidden lg:inline-flex"
            aria-label={listCollapsed ? "展开试卷列表" : "收起试卷列表"}
            aria-expanded={!listCollapsed}
            title={listCollapsed ? "展开试卷列表" : "收起试卷列表"}
            onClick={() => setListCollapsed((prev) => !prev)}
          >
            {listCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <main ref={detailScrollRootRef} className={`min-h-0 overflow-auto p-4 sm:p-6 ${mobileTab === "detail" ? "flex-1 block" : "hidden lg:block flex-1"}`}>
          {/* Mobile Back to List button */}
          <div className="mb-3 flex lg:hidden items-center justify-between">
            <button
              type="button"
              onClick={() => setMobileTab("list")}
              className="or-g51-btn or-g51-btn-outline text-xs py-1.5 px-3"
            >
              ← 返回试卷列表
            </button>
          </div>
          {detailContentAvailable ? (
            selectedPaper ? (
            <div className="mx-auto flex max-w-6xl flex-col gap-5">
              <section className="or-g51-surface p-4 sm:p-6 shadow-sm or-g51-static-card" tabIndex={-1}
                data-agent-target="paper-detail" data-agent-resource-id={selectedPaper.paper_id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--or-on-container)]">{formatSubjectLabel(selectedPaper.subject, "综合学科")}</p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--or-text)]">{selectedPaper.title}</h2>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
                      {mountedDetailToolsPaperId ? (
                        <div
                          className="inline-flex items-center gap-2.5"
                          style={{ display: mountedDetailToolsPaperId === selectedPaper.paper_id ? "inline-flex" : "none" }}
                          aria-hidden={mountedDetailToolsPaperId !== selectedPaper.paper_id}
                        >
                          <ContentTags
                            scope="paper"
                            itemId={mountedDetailToolsPaperId}
                            onError={(error) => reportError(error)}
                            onChange={() => void listTaggedItems("paper").then((result) => setTaggedItems(result.items))}
                          />
                          {mountedDetailToolsPaper ? (
                            <label className="inline-flex items-center gap-1.5 font-medium text-[var(--or-muted)]">
                              归类
                              <AppSelect
                                aria-label="试卷所在文件夹"
                                disabled={paperHasPublicationHistory(mountedDetailToolsPaper)}
                                title={paperHasPublicationHistory(mountedDetailToolsPaper) ? "已有发布记录，请移动整个文件夹，以保留答卷和统计关系" : undefined}
                                className="or-g51-select py-1 px-2.5 text-xs"
                                value={mountedDetailToolsPaper.folder_id ?? ""}
                                onValueChange={(value) => void movePaperToFolder(mountedDetailToolsPaper.paper_id, value).then(() => refresh()).catch(reportError)}
                              >
                                {folders.map((folder) => (
                                  <option key={folder.id} value={folder.id}>
                                    {folder.name}
                                  </option>
                                ))}
                              </AppSelect>
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                      {!detailToolsReady ? (
                        <span className="inline-flex items-center gap-2.5" role="status" aria-label="正在准备标签与归类">
                          <span className="relative inline-flex items-center gap-1.5">
                            <TagChips tags={taggedItems[selectedPaper.paper_id] ?? []} />
                            <span className="or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-0.5 text-xs font-medium leading-none text-[var(--or-muted)]">
                              标签
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--or-muted)]">
                            归类
                            <PaperSelectPlaceholder
                              label={folders.find((folder) => folder.id === selectedPaper.folder_id)?.name ?? "—"}
                              className="or-g51-select py-1 px-2.5 text-xs"
                            />
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3.5 flex flex-wrap gap-2 text-sm">
                      <G51Pill variant="neutral">{selectedPaper.question_count} 题</G51Pill>
                      <G51Pill variant="neutral">{selectedPaper.section_count} 个题组</G51Pill>
                      <G51Pill variant="neutral">{selectedPaper.submitted_student_count ?? 0} 份已提交</G51Pill>
                      <G51Pill variant="success">
                        {selectedPaper.published_student_count ?? selectedPaper.graded_student_count ?? 0} 份批改并发布
                      </G51Pill>
                      {selectedPaper.score_batch_count > 0 ? (
                        <G51Pill variant="neutral">{selectedPaper.score_batch_count} 批线下成绩</G51Pill>
                      ) : null}
                      {selectedPaper.status === "published" ? (
                        <G51Pill variant="success">已发布</G51Pill>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => { setPaperDetailView("grading"); void loadSelectedSubmissions(); }}
                      className="or-g51-btn or-g51-btn-tonal text-sm font-semibold"
                    >
                      查看提交与批改{(selectedPaper.submitted_student_count ?? 0) > 0 ? `（${selectedPaper.submitted_student_count}）` : ""}
                    </button>
                    <div ref={deliveryModeSegmentRef} className="or-g51-segmented or-g51-segmented-indicator relative isolate">
                      <SelectionIndicator rootRef={deliveryModeSegmentRef} selector={'[data-state="active"]'} />
                      <button
                        type="button"
                        data-testid="paper-mode-offline"
                        aria-pressed={selectedPaper.delivery_mode === "offline"}
                        data-state={selectedPaper.delivery_mode === "offline" ? "active" : "inactive"}
                        disabled={modeBusy || selectedPaper.delivery_mode === "offline"}
                        onClick={() => void setDeliveryMode(selectedPaper, "offline")}
                        className={`or-g51-segment-item ${selectedPaper.delivery_mode === "offline" ? "active" : ""}`}
                      >
                        设为线下
                      </button>
                      <button
                        type="button"
                        data-testid="paper-mode-online"
                        aria-pressed={selectedPaper.delivery_mode === "online"}
                        data-state={selectedPaper.delivery_mode === "online" ? "active" : "inactive"}
                        disabled={modeBusy || selectedPaper.delivery_mode === "online"}
                        onClick={() => void setDeliveryMode(selectedPaper, "online")}
                        className={`or-g51-segment-item ${selectedPaper.delivery_mode === "online" ? "active" : ""}`}
                      >
                        设为线上
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <div ref={detailViewSegmentRef} className="or-g51-segmented or-g51-segmented-indicator relative isolate w-fit">
                <SelectionIndicator rootRef={detailViewSegmentRef} selector={'[data-state="active"]'} />
                <button
                  type="button"
                  data-testid="paper-tab-manage"
                  aria-pressed={paperDetailView === "manage"}
                  data-state={paperDetailView === "manage" ? "active" : "inactive"}
                  onClick={() => setPaperDetailView("manage")}
                  className={`or-g51-segment-item ${paperDetailView === "manage" ? "active" : ""}`}
                >
                  试卷管理
                </button>
                <button
                  type="button"
                  data-testid="paper-tab-grading"
                  aria-pressed={paperDetailView === "grading"}
                  data-state={paperDetailView === "grading" ? "active" : "inactive"}
                  onClick={() => {
                    setPaperDetailView("grading");
                    void loadSelectedSubmissions();
                  }}
                  className={`or-g51-segment-item ${paperDetailView === "grading" ? "active" : ""}`}
                >
                  提交批改{(selectedPaper.submitted_student_count ?? 0) > 0 ? `（${selectedPaper.submitted_student_count}）` : ""}
                </button>
              </div>

              {paperDetailView === "manage" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                {detailMountStages.publishForm || detailMountStages.publicationHistory ? (
                  <div className="min-w-0 space-y-6">
                    <Suspense fallback={<PaperPublishPanelPlaceholder recipientScope={recipientScope} folderLabel={publishFolderLabel} subjectLabel={publishSubjectLabel} />}>
                      <LazyPaperPublishingSidebar
                        showPublishPanel={detailMountStages.publishForm}
                        showRecords={detailMountStages.publicationHistory}
                        publishPanel={detailMountStages.publishForm ? (
                    <LazyPaperClassPublishPanel
                        scrollRootRef={detailScrollRootRef}
                        selectedPaper={selectedPaper}
                        folders={folders}
                        publishFolderId={publishFolderId}
                        newFolderName={newFolderName}
                        recipientScope={recipientScope}
                        selectedClassIds={selectedClassIds}
                        selectedStudentIds={selectedStudentIds}
                        studentSearch={studentSearch}
                        classStudents={classStudents}
                        teacherSubjects={teacherSubjects}
                        selectedSubject={selectedSubject}
                        classes={classes}
                        alreadyPublishedClassIds={activePublishedClassIds}
                        submissionMode={submissionMode}
                        maxScreenSwitches={maxScreenSwitches}
                        publishStartAt={publishStartAt}
                        publishEndAt={publishEndAt}
                        timeLimitMinutes={timeLimitMinutes}
                        canPublish={canPublish}
                        onRecipientScopeChange={(scope) => {
                          setRecipientScope(scope);
                          if (scope === "class") setSelectedStudentIds([]);
                          else setSelectedClassIds([]);
                        }}
                        onFolderChange={setPublishFolderId}
                        onConvertFolder={() => void updateContentFolder(publishFolderId, { kind: "paper" }).then(({ folder }) => setFolders((current) => current.map((item) => item.id === folder.id ? folder : item))).catch(reportError)}
                        onNewFolderNameChange={setNewFolderName}
                        onCreateFolder={() => {
                          const parent = folders.find((folder) => folder.id === publishFolderId && folder.kind === "category") ?? folders.find((folder) => folder.kind === "category" && !folder.parent_id);
                          void createContentFolder({ scope: "paper", name: newFolderName.trim(), kind: recipientScope === "student" ? "paper" : "category", parent_id: recipientScope === "student" ? parent?.id : (parent?.id ?? null) }).then(({ folder }) => {
                            setFolders((current) => [...current, folder]);
                            setPublishFolderId(folder.id);
                            setNewFolderName("");
                          }).catch(reportError);
                        }}
                        onSubjectChange={setSelectedSubject}
                        onToggleClass={toggleClass}
                        onStudentSearchChange={setStudentSearch}
                        onToggleStudent={(studentId) => setSelectedStudentIds((ids) => ids.includes(studentId) ? ids.filter((id) => id !== studentId) : [...ids, studentId])}
                        onSubmissionModeChange={setSubmissionMode}
                        onMaxScreenSwitchesChange={setMaxScreenSwitches}
                        onPublishStartAtChange={setPublishStartAt}
                        onPublishEndAtChange={setPublishEndAt}
                        onTimeLimitMinutesChange={setTimeLimitMinutes}
                        onPublish={() => void publishSelectedPaper()}
                    />
                        ) : null}
                        publications={publications}
                        busy={busy}
                        onTogglePause={togglePublicationPause}
                        onRevoke={revokePublication}
                      />
                    </Suspense>
                    {!detailMountStages.publicationHistory ? <PaperPublicationHistoryPlaceholder publications={publications} /> : null}
                  </div>
                ) : (
                  <div className="min-w-0 space-y-6">
                    <PaperPublishPanelPlaceholder recipientScope={recipientScope} folderLabel={publishFolderLabel} subjectLabel={publishSubjectLabel} />
                    <PaperPublicationHistoryPlaceholder publications={publications} />
                  </div>
                )}
                {detailMountStages.manageUtilities ? (
                <aside className="space-y-5">
                  <Panel title="线下成绩" icon={<Upload className="h-5 w-5 text-[var(--or-on-container)]" />}>
                    <div className="flex flex-col gap-2.5">
                      <button
                        type="button"
                        onClick={() => void downloadScoreTemplate()}
                        className="or-g51-btn or-g51-btn-outline w-full text-sm font-medium"
                      >
                        下载成绩模板
                      </button>
                      <label className="or-g51-btn or-g51-btn-primary w-full text-sm font-semibold cursor-pointer">
                        {scoresBusy ? "上传中..." : "上传成绩"}
                        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => void uploadScores(event)} />
                      </label>
                    </div>
                  </Panel>

                  <Panel title="分析" icon={<BarChart3 className="h-5 w-5 text-[var(--or-on-container)]" />}>
                    <button
                      type="button"
                      data-testid="paper-load-analysis"
                      disabled={analysisBusy}
                      onClick={() => void loadSelectedAnalysis()}
                      className="or-g51-btn or-g51-btn-primary w-full text-sm font-semibold"
                    >
                      {analysisBusy ? "加载中..." : "查看分析摘要"}
                    </button>
                    {analysis ? <p className="mt-2.5 text-xs font-medium text-[var(--or-on-success)]">分析已在大窗口中打开</p> : null}
                    <button
                      type="button"
                      onClick={() => onOpenAnalysis?.(selectedPaper.exam_id)}
                      className="or-g51-btn or-g51-btn-outline mt-2.5 w-full text-sm font-medium"
                    >
                      打开分析
                    </button>
                  </Panel>
                </aside>
                ) : (
                  <PaperManageUtilitiesPlaceholder analysisAvailable={Boolean(analysis)} />
                )}
              </div>
              ) : detailMountStages.gradingWorkspace ? (
                <Suspense
                  fallback={(
                    <section className="or-g51-surface p-4 sm:p-6 shadow-sm" role="status">
                      正在加载批改工作区…
                    </section>
                  )}
                >
                  <LazyGradingWorkspace
                    submissions={submissions}
                    selectedSubmission={selectedGradingSubmission}
                    batchBusy={busy === "ai-grade:batch"}
                    submissionsBusy={submissionsBusy}
                    storageWarning={gradingDraftStorageWarning.ownerKey === gradingOwnerKey && gradingDraftStorageWarning.visible}
                    onBatch={() => void suggestLoadedPendingGrades()}
                    onReload={() => void loadSelectedSubmissions()}
                    onSelectSubmission={setSelectedGradingAttemptId}
                  >
                    {selectedGradingSubmission &&
                    detailMountStages.gradingAttemptId === selectedGradingSubmission.attempt_id &&
                    selectedGradingDraftsReady ? (
                      <Suspense fallback={<p className="text-sm text-[var(--or-muted)]" role="status">正在加载答卷详情…</p>}>
                        <LazyPaperSubmissionDetail
                          key={selectedGradingSubmission.attempt_id}
                          submission={selectedGradingSubmission}
                          busy={busy}
                          scanImageUrls={scanImageUrls}
                          onSuggest={() => void suggestSubmissionGrades(selectedGradingSubmission)}
                          onLoadScan={(pageIndex) => void loadOfflineScanImage(selectedGradingSubmission, pageIndex)}
                          onComplete={() => void completeGrading(selectedGradingSubmission)}
                        >
                          {selectedGradingSubmission.answers.map((answer) => {
                            const key = gradeKey(selectedGradingSubmission.attempt_id, answer.question_id);
                            const source = toGradingDraftSource(answer);
                            const draft = getGradingDraft(gradingDrafts, key, source);
                            const sourceVersion = gradingDraftSourceVersionsRef.current.get(key);
                            const versionChanged = gradingDraftSourceVersionsRef.current.has(key) && sourceVersion !== (answer.grading_version ?? null);
                            return (
                              <DeferredMount
                                scrollRootRef={detailScrollRootRef}
                                key={answer.question_id}
                                fallback={(
                                  <div
                                    className="min-h-24 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]"
                                    role="status"
                                  >
                                    滚动到此处后加载本题批改内容…
                                  </div>
                                )}
                              >
                                <Suspense fallback={<div className="min-h-24 rounded-2xl border border-dashed border-[var(--or-outline)] px-4 py-3 text-xs text-[var(--or-muted)]" role="status">正在加载本题…</div>}>
                                  <LazyGradingQuestionCard
                                    answer={answer}
                                    scoreValue={draft.score.value}
                                    feedbackValue={draft.feedback.value}
                                    statusLabel={gradingStatusLabel(answer.grading_status)}
                                    studentAnswerText={formatStudentAnswer(answer.answer)}
                                    saving={busy === "grade:" + key}
                                    versionChanged={versionChanged && (draft.score.dirty || draft.feedback.dirty)}
                                    onScoreChange={(changedValue) => {
                                      gradingRequests.beginEdit(key, "score");
                                      if (!gradingDraftSourceVersionsRef.current.has(key)) gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
                                      setGradingDrafts((current) => updateGradingDraft(current, key, source, "score", changedValue));
                                    }}
                                    onFeedbackChange={(changedValue) => {
                                      gradingRequests.beginEdit(key, "feedback");
                                      if (!gradingDraftSourceVersionsRef.current.has(key)) gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
                                      setGradingDrafts((current) => updateGradingDraft(current, key, source, "feedback", changedValue));
                                    }}
                                    onSave={() => void saveGrade(selectedGradingSubmission, answer.question_id)}
                                  />
                                </Suspense>
                              </DeferredMount>
                            );
                          })}
                        </LazyPaperSubmissionDetail>
                      </Suspense>
                    ) : selectedGradingSubmission ? (
                      <p className="text-sm text-[var(--or-muted)]" role="status">正在准备答卷详情…</p>
                    ) : null}
                  </LazyGradingWorkspace>
                </Suspense>
              ) : (
                <section className="or-g51-surface p-4 sm:p-6 shadow-sm" role="status">
                  正在准备批改工作区…
                </section>
              )}
              {message ? (
                <div className="rounded-md border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 text-sm text-[var(--or-muted)] shadow-sm">
                  {message}
                </div>
              ) : null}
            </div>
            ) : (
              <div className="flex h-full items-start justify-center overflow-auto p-6">
                {!accountProfileReady ? (
                  <p className="py-16 text-sm text-[var(--or-muted)]">
                    {accountProfileFailed ? "当前账号信息加载失败，请刷新重试。" : "正在加载当前账号数据…"}
                  </p>
                ) : loading ? <p className="py-16 text-sm text-[var(--or-muted)]">正在加载试卷...</p> : (
                  <div className="w-full max-w-5xl space-y-4">
                    <GettingStartedChecklist
                      description="准备题目和模板后即可组卷、预览并发布到班级"
                      steps={[
                        { label: "准备题目", complete: false, actionLabel: "去创建题目", onAction: onOpenBank },
                        { label: "准备试卷模板", complete: false, actionLabel: "去创建模板", onAction: onOpenTemplates },
                        { label: "生成第一份试卷", complete: false, actionLabel: "开始组卷", onAction: onOpenCompose },
                      ]}
                    />
                    <p className="text-center text-sm text-[var(--or-muted)]">当前还没有试卷，可从上面的任一步开始。</p>
                  </div>
                )}
              </div>
            )
          ) : null}
        </main>
      </div>
      {analysisDialogOpen ? (
        <div className="or-g51-dialog-backdrop" role="dialog" aria-modal="true" aria-label="试卷分析">
          <section className="or-g51-dialog-window h-[92vh] sm:h-[85vh] w-[95vw] sm:w-[85vw] max-w-5xl min-w-0">
            <header className="flex shrink-0 items-center justify-between border-b border-[var(--or-outline)] px-4 py-3 sm:px-6 sm:py-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[var(--or-text)]">
                  {analysis ? analysis.paper.title : selectedPaper?.title ?? "试卷"} · 试卷分析
                </h2>
                <p className="mt-1 text-sm text-[var(--or-muted)]">完成情况、题目表现、模块掌握和考试行为数据</p>
              </div>
              <button
                type="button"
                aria-label="关闭试卷分析"
                onClick={invalidateAnalysisLifecycle}
                className="rounded-lg p-2 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] transition"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              {analysis ? (
                <>
                  {analysisPending ? (
                    <p className="mb-3 text-sm font-medium text-[var(--or-muted)]" role="status">正在更新分析结果…</p>
                  ) : null}
                  <div className="mb-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      data-testid="paper-export-report-xlsx"
                      disabled={!analysisSnapshotIsCurrent || analysisPending}
                      onClick={downloadAnalysisReport}
                      className="or-g51-btn or-g51-btn-outline text-sm"
                    >
                      导出 Excel
                    </button>
                    <button
                      type="button"
                      data-testid="paper-export-report-pdf"
                      disabled={!analysisSnapshotIsCurrent || analysisPending}
                      onClick={() => void printAnalysisReport()}
                      className="or-g51-btn or-g51-btn-outline text-sm"
                    >
                      导出 PDF
                    </button>
                  </div>
                  <div className="mb-4 flex flex-wrap items-center gap-4">
                    {(analysis.publications?.length ?? 0) > 0 ? (
                      <label className="flex items-center gap-2 text-sm font-medium text-[var(--or-muted)]">
                        发布批次
                        <AppSelect
                          aria-label="分析发布批次"
                          disabled={busy !== null && !analysisPending}
                          value={analysisFilterSelection?.ownerKey === requestOwnerKey ? analysisFilterSelection.publicationId ?? "" : analysis.publication_id ?? ""}
                          className="or-g51-select text-sm py-1.5 px-3"
                          onValueChange={(value) => void loadSelectedAnalysis(value || undefined)}
                        >
                          {analysis.publications?.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title} · {item.created_at} · {item.id.slice(0, 8)}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                    ) : null}
                    {(analysis.available_classes?.length ?? 0) > 0 ? (
                      <label className="flex items-center gap-2 text-sm font-medium text-[var(--or-muted)]">
                        分析班级
                        <AppSelect
                          aria-label="分析班级"
                          disabled={busy !== null && !analysisPending}
                          value={analysisFilterSelection?.ownerKey === requestOwnerKey ? analysisFilterSelection.classId ?? "" : analysis.class_id ?? ""}
                          className="or-g51-select text-sm py-1.5 px-3"
                          onValueChange={(value) =>
                            void loadSelectedAnalysis(
                              getCurrentAnalysisFilters().publicationId,
                              value || undefined,
                            )
                          }
                        >
                          <option value="">全部班级</option>
                          {analysis.available_classes?.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {item.grade && !item.name.includes(item.grade) ? " · " + item.grade : ""}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                    ) : null}
                  </div>
                  <Suspense fallback={<p className="text-sm text-[var(--or-muted)]" role="status">正在加载分析图表…</p>}>
                    <LazyPlatformPaperAnalysisCharts analysis={analysis} />
                  </Suspense>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm font-medium text-[var(--or-muted)]" role="status">正在加载试卷分析…</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {folderAnalysis ? (
        <div className="or-g51-dialog-backdrop" role="dialog" aria-modal="true" aria-label="文件夹分析">
          <section className="or-g51-dialog-window h-[92vh] sm:h-[85vh] w-[95vw] sm:w-[85vw] max-w-5xl flex-col">
            <header className="flex items-center justify-between border-b border-[var(--or-outline)] px-4 py-3 sm:px-6 sm:py-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[var(--or-text)]">
                  {folderAnalysis.folder.name} · 文件夹分析
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-[var(--or-muted)]">
                  仅统计实际收到该练习的学生；不计入班级统考平均分。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭文件夹分析"
                onClick={() => setFolderAnalysis(null)}
                className="rounded-lg p-2 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] transition"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="overflow-auto p-4 sm:p-6 space-y-4">
              <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-5">
                {[
                  ["接收人数", folderAnalysis.summary.assigned_count],
                  ["已提交", folderAnalysis.summary.submitted_count],
                  ["已批改", folderAnalysis.summary.graded_count],
                  ["发布批次", folderAnalysis.summary.publication_count],
                  [
                    "平均得分率",
                    folderAnalysis.summary.average_score_percent == null
                      ? "暂无"
                      : `${folderAnalysis.summary.average_score_percent}%`,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="or-g51-static-card rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5">
                    <div className="text-xs font-medium text-[var(--or-muted)]">{label}</div>
                    <div className="mt-1 text-lg font-bold text-[var(--or-text)]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 text-sm">
                {folderAnalysis.attempts.map((attempt, index) => (
                  <div
                    key={index}
                    className="or-g51-static-card flex flex-wrap justify-between gap-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 font-medium"
                  >
                    <span className="text-[var(--or-text)]">
                      {attempt.display_name} · {attempt.student_no}
                    </span>
                    <span className="text-[var(--or-muted)]">
                      {attempt.title} · {attempt.status} ·{" "}
                      {attempt.score == null ? "未发布成绩" : `${attempt.score}/${attempt.max_score ?? "—"}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function toGradingDraftSource(answer: PaperSubmissionRecord["answers"][number]): GradingDraftSource {
  return {
    score: answer.score,
    aiSuggestedScore: answer.ai_suggested_score,
    feedback: answer.feedback,
    aiFeedback: answer.ai_feedback,
  };
}

function gradingDraftStorageScope(
  owner: { accountId: string; projectId: string; paperId: string },
  attemptId: string,
  questionId: string,
): GradingDraftStorageScope {
  return { ...owner, attemptId, questionId };
}

function reconcileSubmissionSnapshot(
  current: PaperSubmissionRecord[],
  incoming: PaperSubmissionRecord[],
  refreshableFields: Map<string, { score: boolean; feedback: boolean }>,
): PaperSubmissionRecord[] {
  const currentByAttempt = new Map(current.map((submission) => [submission.attempt_id, submission]));
  return incoming.map((submission) => {
    const existing = currentByAttempt.get(submission.attempt_id);
    if (!existing) return submission;
    const existingAnswers = new Map(existing.answers.map((answer) => [answer.question_id, answer]));
    return {
      ...submission,
      answers: submission.answers.map((answer) => {
        const previous = existingAnswers.get(answer.question_id);
        const refreshable = refreshableFields.get(`${submission.attempt_id}:${answer.question_id}`);
        if (!previous || !refreshable) return answer;
        return {
          ...answer,
          ...(refreshable.score ? {} : { score: previous.score, ai_suggested_score: previous.ai_suggested_score }),
          ...(refreshable.feedback ? {} : { feedback: previous.feedback, ai_feedback: previous.ai_feedback }),
          ...(!refreshable.score || !refreshable.feedback ? { grading_status: previous.grading_status } : {}),
        };
      }),
    };
  });
}

function gradingSaveMessage(fields: Record<"score" | "feedback", boolean>): string {
  if (fields.score && fields.feedback) return "已保存批改结果";
  if (!fields.score && !fields.feedback) return "已保存发出时的分数和评语；当前有更新的分数和评语未保存。";
  if (!fields.score) return "已保存发出时的评语；当前有更新的分数未保存。";
  return "已保存发出时的分数；当前有更新的评语未保存。";
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="or-g51-surface p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2.5">
        {icon}
        <h3 className="text-base font-semibold text-[var(--or-text)]">{title}</h3>
      </div>
      {children}
    </section>
  );
}
