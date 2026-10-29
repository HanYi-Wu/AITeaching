export type StudentDraftScope = {
  accountId: string;
  projectScope: string;
  publicationId: string;
  attemptId: string;
  snapshotVersion: string;
};

type TextEntry = { value: string; baseline: string; sent?: string };
type TextDraft = { version: 1; scope: StudentDraftScope; entries: Record<string, TextEntry> };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type TextDraftIssue = "unavailable" | "too_large" | "corrupt" | null;
const PREFIX = "eh:student-text-draft:v1:";
const MAX_BYTES = 1_000_000;
const MAX_ANSWERS = 200;
const MAX_TEXT = 100_000;
const MAX_VOLATILE_BYTES = MAX_BYTES;
const volatileDrafts = new Map<string, { draft: TextDraft | null; bytes: number }>();

function cacheVolatileDraft(key: string, draft: TextDraft | null, bytes: number): boolean {
  if (bytes > MAX_VOLATILE_BYTES) { volatileDrafts.delete(key); return false; }
  let total = 0;
  for (const [existingKey, existing] of volatileDrafts) {
    if (existingKey !== key) total += existing.bytes;
  }
  if (total + bytes > MAX_VOLATILE_BYTES) { volatileDrafts.delete(key); return false; }
  volatileDrafts.set(key, { draft, bytes });
  return true;
}

export function studentDraftKey(scope: StudentDraftScope): string | null {
  const parts = [scope.accountId, scope.projectScope, scope.publicationId, scope.attemptId, scope.snapshotVersion];
  if (parts.some((part) => typeof part !== "string" || !part.trim() || part.length > 512)) return null;
  return PREFIX + parts.map(encodeURIComponent).join(":");
}

function storageOrNull(storage?: DraftStorage): DraftStorage | null {
  try { return storage ?? window.localStorage; } catch { return null; }
}

function read(scope: StudentDraftScope, storage?: DraftStorage): { draft: TextDraft | null; issue: TextDraftIssue } {
  const key = studentDraftKey(scope);
  const target = storageOrNull(storage);
  if (!key) return { draft: null, issue: "unavailable" };
  const volatile = volatileDrafts.get(key) ?? null;
  if (!target) return { draft: volatile?.draft ?? null, issue: "unavailable" };
  let raw: string | null;
  try { raw = target.getItem(key); } catch { return { draft: volatile?.draft ?? null, issue: "unavailable" }; }
  if (volatile) return { draft: volatile.draft, issue: "unavailable" };
  try {
    if (!raw) return { draft: null, issue: null };
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return { draft: null, issue: "too_large" };
    const draft = JSON.parse(raw) as TextDraft;
    if (draft.version !== 1 || !draft.scope || studentDraftKey(draft.scope) !== key || !draft.entries ||
        typeof draft.entries !== "object" || Array.isArray(draft.entries) ||
        Object.keys(draft.entries).length > MAX_ANSWERS) return { draft: null, issue: "corrupt" };
    for (const entry of Object.values(draft.entries)) {
      if (!entry || typeof entry.value !== "string" || typeof entry.baseline !== "string" ||
          entry.value.length > MAX_TEXT || entry.baseline.length > MAX_TEXT ||
          (entry.sent !== undefined && (typeof entry.sent !== "string" || entry.sent.length > MAX_TEXT))) {
        return { draft: null, issue: "corrupt" };
      }
    }
    return { draft, issue: null };
  } catch { return { draft: null, issue: "corrupt" }; }
}

function write(scope: StudentDraftScope, entries: Record<string, TextEntry>, storage?: DraftStorage): TextDraftIssue {
  const key = studentDraftKey(scope);
  const target = storageOrNull(storage);
  if (!key) return "unavailable";
  if (!Object.keys(entries).length) {
    try {
      if (!target) throw new Error("localStorage unavailable");
      target.removeItem(key);
      volatileDrafts.delete(key);
      return null;
    } catch {
      return cacheVolatileDraft(key, null, 0) ? "unavailable" : "too_large";
    }
  }
  const raw = JSON.stringify({ version: 1, scope, entries } satisfies TextDraft);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (Object.keys(entries).length > MAX_ANSWERS || bytes > MAX_BYTES ||
      Object.values(entries).some((entry) => entry.value.length > MAX_TEXT || entry.baseline.length > MAX_TEXT || (entry.sent?.length ?? 0) > MAX_TEXT)) {
    volatileDrafts.delete(key);
    return "too_large";
  }
  const draft = { version: 1, scope, entries } satisfies TextDraft;
  if (!target) return cacheVolatileDraft(key, draft, bytes) ? "unavailable" : "too_large";
  try {
    target.setItem(key, raw);
    volatileDrafts.delete(key);
    return null;
  } catch { return cacheVolatileDraft(key, draft, bytes) ? "unavailable" : "too_large"; }
}

export function persistStudentTextDraft(
  scope: StudentDraftScope, answers: Record<string, string>, baseline: Record<string, string>,
  sent: Record<string, string> = {}, storage?: DraftStorage, preserveIds: string[] = [],
): TextDraftIssue {
  const entries = Object.fromEntries(Object.entries(answers)
    .filter(([id, value]) => value !== (baseline[id] ?? "") || (sent[id] !== undefined && value !== sent[id]))
    .map(([id, value]) => [id, { value, baseline: baseline[id] ?? "", ...(sent[id] === undefined ? {} : { sent: sent[id] }) }]));
  const previous = preserveIds.length ? read(scope, storage).draft : null;
  for (const id of preserveIds) {
    if (previous && Object.prototype.hasOwnProperty.call(previous.entries, id)) entries[id] = previous.entries[id];
  }
  return write(scope, entries, storage);
}

export function restoreStudentTextDraft(
  scope: StudentDraftScope, serverAnswers: Record<string, string>, allowedIds: string[], storage?: DraftStorage,
): { answers: Record<string, string>; conflicts: Record<string, string>; restored: boolean; issue: TextDraftIssue } {
  const { draft, issue } = read(scope, storage);
  const answers = { ...serverAnswers };
  const conflicts: Record<string, string> = {};
  let restored = false;
  for (const id of allowedIds) {
    const entry = draft && Object.prototype.hasOwnProperty.call(draft.entries, id) ? draft.entries[id] : undefined;
    if (!entry || entry.value === (serverAnswers[id] ?? "")) continue;
    if ((serverAnswers[id] ?? "") === entry.baseline || (entry.sent !== undefined && serverAnswers[id] === entry.sent)) {
      answers[id] = entry.value;
      restored = true;
    } else { conflicts[id] = entry.value; }
  }
  return { answers, conflicts, restored, issue };
}

export function markStudentTextDraftSent(scope: StudentDraftScope, sent: Record<string, string>, storage?: DraftStorage): TextDraftIssue {
  const { draft, issue } = read(scope, storage);
  if (!draft) return issue;
  for (const [id, entry] of Object.entries(draft.entries)) {
    if (Object.prototype.hasOwnProperty.call(sent, id)) entry.sent = sent[id];
  }
  return write(scope, draft.entries, storage);
}

export function acknowledgeStudentTextDraft(scope: StudentDraftScope, sent: Record<string, string>, storage?: DraftStorage): TextDraftIssue {
  const { draft, issue } = read(scope, storage);
  if (!draft) return issue;
  for (const [id, entry] of Object.entries(draft.entries)) {
    if (!Object.prototype.hasOwnProperty.call(sent, id)) continue;
    if (entry.value === sent[id]) delete draft.entries[id];
    else entry.baseline = sent[id];
  }
  return write(scope, draft.entries, storage);
}

export function clearStudentTextDraft(scope: StudentDraftScope, storage?: DraftStorage): TextDraftIssue {
  return write(scope, {}, storage);
}

export function pendingStudentTextDraft(scope: StudentDraftScope, storage?: DraftStorage): Record<string, string> {
  const { draft } = read(scope, storage);
  return Object.fromEntries(Object.entries(draft?.entries ?? {}).map(([id, entry]) => [id, entry.value]));
}

export function retainUnconfirmedStudentText(scope: StudentDraftScope, answers: Record<string, string>, storage?: DraftStorage): TextDraftIssue {
  const previous = read(scope, storage).draft?.entries ?? {};
  const entries = Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, { value, baseline: value }]));
  return write(scope, { ...entries, ...previous }, storage);
}
