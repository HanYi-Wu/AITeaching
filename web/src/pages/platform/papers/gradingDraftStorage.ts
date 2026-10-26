import type { GradingDraft } from "./gradingModel";

export type GradingDraftStorageScope = {
  accountId: string;
  projectId: string;
  paperId: string;
  attemptId: string;
  questionId: string;
};

export type StoredGradingDraft = {
  version: 1;
  sourceVersion: string | null;
  score?: string;
  feedback?: string;
};

export type GradingDraftReadResult = {
  draft: StoredGradingDraft | null;
  status: "missing" | "saved" | "unavailable" | "corrupted";
};

export const GRADING_DRAFT_STORAGE_PREFIX = "solaire.paper-grading.draft.v1:";

export function buildGradingDraftStorageKey(scope: GradingDraftStorageScope): string {
  return `${GRADING_DRAFT_STORAGE_PREFIX}${[
    scope.accountId,
    scope.projectId,
    scope.paperId,
    scope.attemptId,
    scope.questionId,
  ].map((part) => encodeURIComponent(part.trim())).join(":")}`;
}

export function readGradingDraft(
  scope: GradingDraftStorageScope,
  storage: Pick<Storage, "getItem" | "removeItem"> | null = getDefaultStorage(),
): GradingDraftReadResult {
  if (!storage) return { draft: null, status: "unavailable" };
  const key = buildGradingDraftStorageKey(scope);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { draft: null, status: "unavailable" };
  }
  if (raw === null) return { draft: null, status: "missing" };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGradingDraft>;
    if (
      parsed.version !== 1 ||
      !(parsed.sourceVersion === null || typeof parsed.sourceVersion === "string") ||
      !(parsed.score === undefined || typeof parsed.score === "string") ||
      !(parsed.feedback === undefined || typeof parsed.feedback === "string") ||
      (parsed.score === undefined && parsed.feedback === undefined)
    ) {
      try { storage.removeItem(key); } catch { /* ignore cleanup failure */ }
      return { draft: null, status: "corrupted" };
    }
    return { draft: parsed as StoredGradingDraft, status: "saved" };
  } catch {
    try { storage.removeItem(key); } catch { /* ignore cleanup failure */ }
    return { draft: null, status: "corrupted" };
  }
}

export function writeGradingDraft(
  scope: GradingDraftStorageScope,
  draft: GradingDraft,
  sourceVersion: string | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  const key = buildGradingDraftStorageKey(scope);
  if (!draft.score.dirty && !draft.feedback.dirty) {
    try { storage.removeItem(key); return true; } catch { return false; }
  }
  const record: StoredGradingDraft = {
    version: 1,
    sourceVersion,
    ...(draft.score.dirty ? { score: draft.score.value } : {}),
    ...(draft.feedback.dirty ? { feedback: draft.feedback.value } : {}),
  };
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
