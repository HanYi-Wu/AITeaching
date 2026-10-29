import type { StudentAnswerImage } from "../../../platform/auth";
import { studentDraftKey, type StudentDraftScope } from "./studentTextDraft";

export type ImageDraftIssue = "unavailable" | "too_large" | "corrupt" | null;
type ImageEntry = { images: StudentAnswerImage[]; baseline: StudentAnswerImage[]; sent?: StudentAnswerImage[] };
type ImageDraft = { version: 1; scope: StudentDraftScope; entries: Record<string, ImageEntry> };
type StoredDraft = ImageDraft & { key: string };

const DATABASE = "solaire.student-image-drafts";
const STORE = "drafts";
const MAX_QUESTIONS = 200;
const MAX_IMAGES_PER_ANSWER = 10;
const MAX_IMAGE_DATA_URL_LENGTH = 5_000_000;
const MAX_DRAFT_BYTES = 20_000_000;
const MAX_VOLATILE_BYTES = MAX_DRAFT_BYTES;
const volatileDrafts = new Map<string, { draft: ImageDraft | null; bytes: number }>();

let writeQueue: Promise<void> = Promise.resolve();

function cacheVolatileDraft(key: string, draft: ImageDraft | null, bytes: number): boolean {
  if (bytes > MAX_VOLATILE_BYTES) { volatileDrafts.delete(key); return false; }
  let total = 0;
  for (const [existingKey, existing] of volatileDrafts) {
    if (existingKey !== key) total += existing.bytes;
  }
  if (total + bytes > MAX_VOLATILE_BYTES) { volatileDrafts.delete(key); return false; }
  volatileDrafts.set(key, { draft, bytes });
  return true;
}

export function sameImages(left: StudentAnswerImage[] | undefined, right: StudentAnswerImage[] | undefined): boolean {
  if (left === right) return true;
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  let sameReferences = true;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) { sameReferences = false; break; }
  }
  return sameReferences || JSON.stringify(a) === JSON.stringify(b);
}

export function sameAnswerImage(left: StudentAnswerImage, right: StudentAnswerImage): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function validImages(value: unknown): value is StudentAnswerImage[] {
  return Array.isArray(value) && value.length <= MAX_IMAGES_PER_ANSWER && value.every((image) =>
    Boolean(image) && typeof image.name === "string" &&
    (image.mime_type === undefined || image.mime_type === null || typeof image.mime_type === "string") &&
    typeof image.data_url === "string" && image.data_url.length <= MAX_IMAGE_DATA_URL_LENGTH,
  );
}

function validEntry(value: unknown): value is ImageEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as ImageEntry;
  return validImages(entry.images) && validImages(entry.baseline) &&
    (entry.sent === undefined || validImages(entry.sent));
}

function getFactory(factory?: IDBFactory): IDBFactory | null {
  try { return factory ?? globalThis.indexedDB ?? null; } catch { return null; }
}

function openDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  const indexedDb = getFactory(factory);
  if (!indexedDb) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDb.open(DATABASE, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function readDraft(key: string, factory?: IDBFactory): Promise<{ draft: ImageDraft | null; issue: ImageDraftIssue }> {
  const volatile = volatileDrafts.get(key);
  if (volatile) return { draft: volatile.draft, issue: "unavailable" };
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase(factory);
    const row = await new Promise<StoredDraft | undefined>((resolve, reject) => {
      const transaction = database!.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as StoredDraft | undefined);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB read failed"));
    });
    if (!row) return { draft: null, issue: null };
    const draft = row as ImageDraft;
    const scopeParts = draft.scope && [draft.scope.accountId, draft.scope.projectScope, draft.scope.publicationId,
      draft.scope.attemptId, draft.scope.snapshotVersion];
    if (row.key !== key || draft.version !== 1 || !scopeParts || scopeParts.some((part) => typeof part !== "string") ||
        studentDraftKey(draft.scope) !== key ||
        !draft.entries ||
        typeof draft.entries !== "object" || Array.isArray(draft.entries) ||
        Object.keys(draft.entries).length > MAX_QUESTIONS ||
        Object.values(draft.entries).some((entry) => !validEntry(entry))) {
      return { draft: null, issue: "corrupt" };
    }
    if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > MAX_DRAFT_BYTES) return { draft: null, issue: "too_large" };
    return { draft, issue: null };
  } catch {
    return { draft: null, issue: "unavailable" };
  } finally { database?.close(); }
}

async function writeDraft(
  key: string, scope: StudentDraftScope, entries: Record<string, ImageEntry>, factory?: IDBFactory,
  shouldWrite?: () => boolean,
): Promise<ImageDraftIssue> {
  if (Object.keys(entries).length > MAX_QUESTIONS || Object.values(entries).some((entry) => !validEntry(entry))) {
    volatileDrafts.delete(key);
    return "too_large";
  }
  const draft: ImageDraft = { version: 1, scope, entries };
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  if (bytes > MAX_DRAFT_BYTES) {
    volatileDrafts.delete(key);
    return "too_large";
  }
  if (shouldWrite && !shouldWrite()) return null;
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase(factory);
    if (shouldWrite && !shouldWrite()) return null;
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(STORE, "readwrite");
      const objectStore = transaction.objectStore(STORE);
      if (Object.keys(entries).length) objectStore.put({ key, ...draft } satisfies StoredDraft);
      else objectStore.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    });
    volatileDrafts.delete(key);
    return null;
  } catch {
    return cacheVolatileDraft(key, Object.keys(entries).length ? draft : null, Object.keys(entries).length ? bytes : 0)
      ? "unavailable" : "too_large";
  }
  finally { database?.close(); }
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function restoreStudentImageDraft(
  scope: StudentDraftScope,
  serverImages: Record<string, StudentAnswerImage[]>,
  allowedIds: string[],
  factory?: IDBFactory,
  shouldClean?: () => boolean,
): Promise<{ images: Record<string, StudentAnswerImage[]>; conflicts: Record<string, StudentAnswerImage[]>; restored: boolean; issue: ImageDraftIssue }> {
  const key = studentDraftKey(scope);
  if (!key) return { images: { ...serverImages }, conflicts: {}, restored: false, issue: "unavailable" };
  const { draft, issue } = await readDraft(key, factory);
  const images = { ...serverImages };
  const conflicts: Record<string, StudentAnswerImage[]> = {};
  let restored = false;
  const confirmedIds: string[] = [];
  for (const id of allowedIds) {
    const entry = draft?.entries[id];
    if (!entry) continue;
    if (sameImages(entry.images, serverImages[id])) { confirmedIds.push(id); continue; }
    if (sameImages(serverImages[id], entry.baseline) || (entry.sent && sameImages(serverImages[id], entry.sent))) {
      if (entry.images.length) images[id] = entry.images;
      else delete images[id];
      restored = true;
    } else conflicts[id] = entry.images;
  }
  const cleanupIssue = confirmedIds.length
    ? await enqueueWrite(async () => {
        if (shouldClean && !shouldClean()) return null;
        const current = await readDraft(key, factory);
        if (!current.draft || (shouldClean && !shouldClean())) return current.issue;
        const entries = { ...current.draft.entries };
        for (const id of confirmedIds) {
          if (entries[id] && sameImages(entries[id].images, serverImages[id])) delete entries[id];
        }
        return writeDraft(key, scope, entries, factory, shouldClean);
      })
    : null;
  return { images, conflicts, restored, issue: cleanupIssue ?? issue };
}

export function persistStudentImageDraft(
  scope: StudentDraftScope,
  images: Record<string, StudentAnswerImage[]>,
  baseline: Record<string, StudentAnswerImage[]>,
  sent: Record<string, StudentAnswerImage[]> = {},
  preserveIds: string[] = [],
  factory?: IDBFactory,
): Promise<ImageDraftIssue> {
  const key = studentDraftKey(scope);
  if (!key) return Promise.resolve("unavailable");
  return enqueueWrite(async () => {
    const previous = preserveIds.length ? (await readDraft(key, factory)).draft : null;
    const entries: Record<string, ImageEntry> = {};
    const ids = new Set([...Object.keys(images), ...Object.keys(baseline), ...Object.keys(sent)]);
    for (const id of ids) {
      const value = images[id] ?? [];
      const original = baseline[id] ?? [];
      const sentValue = sent[id];
      if (!sameImages(value, original) || (sentValue !== undefined && !sameImages(value, sentValue))) {
        entries[id] = { images: value, baseline: original, ...(sentValue === undefined ? {} : { sent: sentValue }) };
      }
    }
    for (const id of preserveIds) {
      const existing = previous?.entries[id];
      if (existing) entries[id] = existing;
    }
    return writeDraft(key, scope, entries, factory);
  });
}

export function acknowledgeStudentImageDraft(
  scope: StudentDraftScope,
  sent: Record<string, StudentAnswerImage[]>,
  factory?: IDBFactory,
): Promise<ImageDraftIssue> {
  const key = studentDraftKey(scope);
  if (!key) return Promise.resolve("unavailable");
  return enqueueWrite(async () => {
    const { draft, issue } = await readDraft(key, factory);
    if (!draft) return issue;
    for (const [id, entry] of Object.entries(draft.entries)) {
      if (!Object.prototype.hasOwnProperty.call(sent, id)) continue;
      const confirmed = sent[id] ?? [];
      if (sameImages(entry.images, confirmed)) delete draft.entries[id];
      else { entry.baseline = confirmed; delete entry.sent; }
    }
    return writeDraft(key, scope, draft.entries, factory);
  });
}

export function retainUnconfirmedStudentImageDraft(
  scope: StudentDraftScope,
  submitted: Record<string, StudentAnswerImage[]>,
  latest: Record<string, StudentAnswerImage[]>,
  factory?: IDBFactory,
): Promise<ImageDraftIssue> {
  const key = studentDraftKey(scope);
  if (!key) return Promise.resolve("unavailable");
  return enqueueWrite(async () => {
    const { draft } = await readDraft(key, factory);
    const entries = { ...(draft?.entries ?? {}) };
    const ids = new Set([...Object.keys(submitted), ...Object.keys(latest)]);
    for (const id of ids) {
      const actual = submitted[id] ?? [];
      const current = latest[id] ?? [];
      if (sameImages(current, actual)) {
        if (actual.length) entries[id] = { images: actual, baseline: [] };
      } else entries[id] = { images: current, baseline: actual };
    }
    return writeDraft(key, scope, entries, factory);
  });
}

export function retainLateStudentImage(
  scope: StudentDraftScope, questionId: string, images: StudentAnswerImage[],
  baseline: StudentAnswerImage[], sent?: StudentAnswerImage[], factory?: IDBFactory,
): Promise<ImageDraftIssue> {
  const key = studentDraftKey(scope);
  if (!key) return Promise.resolve("unavailable");
  return enqueueWrite(async () => {
    const { draft, issue } = await readDraft(key, factory);
    if (issue) return issue;
    const entries = { ...(draft?.entries ?? {}) };
    if (!sameImages(images, baseline) || (sent !== undefined && !sameImages(images, sent))) {
      entries[questionId] = { images, baseline, ...(sent === undefined ? {} : { sent }) };
    } else delete entries[questionId];
    return writeDraft(key, scope, entries, factory);
  });
}
