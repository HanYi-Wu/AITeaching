import { apiGet } from "../../api/client";
import { SOLAIRE_EXAMS_CHANGED_EVENT } from "../../lib/examEvents";
import { listPlatformPapers, type PlatformPaperRecord } from "../../platform/auth";
import { loadSessionToken } from "../../platform/session";
import type { ExamResult } from "./analysisTypes";
import type { AnalysisFolderState } from "./useAnalysisFolders";

export type AnalysisPrefetchSnapshot = {
  exams: ExamResult[] | null;
  onlinePapers: PlatformPaperRecord[] | null;
  examsLoaded: boolean;
  onlinePapersLoaded: boolean;
  fetchedAt: number;
};

export type AnalysisInFlightStreams = {
  promise: Promise<AnalysisPrefetchSnapshot>;
  examsPromise: Promise<ExamResult[]> | null;
  onlinePapersPromise: Promise<PlatformPaperRecord[]> | null;
};

type WorkspaceCacheEntry = {
  scopeKey: string;
  sessionToken: string | null;
  promise: Promise<AnalysisPrefetchSnapshot> | null;
  examsPromise: Promise<ExamResult[]> | null;
  onlinePapersPromise: Promise<PlatformPaperRecord[]> | null;
  snapshot: AnalysisPrefetchSnapshot | null;
};

type FolderCacheEntry = {
  scopeKey: string;
  sessionToken: string | null;
  promise: Promise<AnalysisFolderState> | null;
  state: AnalysisFolderState | null;
  fetchedAt: number;
};

const PREFETCH_TTL_MS = 15_000;
const analysisPrefetchCache = new Map<string, WorkspaceCacheEntry>();
const analysisFolderPrefetchCache = new Map<string, FolderCacheEntry>();
let listenerInstalled = false;

function ensureInvalidationListener(): void {
  if (listenerInstalled || typeof window === "undefined" || !SOLAIRE_EXAMS_CHANGED_EVENT) return;
  listenerInstalled = true;
  window.addEventListener(SOLAIRE_EXAMS_CHANGED_EVENT, () => {
    invalidateAnalysisPrefetch();
  });
}

export function normalizeAnalysisProjectId(projectId: string | null | undefined): string | null {
  const normalized = projectId?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  return normalized || null;
}

export function getAnalysisFolderScopeKey(
  ownerId?: string | null,
  projectId?: string | null,
): string {
  return JSON.stringify([ownerId?.trim() || null, normalizeAnalysisProjectId(projectId)]);
}

export function getAnalysisPrefetchScopeKey(
  ownerId?: string | null,
  projectId?: string | null,
): string {
  return JSON.stringify([
    loadSessionToken() ?? null,
    ownerId?.trim() || null,
    normalizeAnalysisProjectId(projectId),
  ]);
}

export async function fetchAnalysisExams(): Promise<ExamResult[]> {
  const data = await apiGet<{ exams: ExamResult[] }>("/api/exams/analysis-list");
  return data.exams ?? [];
}

export async function fetchAllOnlinePapers(): Promise<PlatformPaperRecord[]> {
  const collected: PlatformPaperRecord[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await listPlatformPapers({
      deliveryMode: "all",
      status: "all",
      page,
      pageSize: 100,
    });
    if (res.papers?.length) {
      collected.push(...res.papers);
    }
    totalPages = Math.max(1, res.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);
  return collected;
}

export async function fetchAnalysisFoldersState(): Promise<AnalysisFolderState> {
  return apiGet<AnalysisFolderState>("/api/analysis/folders");
}

export function peekAnalysisPrefetch(
  ownerId?: string | null,
  projectId?: string | null,
): AnalysisPrefetchSnapshot | null {
  const scopeKey = getAnalysisPrefetchScopeKey(ownerId, projectId);
  const entry = analysisPrefetchCache.get(scopeKey);
  if (!entry?.snapshot) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    analysisPrefetchCache.delete(scopeKey);
    return null;
  }
  if (Date.now() - entry.snapshot.fetchedAt > PREFETCH_TTL_MS) {
    analysisPrefetchCache.delete(scopeKey);
    return null;
  }
  return entry.snapshot;
}

export function peekInFlightAnalysisPrefetch(
  ownerId?: string | null,
  projectId?: string | null,
): Promise<AnalysisPrefetchSnapshot> | null {
  const scopeKey = getAnalysisPrefetchScopeKey(ownerId, projectId);
  const entry = analysisPrefetchCache.get(scopeKey);
  if (!entry?.promise) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    analysisPrefetchCache.delete(scopeKey);
    return null;
  }
  return entry.promise;
}

export function peekInFlightAnalysisStreams(
  ownerId?: string | null,
  projectId?: string | null,
): AnalysisInFlightStreams | null {
  const scopeKey = getAnalysisPrefetchScopeKey(ownerId, projectId);
  const entry = analysisPrefetchCache.get(scopeKey);
  if (!entry?.promise) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    analysisPrefetchCache.delete(scopeKey);
    return null;
  }
  return {
    promise: entry.promise,
    examsPromise: entry.examsPromise,
    onlinePapersPromise: entry.onlinePapersPromise,
  };
}

export function peekAnalysisFolderPrefetch(folderScopeKey: string): AnalysisFolderState | null {
  const entry = analysisFolderPrefetchCache.get(folderScopeKey);
  if (!entry?.state) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    analysisFolderPrefetchCache.delete(folderScopeKey);
    return null;
  }
  if (Date.now() - entry.fetchedAt > PREFETCH_TTL_MS) {
    analysisFolderPrefetchCache.delete(folderScopeKey);
    return null;
  }
  return entry.state;
}

export function peekInFlightAnalysisFolderPrefetch(
  folderScopeKey: string,
): Promise<AnalysisFolderState> | null {
  const entry = analysisFolderPrefetchCache.get(folderScopeKey);
  if (!entry?.promise) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    analysisFolderPrefetchCache.delete(folderScopeKey);
    return null;
  }
  return entry.promise;
}

export function invalidateAnalysisFolderPrefetch(): void {
  analysisFolderPrefetchCache.clear();
}

export function invalidateAnalysisPrefetch(): void {
  analysisPrefetchCache.clear();
  analysisFolderPrefetchCache.clear();
}

export async function prefetchAnalysisWorkspaceData(
  ownerId?: string | null,
  projectId?: string | null,
): Promise<void> {
  ensureInvalidationListener();
  const sessionToken = loadSessionToken();
  const scopeKey = getAnalysisPrefetchScopeKey(ownerId, projectId);
  const folderScopeKey = getAnalysisFolderScopeKey(ownerId, projectId);

  const tasks: Promise<unknown>[] = [];

  if (!peekAnalysisPrefetch(ownerId, projectId)) {
    const existingWorkspace = peekInFlightAnalysisPrefetch(ownerId, projectId);
    if (existingWorkspace) {
      tasks.push(existingWorkspace.catch(() => undefined));
    } else {
      const examsPromise = fetchAnalysisExams();
      const onlinePapersPromise = fetchAllOnlinePapers();
      const promise = (async (): Promise<AnalysisPrefetchSnapshot> => {
        const [examsResult, onlinePapersResult] = await Promise.allSettled([
          examsPromise,
          onlinePapersPromise,
        ]);
        if (loadSessionToken() !== sessionToken) {
          throw new Error("analysis prefetch session changed");
        }
        return {
          exams: examsResult.status === "fulfilled" ? examsResult.value : null,
          onlinePapers: onlinePapersResult.status === "fulfilled" ? onlinePapersResult.value : null,
          examsLoaded: examsResult.status === "fulfilled",
          onlinePapersLoaded: onlinePapersResult.status === "fulfilled",
          fetchedAt: Date.now(),
        };
      })();

      const entry: WorkspaceCacheEntry = {
        scopeKey,
        sessionToken,
        promise,
        examsPromise,
        onlinePapersPromise,
        snapshot: null,
      };
      analysisPrefetchCache.set(scopeKey, entry);

      tasks.push(
        promise
          .then((snapshot) => {
            if (analysisPrefetchCache.get(scopeKey) === entry && loadSessionToken() === sessionToken) {
              if (snapshot.examsLoaded || snapshot.onlinePapersLoaded) {
                entry.snapshot = snapshot;
              } else {
                analysisPrefetchCache.delete(scopeKey);
              }
              entry.promise = null;
              entry.examsPromise = null;
              entry.onlinePapersPromise = null;
            }
          })
          .catch(() => {
            if (analysisPrefetchCache.get(scopeKey) === entry) {
              analysisPrefetchCache.delete(scopeKey);
            }
          }),
      );
    }
  }

  if (!peekAnalysisFolderPrefetch(folderScopeKey)) {
    const existingFolders = peekInFlightAnalysisFolderPrefetch(folderScopeKey);
    if (existingFolders) {
      tasks.push(existingFolders.catch(() => undefined));
    } else {
      const folderPromise = fetchAnalysisFoldersState();
      const folderEntry: FolderCacheEntry = {
        scopeKey: folderScopeKey,
        sessionToken,
        promise: folderPromise,
        state: null,
        fetchedAt: 0,
      };
      analysisFolderPrefetchCache.set(folderScopeKey, folderEntry);

      tasks.push(
        folderPromise
          .then((state) => {
            if (
              analysisFolderPrefetchCache.get(folderScopeKey) === folderEntry &&
              loadSessionToken() === sessionToken
            ) {
              folderEntry.state = state;
              folderEntry.fetchedAt = Date.now();
              folderEntry.promise = null;
            }
          })
          .catch(() => {
            if (analysisFolderPrefetchCache.get(folderScopeKey) === folderEntry) {
              analysisFolderPrefetchCache.delete(folderScopeKey);
            }
          }),
      );
    }
  }

  await Promise.allSettled(tasks);
}
