import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "../../api/client";
import {
  fetchAnalysisFoldersState,
  invalidateAnalysisFolderPrefetch,
  peekAnalysisFolderPrefetch,
  peekInFlightAnalysisFolderPrefetch,
} from "./analysisPrefetch";

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
type ScopedStatus = {
  scopeKey: string;
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
};
type MutationToken = { scopeKey: string; requestId: number };

const EMPTY_STATE: AnalysisFolderState = { version: 1, folders: [], items: {} };
const EMPTY_STATUS = { enabled: false, loading: false, busy: false, error: null } as const;

function normalizeState(result: AnalysisFolderState): AnalysisFolderState {
  return {
    version: 1,
    folders: Array.isArray(result.folders) ? result.folders : [],
    items: result.items && typeof result.items === "object" ? result.items : {},
  };
}

export function useAnalysisFolders(scopeKey: string, enabled: boolean) {
  const initialPrefetch = enabled ? peekAnalysisFolderPrefetch(scopeKey) : null;
  const [storedState, setStoredState] = useState<ScopedState>(() => ({
    scopeKey,
    value: initialPrefetch ? normalizeState(initialPrefetch) : EMPTY_STATE,
  }));
  const [storedStatus, setStoredStatus] = useState<ScopedStatus>(() => ({
    scopeKey,
    enabled,
    loading: enabled && !initialPrefetch,
    busy: false,
    error: null,
  }));
  const requestIdRef = useRef(0);
  const scopeKeyRef = useRef(scopeKey);
  const mountedRef = useRef(false);
  const mutationInFlightRef = useRef<MutationToken | null>(null);
  scopeKeyRef.current = scopeKey;
  if (mutationInFlightRef.current && mutationInFlightRef.current.scopeKey !== scopeKey) {
    mutationInFlightRef.current = null;
  }

  const refresh = useCallback(async (options?: { reusePrefetch?: boolean }) => {
    if (!enabled || !mountedRef.current || mutationInFlightRef.current?.scopeKey === scopeKey) return;
    const reusePrefetch = Boolean(options && typeof options === "object" && options.reusePrefetch);
    const requestId = ++requestIdRef.current;
    const requestScope = scopeKey;
    setStoredStatus({ scopeKey: requestScope, enabled: true, loading: true, busy: false, error: null });
    try {
      const inFlight = reusePrefetch ? peekInFlightAnalysisFolderPrefetch(requestScope) : null;
      if (!reusePrefetch) {
        invalidateAnalysisFolderPrefetch();
      }
      const result = await (inFlight ?? fetchAnalysisFoldersState());
      if (!mountedRef.current || requestIdRef.current !== requestId || scopeKeyRef.current !== requestScope) return;
      setStoredState({ scopeKey: requestScope, value: normalizeState(result) });
      setStoredStatus({ scopeKey: requestScope, enabled: true, loading: false, busy: false, error: null });
    } catch (cause) {
      if (mountedRef.current && requestIdRef.current === requestId && scopeKeyRef.current === requestScope) {
        setStoredStatus({
          scopeKey: requestScope,
          enabled: true,
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
    const prefetched = enabled ? peekAnalysisFolderPrefetch(effectScopeKey) : null;
    if (enabled && prefetched) {
      setStoredState({ scopeKey: effectScopeKey, value: normalizeState(prefetched) });
      setStoredStatus({ scopeKey: effectScopeKey, enabled: true, loading: false, busy: false, error: null });
    } else {
      setStoredState({ scopeKey: effectScopeKey, value: EMPTY_STATE });
      setStoredStatus({ scopeKey: effectScopeKey, enabled, loading: enabled, busy: false, error: null });
      if (enabled) void refresh({ reusePrefetch: true });
    }
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
    setStoredStatus({ scopeKey: requestScope, enabled: true, loading: false, busy: true, error: null });
    try {
      const result = await apiPost<AnalysisFolderState>("/api/analysis/folders", body);
      invalidateAnalysisFolderPrefetch();
      if (!mountedRef.current || requestIdRef.current !== requestId || scopeKeyRef.current !== requestScope) return false;
      setStoredState({ scopeKey: requestScope, value: normalizeState(result) });
      return true;
    } catch (cause) {
      if (mountedRef.current && requestIdRef.current === requestId && scopeKeyRef.current === requestScope) {
        setStoredStatus({
          scopeKey: requestScope,
          enabled: true,
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

  const scopeMatches = enabled && storedStatus.scopeKey === scopeKey && storedStatus.enabled === enabled;
  const pendingPrefetch = enabled && !scopeMatches ? peekAnalysisFolderPrefetch(scopeKey) : null;
  const currentState = enabled
    ? (storedState.scopeKey === scopeKey
      ? storedState.value
      : (pendingPrefetch ? normalizeState(pendingPrefetch) : EMPTY_STATE))
    : EMPTY_STATE;
  const { loading, busy, error } = enabled
    ? (scopeMatches ? storedStatus : { loading: !pendingPrefetch, busy: false, error: null })
    : EMPTY_STATUS;
  return {
    ...currentState,
    loading,
    busy,
    error,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    assignItems,
  };
}
