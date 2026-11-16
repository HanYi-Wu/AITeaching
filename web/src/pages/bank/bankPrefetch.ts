import { apiGet, apiGraphQuestionBindingsIndex } from "../../api/client";
import type { BankFolders } from "../../components/BankFolderExplorer";
import { CONTENT_LIBRARY_CHANGED_EVENT } from "../../lib/contentEvents";
import { loadSessionToken } from "../../platform/session";
import type { BankCollectionRow, BankListItem, BankReadDiagnostic } from "./bankModel";

export type BankCorePayload = {
  collections: BankCollectionRow[];
  items: BankListItem[];
  diagnostics: BankReadDiagnostic[];
  folders: BankFolders;
  subjects: string[];
};

export type BankPrefetchSnapshot = BankCorePayload & {
  graphLinkIndex: Record<string, { id: string; canonical_name: string; node_kind: string }[]>;
  fetchedAt: number;
};

type CacheEntry = {
  scopeKey: string;
  sessionToken: string | null;
  promise: Promise<BankPrefetchSnapshot> | null;
  snapshot: BankPrefetchSnapshot | null;
};

const PREFETCH_TTL_MS = 15_000;
const bankPrefetchCache = new Map<string, CacheEntry>();
let listenerInstalled = false;

function ensureInvalidationListener(): void {
  if (listenerInstalled || typeof window === "undefined" || !CONTENT_LIBRARY_CHANGED_EVENT) return;
  listenerInstalled = true;
  window.addEventListener(CONTENT_LIBRARY_CHANGED_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<{ kind?: string }>).detail;
    if (!detail?.kind || detail.kind === "question") {
      invalidateBankPrefetch();
    }
  });
}

export function getBankPrefetchScopeKey(projectScope?: string | null): string {
  return JSON.stringify([loadSessionToken() ?? "local-session", projectScope ?? ""]);
}

export async function fetchBankCorePayload(): Promise<BankCorePayload> {
  const [c, it, sub, folderData] = await Promise.all([
    apiGet<{
      collections: { id: string; label: string; subject?: string; collection?: string }[];
    }>("/api/bank/collections"),
    apiGet<{ items: BankListItem[]; diagnostics?: BankReadDiagnostic[] }>("/api/bank/items"),
    apiGet<{ subjects: string[] }>("/api/bank/subjects"),
    apiGet<BankFolders>("/api/bank/folders"),
  ]);

  const parsedCollections = c.collections.map((x) => {
    const parts = x.id.split("/");
    const subj = x.subject ?? parts[0] ?? "";
    const coll = x.collection ?? (parts.length > 1 ? parts.slice(1).join("/") : parts[0] ?? "");
    return { id: x.id, label: x.label, subject: subj, collection: coll };
  });

  return {
    collections: parsedCollections,
    items: it.items,
    diagnostics: it.diagnostics ?? [],
    folders: folderData,
    subjects: sub.subjects,
  };
}

export function peekBankPrefetchSnapshot(scopeKey: string): BankPrefetchSnapshot | null {
  const entry = bankPrefetchCache.get(scopeKey);
  if (!entry?.snapshot) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    bankPrefetchCache.delete(scopeKey);
    return null;
  }
  if (Date.now() - entry.snapshot.fetchedAt > PREFETCH_TTL_MS) {
    bankPrefetchCache.delete(scopeKey);
    return null;
  }
  return entry.snapshot;
}

export function peekInFlightBankPrefetch(scopeKey: string): Promise<BankPrefetchSnapshot> | null {
  const entry = bankPrefetchCache.get(scopeKey);
  if (!entry?.promise) return null;
  if (entry.sessionToken !== loadSessionToken()) {
    bankPrefetchCache.delete(scopeKey);
    return null;
  }
  return entry.promise;
}

export function invalidateBankPrefetch(): void {
  bankPrefetchCache.clear();
}

export async function prefetchBankListData(projectScope?: string | null): Promise<void> {
  ensureInvalidationListener();
  const sessionToken = loadSessionToken();
  const scopeKey = JSON.stringify([sessionToken ?? "local-session", projectScope ?? ""]);
  if (peekBankPrefetchSnapshot(scopeKey)) return;
  const existing = peekInFlightBankPrefetch(scopeKey);
  if (existing) {
    await existing.catch(() => undefined);
    return;
  }

  const promise = (async (): Promise<BankPrefetchSnapshot> => {
    const core = await fetchBankCorePayload();
    if (loadSessionToken() !== sessionToken) {
      throw new Error("bank prefetch session changed");
    }
    let graphLinkIndex: Record<string, { id: string; canonical_name: string; node_kind: string }[]> = {};
    try {
      const idx = await apiGraphQuestionBindingsIndex();
      graphLinkIndex = idx.index ?? {};
    } catch {
      graphLinkIndex = {};
    }
    if (loadSessionToken() !== sessionToken) {
      throw new Error("bank prefetch session changed");
    }
    return {
      ...core,
      graphLinkIndex,
      fetchedAt: Date.now(),
    };
  })();

  const entry: CacheEntry = {
    scopeKey,
    sessionToken,
    promise,
    snapshot: null,
  };
  bankPrefetchCache.set(scopeKey, entry);

  try {
    const snapshot = await promise;
    if (bankPrefetchCache.get(scopeKey) === entry && loadSessionToken() === sessionToken) {
      entry.snapshot = snapshot;
      entry.promise = null;
    }
  } catch {
    if (bankPrefetchCache.get(scopeKey) === entry) {
      bankPrefetchCache.delete(scopeKey);
    }
  }
}
