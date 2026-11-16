import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { isImeCompositionActive } from "../../../lib/ime";
import { loadSessionToken } from "../../../platform/session";
import { ApiError } from "../../../api/errors";
import type {
  BankDetailState,
} from "../../../components/BankQuestionEditorPanel";
import { BankEditorDraftStore } from "../../../components/bankEditorDraftStore";
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

const DIRTY_RECHECK_DELAY_MS = 250;

function resolveSetStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (previous: T) => T)(current)
    : action;
}

export interface UseBankEditSessionOptions {
  onError: (msg: string | null) => void;
  fetchDetailApi: (qid: string) => Promise<BankDetailState>;
  putItemApi: (
    qid: string,
    payload: unknown,
    headers?: Record<string, string>
  ) => Promise<{ version?: string; qualified_id?: string }>;
  refreshListApi: () => Promise<void>;
  onQuestionRenamed?: (oldQid: string, newQid: string) => void;
  validateBeforeSave?: (detail: BankDetailState, source: BankEditorTab) => string | null;
}

export function useBankEditSession(options: UseBankEditSessionOptions) {
  const {
    onError,
    fetchDetailApi,
    putItemApi,
    refreshListApi,
    onQuestionRenamed,
    validateBeforeSave,
  } = options;

  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorTab, setEditorTab] = useState<BankEditorTab>("form");
  const [workView, setWorkView] = useState<BankWorkView>("fields");
  const [saveConflict, setSaveConflict] = useState<BankSaveConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const draftStoreRef = useRef<BankEditorDraftStore | null>(null);
  if (!draftStoreRef.current) draftStoreRef.current = new BankEditorDraftStore();
  const draftStore = draftStoreRef.current;
  const { detail, rawYaml, metaRows } = draftStore.getSnapshot();

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const baselinesRef = useRef<BankBaselines>({});
  const detailRequestSeqRef = useRef(0);
  const saveInProgressRef = useRef(false);
  const mountedRef = useRef(false);
  const dirtyTimerRef = useRef<number | null>(null);

  const draftRef = useRef({ selectedId, detail, rawYaml, metaRows });
  draftRef.current = { selectedId, ...draftStore.getSnapshot() };

  const cancelDirtyRefresh = useCallback(() => {
    if (dirtyTimerRef.current === null) return;
    window.clearTimeout(dirtyTimerRef.current);
    dirtyTimerRef.current = null;
  }, []);

  const isCurrentDraftDirty = useCallback(() => {
    const current = draftStore.getSnapshot();
    return isSessionDirty(
      selectedIdRef.current,
      current.detail,
      current.rawYaml,
      current.metaRows,
      baselinesRef.current,
    );
  }, [draftStore]);

  const refreshDirtyNow = useCallback(() => {
    cancelDirtyRefresh();
    const next = isCurrentDraftDirty();
    if (mountedRef.current) setDirty(next);
    return next;
  }, [cancelDirtyRefresh, isCurrentDraftDirty]);

  const scheduleDirtyRefresh = useCallback(() => {
    setDirty(true);
    cancelDirtyRefresh();
    dirtyTimerRef.current = window.setTimeout(() => {
      dirtyTimerRef.current = null;
      if (mountedRef.current) refreshDirtyNow();
    }, DIRTY_RECHECK_DELAY_MS);
  }, [cancelDirtyRefresh, refreshDirtyNow]);

  const setSelectedId = useCallback((action: SetStateAction<string | null>) => {
    const next = resolveSetStateAction(action, selectedIdRef.current);
    selectedIdRef.current = next;
    draftRef.current = { ...draftRef.current, selectedId: next };
    setSelectedIdState(next);
  }, []);

  const setDetail = useCallback((action: SetStateAction<BankDetailState | null>) => {
    const current = draftStore.getSnapshot().detail;
    const next = resolveSetStateAction(action, current);
    if (Object.is(current, next)) return;
    draftRef.current = { ...draftRef.current, detail: next };
    draftStore.setDetail(next);
    scheduleDirtyRefresh();
  }, [draftStore, scheduleDirtyRefresh]);

  const setRawYaml = useCallback((action: SetStateAction<string>) => {
    const current = draftStore.getSnapshot().rawYaml;
    const next = resolveSetStateAction(action, current);
    if (Object.is(current, next)) return;
    draftRef.current = { ...draftRef.current, rawYaml: next };
    draftStore.setRawYaml(next);
    scheduleDirtyRefresh();
  }, [draftStore, scheduleDirtyRefresh]);

  const setMetaRows = useCallback((action: SetStateAction<MetaRow[]>) => {
    const current = draftStore.getSnapshot().metaRows;
    const next = resolveSetStateAction(action, current);
    if (Object.is(current, next)) return;
    draftRef.current = { ...draftRef.current, metaRows: next };
    draftStore.setMetaRows(next);
    scheduleDirtyRefresh();
  }, [draftStore, scheduleDirtyRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detailRequestSeqRef.current++;
      cancelDirtyRefresh();
    };
  }, [cancelDirtyRefresh]);

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
    setSelectedId(null);
    setDetail(null);
    setRawYaml("");
    setMetaRows([]);
    setSaveConflict(null);
    refreshDirtyNow();
  }, [refreshDirtyNow, setDetail, setMetaRows, setRawYaml, setSelectedId]);

  const trySelectQuestion = useCallback(
    (nextQid: string | null, confirmDiscardText: string): boolean => {
      const currentSelectedId = selectedIdRef.current;
      if (nextQid === currentSelectedId) {
        return true;
      }
      if (isCurrentDraftDirty() && !window.confirm(confirmDiscardText)) {
        return false;
      }

      detailRequestSeqRef.current++;
      setDetail(null);
      setRawYaml("");
      setMetaRows([]);
      setSaveConflict(null);
      setSelectedId(nextQid);
      refreshDirtyNow();
      return true;
    },
    [isCurrentDraftDirty, refreshDirtyNow, setDetail, setMetaRows, setRawYaml, setSelectedId]
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
        refreshDirtyNow();
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
    [fetchDetailApi, onError, refreshDirtyNow, setDetail, setMetaRows, setRawYaml, setDetailBaseline]
  );

  const saveActiveEditor = useCallback(async (source: BankEditorTab): Promise<boolean> => {
    if (!mountedRef.current || isImeCompositionActive()) {
      return false;
    }
    const submittedDraft = draftStore.getSnapshot();
    const currentDetail = submittedDraft.detail;
    if (!currentDetail || currentDetail.qualified_id !== selectedIdRef.current) {
      return false;
    }
    if (saveInProgressRef.current) {
      return false;
    }
    if (!isSessionDirty(
      selectedIdRef.current,
      currentDetail,
      submittedDraft.rawYaml,
      submittedDraft.metaRows,
      baselinesRef.current,
    )) {
      refreshDirtyNow();
      return false;
    }

    const qid = currentDetail.qualified_id;
    const precheckError = validateBeforeSave?.(currentDetail, source);
    if (precheckError) {
      onError(precheckError);
      return false;
    }
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
    const submittedMetaRowsJson = JSON.stringify(submittedDraft.metaRows);
    const submittedYaml = submittedDraft.rawYaml;

    saveInProgressRef.current = true;
    setSaving(true);
    onError(null);

    let committed = false;
    let saveResult: { version?: string; qualified_id?: string } | undefined;
    let savedQid = qid;
    let renamed = false;
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
        ? validateAndParseYamlPayload(submittedDraft.rawYaml, qid)
        : buildSavePayload(currentDetail, submittedDraft.metaRows);
      const headers = currentDetail.version ? { "If-Match": currentDetail.version } : undefined;
      saveResult = await putItemApi(qid, body, headers);
      committed = true;
      savedQid = saveResult?.qualified_id?.trim() || qid;
      renamed = savedQid !== qid;

      if (!isCurrent()) {
        if (renamed) {
          removeBaseline(qid);
          onQuestionRenamed?.(qid, savedQid);
        }
        await refreshCommittedQuestion();
        return false;
      }

      setSaveConflict(null);
      let serverDetail: BankDetailState;
      try {
        serverDetail = await fetchDetailApi(savedQid);
      } catch (readErr) {
        if (isCurrent()) {
          if (renamed) {
            removeBaseline(qid);
            onQuestionRenamed?.(qid, savedQid);
            setSelectedId(savedQid);
          }
          if (saveResult.version || renamed) {
            setDetail((current) =>
              current?.qualified_id === qid || current?.qualified_id === savedQid
                ? {
                    ...current,
                    qualified_id: savedQid,
                    ...(saveResult!.version ? { version: saveResult!.version } : {}),
                  }
                : current
            );
          }
        } else if (renamed) {
          removeBaseline(qid);
          onQuestionRenamed?.(qid, savedQid);
        }
        await refreshCommittedQuestion();
        if (isCurrent()) {
          const message = readErr instanceof Error ? readErr.message : String(readErr);
          onError(`题目已保存，但无法读取保存后的规范化内容：${message}`);
        }
        return true;
      }
      if (!isCurrent()) {
        if (renamed) {
          removeBaseline(qid);
          onQuestionRenamed?.(qid, savedQid);
        }
        await refreshCommittedQuestion();
        return false;
      }

      const reconciled = reconcileSavedDetail({
        qid: savedQid,
        previousQid: qid,
        serverDetail,
        currentDetail: draftRef.current.detail,
        currentMetaRows: draftRef.current.metaRows,
        currentRawYaml: draftRef.current.rawYaml,
        submittedDetailJson,
        submittedMetaRowsJson,
        submittedYaml,
        savedVersion: saveResult?.version,
      });

      if (renamed) {
        removeBaseline(qid);
      }
      setDetailBaseline(savedQid, serverDetail, computeDetailMetaRows(serverDetail));
      setDetail(reconciled.nextDetail);
      setMetaRows(reconciled.nextMetaRows);
      setRawYaml(reconciled.nextRawYaml);
      if (renamed) {
        onQuestionRenamed?.(qid, savedQid);
        setSelectedId(savedQid);
      }
      if (reconciled.nextEditorTab) {
        setEditorTab(reconciled.nextEditorTab);
      }
      refreshDirtyNow();

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
        if (isCurrent()) {
          if (renamed) {
            removeBaseline(qid);
            onQuestionRenamed?.(qid, savedQid);
            setSelectedId(savedQid);
          }
          if (saveResult?.version || renamed) {
            setDetail((current) =>
              current?.qualified_id === qid || current?.qualified_id === savedQid
                ? {
                    ...current,
                    qualified_id: savedQid,
                    ...(saveResult!.version ? { version: saveResult!.version } : {}),
                  }
                : current
            );
          }
        } else if (renamed) {
          removeBaseline(qid);
          onQuestionRenamed?.(qid, savedQid);
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
          const isDuplicateIdConflict =
            e.message.includes("题号") || e.message.includes("题目已存在");
          if (isDuplicateIdConflict) {
            setSaveConflict(null);
          } else {
            setSaveConflict({ qid, latest: null, message: e.message });
          }
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
    draftStore,
    putItemApi,
    refreshListApi,
    fetchDetailApi,
    onError,
    setDetailBaseline,
    removeBaseline,
    onQuestionRenamed,
    setSelectedId,
    refreshDirtyNow,
    setDetail,
    setMetaRows,
    setRawYaml,
  ]);

  const saveForm = useCallback(() => saveActiveEditor("form"), [saveActiveEditor]);

  const saveRawYaml = useCallback(() => saveActiveEditor("yaml"), [saveActiveEditor]);

  const viewLatestConflict = useCallback(async () => {
    const currentDetail = draftStore.getSnapshot().detail;
    if (!currentDetail) return;
    const qid = currentDetail.qualified_id;
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
  }, [draftStore, fetchDetailApi, onError]);

  const loadLatestConflict = useCallback(
    async (confirmText: string) => {
      const currentDetail = draftStore.getSnapshot().detail;
      if (!currentDetail) return;
      if (!window.confirm(confirmText)) return;
      await loadQuestionDetail(currentDetail.qualified_id);
    },
    [draftStore, loadQuestionDetail]
  );

  return {
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
