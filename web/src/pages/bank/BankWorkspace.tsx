import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import yaml from "js-yaml";
import { ApiError } from "../../api/errors";
import { loadSessionToken } from "../../platform/session";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostFormData,
  apiPut,
} from "../../api/client";
import {
  BankQuestionEditorPanel,
  type BankDetailState,
  type GroupMemberJson,
  type QuestionGroupJson,
  type QuestionJson,
} from "../../components/BankQuestionEditorPanel";
import type { EmbedKind } from "../../lib/bankEditorEmbedKinds";
import { ContentWithPrimeBrush } from "../../components/ContentWithPrimeBrush";
import { ContentTags } from '../../components/ContentTags';
import { MathInsertOverlay } from "../../components/MathInsertOverlay";
import { MermaidEditorModal } from "../../components/MermaidEditorModal";
import { PrimeBrushEditorModal } from "../../components/PrimeBrushEditorModal";
import { useAgentContext } from "../../contexts/AgentContext";
import { TabPanel, type TabItem } from "../../components/layout/TabPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import i18n from "../../i18n/i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import { localeCompareStrings } from "../../lib/locale";
import { SOLAIRE_SAVE_EVENT } from "../../lib/saveEvents";
import { notifyContentLibraryChanged } from "../../lib/contentEvents";
import { isImeCompositionActive } from "../../lib/ime";
import { downloadPlatformBlob, listTaggedItems, type ContentTag } from "../../platform/auth";
import { isChoiceQuestionType } from "../../lib/questionTypes";
import { defaultItemsForNewGroup, type BankListItem } from "./bankModel";
import { pruneStaleSelection } from "./bankOperationModel";
import { useBankList } from "./useBankList";
import { BankToolbar } from "./BankToolbar";
import { BankSidebar } from "./BankSidebar";
import { useBankImageUpload } from "./bankImageAdapter";

export function BankWorkspace({
  onError,
  onOpenGraphNode,
}: {
  onError: (s: string | null) => void;
  onOpenGraphNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation(["bank", "lib", "common"]);
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
    loadList,
    metadataFilterDefinitions,
    filtered,
    bankFilterSummary,
  } = useBankList({ onError });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const refreshTags = useCallback(() => { void listTaggedItems("bank").then(({ items }) => setTaggedItems(items)).catch(() => undefined); }, []);
  useEffect(() => refreshTags(), [refreshTags]);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  /** 已打开的题目标签（多窗口编辑） */
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  /** 中间工作区：字段编辑 / 浏览 / 源文件 */
  const [workView, setWorkView] = useState<"fields" | "preview" | "source">("fields");
  const [detail, setDetail] = useState<BankDetailState | null>(null);
  const [saveConflict, setSaveConflict] = useState<{ qid: string; latest: BankDetailState | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importYaml, setImportYaml] = useState("");
  const [importSubject, setImportSubject] = useState(() => i18n.t("bank:defaultSubject"));
  const [importTarget] = useState("默认");
  const openModalAfterCreateRef = useRef(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [bankManageOpen, setBankManageOpen] = useState(false);
  const [manageEditId, setManageEditId] = useState<string | null>(null);
  const [manageDraftSubject, setManageDraftSubject] = useState("");
  const [manageDraftCollection, setManageDraftCollection] = useState("");
  const [newSubject, setNewSubject] = useState(() => i18n.t("bank:defaultSubject"));
  const [newCollection] = useState("默认");
  const [newId, setNewId] = useState("new_question_001");
  const [newType, setNewType] = useState("single_choice");
  /** 新建题组：混编或同型 */
  const [newGroupUnified, setNewGroupUnified] = useState<string>("single_choice");
  const [newGroupMaterial, setNewGroupMaterial] = useState("");
  const [pendingDeleteItem, setPendingDeleteItem] = useState<BankListItem | null>(null);
  const [editorTab, setEditorTab] = useState<"form" | "yaml">("form");
  const [rawYaml, setRawYaml] = useState("");
  const [metaRows, setMetaRows] = useState<{ key: string; value: string }[]>([]);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const detailRequestSeqRef = useRef(0);
  useEffect(() => () => { detailRequestSeqRef.current++; }, []);
  const draftRef = useRef({ selectedId, detail, rawYaml, metaRows });
  draftRef.current = { selectedId, detail, rawYaml, metaRows };
  const saveInProgressRef = useRef(false);
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

  const { imageInputRef, beginImageEmbed, onImageFileSelected, insertSnippet } =
    useBankImageUpload({
      detail,
      setDetail,
      setBusy,
      onError,
      contentRef,
      answerRef,
      analysisRef,
      materialGroupRef,
    });

  const { setPageContext } = useAgentContext();
  const baselineRef = useRef<Record<string, { yaml: string; detailJson: string; metaRowsJson: string }>>({});

  useEffect(() => {
    if (selectedId && detail) {
      const raw =
        typeof detail.question?.content === "string" ? detail.question.content : detail.qualified_id;
      const preview = raw.replace(/\s+/g, " ").slice(0, 48);
      const suffix = preview
        ? ` — ${preview}${preview.length >= 48 ? "…" : ""}`
        : "";
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
    return () => setPageContext(null);
  }, [selectedId, detail, setPageContext, t]);

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
      const t = ug === false ? "single_choice" : typeof ug === "string" ? ug : "single_choice";
      detailState = {
        ...d,
        question: {
          id: `${d.question_group.id}__01`,
          type: t,
          content: "",
          answer: "",
          analysis: "",
          metadata: {},
          options: isChoiceQuestionType(t) ? { A: "", B: "", C: "", D: "" } : null,
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

  const detailMetaRows = useCallback((detailState: BankDetailState) => {
    const m = detailState.question.metadata ?? {};
    return Object.keys(m).length
      ? Object.entries(m).map(([k, v]) => ({ key: k, value: String(v) }))
      : [{ key: "", value: "" }];
  }, []);

  const setDetailBaseline = useCallback((qid: string, detailState: BankDetailState, rows: { key: string; value: string }[]) => {
    baselineRef.current[qid] = {
      yaml: detailState.file_yaml,
      detailJson: JSON.stringify(detailState),
      metaRowsJson: JSON.stringify(rows),
    };
  }, []);

  const loadDetail = useCallback(
    async (qid: string) => {
      const requestSeq = ++detailRequestSeqRef.current;
      const session = loadSessionToken();
      onError(null);
      const detailState = await fetchDetail(qid);
      if (requestSeq !== detailRequestSeqRef.current || selectedIdRef.current !== qid || session !== loadSessionToken()) {
        return;
      }
      const nextMetaRows = detailMetaRows(detailState);
      setDetail(detailState);
      setSaveConflict(null);
      setRawYaml(detailState.file_yaml);
      setMetaRows(nextMetaRows);
      setEditorTab("form");
      setDetailBaseline(qid, detailState, nextMetaRows);
    },
    [onError, fetchDetail, detailMetaRows, setDetailBaseline],
  );

  const reconcileSavedDetail = useCallback(
    async (
      qid: string,
      submittedDetailJson: string,
      submittedMetaRowsJson: string,
      submittedYaml: string,
      savedVersion?: string,
    ) => {
      const requestSeq = detailRequestSeqRef.current;
      const session = loadSessionToken();
      const detailState = await fetchDetail(qid);
      if (requestSeq !== detailRequestSeqRef.current || selectedIdRef.current !== qid || session !== loadSessionToken()) {
        return;
      }

      const nextMetaRows = detailMetaRows(detailState);
      setDetailBaseline(qid, detailState, nextMetaRows);

      const current = draftRef.current;
      const currentDetailBelongsToQuestion = current.detail?.qualified_id === qid;
      const formUnchanged =
        !currentDetailBelongsToQuestion ||
        (JSON.stringify(current.detail) === submittedDetailJson &&
          JSON.stringify(current.metaRows) === submittedMetaRowsJson);
      const yamlUnchanged =
        !currentDetailBelongsToQuestion || current.rawYaml === submittedYaml;

      if (formUnchanged) {
        setDetail(detailState);
        setMetaRows(nextMetaRows);
      } else if (savedVersion) {
        setDetail((previous) => previous?.qualified_id === qid ? { ...previous, version: savedVersion } : previous);
      }
      if (yamlUnchanged) {
        setRawYaml(detailState.file_yaml);
      }
      if (formUnchanged && yamlUnchanged) {
        setEditorTab("form");
      }
    },
    [fetchDetail, detailMetaRows, setDetailBaseline],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setRawYaml("");
      setMetaRows([]);
      setEditorModalOpen(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadDetail(selectedId);
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
  }, [selectedId, loadDetail, onError]);

  function buildQuestionFromForm(): QuestionJson {
    if (!detail) {
      throw new Error(t("bank:errors.noQuestion"));
    }
    const q = { ...detail.question };
    const meta: Record<string, unknown> = {};
    for (const row of metaRows) {
      if (row.key.trim()) {
        meta[row.key.trim()] = row.value;
      }
    }
    q.metadata = meta;
    if (isChoiceQuestionType(q.type)) {
      q.options = { ...(detail.question.options ?? { A: "", B: "", C: "", D: "" }) };
    } else {
      q.options = null;
    }
    return q;
  }

  function buildQuestionGroupFromForm(): QuestionGroupJson {
    if (!detail?.question_group) {
      throw new Error(t("bank:errors.noGroup"));
    }
    const g = detail.question_group;
    const unified = g.unified === false ? false : g.unified;
    const items = g.items.map((it) => {
      let options: Record<string, string> | undefined;
      const itemType =
        unified === false ? (it.type ?? "single_choice") : typeof unified === "string" ? unified : "single_choice";
      if (isChoiceQuestionType(itemType)) {
        options = { ...(it.options ?? { A: "", B: "", C: "", D: "" }) };
      }
      if (unified === false) {
        return {
          type: it.type ?? "single_choice",
          content: it.content,
          answer: it.answer,
          analysis: it.analysis ?? "",
          metadata: (it.metadata ?? {}) as Record<string, unknown>,
          ...(options ? { options } : {}),
        };
      }
      return {
        content: it.content,
        answer: it.answer,
        analysis: it.analysis ?? "",
        metadata: (it.metadata ?? {}) as Record<string, unknown>,
        ...(options ? { options } : {}),
      };
    });
    return {
      id: g.id,
      type: "group",
      material: g.material,
      unified,
      items,
    };
  }

  async function saveForm() {
    if (isImeCompositionActive()) return;
    if (!detail || detail.qualified_id !== selectedId) {
      return;
    }
    if (saveInProgressRef.current) return;
    const qid = detail.qualified_id;
    const scope = detailRequestSeqRef.current;
    const session = loadSessionToken();
    const isCurrent = () => selectedIdRef.current === qid && scope === detailRequestSeqRef.current && session === loadSessionToken();
    const submittedDetailJson = JSON.stringify(detail);
    const submittedMetaRowsJson = JSON.stringify(metaRows);
    const submittedYaml = rawYaml;
    saveInProgressRef.current = true;
    setBusy(true);
    onError(null);
    try {
      const enc = encodeURIComponent(qid);
      const body = detail.question_group ? buildQuestionGroupFromForm() : buildQuestionFromForm();
      const result = detail.version
        ? await apiPut<{ version?: string }>(`/api/bank/items/${enc}`, body, { "If-Match": detail.version })
        : await apiPut<{ version?: string }>(`/api/bank/items/${enc}`, body);
      if (!isCurrent()) return;
      await loadList();
      if (isCurrent()) {
        setSaveConflict(null);
        await reconcileSavedDetail(qid, submittedDetailJson, submittedMetaRowsJson, submittedYaml, result?.version);
      }
      notifyContentLibraryChanged("question");
    } catch (e) {
      if (isCurrent()) {
        if (e instanceof ApiError && e.status === 409) setSaveConflict({ qid, latest: null });
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      saveInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function saveRawYaml() {
    if (isImeCompositionActive()) return;
    if (!detail || detail.qualified_id !== selectedId) {
      return;
    }
    if (saveInProgressRef.current) return;
    const qid = detail.qualified_id;
    const scope = detailRequestSeqRef.current;
    const session = loadSessionToken();
    const isCurrent = () => selectedIdRef.current === qid && scope === detailRequestSeqRef.current && session === loadSessionToken();
    const submittedDetailJson = JSON.stringify(detail);
    const submittedMetaRowsJson = JSON.stringify(metaRows);
    const submittedYaml = rawYaml;
    saveInProgressRef.current = true;
    setBusy(true);
    onError(null);
    try {
      let savedVersion: string | undefined;
      {
        const parsed = yaml.load(rawYaml) as unknown;
        if (!parsed || typeof parsed !== "object") {
          throw new Error(t("bank:errors.yamlMustBeObject"));
        }
        const obj = parsed as Record<string, unknown>;
        if (String(obj.id ?? "") !== qid.split("/").at(-1)) {
          throw new Error("题目 ID 不可在 YAML 中修改；如需更名，请新建题目后迁移内容。");
        }
        const enc = encodeURIComponent(qid);
        const result = detail.version
          ? await apiPut<{ version?: string }>(`/api/bank/items/${enc}`, obj, { "If-Match": detail.version })
          : await apiPut<{ version?: string }>(`/api/bank/items/${enc}`, obj);
        savedVersion = result?.version;
      }
      if (!isCurrent()) return;
      await loadList();
      if (isCurrent()) {
        setSaveConflict(null);
        await reconcileSavedDetail(qid, submittedDetailJson, submittedMetaRowsJson, submittedYaml, savedVersion);
      }
      notifyContentLibraryChanged("question");
    } catch (e) {
      if (isCurrent()) {
        if (e instanceof ApiError && e.status === 409) setSaveConflict({ qid, latest: null });
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      saveInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function createQuestion() {
    setBusy(true);
    onError(null);
    const subj = newSubject.trim();
    const coll = newCollection.trim();
    const qid = newId.trim();
    try {
      let body: { subject: string; collection: string; question: QuestionJson | QuestionGroupJson };
      if (newType === "group") {
        const unified = newGroupUnified === "mixed" ? false : newGroupUnified;
        const items = defaultItemsForNewGroup(newGroupUnified, t("placeholderSubItem"));
        body = {
          subject: subj,
          collection: coll,
          question: {
            id: qid,
            type: "group",
            material: newGroupMaterial.trim() || t("sharedMaterialDefault"),
            unified,
            items,
          },
        };
      } else {
        body = {
          subject: subj,
          collection: coll,
          question: {
            id: qid,
            type: newType,
            content: t("latexStemPh"),
            options: isChoiceQuestionType(newType) ? { A: "", B: "", C: "", D: "" } : null,
            answer: "",
            analysis: "",
            metadata: {},
          },
        };
      }
      const r = await apiPost<{ ok: boolean; qualified_id: string }>("/api/bank/items", body);
      await loadList();
      notifyContentLibraryChanged("question");
      openModalAfterCreateRef.current = true;
      setOpenTabs((prev) => (prev.includes(r.qualified_id) ? prev : [...prev, r.qualified_id]));
      selectedIdRef.current = r.qualified_id;
      setDetail(null);
      setRawYaml("");
      setMetaRows([]);
      setSelectedId(r.qualified_id);
      return true;
    } catch (e) {
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
        openModalAfterCreateRef.current = true;
        setOpenTabs((prev) => (prev.includes(qualifiedId) ? prev : [...prev, qualifiedId]));
        selectedIdRef.current = qualifiedId;
        setDetail(null);
        setRawYaml("");
        setMetaRows([]);
        setSelectedId(qualifiedId);
        onError(null);
        return true;
      } else {
        onError(e instanceof Error ? e.message : String(e));
        return false;
      }
    } finally {
      setBusy(false);
    }
  }

  async function doImport(): Promise<boolean> {
    setBusy(true);
    onError(null);
    try {
      await apiPost("/api/bank/import", {
        yaml: importYaml,
        target_subject: importSubject.trim() || t("defaultTarget"),
        target_collection: importTarget.trim() || "imported",
      });
      setImportYaml("");
      await loadList();
      notifyContentLibraryChanged("question");
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function doImportFromFile(e: ChangeEvent<HTMLInputElement>): Promise<boolean> {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) {
      return false;
    }
    const name = f.name.toLowerCase();
    setBusy(true);
    onError(null);
    try {
      if (name.endsWith(".zip")) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("target_subject", importSubject.trim() || t("defaultTarget"));
        fd.append("target_collection", importTarget.trim() || "imported");
        const r = await apiPostFormData<{ written: number; warnings?: string[] }>("/api/bank/import-bundle", fd);
        if (r.warnings?.length) {
          window.alert(
            t("importWritten", { n: r.written, warnings: r.warnings.join("\n") }),
          );
        }
        await loadList();
        notifyContentLibraryChanged("question");
        return true;
      } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
        const text = await f.text();
        await apiPost("/api/bank/import", {
          yaml: text,
          target_subject: importSubject.trim() || t("defaultTarget"),
          target_collection: importTarget.trim() || "imported",
        });
        await loadList();
        notifyContentLibraryChanged("question");
        return true;
      } else {
        onError(t("errors.pickYamlZip"));
        return false;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

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

    setBusy(true);
    try {
      const result = await apiPost<{ download_url: string; filename: string; question_count: number }>("/api/bank/export-selection", {
        qualified_ids: valid,
        title: "我的题目导出",
      });
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
      setBusy(false);
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
    setBusy(true);
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
      const currentSelectedId = selectedIdRef.current;
      const nextSelectedId = currentSelectedId ? mapQid(currentSelectedId) : null;
      if (nextSelectedId !== currentSelectedId) {
        detailRequestSeqRef.current++;
        setDetail(null);
        setRawYaml("");
        setMetaRows([]);
      }
      selectedIdRef.current = nextSelectedId;
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
      setBusy(false);
    }
  }

  async function removeCollectionRow(namespace: string, label: string) {
    if (!(await confirmDialog(t("manageDeleteConfirm", { name: label })))) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiPost("/api/bank/delete-collection", { namespace });
      const prefix = `${namespace}/`;
      setSelectedExportIds((prev) => prev.filter((id) => id !== namespace && !id.startsWith(prefix)));
      const currentSelectedId = selectedIdRef.current;
      const selectedWasDeleted = Boolean(
        currentSelectedId && (currentSelectedId.startsWith(prefix) || currentSelectedId === namespace),
      );
      if (selectedWasDeleted) {
        selectedIdRef.current = null;
        detailRequestSeqRef.current++;
        setDetail(null);
        setRawYaml("");
        setMetaRows([]);
        setEditorModalOpen(false);
      }
      setSelectedId((current) =>
        current && (current.startsWith(prefix) || current === namespace) ? null : current,
      );
      setOpenTabs((tabs) => tabs.filter((id) => id !== namespace && !id.startsWith(prefix)));
      if (filterCollection === namespace) {
        setFilterCollection("__all__");
      }
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestion() {
    if (!detail || !selectedId) {
      return;
    }
    const isGroup = Boolean(detail.question_group);
    if (
      !(await confirmDialog(
        isGroup
          ? t("errors.deleteGroup", { id: detail.question_group!.id })
          : t("errors.deleteQuestion", { id: selectedId }),
      ))
    ) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const enc = encodeURIComponent(selectedId);
      const sp = detail.storage_path
        ? `?storage_path=${encodeURIComponent(detail.storage_path)}`
        : "";
      await apiDelete(`/api/bank/items/${enc}${sp}`);
      const currentItem = items.find((x) => x.qualified_id === selectedId);
      const removedIds = new Set([
        selectedId,
        ...(currentItem?.group_member_qualified_ids ?? []),
      ]);
      setSelectedExportIds((prev) => prev.filter((id) => !removedIds.has(id)));
      setOpenTabs((prev) => prev.filter((x) => !removedIds.has(x)));
      delete baselineRef.current[selectedId];
      const selectedWasDeleted = Boolean(selectedIdRef.current && removedIds.has(selectedIdRef.current));
      if (selectedWasDeleted) {
        selectedIdRef.current = null;
        detailRequestSeqRef.current++;
        setRawYaml("");
        setMetaRows([]);
        setEditorModalOpen(false);
      }
      setSelectedId((current) => (current && removedIds.has(current) ? null : current));
      setDetail((current) => (current && removedIds.has(current.qualified_id) ? null : current));
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestionFromList(item: BankListItem) {
    setBusy(true);
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
      delete baselineRef.current[item.qualified_id];
      const selectedWasDeleted = Boolean(selectedIdRef.current && removedIds.has(selectedIdRef.current));
      if (selectedWasDeleted) {
        selectedIdRef.current = null;
        detailRequestSeqRef.current++;
        setRawYaml("");
        setMetaRows([]);
        setEditorModalOpen(false);
      }
      setSelectedId((current) => (current && removedIds.has(current) ? null : current));
      setDetail((current) => (current && removedIds.has(current.qualified_id) ? null : current));
      await loadList();
      setPendingDeleteItem(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 已保存题目：服务端展开插图占位符；编辑未保存时回退到表单原文 */
  const previewQ = useMemo(() => {
    if (!detail) return null;
    return detail.question_display ?? detail.question ?? null;
  }, [detail]);

  const previewGroup = useMemo(() => {
    if (!detail?.question_group) return null;
    const g = detail.question_group;
    const p = detail.question_group_preview;
    if (!p) return g;
    return { ...g, material: p.material, items: p.items };
  }, [detail]);

  const dirty = useMemo(() => {
    if (!selectedId || !detail || detail.qualified_id !== selectedId) return false;
    const b = baselineRef.current[selectedId];
    if (!b) return false;
    const yamlDirty = rawYaml !== b.yaml;
    const formDirty = JSON.stringify(detail) !== b.detailJson;
    const metaRowsDirty = JSON.stringify(metaRows) !== b.metaRowsJson;
    return yamlDirty || formDirty || metaRowsDirty;
  }, [selectedId, detail, rawYaml, metaRows]);

  const translateRef = useRef(t);
  translateRef.current = t;
  const trySelectId = useCallback((qid: string | null) => {
    const currentSelectedId = selectedIdRef.current;
    const currentDraft = draftRef.current;
    if (qid === currentSelectedId) return true;

    const baseline = currentSelectedId ? baselineRef.current[currentSelectedId] : undefined;
    const currentDraftIsDirty = Boolean(
      currentSelectedId &&
      currentDraft.selectedId === currentSelectedId &&
      currentDraft.detail?.qualified_id === currentSelectedId &&
      baseline &&
      (currentDraft.rawYaml !== baseline.yaml ||
        JSON.stringify(currentDraft.detail) !== baseline.detailJson ||
        JSON.stringify(currentDraft.metaRows) !== baseline.metaRowsJson),
    );
    if (currentDraftIsDirty && !window.confirm(translateRef.current("switchTabDiscard"))) {
      return false;
    }
    detailRequestSeqRef.current++;
    selectedIdRef.current = qid;
    setDetail(null);
    setRawYaml("");
    setMetaRows([]);
    setSelectedId(qid);
    return true;
  }, []);

  const openOrFocusTab = useCallback(
    (qid: string) => {
      if (!trySelectId(qid)) return;
      setOpenTabs((prev) => (prev.includes(qid) ? prev : [...prev, qid]));
      setEditorModalOpen(false);
    },
    [trySelectId],
  );

  const closeTab = useCallback(
    (qid: string) => {
      if (qid === selectedId && dirty && !window.confirm(t("closeTabConfirm"))) {
        return;
      }
      setOpenTabs((prev) => {
        const next = prev.filter((x) => x !== qid);
        if (selectedId === qid) {
          const fallback = next[next.length - 1] ?? null;
          detailRequestSeqRef.current++;
          selectedIdRef.current = fallback;
          setDetail(null);
          setRawYaml("");
          setMetaRows([]);
          setSelectedId(fallback);
        }
        return next;
      });
      delete baselineRef.current[qid];
    },
    [selectedId, dirty, t],
  );

  const saveFormRef = useRef(saveForm);
  saveFormRef.current = saveForm;
  const saveRawYamlRef = useRef(saveRawYaml);
  saveRawYamlRef.current = saveRawYaml;

  const handleToolbarSave = useCallback(() => {
    if (workView === "source") {
      void saveRawYamlRef.current();
    } else {
      void saveFormRef.current();
    }
  }, [workView]);

  useEffect(() => {
    if (workView === "source") {
      setEditorTab("yaml");
    } else if (workView === "fields") {
      setEditorTab("form");
    }
  }, [workView]);

  useEffect(() => {
    const onSave = () => {
      if (!selectedId || !detail || !dirty) return;
      if (workView === "source") {
        void saveRawYamlRef.current();
      } else {
        void saveFormRef.current();
      }
    };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, [selectedId, detail, dirty, workView]);

  const tabItems: TabItem[] = useMemo(
    () =>
      openTabs.map((id) => {
        const short = id.includes("/") ? id.split("/").pop() ?? id : id;
        return { id, label: short, dirty: id === selectedId && dirty, closable: true };
      }),
    [openTabs, selectedId, dirty],
  );

  const previewBlock =
    !previewQ && !previewGroup ? (
      <p className="mt-4 text-sm text-slate-500">{t("previewEmpty")}</p>
    ) : previewGroup ? (
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-medium text-slate-500">{t("sharedMaterialLabel")}</p>
          <ContentWithPrimeBrush text={previewGroup.material} className="mt-1 text-slate-900" />
        </div>
        {previewGroup.items.map((it, i) => {
          const rowIsChoice =
            previewGroup.unified === false
              ? isChoiceQuestionType(it.type ?? "single_choice")
              : typeof previewGroup.unified === "string" && isChoiceQuestionType(previewGroup.unified);
          return (
            <div key={i} className="border-t border-slate-100 pt-3">
              <p className="text-[11px] font-medium text-slate-500">{t("subItemIndex", { n: i + 1 })}</p>
              <ContentWithPrimeBrush text={it.content} className="mt-1 text-slate-900" />
              {rowIsChoice && (
                <div>
                  <p className="text-[11px] font-medium text-slate-500">{t("options")}</p>
                  <ul className="mt-1 list-inside list-disc text-slate-700">
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
              <details>
                <summary className="cursor-pointer text-xs text-slate-600">{t("answer")}</summary>
                <ContentWithPrimeBrush text={it.answer} className="mt-1" />
              </details>
              <details>
                <summary className="cursor-pointer text-xs text-slate-600">{t("analysis")}</summary>
                <ContentWithPrimeBrush text={it.analysis || ""} className="mt-1" />
              </details>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-medium text-slate-500">{t("stem")}</p>
          <ContentWithPrimeBrush text={previewQ!.content} className="mt-1 text-slate-900" />
        </div>
        {isChoiceQuestionType(previewQ!.type) && previewQ!.options && (
          <div>
            <p className="text-[11px] font-medium text-slate-500">{t("options")}</p>
            <ul className="mt-1 list-inside list-disc text-slate-700">
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
        <details>
          <summary className="cursor-pointer text-xs text-slate-600">{t("answer")}</summary>
          <ContentWithPrimeBrush text={previewQ!.answer} className="mt-1" />
        </details>
        <details>
          <summary className="cursor-pointer text-xs text-slate-600">{t("analysis")}</summary>
          <ContentWithPrimeBrush text={previewQ!.analysis || ""} className="mt-1" />
        </details>
      </div>
    );

  return (
    <>
      <BankToolbar
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
        setNewId={setNewId}
        newType={newType}
        setNewType={setNewType}
        newGroupUnified={newGroupUnified}
        setNewGroupUnified={setNewGroupUnified}
        newGroupMaterial={newGroupMaterial}
        setNewGroupMaterial={setNewGroupMaterial}
        onCreateQuestion={createQuestion}
        importSubject={importSubject}
        setImportSubject={setImportSubject}
        importSubjectSelectValue={importSubjectSelectValue}
        importSummaryHint={importSummaryHint}
        importYaml={importYaml}
        setImportYaml={setImportYaml}
        onImportFile={doImportFromFile}
        onImportYaml={doImport}
        selectedId={selectedId}
        hasDetail={Boolean(detail)}
        dirty={dirty}
        onSave={handleToolbarSave}
      />
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* 左：筛选 + 列表 + 导入 */}
      <BankSidebar
        folders={folders}
        setFolders={setFolders}
        filteredItems={filtered}
        allItems={items}
        selectedExportIds={selectedExportIds}
        onSelectExportIds={setSelectedExportIds}
        selectedId={selectedId}
        onOpenItem={openOrFocusTab}
        onRefresh={loadList}
        onError={onError}
        busy={busy}
        graphLinkIndex={graphLinkIndex}
        taggedItems={taggedItems}
        onOpenGraphNode={onOpenGraphNode}
        onRequestDelete={setPendingDeleteItem}
      />

      {/* 中：多标签 + 字段 / 浏览 / 源文件 */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-slate-200 bg-slate-50 lg:border-r">
        {diagnostics.length > 0 && (
          <details className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <summary className="cursor-pointer font-medium">{t("fileIssues", { count: diagnostics.length })}</summary>
            <p className="mt-2 text-xs">{t("fileIssuesHelp")}</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.storage_path}:${diagnostic.code}:${index}`} className="break-words">
                  <span className="font-medium">{diagnostic.storage_path}</span>：{diagnostic.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        <TabPanel
          tabs={tabItems}
          activeId={selectedId}
          onSelect={(id) => {
            if (trySelectId(id)) {
              setEditorModalOpen(false);
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
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {saveConflict?.qid === selectedId && detail ? (
            <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>{t("saveConflict")}</p>
              <button type="button" className="mt-2 underline" onClick={async () => {
                const qid = detail.qualified_id;
                const sequence = ++detailRequestSeqRef.current;
                const session = loadSessionToken();
                try {
                  const latest = await fetchDetail(qid);
                  if (sequence === detailRequestSeqRef.current && selectedIdRef.current === qid && session === loadSessionToken()) {
                    setSaveConflict({ qid, latest });
                  }
                } catch (error) {
                  if (sequence === detailRequestSeqRef.current && session === loadSessionToken()) onError(error instanceof Error ? error.message : String(error));
                }
              }}>{t("viewLatest")}</button>
              {saveConflict.latest ? (
                <div>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{saveConflict.latest.file_yaml}</pre>
                  <button type="button" className="mt-2 underline" onClick={() => {
                    if (window.confirm(t("loadLatestConfirm"))) {
                      void loadDetail(detail.qualified_id).catch((error) => onError(error instanceof Error ? error.message : String(error)));
                    }
                  }}>{t("loadLatest")}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {selectedId ? <div className="mb-2 rounded border bg-white p-2 text-xs"><ContentTags scope="bank" itemId={selectedId} onError={onError} onChange={refreshTags} /></div> : null}
          {!detail ? (
            <p className="text-sm text-slate-500">{t("selectLeft")}</p>
          ) : editorModalOpen ? (
            <p className="text-sm text-slate-600">{t("editingInModal")}</p>
          ) : (
            <>
              {graphLinkIndex[detail.qualified_id]?.length ? (
                <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2">
                  <p className="text-[11px] font-medium text-sky-900">{t("linkedNodes")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {graphLinkIndex[detail.qualified_id]!.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-sky-800 shadow-sm ring-1 ring-sky-200 hover:bg-sky-100"
                        onClick={() => onOpenGraphNode?.(n.id)}
                      >
                        {n.canonical_name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <Tabs value={workView} onValueChange={(v) => setWorkView(v as "fields" | "preview" | "source")}>
                <TabsList className="mb-3 grid w-full max-w-md grid-cols-3">
                  <TabsTrigger value="fields">{t("workViewFields")}</TabsTrigger>
                  <TabsTrigger value="preview">{t("workViewPreview")}</TabsTrigger>
                  <TabsTrigger value="source">{t("workViewSource")}</TabsTrigger>
                </TabsList>
                <TabsContent value="fields" className="mt-0">
                  <BankQuestionEditorPanel
                    embedded
                    panelMode="form"
                    detail={detail}
                    setDetail={setDetail}
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
                <TabsContent value="preview" className="mt-0 rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("livePreview")}</h3>
                  {previewBlock}
                </TabsContent>
                <TabsContent value="source" className="mt-0">
                  <BankQuestionEditorPanel
                    embedded
                    panelMode="yaml"
                    detail={detail}
                    setDetail={setDetail}
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
    {detail && editorModalOpen && (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
        onClick={() => setEditorModalOpen(false)}
        role="presentation"
      >
        <div
          className="mt-4 w-full max-w-3xl max-h-[min(92vh,100%)] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <BankQuestionEditorPanel
            detail={detail}
            setDetail={setDetail}
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
            onSave={saveForm}
            onSaveYaml={saveRawYaml}
            onClose={() => setEditorModalOpen(false)}
            removeLabel={detail.question_group ? t("removeGroup") : t("remove")}
          />
        </div>
      </div>
    )}
    {bankManageOpen ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4"
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
          className="flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col rounded-lg border border-slate-200 bg-white shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 id="bank-manage-title" className="text-sm font-semibold text-slate-900">
              {t("manageModalTitle")}
            </h2>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              onClick={() => {
                setBankManageOpen(false);
                setManageEditId(null);
              }}
            >
              {t("common:close")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="text-xs leading-relaxed text-slate-500">{t("manageModalHint")}</p>
            {collections.filter((c) => c.id !== "main").length === 0 ? (
              <p className="mt-4 text-center text-sm text-slate-500">{t("manageEmpty")}</p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {collections
                .filter((c) => c.id !== "main")
                .map((c) => (
                  <li key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-2.5">
                    {manageEditId === c.id ? (
                      <div className="space-y-2">
                        <label className="block text-[11px] font-medium text-slate-600">
                          {t("manageSubjectField")}
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={manageDraftSubject}
                            onChange={(e) => setManageDraftSubject(e.target.value)}
                          />
                        </label>
                        <label className="block text-[11px] font-medium text-slate-600">
                          {t("manageCollectionField")}
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={manageDraftCollection}
                            onChange={(e) => setManageDraftCollection(e.target.value)}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void applyManageRename()}
                          >
                            {t("manageSave")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                            disabled={busy}
                            onClick={() => setManageEditId(null)}
                          >
                            {t("manageCancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800">{c.label}</p>
                          <p className="mt-0.5 break-all font-mono text-[10px] text-slate-500">{c.id}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => {
                              setManageEditId(c.id);
                              setManageDraftSubject(c.subject);
                              setManageDraftCollection(c.collection);
                            }}
                          >
                            {t("manageEdit")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void removeCollectionRow(c.id, c.label)}
                          >
                            {t("manageDelete")}
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
        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-delete-question-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) {
            setPendingDeleteItem(null);
          }
        }}
      >
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
          <h2 id="bank-delete-question-title" className="text-sm font-semibold text-slate-900">
            {t("deleteQuestionTitle")}
          </h2>
          <p className="mt-2 break-all text-sm leading-relaxed text-slate-600">
            {t("errors.deleteQuestion", { id: pendingDeleteItem.qualified_id })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => setPendingDeleteItem(null)}
            >
              {t("manageCancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={() => void removeQuestionFromList(pendingDeleteItem)}
            >
              {t("remove")}
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
        const k = embedKindRef.current;
        const sel = embedSelectionRef.current;
        embedKindRef.current = null;
        embedSelectionRef.current = null;
        if (k) insertSnippet(snippet, k, sel);
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
        const k = embedKindRef.current;
        const sel = embedSelectionRef.current;
        embedKindRef.current = null;
        embedSelectionRef.current = null;
        if (k) insertSnippet(fencedBlock, k, sel);
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
        const k = embedKindRef.current;
        const sel = embedSelectionRef.current;
        embedKindRef.current = null;
        embedSelectionRef.current = null;
        if (k) insertSnippet(fencedBlock, k, sel);
      }}
    />
    </>
  );
}
