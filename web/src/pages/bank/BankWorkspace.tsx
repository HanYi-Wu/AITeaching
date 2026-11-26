import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCollapsedPanelInert } from "../../hooks/useCollapsedPanelInert";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostFormData,
  apiPut,
} from "../../api/client";
import { ApiError } from "../../api/errors";
import {
  BankQuestionEditorPanel,
  type BankDetailState,
  type GroupMemberJson,
  type QuestionGroupJson,
  type QuestionJson,
} from "../../components/BankQuestionEditorPanel";
import type { BankEditorDraftStore } from "../../components/bankEditorTypes";
import type { EmbedKind } from "../../lib/bankEditorEmbedKinds";
import { ContentWithPrimeBrush } from "../../components/ContentWithPrimeBrush";
import { ContentTags } from "../../components/ContentTags";
import { MathInsertOverlay } from "../../components/MathInsertOverlay";
import { MermaidEditorModal } from "../../components/MermaidEditorModal";
import { PrimeBrushEditorModal } from "../../components/PrimeBrushEditorModal";
import { useAgentActions } from "../../contexts/AgentContext";
import { TabPanel, type TabItem } from "../../components/layout/TabPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { SelectionIndicator } from "../../design-system/SelectionIndicator";
import i18n from "../../i18n/i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import { localeCompareStrings } from "../../lib/locale";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { downloadPlatformBlob, listTaggedItems, type ContentTag } from "../../platform/auth";
import { loadSessionToken } from "../../platform/session";
import { isChoiceQuestionType } from "../../lib/questionTypes";
import {
  defaultItemsForNewGroup,
  extractQuestionNamespace,
  nextSequentialQuestionId,
  validateQuestionIdInCollection,
  type BankListItem,
} from "./bankModel";
import { pruneStaleSelection } from "./bankOperationModel";
import { useBankList } from "./useBankList";
import { BankToolbar } from "./BankToolbar";
import { BankSidebar } from "./BankSidebar";
import { useBankImageUpload } from "./bankImageAdapter";
import { useBankEditSession, useBankImportSession } from "./sessionCore";
import "../../ui-redesign/g48/g48-bank.css";

const ignoreDraftChanges = (_listener: () => void) => () => undefined;

function BankPageContextSync({
  active = true,
  selectedId,
  draftStore,
  setPageContext,
}: {
  active?: boolean;
  selectedId: string | null;
  draftStore: BankEditorDraftStore;
  setPageContext: ReturnType<typeof useAgentActions>["setPageContext"];
}) {
  const { t } = useTranslation(["bank"]);
  const wasActiveRef = useRef(active);
  const { detail } = useSyncExternalStore(
    draftStore.subscribe,
    draftStore.getSnapshot,
    draftStore.getSnapshot,
  );

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (wasActive && !active) {
      setPageContext(null);
    }
  }, [active, setPageContext]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      if (selectedId && detail?.qualified_id === selectedId) {
        const raw = typeof detail.question?.content === "string" ? detail.question.content : detail.qualified_id;
        const preview = raw.replace(/\s+/g, " ").slice(0, 48);
        const suffix = preview ? ` — ${preview}${preview.length >= 48 ? "…" : ""}` : "";
        setPageContext({
          current_page: "bank",
          selected_resource_type: "question",
          selected_resource_id: selectedId,
          summary: t("bank:pageContextWithId", { id: detail.qualified_id, suffix }),
        });
      } else {
        setPageContext({
          current_page: "bank",
          summary: t("bank:pageContextBrowse"),
        });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [active, selectedId, detail, setPageContext, t]);

  useEffect(() => () => setPageContext(null), [setPageContext]);
  return null;
}

function BankQuestionPreview({
  draftStore,
  live,
}: {
  draftStore: BankEditorDraftStore;
  live: boolean;
}) {
  const { t } = useTranslation("bank");
  const { detail } = useSyncExternalStore(
    live ? draftStore.subscribe : ignoreDraftChanges,
    draftStore.getSnapshot,
    draftStore.getSnapshot,
  );
  const previewQ = detail ? detail.question_display ?? detail.question : null;
  const previewGroup = detail?.question_group
    ? detail.question_group_preview
      ? {
          ...detail.question_group,
          material: detail.question_group_preview.material,
          items: detail.question_group_preview.items,
        }
      : detail.question_group
    : null;

  return (
    <>
      <h3 className="text-sm font-semibold text-[var(--or-muted)]">{t("livePreview")}</h3>
      {!previewQ && !previewGroup ? (
        <p className="mt-4 text-sm text-[var(--or-muted)]">{t("previewEmpty")}</p>
      ) : previewGroup ? (
        <div className="mt-3 space-y-4 text-sm leading-relaxed">
          <div>
            <p className="text-[13px] font-semibold text-[var(--or-muted)]">{t("sharedMaterialLabel")}</p>
            <ContentWithPrimeBrush text={previewGroup.material} className="mt-1 text-[var(--or-text)]" />
          </div>
          {previewGroup.items.map((it, i) => {
            const rowIsChoice = previewGroup.unified === false
              ? isChoiceQuestionType(it.type ?? "single_choice")
              : typeof previewGroup.unified === "string" && isChoiceQuestionType(previewGroup.unified);
            return (
              <div key={i} className="border-t border-[var(--or-outline)] pt-3">
                <p className="text-[13px] font-semibold text-[var(--or-muted)]">{t("subItemIndex", { n: i + 1 })}</p>
                <ContentWithPrimeBrush text={it.content} className="mt-1 text-[var(--or-text)]" />
                {rowIsChoice && (
                  <div className="mt-2">
                    <p className="text-[13px] font-semibold text-[var(--or-muted)]">{t("options")}</p>
                    <ul className="mt-1 list-inside list-disc text-[var(--or-muted)]">
                      {Object.entries(it.options ?? { A: "", B: "", C: "", D: "" }).map(([k, v]) => (
                        <li key={k}>
                          <strong>{k}</strong>{" "}
                          <span className="inline-block align-top">
                            <ContentWithPrimeBrush text={v} className="inline" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-2">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--or-muted)]">{t("answer")}</summary>
                  <ContentWithPrimeBrush text={it.answer} className="mt-1" />
                </details>
                <details className="mt-1.5 rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-2">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--or-muted)]">{t("analysis")}</summary>
                  <ContentWithPrimeBrush text={it.analysis || ""} className="mt-1" />
                </details>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 space-y-4 text-sm leading-relaxed">
          <div>
            <p className="text-[13px] font-semibold text-[var(--or-muted)]">{t("stem")}</p>
            <ContentWithPrimeBrush text={previewQ!.content} className="mt-1 text-[var(--or-text)]" />
          </div>
          {isChoiceQuestionType(previewQ!.type) && previewQ!.options && (
            <div>
              <p className="text-[13px] font-semibold text-[var(--or-muted)]">{t("options")}</p>
              <ul className="mt-1 list-inside list-disc text-[var(--or-muted)]">
                {Object.entries(previewQ!.options).map(([k, v]) => (
                  <li key={k}>
                    <strong>{k}</strong>{" "}
                    <span className="inline-block align-top">
                      <ContentWithPrimeBrush text={v} className="inline" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-2">
            <summary className="cursor-pointer text-sm font-medium text-[var(--or-muted)]">{t("answer")}</summary>
            <ContentWithPrimeBrush text={previewQ!.answer} className="mt-1" />
          </details>
          <details className="mt-1.5 rounded-lg border border-[color-mix(in_srgb,var(--or-outline)_60%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-2">
            <summary className="cursor-pointer text-sm font-medium text-[var(--or-muted)]">{t("analysis")}</summary>
            <ContentWithPrimeBrush text={previewQ!.analysis || ""} className="mt-1" />
          </details>
        </div>
      )}
    </>
  );
}

export function BankWorkspace(props: {
  onError: (s: string | null) => void;
  onOpenGraphNode?: (nodeId: string) => void;
  active?: boolean;
  projectScope?: string | null;
}) {
  const sessionScope = loadSessionToken() ?? "local-session";
  return <BankWorkspaceSession key={sessionScope} {...props} />;
}

function BankWorkspaceSession({
  onError,
  onOpenGraphNode,
  active = true,
  projectScope = null,
}: {
  onError: (s: string | null) => void;
  onOpenGraphNode?: (nodeId: string) => void;
  active?: boolean;
  projectScope?: string | null;
}) {
  const { t } = useTranslation(["bank", "lib", "common"]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const listErrorRef = useRef<string | null>(null);
  const bankListRefreshSourceRef = useRef<object>({});
  const handleBankListError = useCallback(
    (msg: string | null) => {
      listErrorRef.current = msg;
      if (!activeRef.current && msg !== null) return;
      onError(msg);
    },
    [onError]
  );

  const {
    items,
    diagnostics,
    folders,
    setFolders,
    collections,
    subjects,
    filterSubject,
    setFilterSubject,
    filterCollection,
    setFilterCollection,
    filterType,
    setFilterType,
    filterCategory,
    setFilterCategory,
    metadataFilters,
    setMetadataFilters,
    searchInput,
    setSearchInput,
    commitSearch,
    graphLinkIndex,
    loading,
    hasLoaded,
    loadList,
    metadataFilterDefinitions,
    filtered,
    bankFilterSummary,
  } = useBankList({
    onError: handleBankListError,
    ignoreContentChangeSource: bankListRefreshSourceRef.current,
    projectScope,
  });

  const wasActiveRef = useRef(active);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!wasActive && active) {
      void loadList();
    }
  }, [active, loadList]);

  const robustLoadList = useCallback(async () => {
    listErrorRef.current = null;
    await loadList();
    if (listErrorRef.current) {
      const err = new Error(listErrorRef.current);
      listErrorRef.current = null;
      throw err;
    }
  }, [loadList]);

  const refreshListAndNotify = useCallback(async () => {
    const session = loadSessionToken();
    try {
      await robustLoadList();
    } finally {
      if (session === loadSessionToken()) {
        notifyContentLibraryChanged("question", bankListRefreshSourceRef.current);
      }
    }
  }, [robustLoadList]);

  const fetchDetail = useCallback(async (qid: string): Promise<BankDetailState> => {
    const enc = encodeURIComponent(qid);
    const d = await apiGet<{
      qualified_id: string;
      question: QuestionJson | null;
      question_display?: QuestionJson | null;
      file_yaml: string;
      record_yaml?: string;
      version?: string;
      storage_path: string;
      storage_kind: string;
      question_group?: QuestionGroupJson | null;
      question_group_preview?: { material: string; items: GroupMemberJson[] } | null;
    }>(`/api/bank/items/${enc}`);
    d.file_yaml = d.record_yaml ?? d.file_yaml;
    let detailState: BankDetailState;
    if (!d.question && d.question_group) {
      const ug = d.question_group.unified;
      const qt = ug === false ? "single_choice" : typeof ug === "string" ? ug : "single_choice";
      detailState = {
        ...d,
        question: {
          id: `${d.question_group.id}__01`,
          type: qt,
          content: "",
          answer: "",
          analysis: "",
          metadata: {},
          options: isChoiceQuestionType(qt) ? { A: "", B: "", C: "", D: "" } : null,
          group_material: d.question_group.material,
        },
        question_display: undefined,
      };
    } else {
      detailState = {
        ...(d as BankDetailState),
        question_display: d.question_display ?? undefined,
      };
    }
    return detailState;
  }, []);

  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  /** 已打开的题目标签（多窗口编辑） */
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const skipReloadSelectedIdRef = useRef<string | null>(null);

  const handleQuestionRenamed = useCallback((oldQid: string, newQid: string) => {
    skipReloadSelectedIdRef.current = newQid;
    setOpenTabs((prev) => {
      const next = prev.map((id) => (id === oldQid ? newQid : id));
      return Array.from(new Set(next));
    });
    setSelectedExportIds((prev) => {
      const next = prev.map((id) => (id === oldQid ? newQid : id));
      return Array.from(new Set(next));
    });
  }, []);

  const putItemApi = useCallback(
    async (qid: string, body: unknown, headers?: Record<string, string>) => {
      const enc = encodeURIComponent(qid);
      return headers
        ? apiPut<{ version?: string; qualified_id?: string }>(`/api/bank/items/${enc}`, body, headers)
        : apiPut<{ version?: string; qualified_id?: string }>(`/api/bank/items/${enc}`, body);
    },
    []
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const {
    selectedId,
    setSelectedId,
    detail,
    setDetail,
    draftStore,
    rawYaml,
    setRawYaml,
    metaRows,
    setMetaRows,
    editorTab,
    setEditorTab,
    workView,
    setWorkView,
    dirty,
    isCurrentDraftDirty,
    saving,
    saveConflict,
    trySelectQuestion,
    loadQuestionDetail,
    saveForm,
    saveRawYaml,
    viewLatestConflict,
    loadLatestConflict,
    clearSessionDraft,
    removeBaseline,
    draftRef,
  } = useBankEditSession({
    onError,
    fetchDetailApi: fetchDetail,
    putItemApi,
    refreshListApi: refreshListAndNotify,
    onQuestionRenamed: handleQuestionRenamed,
    validateBeforeSave: (currentDetail, source) => {
      if (source !== "form" || currentDetail.question_group) return null;
      return validateQuestionIdInCollection({
        items: itemsRef.current,
        subject: extractQuestionNamespace(currentDetail.qualified_id),
        rawId: currentDetail.question.id,
        excludeQualifiedId: currentDetail.qualified_id,
      });
    },
  });

  const {
    transaction: importTransaction,
    busy: importBusy,
    importYaml,
    setImportYaml,
    importSubject,
    setImportSubject,
    importTarget,
    importYamlText,
    importFromFile,
    retryRefreshOnly,
  } = useBankImportSession({
    onError,
    postImportApi: (body) => apiPost("/api/bank/import", body),
    postBundleApi: (fd) => apiPostFormData("/api/bank/import-bundle", fd),
    refreshListApi: refreshListAndNotify,
    defaultSubject: i18n.t("bank:defaultSubject"),
    defaultTarget: "默认",
  });

  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const refreshTags = useCallback(() => {
    void listTaggedItems("bank")
      .then(({ items }) => setTaggedItems(items))
      .catch(() => undefined);
  }, []);
  useEffect(() => refreshTags(), [refreshTags]);

  const [mobileBankPanel, setMobileBankPanel] = useState<"list" | "editor">("list");
  const [bankListCollapsed, setBankListCollapsed] = useState(false);
  const bankListInnerRef = useCollapsedPanelInert(bankListCollapsed, 1024);
  const mobileBankPanelRef = useRef<HTMLDivElement>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const busy = opBusy || imageBusy || saving || importBusy;

  const openModalAfterCreateRef = useRef(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [bankManageOpen, setBankManageOpen] = useState(false);
  const [manageEditId, setManageEditId] = useState<string | null>(null);
  const [manageDraftSubject, setManageDraftSubject] = useState("");
  const [manageDraftCollection, setManageDraftCollection] = useState("");
  const [newSubject, setNewSubject] = useState(() => i18n.t("bank:defaultSubject"));
  const [newCollection] = useState("默认");
  const [newIdEdited, setNewIdEdited] = useState(false);
  const [newId, setNewIdState] = useState(() =>
    nextSequentialQuestionId([], i18n.t("bank:defaultSubject"), "默认")
  );
  const suggestedNewId = useMemo(
    () => nextSequentialQuestionId(items, newSubject, newCollection),
    [items, newSubject, newCollection]
  );
  useEffect(() => {
    if (!newIdEdited && newId !== suggestedNewId) {
      setNewIdState(suggestedNewId);
    }
  }, [newIdEdited, newId, suggestedNewId]);
  const handleNewIdChange = useCallback((next: string) => {
    setNewIdEdited(true);
    setNewIdState(next);
  }, []);
  const [newType, setNewType] = useState("single_choice");
  /** 新建题组：混编或同型 */
  const [newGroupUnified, setNewGroupUnified] = useState<string>("single_choice");
  const [newGroupMaterial, setNewGroupMaterial] = useState("");
  const [pendingDeleteItem, setPendingDeleteItem] = useState<BankListItem | null>(null);

  const [mathOpen, setMathOpen] = useState(false);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [primeBrushOpen, setPrimeBrushOpen] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const analysisRef = useRef<HTMLTextAreaElement>(null);
  const materialGroupRef = useRef<HTMLTextAreaElement>(null);
  /** 插入目标（公式 / Mermaid） */
  const embedKindRef = useRef<EmbedKind | null>(null);
  /** Saved when opening Math/Mermaid overlay — focus moves and loses textarea selection. */
  const embedSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const getCurrentDraftDetail = useCallback(
    () => draftStore.getSnapshot().detail,
    [draftStore],
  );

  const { imageInputRef, beginImageEmbed, onImageFileSelected, insertSnippet } =
    useBankImageUpload({
      detail,
      getDetail: getCurrentDraftDetail,
      setDetail,
      setBusy: setImageBusy,
      onError,
      contentRef,
      answerRef,
      analysisRef,
      materialGroupRef,
    });

  const { setPageContext } = useAgentActions();

  const beginMathEmbed = useCallback((kind: EmbedKind, sel: { start: number; end: number } | null) => {
    embedKindRef.current = kind;
    embedSelectionRef.current = sel;
    setMathOpen(true);
  }, []);

  const beginMermaidEmbed = useCallback((kind: EmbedKind, sel: { start: number; end: number } | null) => {
    embedKindRef.current = kind;
    embedSelectionRef.current = sel;
    setMermaidOpen(true);
  }, []);

  const beginPrimeBrushEmbed = useCallback((kind: EmbedKind, sel: { start: number; end: number } | null) => {
    embedKindRef.current = kind;
    embedSelectionRef.current = sel;
    setPrimeBrushOpen(true);
  }, []);

  useEffect(() => {
    if (!bankManageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBankManageOpen(false);
        setManageEditId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bankManageOpen]);

  useEffect(() => {
    if (!pendingDeleteItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setPendingDeleteItem(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDeleteItem, busy]);

  useEffect(() => {
    if (!editorModalOpen || pendingDeleteItem || mathOpen || mermaidOpen || primeBrushOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setEditorModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorModalOpen, pendingDeleteItem, mathOpen, mermaidOpen, primeBrushOpen, busy]);

  /** 导入目标科目：接口科目 + 列表中已出现的科目 */
  const importSubjectList = useMemo(() => {
    const fromItems = [...new Set(items.map((i) => i.subject).filter(Boolean) as string[])];
    return [...new Set([...subjects, ...fromItems])].sort((a, b) => localeCompareStrings(a, b));
  }, [subjects, items]);

  const newSubjectSelectValue = useMemo(() => {
    const subject = newSubject.trim();
    return importSubjectList.includes(subject) ? subject : "__custom__";
  }, [importSubjectList, newSubject]);

  const importSubjectSelectValue = useMemo(() => {
    if (importSubjectList.length === 0) {
      return "__custom__";
    }
    const subjTrim = importSubject.trim();
    if (subjTrim === "") {
      return "__custom__";
    }
    const match = importSubjectList.find((s) => s === importSubject || s === subjTrim);
    return match ?? "__custom__";
  }, [importSubject, importSubjectList]);

  const importSummaryHint = useMemo(() => {
    const sub = importSubject.trim() || t("bank:importSubjectUnset");
    const coll = importTarget.trim() || t("bank:importCollectionUnset");
    return `${sub} → ${coll}`;
  }, [importSubject, importTarget, t]);

  useEffect(() => {
    if (!selectedId) {
      clearSessionDraft();
      setEditorModalOpen(false);
      return;
    }
    if (skipReloadSelectedIdRef.current === selectedId) {
      void Promise.resolve().then(() => {
        if (skipReloadSelectedIdRef.current === selectedId) {
          skipReloadSelectedIdRef.current = null;
        }
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadQuestionDetail(selectedId);
        if (!cancelled && openModalAfterCreateRef.current) {
          openModalAfterCreateRef.current = false;
          setEditorModalOpen(true);
        }
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadQuestionDetail, clearSessionDraft, onError]);

  async function createQuestion() {
    const subj = newSubject.trim();
    const coll = newCollection.trim();
    const qid = newId.trim();
    const createIdError = validateQuestionIdInCollection({
      items,
      subject: subj,
      collection: coll,
      rawId: newId,
      groupMemberCount: newType === "group" ? 1 : 0,
    });
    if (createIdError) {
      onError(createIdError);
      return false;
    }
    setOpBusy(true);
    onError(null);
    try {
      let body: { subject: string; collection: string; question: QuestionJson | QuestionGroupJson };
      if (newType === "group") {
        const unified = newGroupUnified === "mixed" ? false : newGroupUnified;
        const groupItems = defaultItemsForNewGroup(newGroupUnified, t("placeholderSubItem"));
        body = {
          subject: subj,
          collection: coll,
          question: {
            id: qid,
            type: "group",
            material: newGroupMaterial.trim() || t("sharedMaterialDefault"),
            unified,
            items: groupItems,
          },
        };
      } else {
        body = {
          subject: subj,
          collection: coll,
          question: {
            id: qid,
            type: newType,
            content: "",
            options: isChoiceQuestionType(newType) ? { A: "", B: "", C: "", D: "" } : null,
            answer: "",
            analysis: "",
            metadata: {},
          },
        };
      }
      const r = await apiPost<{ ok: boolean; qualified_id: string }>("/api/bank/items", body);
      await loadList();
      setNewIdEdited(false);
      notifyContentLibraryChanged("question");
      openModalAfterCreateRef.current = true;
      setOpenTabs((prev) => (prev.includes(r.qualified_id) ? prev : [...prev, r.qualified_id]));
      clearSessionDraft();
      setSelectedId(r.qualified_id);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onError(e.message);
        return false;
      }
      // The server can finish creating a question after a slow response timed out.
      // Reconcile the intended ID before offering another create attempt.
      const qualifiedId = `${subj}/${coll}/${qid}`;
      let recovered = false;
      for (const delay of [0, 350, 1000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          await apiGet(`/api/bank/items/${encodeURIComponent(qualifiedId)}`);
          recovered = true;
          break;
        } catch { /* The request may still be committing on the server. */ }
      }
      if (recovered) {
        await loadList();
        setNewIdEdited(false);
        notifyContentLibraryChanged("question");
        openModalAfterCreateRef.current = true;
        setOpenTabs((prev) => (prev.includes(qualifiedId) ? prev : [...prev, qualifiedId]));
        clearSessionDraft();
        setSelectedId(qualifiedId);
        onError(null);
        return true;
      } else {
        onError(e instanceof Error ? e.message : String(e));
        return false;
      }
    } finally {
      setOpBusy(false);
    }
  }

  const doImport = useCallback(async (): Promise<boolean> => {
    return importYamlText();
  }, [importYamlText]);

  const doImportFromFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<boolean> => {
      return importFromFile(e);
    },
    [importFromFile]
  );

  async function doExportSelection() {
    if (busy) return;
    const currentItemIds = new Set(items.map((it) => it.qualified_id));
    const { valid, stale } = pruneStaleSelection(selectedExportIds, currentItemIds);

    if (stale.length > 0) {
      setSelectedExportIds(valid);
      if (valid.length === 0) {
        onError("所选题目已不存在或已失效，请重新选择");
        return;
      }
      onError(`部分已选题目（${stale.length} 道）已失效，已自动保留有效题目`);
    } else {
      onError(null);
    }

    if (valid.length === 0) {
      onError("请在左侧勾选需要导出的题目");
      return;
    }

    setOpBusy(true);
    try {
      const result = await apiPost<{ download_url: string; filename: string; question_count: number }>(
        "/api/bank/export-selection",
        {
          qualified_ids: valid,
          title: "我的题目导出",
        }
      );
      const blob = await downloadPlatformBlob(result.download_url);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpBusy(false);
    }
  }

  async function applyManageRename() {
    if (!manageEditId) {
      return;
    }
    const oldNs = manageEditId;
    const newSub = manageDraftSubject.trim();
    const newColl = manageDraftCollection.trim();
    if (!newSub || !newColl) {
      onError(t("manageNameEmpty"));
      return;
    }
    setOpBusy(true);
    onError(null);
    try {
      const r = await apiPost<{ ok: boolean; namespace: string }>("/api/bank/rename-collection", {
        namespace: oldNs,
        new_subject: newSub,
        new_collection: newColl,
      });
      const newNs = r.namespace;
      const prefix = `${oldNs}/`;
      const mapQid = (qid: string) => (qid.startsWith(prefix) ? `${newNs}/${qid.slice(prefix.length)}` : qid);
      const currentSelectedId = draftRef.current.selectedId;
      const nextSelectedId = currentSelectedId ? mapQid(currentSelectedId) : null;
      if (nextSelectedId !== currentSelectedId) {
        clearSessionDraft();
      }
      setSelectedId(nextSelectedId);
      setOpenTabs((tabs) => tabs.map(mapQid));
      if (filterCollection === oldNs) {
        setFilterCollection(newNs);
      }
      setManageEditId(null);
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpBusy(false);
    }
  }

  async function removeCollectionRow(namespace: string, label: string) {
    if (!(await confirmDialog(t("manageDeleteConfirm", { name: label })))) {
      return;
    }
    setOpBusy(true);
    onError(null);
    try {
      await apiPost("/api/bank/delete-collection", { namespace });
      const prefix = `${namespace}/`;
      setSelectedExportIds((prev) => prev.filter((id) => id !== namespace && !id.startsWith(prefix)));
      const currentSelectedId = draftRef.current.selectedId;
      const selectedWasDeleted = Boolean(
        currentSelectedId && (currentSelectedId.startsWith(prefix) || currentSelectedId === namespace)
      );
      if (selectedWasDeleted) {
        clearSessionDraft();
        setEditorModalOpen(false);
      }
      setSelectedId((current) =>
        current && (current.startsWith(prefix) || current === namespace) ? null : current
      );
      setOpenTabs((tabs) => tabs.filter((id) => id !== namespace && !id.startsWith(prefix)));
      if (filterCollection === namespace) {
        setFilterCollection("__all__");
      }
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpBusy(false);
    }
  }

  async function removeQuestion() {
    const currentDetail = draftRef.current.detail;
    const currentSelectedId = draftRef.current.selectedId;
    if (!currentDetail || !currentSelectedId || currentDetail.qualified_id !== currentSelectedId) {
      return;
    }
    const isGroup = Boolean(currentDetail.question_group);
    if (
      !(await confirmDialog(
        isGroup
          ? t("errors.deleteGroup", { id: currentDetail.question_group!.id })
          : t("errors.deleteQuestion", { id: currentSelectedId })
      ))
    ) {
      return;
    }
    setOpBusy(true);
    onError(null);
    try {
      const enc = encodeURIComponent(currentSelectedId);
      const sp = currentDetail.storage_path
        ? `?storage_path=${encodeURIComponent(currentDetail.storage_path)}`
        : "";
      await apiDelete(`/api/bank/items/${enc}${sp}`);
      const currentItem = items.find((x) => x.qualified_id === currentSelectedId);
      const removedIds = new Set([
        currentSelectedId,
        ...(currentItem?.group_member_qualified_ids ?? []),
      ]);
      setSelectedExportIds((prev) => prev.filter((id) => !removedIds.has(id)));
      setOpenTabs((prev) => prev.filter((x) => !removedIds.has(x)));
      removeBaseline(currentSelectedId);
      const liveSelectedId = draftRef.current.selectedId;
      const selectedWasDeleted = Boolean(liveSelectedId && removedIds.has(liveSelectedId));
      if (selectedWasDeleted) {
        clearSessionDraft();
        setEditorModalOpen(false);
      }
      setSelectedId((current) => (current && removedIds.has(current) ? null : current));
      setDetail((current) => (current && removedIds.has(current.qualified_id) ? null : current));
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpBusy(false);
    }
  }

  async function removeQuestionFromList(item: BankListItem) {
    setOpBusy(true);
    onError(null);
    try {
      const enc = encodeURIComponent(item.qualified_id);
      const sp = item.storage_path
        ? `?storage_path=${encodeURIComponent(item.storage_path)}`
        : "";
      await apiDelete(`/api/bank/items/${enc}${sp}`);
      const removedIds = new Set([
        item.qualified_id,
        ...(item.group_member_qualified_ids ?? []),
      ]);
      setSelectedExportIds((prev) => prev.filter((id) => !removedIds.has(id)));
      setOpenTabs((prev) => prev.filter((x) => !removedIds.has(x)));
      removeBaseline(item.qualified_id);
      const currentSelectedId = draftRef.current.selectedId;
      const selectedWasDeleted = Boolean(currentSelectedId && removedIds.has(currentSelectedId));
      if (selectedWasDeleted) {
        clearSessionDraft();
        setEditorModalOpen(false);
      }
      setSelectedId((current) => (current && removedIds.has(current) ? null : current));
      setDetail((current) => (current && removedIds.has(current.qualified_id) ? null : current));
      await loadList();
      setPendingDeleteItem(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpBusy(false);
    }
  }

  const trySelectId = useCallback(
    (qid: string | null) => {
      return trySelectQuestion(qid, t("switchTabDiscard"));
    },
    [trySelectQuestion, t]
  );

  const openOrFocusTab = useCallback(
    (qid: string): boolean => {
      if (!trySelectId(qid)) return false;
      setOpenTabs((prev) => (prev.includes(qid) ? prev : [...prev, qid]));
      setEditorModalOpen(false);
      return true;
    },
    [trySelectId]
  );

  const closeTab = useCallback(
    (qid: string) => {
      const closesSelected = qid === draftRef.current.selectedId;
      if (closesSelected && isCurrentDraftDirty() && !window.confirm(t("closeTabConfirm"))) {
        return;
      }
      setOpenTabs((prev) => {
        const next = prev.filter((x) => x !== qid);
        if (closesSelected) {
          const fallback = next[next.length - 1] ?? null;
          clearSessionDraft();
          setSelectedId(fallback);
        }
        return next;
      });
      removeBaseline(qid);
    },
    [draftRef, isCurrentDraftDirty, t, clearSessionDraft, setSelectedId, removeBaseline]
  );

  const saveFormRef = useRef(saveForm);
  saveFormRef.current = saveForm;
  const saveRawYamlRef = useRef(saveRawYaml);
  saveRawYamlRef.current = saveRawYaml;

  const saveModalEditor = useCallback(async (source: "form" | "yaml") => {
    const saved = await (source === "yaml" ? saveRawYamlRef.current() : saveFormRef.current());
    if (saved) {
      setEditorModalOpen(false);
      setMobileBankPanel("list");
    }
    return saved;
  }, []);

  const handleToolbarSave = useCallback(() => {
    if (editorModalOpen) {
      void saveModalEditor(editorTab === "yaml" ? "yaml" : "form");
    } else if (workView === "source") {
      void saveRawYamlRef.current();
    } else {
      void saveFormRef.current();
    }
  }, [workView, editorModalOpen, editorTab, saveModalEditor]);

  useEffect(() => {
    if (workView === "source") {
      setEditorTab("yaml");
    } else if (workView === "fields") {
      setEditorTab("form");
    }
  }, [workView, setEditorTab]);

  useEffect(() => {
    if (!active) return;
    const onSave = () => {
      if (!draftRef.current.selectedId || !getCurrentDraftDetail() || !isCurrentDraftDirty()) return;
      if (editorModalOpen) {
        void saveModalEditor(editorTab === "yaml" ? "yaml" : "form");
      } else if (workView === "source") {
        void saveRawYamlRef.current();
      } else {
        void saveFormRef.current();
      }
    };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, [active, draftRef, getCurrentDraftDetail, isCurrentDraftDirty, workView, editorModalOpen, editorTab, saveModalEditor]);

  const tabItems: TabItem[] = useMemo(
    () =>
      openTabs.map((id) => {
        const short = id.includes("/") ? id.split("/").pop() ?? id : id;
        return { id, label: short, dirty: id === selectedId && dirty, closable: true };
      }),
    [openTabs, selectedId, dirty]
  );

  const saveConflictBanner = saveConflict?.qid === selectedId && detail ? (
    <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-[var(--or-warning-container)] p-3.5 text-sm">
      <p className="font-medium text-[var(--or-on-warning)]">{t("saveConflict")}</p>
      <p className="mt-1 break-words text-[13px] text-[var(--or-on-warning)]">{saveConflict.message}</p>
      <button type="button" className="mt-2 text-sm font-semibold text-[var(--or-on-container)] underline" onClick={() => void viewLatestConflict()}>
        {t("viewLatest")}
      </button>
      {saveConflict.latest ? (
        <div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--or-warning)] bg-[var(--or-card)] p-3 font-mono text-[13px]">{saveConflict.latest.file_yaml}</pre>
          <button type="button" className="mt-2 text-sm font-semibold text-[var(--or-on-container)] underline" onClick={() => void loadLatestConflict(t("loadLatestConfirm"))}>
            {t("loadLatest")}
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <BankPageContextSync
        active={active}
        selectedId={selectedId}
        draftStore={draftStore}
        setPageContext={setPageContext}
      />
      <BankToolbar
        active={active}
        busy={busy}
        selectedExportIds={selectedExportIds}
        onExport={doExportSelection}
        subjects={subjects}
        items={items}
        filterSubject={filterSubject}
        setFilterSubject={setFilterSubject}
        setFilterCollection={setFilterCollection}
        filterType={filterType}
        setFilterType={setFilterType}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        metadataFilters={metadataFilters}
        setMetadataFilters={setMetadataFilters}
        metadataFilterDefinitions={metadataFilterDefinitions}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        commitSearch={commitSearch}
        bankFilterSummary={bankFilterSummary}
        importSubjectList={importSubjectList}
        newSubject={newSubject}
        setNewSubject={setNewSubject}
        newSubjectSelectValue={newSubjectSelectValue}
        newCollection={newCollection}
        newId={newId}
        setNewId={handleNewIdChange}
        newType={newType}
        setNewType={setNewType}
        newGroupUnified={newGroupUnified}
        setNewGroupUnified={setNewGroupUnified}
        newGroupMaterial={newGroupMaterial}
        setNewGroupMaterial={setNewGroupMaterial}
        onCreateQuestion={async () => {
          const created = await createQuestion();
          if (created) setMobileBankPanel("editor");
          return created;
        }}
        importSubject={importSubject}
        setImportSubject={setImportSubject}
        importSubjectSelectValue={importSubjectSelectValue}
        importSummaryHint={importSummaryHint}
        importYaml={importYaml}
        setImportYaml={setImportYaml}
        onImportFile={doImportFromFile}
        onImportYaml={doImport}
        importTransaction={importTransaction}
        onRetryRefreshOnly={retryRefreshOnly}
        selectedId={selectedId}
        hasDetail={Boolean(detail)}
        dirty={dirty}
        onSave={handleToolbarSave}
      />
      <div className="or-g48-bank-workspace" data-active-panel={mobileBankPanel}>
        <div
          ref={mobileBankPanelRef}
          className="or-g48-bank-panel-switcher"
          role="group"
          aria-label={t("mobilePanelLabel")}
        >
          <SelectionIndicator
            rootRef={mobileBankPanelRef}
            selector={'[data-state="active"]'}
            className="or-g48-bank-panel-indicator"
          />
          <button
            type="button"
            aria-pressed={mobileBankPanel === "list"}
            data-state={mobileBankPanel === "list" ? "active" : "inactive"}
            onClick={() => setMobileBankPanel("list")}
            className="or-g48-bank-panel-button"
          >
            {t("mobileViewList")}
          </button>
          <button
            type="button"
            aria-pressed={mobileBankPanel === "editor"}
            data-state={mobileBankPanel === "editor" ? "active" : "inactive"}
            onClick={() => setMobileBankPanel("editor")}
            className="or-g48-bank-panel-button"
          >
            {t("mobileViewEditor")}
          </button>
        </div>
        <div className={`or-g48-bank-list-panel${bankListCollapsed ? " is-collapsed" : ""}`}>
          <div ref={bankListInnerRef} className="or-g48-bank-list-inner">
            {/* 左：筛选 + 列表 + 导入 */}
            <BankSidebar
              folders={folders}
              setFolders={setFolders}
              filteredItems={filtered}
              allItems={items}
              selectedExportIds={selectedExportIds}
              onSelectExportIds={setSelectedExportIds}
              selectedId={selectedId}
              onOpenItem={(id) => {
                if (openOrFocusTab(id)) setMobileBankPanel("editor");
              }}
              onRefresh={loadList}
              onError={onError}
              busy={busy}
              loading={!hasLoaded || (loading && items.length === 0)}
              graphLinkIndex={graphLinkIndex}
              taggedItems={taggedItems}
              onOpenGraphNode={onOpenGraphNode}
              onRequestDelete={setPendingDeleteItem}
            />
          </div>
          <button
            type="button"
            className="or-sidebar-toggle or-g48-bank-collapse-btn hidden lg:inline-flex"
            aria-label={bankListCollapsed ? "展开题库列表" : "收起题库列表"}
            aria-expanded={!bankListCollapsed}
            title={bankListCollapsed ? "展开题库列表" : "收起题库列表"}
            onClick={() => setBankListCollapsed((prev) => !prev)}
          >
            {bankListCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* 中：多标签 + 字段 / 浏览 / 源文件 */}
        <div className="or-g48-bank-editor-panel">
        <section data-agent-target={selectedId ? "bank-question" : undefined} data-agent-resource-id={selectedId ?? undefined} tabIndex={selectedId ? -1 : undefined}
          className="flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] lg:border-r">
          {diagnostics.length > 0 && (
            <details className="shrink-0 border-b border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_90%,transparent)] px-4 py-2.5 text-sm text-[var(--or-on-warning)]">
              <summary className="cursor-pointer font-semibold">{t("fileIssues", { count: diagnostics.length })}</summary>
              <p className="mt-1 text-[13px] text-[var(--or-on-warning)]">{t("fileIssuesHelp")}</p>
              <ul className="mt-2 max-h-40 space-y-1.5 overflow-auto text-[13px]">
                {diagnostics.map((diagnostic, index) => {
                  const pathParts = diagnostic.storage_path.split(/[\\/]/).filter(Boolean);
                  const visibleName = pathParts[pathParts.length - 1] ?? "";
                  return (
                    <li key={`${diagnostic.storage_path}:${diagnostic.code}:${index}`} className="break-words">
                      <span className="font-semibold">{visibleName}</span>：{diagnostic.message}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          <TabPanel
            className="or-g48-tabpanel"
            tabs={tabItems}
            activeId={selectedId}
            onSelect={(id) => {
              if (trySelectId(id)) {
                setEditorModalOpen(false);
                setMobileBankPanel("editor");
              }
            }}
            onClose={closeTab}
            onCloseOthers={() => {
              if (!selectedId) return;
              const keep = selectedId;
              setOpenTabs([keep]);
              setSelectedId(keep);
            }}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 sm:p-4">
            {importTransaction.stage === "refresh_failed" && (
              <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-[var(--or-warning-container)] p-3.5 text-sm text-[var(--or-on-warning)]">
                <div>
                  <p className="font-semibold">导入已写入服务端，但刷新题目列表失败</p>
                  <p className="text-[13px] text-[var(--or-on-warning)] mt-1">
                    已写入 {importTransaction.result?.written ?? 0} 题至 {importTransaction.result?.namespace ?? ""}。题目已安全保存，无需重新导入。
                  </p>
                </div>
                <button
                  type="button"
                  className="or-button or-button-primary or-g48-pill-btn or-g48-pill-btn-primary px-3.5 py-1.5 text-sm"
                  onClick={() => void retryRefreshOnly()}
                >
                  仅重试刷新列表
                </button>
              </div>
            )}
            {!editorModalOpen ? saveConflictBanner : null}
            {selectedId ? (
              <div className="or-surface or-g48-card or-g48-tags mb-3 p-3">
                <ContentTags scope="bank" itemId={selectedId} onError={onError} onChange={refreshTags} />
              </div>
            ) : null}
            {!detail ? (
              <div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--or-outline)] bg-[var(--or-card)] p-6 text-center">
                <p className="text-sm font-medium text-[var(--or-muted)]">{t("selectLeft")}</p>
              </div>
            ) : editorModalOpen ? (
              <div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-6 text-center">
                <p className="text-sm font-medium text-[var(--or-muted)]">{t("editingInModal")}</p>
              </div>
            ) : (
              <>
                {graphLinkIndex[detail.qualified_id]?.length ? (
                  <div className="mb-3.5 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] px-3.5 py-2.5">
                    <p className="text-[13px] font-semibold text-[var(--or-on-container)]">{t("linkedNodes")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {graphLinkIndex[detail.qualified_id]!.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="or-button or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-on-container)] shadow-2xs border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] hover:bg-[var(--or-primary-container)] transition-colors"
                          onClick={() => onOpenGraphNode?.(n.id)}
                        >
                          {n.canonical_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <Tabs value={workView} onValueChange={(v) => setWorkView(v as "fields" | "preview" | "source")}>
                  <TabsList className="or-tabs or-g48-tabs mb-3.5 inline-flex rounded-full bg-[color-mix(in_srgb,var(--or-inset)_60%,transparent)] p-1 w-full max-w-sm">
                    <TabsTrigger value="fields" className="or-tab rounded-full flex-1 py-1.5 text-sm font-semibold data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-2xs">{t("workViewFields")}</TabsTrigger>
                    <TabsTrigger value="preview" className="or-tab rounded-full flex-1 py-1.5 text-sm font-semibold data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-2xs">{t("workViewPreview")}</TabsTrigger>
                    <TabsTrigger value="source" className="or-tab rounded-full flex-1 py-1.5 text-sm font-semibold data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-2xs">{t("workViewSource")}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="fields" className="mt-0">
                    <BankQuestionEditorPanel
                      embedded
                      panelMode="form"
                      detail={detail}
                      setDetail={setDetail}
                      existingItems={items}
                      draftStore={draftStore}
                      busy={busy}
                      editorTab="form"
                      setEditorTab={setEditorTab}
                      rawYaml={rawYaml}
                      setRawYaml={setRawYaml}
                      metaRows={metaRows}
                      setMetaRows={setMetaRows}
                      contentRef={contentRef}
                      answerRef={answerRef}
                      analysisRef={analysisRef}
                      materialGroupRef={materialGroupRef}
                      imageInputRef={imageInputRef}
                      beginMathEmbed={beginMathEmbed}
                      beginMermaidEmbed={beginMermaidEmbed}
                      beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                      beginImageEmbed={beginImageEmbed}
                      onImageFileSelected={onImageFileSelected}
                      onRemove={removeQuestion}
                      onSave={saveForm}
                      onSaveYaml={saveRawYaml}
                      removeLabel={detail.question_group ? t("removeGroup") : t("remove")}
                    />
                  </TabsContent>
                  <TabsContent value="preview" className="or-surface or-g48-card mt-0 p-5">
                    <BankQuestionPreview draftStore={draftStore} live={!editorModalOpen} />
                  </TabsContent>
                  <TabsContent value="source" className="mt-0">
                    <BankQuestionEditorPanel
                      embedded
                      panelMode="yaml"
                      detail={detail}
                      setDetail={setDetail}
                      existingItems={items}
                      draftStore={draftStore}
                      busy={busy}
                      editorTab="yaml"
                      setEditorTab={setEditorTab}
                      rawYaml={rawYaml}
                      setRawYaml={setRawYaml}
                      metaRows={metaRows}
                      setMetaRows={setMetaRows}
                      contentRef={contentRef}
                      answerRef={answerRef}
                      analysisRef={analysisRef}
                      materialGroupRef={materialGroupRef}
                      imageInputRef={imageInputRef}
                      beginMathEmbed={beginMathEmbed}
                      beginMermaidEmbed={beginMermaidEmbed}
                      beginPrimeBrushEmbed={beginPrimeBrushEmbed}
                      beginImageEmbed={beginImageEmbed}
                      onImageFileSelected={onImageFileSelected}
                      onRemove={removeQuestion}
                      onSave={saveForm}
                      onSaveYaml={saveRawYaml}
                      removeLabel={detail.question_group ? t("removeGroup") : t("remove")}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </section>
        </div>
      </div>

      {detail && editorModalOpen && (
        <div
          className="or-dialog-backdrop fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-xs p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setEditorModalOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            className="or-dialog or-g48-dialog w-full max-w-3xl max-h-[min(92vh,100%)] overflow-y-auto p-4"
            role="dialog"
            aria-modal="true"
          >
            {saveConflictBanner}
            <BankQuestionEditorPanel
              detail={detail}
              setDetail={setDetail}
              existingItems={items}
              draftStore={draftStore}
              busy={busy}
              editorTab={editorTab}
              setEditorTab={setEditorTab}
              rawYaml={rawYaml}
              setRawYaml={setRawYaml}
              metaRows={metaRows}
              setMetaRows={setMetaRows}
              contentRef={contentRef}
              answerRef={answerRef}
              analysisRef={analysisRef}
              materialGroupRef={materialGroupRef}
              imageInputRef={imageInputRef}
              beginMathEmbed={beginMathEmbed}
              beginMermaidEmbed={beginMermaidEmbed}
              beginPrimeBrushEmbed={beginPrimeBrushEmbed}
              beginImageEmbed={beginImageEmbed}
              onImageFileSelected={onImageFileSelected}
              onRemove={removeQuestion}
              onSave={() => saveModalEditor("form")}
              onSaveYaml={() => saveModalEditor("yaml")}
              onClose={() => setEditorModalOpen(false)}
              removeLabel={detail.question_group ? t("removeGroup") : t("remove")}
            />
          </div>
        </div>
      )}

      {bankManageOpen ? (
        <div
          className="or-dialog-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-manage-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setBankManageOpen(false);
              setManageEditId(null);
            }
          }}
        >
          <div
            className="or-dialog or-g48-dialog flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col p-5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--or-outline)] pb-3">
              <h2 id="bank-manage-title" className="text-base font-semibold text-[var(--or-text)]">
                {t("manageModalTitle")}
              </h2>
              <button
                type="button"
                className="or-button or-pill or-g48-pill-btn px-3 py-1 text-sm"
                onClick={() => {
                  setBankManageOpen(false);
                  setManageEditId(null);
                }}
              >
                {t("common:close")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pt-3">
              <p className="text-[13px] leading-relaxed text-[var(--or-muted)]">{t("manageModalHint")}</p>
              {collections.filter((c) => c.id !== "main").length === 0 ? (
                <p className="mt-4 text-center text-sm text-[var(--or-muted)]">{t("manageEmpty")}</p>
              ) : null}
              <ul className="mt-3 space-y-2">
                {collections
                  .filter((c) => c.id !== "main")
                  .map((c) => (
                    <li key={c.id} className="rounded-xl border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-3">
                      {manageEditId === c.id ? (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="text-sm font-medium text-[var(--or-muted)]">
                              {t("subject")}
                              <input
                                className="or-input or-g48-input mt-1 w-full bg-[var(--or-card)] py-1.5 text-sm"
                                value={manageDraftSubject}
                                onChange={(e) => setManageDraftSubject(e.target.value)}
                              />
                            </label>
                            <label className="text-sm font-medium text-[var(--or-muted)]">
                              {t("collectionName")}
                              <input
                                className="or-input or-g48-input mt-1 w-full bg-[var(--or-card)] py-1.5 text-sm"
                                value={manageDraftCollection}
                                onChange={(e) => setManageDraftCollection(e.target.value)}
                              />
                            </label>
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              className="or-button or-pill or-g48-pill-btn px-3.5 py-1.5 text-sm"
                              onClick={() => setManageEditId(null)}
                            >
                              {t("common:cancel")}
                            </button>
                            <button
                              type="button"
                              className="or-button or-button-primary or-g48-pill-btn or-g48-pill-btn-primary px-3.5 py-1.5 text-sm"
                              disabled={busy}
                              onClick={applyManageRename}
                            >
                              {t("manageSave")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-[var(--or-text)]">{c.label}</p>
                            <p className="text-[13px] text-[var(--or-muted)]">{c.id}</p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              className="or-button or-pill or-g48-pill-btn px-3 py-1 text-sm"
                              onClick={() => {
                                setManageEditId(c.id);
                                const parts = c.id.split("/");
                                if (parts.length >= 2) {
                                  setManageDraftSubject(parts[0]);
                                  setManageDraftCollection(parts.slice(1).join("/"));
                                } else {
                                  setManageDraftSubject(c.id);
                                  setManageDraftCollection("");
                                }
                              }}
                            >
                              {t("common:rename")}
                            </button>
                            <button
                              type="button"
                              className="or-button or-button-danger or-g48-pill-btn or-g48-pill-btn-danger px-3 py-1 text-sm"
                              onClick={() => removeCollectionRow(c.id, c.label)}
                            >
                              {t("common:delete")}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteItem ? (
        <div
          className="or-dialog-backdrop fixed inset-0 z-[110] flex items-center justify-center bg-black/45 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setPendingDeleteItem(null);
            }
          }}
        >
          <div className="or-dialog or-g48-dialog w-full max-w-sm p-5">
            <h2 id="confirm-delete-title" className="text-base font-semibold text-[var(--or-text)]">
              {t("deleteQuestionTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--or-muted)]">
              {t("deleteQuestionConfirm", { id: pendingDeleteItem.qualified_id })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="or-button or-pill or-g48-pill-btn px-3.5 py-1.5 text-sm font-medium"
                onClick={() => setPendingDeleteItem(null)}
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                className="or-button or-button-danger or-g48-pill-btn or-g48-pill-btn-danger bg-red-600 text-white hover:bg-red-700 px-3.5 py-1.5 text-sm font-medium disabled:opacity-50"
                disabled={busy}
                onClick={() => void removeQuestionFromList(pendingDeleteItem)}
              >
                {t("common:delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <MathInsertOverlay
        open={mathOpen}
        onClose={() => {
          setMathOpen(false);
          embedKindRef.current = null;
          embedSelectionRef.current = null;
        }}
        onConfirm={(snippet) => {
          const kind = embedKindRef.current;
          const selection = embedSelectionRef.current;
          embedKindRef.current = null;
          embedSelectionRef.current = null;
          if (kind) insertSnippet(snippet, kind, selection);
        }}
      />
      <PrimeBrushEditorModal
        open={primeBrushOpen}
        onClose={() => {
          setPrimeBrushOpen(false);
          embedKindRef.current = null;
          embedSelectionRef.current = null;
        }}
        onConfirm={(fencedBlock) => {
          const kind = embedKindRef.current;
          const selection = embedSelectionRef.current;
          embedKindRef.current = null;
          embedSelectionRef.current = null;
          if (kind) insertSnippet(fencedBlock, kind, selection);
        }}
      />
      <MermaidEditorModal
        open={mermaidOpen}
        onClose={() => {
          setMermaidOpen(false);
          embedKindRef.current = null;
          embedSelectionRef.current = null;
        }}
        onConfirm={(fencedBlock) => {
          const kind = embedKindRef.current;
          const selection = embedSelectionRef.current;
          embedKindRef.current = null;
          embedSelectionRef.current = null;
          if (kind) insertSnippet(fencedBlock, kind, selection);
        }}
      />
    </>
  );
}
