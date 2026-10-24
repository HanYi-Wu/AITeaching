import { isImeComposingKeyboardEvent, isImeCompositionActive } from "../../lib/ime";
import type {
  ComposeDraftScope,
  ComposeDraftStorageStatus,
  ComposeLocalDraftRecord,
  ComposePaperState,
} from "../../types/compose";
import { createEmptyPaperState } from "./composeModel";

export const COMPOSE_DRAFT_STORAGE_PREFIX = "solaire.compose.draft.v1:";

const FORBIDDEN_AUTH_KEY_PATTERN =
  /^(token|access_token|refresh_token|auth_token|session_token|authorization|password|secret|credential|bearer)$/i;
const JWT_LIKE_VALUE_PATTERN = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

export function normalizeProjectRootForScope(projectRoot: string | null | undefined): string {
  if (typeof projectRoot !== "string") return "";
  return projectRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function buildComposeDraftPaperKey(currentExamId: string | null | undefined): string {
  const trimmed = typeof currentExamId === "string" ? currentExamId.trim().replace(/\\/g, "/") : "";
  return trimmed ? `exam:${trimmed}` : "scratch";
}

export function normalizeComposeDraftScope(input: {
  accountId?: string | null;
  projectRoot?: string | null;
  currentExamId?: string | null;
}): ComposeDraftScope | null {
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  const projectRoot = normalizeProjectRootForScope(input.projectRoot);
  if (
    !accountId ||
    !projectRoot ||
    accountId === "undefined" ||
    accountId === "null" ||
    projectRoot === "undefined" ||
    projectRoot === "null"
  ) {
    return null;
  }
  const paperKey = buildComposeDraftPaperKey(input.currentExamId);
  return {
    accountId,
    projectRoot,
    paperKey,
  };
}

export function buildComposeDraftStorageKey(scope: ComposeDraftScope): string {
  const acc = encodeURIComponent(scope.accountId.trim());
  const proj = encodeURIComponent(normalizeProjectRootForScope(scope.projectRoot));
  const paper = encodeURIComponent(scope.paperKey.trim());
  return `${COMPOSE_DRAFT_STORAGE_PREFIX}${acc}::${proj}::${paper}`;
}

function isLikelyTokenString(value: string): boolean {
  const trimmed = value.trim();
  if (/^Bearer\s+\S+/i.test(trimmed)) return true;
  if (JWT_LIKE_VALUE_PATTERN.test(trimmed)) return true;
  return false;
}

export function containsForbiddenAuthFields(raw: unknown, depth = 0): boolean {
  if (depth > 8 || raw === null || raw === undefined) return false;
  if (typeof raw === "string") {
    return isLikelyTokenString(raw);
  }
  if (Array.isArray(raw)) {
    return raw.some((item) => containsForbiddenAuthFields(item, depth + 1));
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (FORBIDDEN_AUTH_KEY_PATTERN.test(k)) {
        return true;
      }
      if (containsForbiddenAuthFields(v, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function sanitizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return isLikelyTokenString(value) ? "" : value;
}

export function sanitizePaperStateForDraft(state: ComposePaperState): ComposePaperState {
  const bySection: Record<string, string[]> = {};
  for (const [secId, list] of Object.entries(state.bySection ?? {})) {
    if (!Array.isArray(list)) continue;
    bySection[secId] = list
      .filter((item): item is string => typeof item === "string" && !isLikelyTokenString(item))
      .map((item) => item);
  }

  const scoreBySection: Record<string, number | undefined> = {};
  for (const [secId, val] of Object.entries(state.scoreBySection ?? {})) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      scoreBySection[secId] = val;
    }
  }

  const countBySection: Record<string, number> = {};
  for (const [secId, val] of Object.entries(state.countBySection ?? {})) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      countBySection[secId] = Math.max(0, Math.min(500, Math.trunc(val)));
    }
  }

  const scoreOverrides: Record<string, Record<string, number>> = {};
  for (const [secId, map] of Object.entries(state.scoreOverrides ?? {})) {
    if (!map || typeof map !== "object") continue;
    const cleanMap: Record<string, number> = {};
    for (const [qid, score] of Object.entries(map)) {
      if (typeof score === "number" && Number.isFinite(score) && score >= 0 && !isLikelyTokenString(qid)) {
        cleanMap[qid] = score;
      }
    }
    if (Object.keys(cleanMap).length > 0) {
      scoreOverrides[secId] = cleanMap;
    }
  }

  const perQuestionMode: Record<string, boolean> = {};
  for (const [secId, flag] of Object.entries(state.perQuestionMode ?? {})) {
    if (typeof flag === "boolean" && flag) {
      perQuestionMode[secId] = true;
    }
  }

  return createEmptyPaperState({
    exportLabel: sanitizeString(state.exportLabel),
    subject: sanitizeString(state.subject),
    templatePath: sanitizeString(state.templatePath),
    templateRef: sanitizeString(state.templateRef),
    draftName: sanitizeString(state.draftName),
    bySection,
    scoreBySection,
    countBySection,
    scoreOverrides,
    perQuestionMode,
  });
}

export function isValidComposePaperState(raw: unknown): raw is ComposePaperState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.exportLabel !== "string" ||
    typeof obj.subject !== "string" ||
    typeof obj.templatePath !== "string" ||
    typeof obj.templateRef !== "string" ||
    typeof obj.draftName !== "string"
  ) {
    return false;
  }
  if (!obj.bySection || typeof obj.bySection !== "object" || Array.isArray(obj.bySection)) {
    return false;
  }
  for (const v of Object.values(obj.bySection as Record<string, unknown>)) {
    if (!Array.isArray(v) || !v.every((item) => typeof item === "string")) {
      return false;
    }
  }
  if (!obj.scoreBySection || typeof obj.scoreBySection !== "object" || Array.isArray(obj.scoreBySection)) {
    return false;
  }
  for (const v of Object.values(obj.scoreBySection as Record<string, unknown>)) {
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      return false;
    }
  }
  if (!obj.countBySection || typeof obj.countBySection !== "object" || Array.isArray(obj.countBySection)) {
    return false;
  }
  for (const v of Object.values(obj.countBySection as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return false;
    }
  }
  if (!obj.scoreOverrides || typeof obj.scoreOverrides !== "object" || Array.isArray(obj.scoreOverrides)) {
    return false;
  }
  for (const secMap of Object.values(obj.scoreOverrides as Record<string, unknown>)) {
    if (!secMap || typeof secMap !== "object" || Array.isArray(secMap)) {
      return false;
    }
    for (const score of Object.values(secMap as Record<string, unknown>)) {
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return false;
      }
    }
  }
  if (!obj.perQuestionMode || typeof obj.perQuestionMode !== "object" || Array.isArray(obj.perQuestionMode)) {
    return false;
  }
  for (const flag of Object.values(obj.perQuestionMode as Record<string, unknown>)) {
    if (typeof flag !== "boolean") {
      return false;
    }
  }
  return true;
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  ) {
    return true;
  }
  if (typeof e.message === "string" && /quota/i.test(e.message)) {
    return true;
  }
  return false;
}

export function readScopedComposeDraft(
  scope: ComposeDraftScope | null,
  storage: Pick<Storage, "getItem" | "removeItem"> | null = getDefaultStorage(),
): { record: ComposeLocalDraftRecord | null; status: ComposeDraftStorageStatus } {
  if (!scope) {
    return { record: null, status: "scope_unavailable" };
  }
  if (!storage) {
    return { record: null, status: "storage_error" };
  }
  const key = buildComposeDraftStorageKey(scope);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { record: null, status: "storage_error" };
  }
  if (raw === null) {
    return { record: null, status: "idle" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ComposeLocalDraftRecord>;
    const validScope =
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      parsed.scope &&
      typeof parsed.scope === "object" &&
      parsed.scope.accountId === scope.accountId &&
      normalizeProjectRootForScope(parsed.scope.projectRoot) === normalizeProjectRootForScope(scope.projectRoot) &&
      parsed.scope.paperKey === scope.paperKey;

    if (
      !validScope ||
      typeof parsed.updatedAt !== "string" ||
      containsForbiddenAuthFields(parsed) ||
      !isValidComposePaperState(parsed.paper)
    ) {
      try {
        storage.removeItem(key);
      } catch {
        /* ignore cleanup failure */
      }
      return { record: null, status: "corrupted_cleared" };
    }

    return {
      record: {
        version: 1,
        scope: {
          accountId: scope.accountId,
          projectRoot: normalizeProjectRootForScope(scope.projectRoot),
          paperKey: scope.paperKey,
        },
        updatedAt: parsed.updatedAt,
        paper: sanitizePaperStateForDraft(parsed.paper),
      },
      status: "saved",
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore cleanup failure */
    }
    return { record: null, status: "corrupted_cleared" };
  }
}

export function writeScopedComposeDraft(
  scope: ComposeDraftScope | null,
  paper: ComposePaperState,
  storage: Pick<Storage, "setItem"> | null = getDefaultStorage(),
  now: () => string = () => new Date().toISOString(),
): { ok: boolean; status: ComposeDraftStorageStatus; record?: ComposeLocalDraftRecord } {
  if (!scope) {
    return { ok: false, status: "scope_unavailable" };
  }
  if (!storage) {
    return { ok: false, status: "storage_error" };
  }
  const normalizedScope: ComposeDraftScope = {
    accountId: scope.accountId.trim(),
    projectRoot: normalizeProjectRootForScope(scope.projectRoot),
    paperKey: scope.paperKey.trim(),
  };
  const record: ComposeLocalDraftRecord = {
    version: 1,
    scope: normalizedScope,
    updatedAt: now(),
    paper: sanitizePaperStateForDraft(paper),
  };
  const key = buildComposeDraftStorageKey(normalizedScope);
  try {
    storage.setItem(key, JSON.stringify(record));
    return { ok: true, status: "saved", record };
  } catch (err) {
    return {
      ok: false,
      status: isQuotaExceededError(err) ? "quota_exceeded" : "storage_error",
    };
  }
}

export function removeScopedComposeDraft(
  scope: ComposeDraftScope | null,
  storage: Pick<Storage, "removeItem"> | null = getDefaultStorage(),
): boolean {
  if (!scope || !storage) {
    return false;
  }
  const key = buildComposeDraftStorageKey(scope);
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isEditableDomElement(el: EventTarget | Element | null): boolean {
  if (!el || typeof el !== "object") return false;
  const node = el as HTMLElement;
  const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (node.isContentEditable) {
    return true;
  }
  if (typeof node.getAttribute === "function") {
    const ce = node.getAttribute("contenteditable");
    if (ce === "true" || ce === "" || ce === "plaintext-only") {
      return true;
    }
  }
  if (typeof node.closest === "function") {
    if (node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) {
      return true;
    }
  }
  return false;
}

export function shouldIgnoreComposeShortcut(
  event: {
    key?: string;
    keyCode?: number;
    which?: number;
    altKey?: boolean;
    isComposing?: boolean;
    target?: EventTarget | null;
    nativeEvent?: {
      key?: string;
      keyCode?: number;
      which?: number;
      isComposing?: boolean;
    };
  },
  doc: Document = document,
): boolean {
  if (event.altKey) return true;
  if (isImeComposingKeyboardEvent(event) || isImeCompositionActive(doc)) {
    return true;
  }
  if (isEditableDomElement(event.target ?? null) || isEditableDomElement(doc.activeElement)) {
    return true;
  }
  return false;
}
