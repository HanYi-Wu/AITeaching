import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../../api/client";

export type AnalysisFolder = { id: string; name: string };
export type AnalysisFolderState = {
  version: 1;
  folders: AnalysisFolder[];
  items: Record<string, string>;
};

type AnalysisFolderMutation =
  | { action: "create"; name: string }
  | { action: "rename"; folder_id: string; name: string }
  | { action: "delete"; folder_id: string }
  | { action: "assign"; folder_id: string | null; ids: string[] };

type ScopedState = { scopeKey: string; value: AnalysisFolderState };
type ScopedStatus = { scopeKey: string; loading: boolean; busy: boolean; error: string | null };
type MutationToken = { scopeKey: string; requestId: number };

const EMPTY_STATE: AnalysisFolderState = { version: 1, folders: [], items: {} };
const EMPTY_STATUS = { loading: false, busy: false, error: null } as const;

function normalizeState(result: AnalysisFolderState): AnalysisFolderState {
  return {
    version: 1,
    folders: Array.isArray(result.folders) ? result.folders : [],
    items: result.items && typeof result.items === "object" ? result.items : {},
  };
}

export function useAnalysisFolders(scopeKey: string, enabled: boolean) {
  const [storedState, setStoredState] = useState<ScopedState>(() => ({ scopeKey, value: EMPTY_STATE }));
  const [storedStatus, setStoredStatus] = useState<ScopedStatus>(() => ({ scopeKey, ...EMPTY_STATUS }));
  const requestIdRef = useRef(0);
  const scopeKeyRef = useRef(scopeKey);
  const mountedRef = useRef(false);
  const mutationInFlightRef = useRef<MutationToken | null>(null);
  scopeKeyRef.current = scopeKey;
  if (mutationInFlightRef.current && mutationInFlightRef.current.scopeKey !== scopeKey) {
    mutationInFlightRef.current = null;
  }

  const refresh = useCallback(async () => {
    if (!enabled || !mountedRef.current || mutationInFlightRef.current?.scopeKey === scopeKey) return;
    const requestId = ++requestIdRef.current;
    const requestScope = scopeKey;
    setStoredStatus({ scopeKey: requestScope, loading: true, busy: false, error: null });
    try {
      const result = await apiGet<AnalysisFolderState>("/api/analysis/folders");
      if (!mountedRef.current || requestIdRef.current !== requestId || scopeKeyRef.current !== requestScope) return;
      setStoredState({ scopeKey: requestScope, value: normalizeState(result) });
      setStoredStatus({ scopeKey: requestScope, loading: false, busy: false, error: null });
    } catch (cause) {
      if (mountedRef.current && requestIdRef.current === requestId && scopeKeyRef.current === requestScope) {
        setStoredStatus({
          scopeKey: requestScope,
          loading: false,
          busy: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId && scopeKeyRef.current === requestScope) {
        setStoredStatus((current) => current.scopeKey === requestScope ? { ...current, loading: false } : current);
      }
    }
  }, [enabled, scopeKey]);

  useEffect(() => {
    const effectScopeKey = scopeKey;
    mountedRef.current = true;
    setStoredState({ scopeKey: effectScopeKey, value: EMPTY_STATE });
    setStoredStatus({ scopeKey: effectScopeKey, ...EMPTY_STATUS });
    if (enabled) void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      if (mutationInFlightRef.current?.scopeKey === effectScopeKey) mutationInFlightRef.current = null;
    };
  }, [enabled, scopeKey, refresh]);

  const mutate = useCallback(async (body: AnalysisFolderMutation): Promise<boolean> => {
    if (!enabled || !mountedRef.current || mutationInFlightRef.current?.scopeKey === scopeKey) return false;
    const requestId = ++requestIdRef.current;
    const requestScope = scopeKey;
    const token = { scopeKey: requestScope, requestId };
    mutationInFlightRef.current = token;
    setStoredStatus({ scopeKey: requestScope, loading: false, busy: true, error: null });
    try {
      const result = await apiPost<AnalysisFolderState>("/api/analysis/folders", body);
      if (!mountedRef.current || requestIdRef.current !== requestId || scopeKeyRef.current !== requestScope) return false;
      setStoredState({ scopeKey: requestScope, value: normalizeState(result) });
      return true;
    } catch (cause) {
      if (mountedRef.current && requestIdRef.current === requestId && scopeKeyRef.current === requestScope) {
        setStoredStatus({
          scopeKey: requestScope,
          loading: false,
          busy: true,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
      return false;
    } finally {
      const ownsMutationSlot = mutationInFlightRef.current === token;
      if (ownsMutationSlot) mutationInFlightRef.current = null;
      if (
        ownsMutationSlot
        && mountedRef.current
        && requestIdRef.current === requestId
        && scopeKeyRef.current === requestScope
      ) {
        setStoredStatus((current) => current.scopeKey === requestScope
          ? { ...current, loading: false, busy: false }
          : current);
      }
    }
  }, [enabled, scopeKey]);

  const createFolder = useCallback((name: string) => mutate({ action: "create", name }), [mutate]);
  const renameFolder = useCallback(
    (folderId: string, name: string) => mutate({ action: "rename", folder_id: folderId, name }),
    [mutate],
  );
  const deleteFolder = useCallback(
    (folderId: string) => mutate({ action: "delete", folder_id: folderId }),
    [mutate],
  );
  const assignItems = useCallback(
    (ids: string[], folderId: string | null) => mutate({ action: "assign", folder_id: folderId, ids }),
    [mutate],
  );

  const currentState = enabled && storedState.scopeKey === scopeKey ? storedState.value : EMPTY_STATE;
  const currentStatus = enabled && storedStatus.scopeKey === scopeKey ? storedStatus : EMPTY_STATUS;
  return {
    ...currentState,
    ...currentStatus,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    assignItems,
  };
}
