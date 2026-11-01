import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isImeCompositionActive } from "../../../lib/ime";
import { loadSessionToken } from "../../../platform/session";
import { ApiError } from "../../../api/errors";
import type {
  BankDetailState,
} from "../../../components/BankQuestionEditorPanel";
import type {
  BankBaselines,
  BankEditorTab,
  BankSaveConflict,
  BankWorkView,
  MetaRow,
} from "./types";
import {
  buildSavePayload,
  checkStaleRequestFencing,
  computeDetailMetaRows,
  createBaselineRecord,
  isSessionDirty,
  reconcileSavedDetail,
  validateAndParseYamlPayload,
} from "./bankEditSessionCore";

export interface UseBankEditSessionOptions {
  onError: (msg: string | null) => void;
  fetchDetailApi: (qid: string) => Promise<BankDetailState>;
  putItemApi: (
    qid: string,
    payload: unknown,
    headers?: Record<string, string>
  ) => Promise<{ version?: string }>;
  refreshListApi: () => Promise<void>;
}

export function useBankEditSession(options: UseBankEditSessionOptions) {
  const {
    onError,
    fetchDetailApi,
    putItemApi,
    refreshListApi,
  } = options;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BankDetailState | null>(null);
  const [rawYaml, setRawYaml] = useState("");
  const [metaRows, setMetaRows] = useState<MetaRow[]>([]);
  const [editorTab, setEditorTab] = useState<BankEditorTab>("form");
  const [workView, setWorkView] = useState<BankWorkView>("fields");
  const [saveConflict, setSaveConflict] = useState<BankSaveConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const baselinesRef = useRef<BankBaselines>({});
  const detailRequestSeqRef = useRef(0);
  const saveInProgressRef = useRef(false);
  const mountedRef = useRef(false);

  const draftRef = useRef({ selectedId, detail, rawYaml, metaRows });
  draftRef.current = { selectedId, detail, rawYaml, metaRows };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detailRequestSeqRef.current++;
    };
  }, []);

  // Compute dirty flag based on baseline
  const dirty = useMemo(() => {
    return isSessionDirty(selectedId, detail, rawYaml, metaRows, baselinesRef.current);
  }, [selectedId, detail, rawYaml, metaRows]);

  const setDetailBaseline = useCallback(
    (qid: string, detailState: BankDetailState, rows: MetaRow[]) => {
      baselinesRef.current[qid] = createBaselineRecord(detailState, rows);
    },
    []
  );

  const removeBaseline = useCallback((qid: string) => {
    delete baselinesRef.current[qid];
  }, []);

  const clearSessionDraft = useCallback(() => {
    detailRequestSeqRef.current++;
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setRawYaml("");
    setMetaRows([]);
    setSaveConflict(null);
  }, []);

  const trySelectQuestion = useCallback(
    (nextQid: string | null, confirmDiscardText: string): boolean => {
      const currentSelectedId = selectedIdRef.current;
      const currentDraft = draftRef.current;
      if (nextQid === currentSelectedId) {
        return true;
      }

      const baseline = currentSelectedId ? baselinesRef.current[currentSelectedId] : undefined;
      const currentDraftIsDirty = Boolean(
        currentSelectedId &&
          currentDraft.selectedId === currentSelectedId &&
          currentDraft.detail?.qualified_id === currentSelectedId &&
          baseline &&
          (currentDraft.rawYaml !== baseline.yaml ||
            JSON.stringify(currentDraft.detail) !== baseline.detailJson ||
            JSON.stringify(currentDraft.metaRows) !== baseline.metaRowsJson)
      );

      if (currentDraftIsDirty && !window.confirm(confirmDiscardText)) {
        return false;
      }

      detailRequestSeqRef.current++;
      selectedIdRef.current = nextQid;
      setDetail(null);
      setRawYaml("");
      setMetaRows([]);
      setSaveConflict(null);
      setSelectedId(nextQid);
      return true;
    },
    []
  );

  const loadQuestionDetail = useCallback(
    async (qid: string) => {
      const requestSeq = ++detailRequestSeqRef.current;
      const session = loadSessionToken();
      onError(null);
      setLoadingDetail(true);

      try {
        const detailState = await fetchDetailApi(qid);
        const isCurrent = checkStaleRequestFencing({
          requestSeq,
          currentSeq: detailRequestSeqRef.current,
          requestQid: qid,
          currentQid: selectedIdRef.current,
          requestSessionToken: session,
          currentSessionToken: loadSessionToken(),
        });
        if (!isCurrent) {
          return;
        }

        const nextMetaRows = computeDetailMetaRows(detailState);
        setDetail(detailState);
        setSaveConflict(null);
        setRawYaml(detailState.file_yaml);
        setMetaRows(nextMetaRows);
        setEditorTab("form");
        setDetailBaseline(qid, detailState, nextMetaRows);
      } catch (err) {
        const isCurrent = checkStaleRequestFencing({
          requestSeq,
          currentSeq: detailRequestSeqRef.current,
          requestQid: qid,
          currentQid: selectedIdRef.current,
          requestSessionToken: session,
          currentSessionToken: loadSessionToken(),
        });
        if (isCurrent) {
          onError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === detailRequestSeqRef.current) {
          setLoadingDetail(false);
        }
      }
    },
    [fetchDetailApi, onError, setDetailBaseline]
  );

  const saveActiveEditor = useCallback(async (source: BankEditorTab): Promise<boolean> => {
    if (!mountedRef.current || isImeCompositionActive()) {
      return false;
    }
    const currentDetail = detail;
    if (!currentDetail || currentDetail.qualified_id !== selectedIdRef.current) {
      return false;
    }
    if (saveInProgressRef.current) {
      return false;
    }

    const qid = currentDetail.qualified_id;
    const requestSeq = detailRequestSeqRef.current;
    const session = loadSessionToken();
    const isCurrent = () =>
      mountedRef.current && checkStaleRequestFencing({
        requestSeq,
        currentSeq: detailRequestSeqRef.current,
        requestQid: qid,
        currentQid: selectedIdRef.current,
        requestSessionToken: session,
        currentSessionToken: loadSessionToken(),
      });

    const submittedDetailJson = JSON.stringify(currentDetail);
    const submittedMetaRowsJson = JSON.stringify(metaRows);
    const submittedYaml = rawYaml;

    saveInProgressRef.current = true;
    setSaving(true);
    onError(null);

    let committed = false;
    let saveResult: { version?: string } | undefined;
    const refreshCommittedQuestion = async () => {
      if (!mountedRef.current || session !== loadSessionToken()) {
        return;
      }
      try {
        await refreshListApi();
      } catch (refreshErr) {
        if (isCurrent()) {
          const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          onError(`题目已保存，但题库列表刷新失败：${message}`);
        }
      }
    };

    try {
      const body = source === "yaml"
        ? validateAndParseYamlPayload(rawYaml, qid)
        : buildSavePayload(currentDetail, metaRows);
      const headers = currentDetail.version ? { "If-Match": currentDetail.version } : undefined;
      saveResult = await putItemApi(qid, body, headers);
      committed = true;

      if (!isCurrent()) {
        await refreshCommittedQuestion();
        return false;
      }

      setSaveConflict(null);
      let serverDetail: BankDetailState;
      try {
        serverDetail = await fetchDetailApi(qid);
      } catch (readErr) {
        if (isCurrent() && saveResult.version) {
          setDetail((current) =>
            current?.qualified_id === qid ? { ...current, version: saveResult!.version } : current
          );
        }
        await refreshCommittedQuestion();
        if (isCurrent()) {
          const message = readErr instanceof Error ? readErr.message : String(readErr);
          onError(`题目已保存，但无法读取保存后的规范化内容：${message}`);
        }
        return true;
      }
      if (!isCurrent()) {
        await refreshCommittedQuestion();
        return false;
      }

      const reconciled = reconcileSavedDetail({
        qid,
        serverDetail,
        currentDetail: draftRef.current.detail,
        currentMetaRows: draftRef.current.metaRows,
        currentRawYaml: draftRef.current.rawYaml,
        submittedDetailJson,
        submittedMetaRowsJson,
        submittedYaml,
        savedVersion: saveResult?.version,
      });

      setDetailBaseline(qid, serverDetail, computeDetailMetaRows(serverDetail));
      setDetail(reconciled.nextDetail);
      setMetaRows(reconciled.nextMetaRows);
      setRawYaml(reconciled.nextRawYaml);
      if (reconciled.nextEditorTab) {
        setEditorTab(reconciled.nextEditorTab);
      }

      try {
        await refreshListApi();
      } catch (refreshErr) {
        if (isCurrent()) {
          const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          onError(`题目已保存，但题库列表刷新失败：${message}`);
        }
      }
      return true;
    } catch (e) {
      if (committed) {
        if (isCurrent() && saveResult?.version) {
          setDetail((current) =>
            current?.qualified_id === qid ? { ...current, version: saveResult!.version } : current
          );
        }
        await refreshCommittedQuestion();
        if (isCurrent()) {
          const message = e instanceof Error ? e.message : String(e);
          onError(`题目已保存，但无法读取保存后的规范化内容：${message}`);
        }
        return true;
      }
      if (isCurrent()) {
        if (e instanceof ApiError && e.status === 409) {
          setSaveConflict({ qid, latest: null, message: e.message });
        }
        onError(e instanceof Error ? e.message : String(e));
      }
      return false;
    } finally {
      saveInProgressRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, [
    detail,
    metaRows,
    rawYaml,
    putItemApi,
    refreshListApi,
    fetchDetailApi,
    onError,
    setDetailBaseline,
  ]);

  const saveForm = useCallback(() => saveActiveEditor("form"), [saveActiveEditor]);

  const saveRawYaml = useCallback(() => saveActiveEditor("yaml"), [saveActiveEditor]);

  const viewLatestConflict = useCallback(async () => {
    if (!detail) return;
    const qid = detail.qualified_id;
    const requestSeq = ++detailRequestSeqRef.current;
    const session = loadSessionToken();

    try {
      const latest = await fetchDetailApi(qid);
      if (
        checkStaleRequestFencing({
          requestSeq,
          currentSeq: detailRequestSeqRef.current,
          requestQid: qid,
          currentQid: selectedIdRef.current,
          requestSessionToken: session,
          currentSessionToken: loadSessionToken(),
        })
      ) {
        setSaveConflict((current) => current?.qid === qid ? { ...current, latest } : current);
      }
    } catch (err) {
      if (
        checkStaleRequestFencing({
          requestSeq,
          currentSeq: detailRequestSeqRef.current,
          requestQid: qid,
          currentQid: selectedIdRef.current,
          requestSessionToken: session,
          currentSessionToken: loadSessionToken(),
        })
      ) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [detail, fetchDetailApi, onError]);

  const loadLatestConflict = useCallback(
    async (confirmText: string) => {
      if (!detail) return;
      if (!window.confirm(confirmText)) return;
      await loadQuestionDetail(detail.qualified_id);
    },
    [detail, loadQuestionDetail]
  );

  return {
    selectedId,
    setSelectedId,
    detail,
    setDetail,
    rawYaml,
    setRawYaml,
    metaRows,
    setMetaRows,
    editorTab,
    setEditorTab,
    workView,
    setWorkView,
    dirty,
    saving,
    loadingDetail,
    saveConflict,
    setSaveConflict,
    trySelectQuestion,
    loadQuestionDetail,
    saveForm,
    saveRawYaml,
    viewLatestConflict,
    loadLatestConflict,
    clearSessionDraft,
    removeBaseline,
    setDetailBaseline,
    draftRef,
  };
}
