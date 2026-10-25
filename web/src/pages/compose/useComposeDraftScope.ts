import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../../api/client";
import { getCurrentUser } from "../../platform/auth";
import type { ComposeDraftScope } from "../../types/compose";
import {
  buildComposeDraftStorageKey,
  normalizeComposeDraftScope,
  normalizeProjectRootForScope,
} from "./composeDraftStorage";

export function useComposeDraftScope(params: {
  accountId?: string | null;
  projectRoot?: string | null;
  currentExamId: string | null;
}): {
  scope: ComposeDraftScope | null;
  storageKey: string | null;
  ownerKey: string;
  scopeReady: boolean;
  refreshScope: () => Promise<void>;
} {
  const { accountId: propAccountId, projectRoot: propProjectRoot, currentExamId } = params;
  const [resolvedAccountId, setResolvedAccountId] = useState<string | null>(null);
  const [resolvedProjectRoot, setResolvedProjectRoot] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refreshScope = useCallback(async () => {
    const reqId = ++requestIdRef.current;

    const resolveAccountPromise = (async (): Promise<string | null> => {
      if (propAccountId !== undefined) {
        return propAccountId?.trim() || null;
      }
      try {
        const me = await getCurrentUser();
        if (me?.user?.id && typeof me.user.id === "string" && me.user.id.trim()) {
          return me.user.id.trim();
        }
      } catch {
        /* ignore */
      }
      try {
        const fallback = await apiGet<{ user?: { id?: string | null } | null }>("/api/auth/me");
        if (fallback?.user?.id && typeof fallback.user.id === "string" && fallback.user.id.trim()) {
          return fallback.user.id.trim();
        }
      } catch {
        /* ignore */
      }
      return null;
    })();

    const resolveProjectPromise = (async (): Promise<string | null> => {
      if (propProjectRoot !== undefined) {
        const norm = normalizeProjectRootForScope(propProjectRoot);
        return norm || null;
      }
      try {
        const info = await apiGet<{ bound?: boolean; root?: string | null; project_id?: string }>("/api/project/info");
        if (info?.bound) {
          const norm = normalizeProjectRootForScope(info.root || info.project_id);
          return norm || null;
        }
      } catch {
        /* ignore */
      }
      return null;
    })();

    const [nextAccount, nextProject] = await Promise.all([
      resolveAccountPromise,
      resolveProjectPromise,
    ]);

    if (reqId !== requestIdRef.current) {
      return;
    }
    setResolvedAccountId(nextAccount);
    setResolvedProjectRoot(nextProject);
  }, [propAccountId, propProjectRoot]);

  useEffect(() => {
    void refreshScope();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refreshScope]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("solaire.platform.session")) {
        if (!event.newValue && propAccountId === undefined) {
          requestIdRef.current += 1;
          setResolvedAccountId(null);
        } else {
          void refreshScope();
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [propAccountId, refreshScope]);

  const effectiveAccountId =
    propAccountId !== undefined ? propAccountId?.trim() || null : resolvedAccountId;
  const effectiveProjectRoot =
    propProjectRoot !== undefined
      ? normalizeProjectRootForScope(propProjectRoot) || null
      : resolvedProjectRoot;

  const scope = useMemo(
    () =>
      normalizeComposeDraftScope({
        accountId: effectiveAccountId,
        projectRoot: effectiveProjectRoot,
        currentExamId,
      }),
    [effectiveAccountId, effectiveProjectRoot, currentExamId],
  );

  const storageKey = useMemo(
    () => (scope ? buildComposeDraftStorageKey(scope) : null),
    [scope],
  );

  const ownerKey = `${effectiveAccountId ?? "__none__"}::${effectiveProjectRoot ?? "__none__"}`;

  return {
    scope,
    storageKey,
    ownerKey,
    scopeReady: scope !== null,
    refreshScope,
  };
}
