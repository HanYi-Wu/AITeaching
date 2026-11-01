import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { apiPostFormData } from "../../api/client";
import type { EmbedKind } from "../../lib/bankEditorEmbedKinds";
import type { BankDetailState } from "../../components/BankQuestionEditorPanel";
import { loadSessionToken } from "../../platform/session";
import {
  focusAsyncFieldAt,
  waitForAsyncFieldCompositionCommit,
} from "../../components/latexField/asyncCallbackBridge";
// Import imageCompression primitives for adapter capability
import {
  compressImageFileToDataUrl,
  MAX_STUDENT_IMAGE_BYTES,
  type CompressedImage,
} from "../../lib/imageCompression";

export { compressImageFileToDataUrl, MAX_STUDENT_IMAGE_BYTES, type CompressedImage };

/**
 * 提取指定 EmbedKind 在题目状态中对应的文本内容
 */
export function getEmbedKindText(detail: BankDetailState, kind: EmbedKind): string {
  if (kind.k === "qo") {
    return detail.question.options?.[kind.key] ?? "";
  }
  if (kind.k === "gio" && detail.question_group) {
    return detail.question_group.items[kind.i]?.options?.[kind.key] ?? "";
  }
  if (kind.k === "q") {
    return (detail.question[kind.f] as string) ?? "";
  }
  if (kind.k === "gm" && detail.question_group) {
    return detail.question_group.material ?? "";
  }
  if (kind.k === "gi" && detail.question_group) {
    return (detail.question_group.items[kind.i]?.[kind.f] as string) ?? "";
  }
  return "";
}

/**
 * 异步插入算法：
 * - 如果当前文本未发生变化（currentText === snapshotText），在 saved 的 [start, end] 范围进行准确替换
 * - 如果当前文本在异步上传期间被用户追加或修改，确保不抹掉用户后续的输入
 */
export function applySafeSnippetInsertion(
  currentText: string,
  snippet: string,
  saved: { start: number; end: number } | null,
  snapshotText?: string,
): {
  nextText: string;
  nextCursor: number;
  appliedRange: { start: number; end: number };
  appended: boolean;
} {
  if (!saved) {
    const nextText = currentText ? `${currentText}${snippet}` : snippet;
    const start = nextText.length - snippet.length;
    return { nextText, nextCursor: nextText.length, appliedRange: { start, end: start }, appended: true };
  }

  const { start, end } = saved;

  // 场景 1：文本未变更，常规光标或选区替换
  if (snapshotText === undefined || currentText === snapshotText) {
    const s = Math.max(0, Math.min(start, currentText.length));
    const e = Math.max(s, Math.min(end, currentText.length));
    const nextText = currentText.slice(0, s) + snippet + currentText.slice(e);
    return { nextText, nextCursor: s + snippet.length, appliedRange: { start: s, end: e }, appended: false };
  }

  // 场景 2：异步期间用户继续输入或修改
  // 如果选区是单点光标（start === end）
  if (start === end) {
    const prefix = snapshotText.slice(0, start);
    // 用户在光标后追加了内容（prefix 仍完整）
    if (currentText.startsWith(prefix)) {
      const nextText = prefix + snippet + currentText.slice(start);
      return {
        nextText,
        nextCursor: start + snippet.length,
        appliedRange: { start, end: start },
        appended: false,
      };
    }
    // 用户编辑了光标前内容，安全追加避免破坏修改
    const nextText = currentText + (currentText.endsWith("\n") ? "" : "\n") + snippet;
    const appliedStart = nextText.length - snippet.length;
    return {
      nextText,
      nextCursor: nextText.length,
      appliedRange: { start: appliedStart, end: appliedStart },
      appended: true,
    };
  }

  // 如果原本选定了区间 [start, end]
  const selectedOriginal = snapshotText.slice(start, end);
  const prefix = snapshotText.slice(0, start);
  const suffix = snapshotText.slice(end);

  if (
    currentText.startsWith(prefix) &&
    currentText.endsWith(suffix) &&
    currentText.slice(start, currentText.length - suffix.length) === selectedOriginal
  ) {
    const nextText = prefix + snippet + suffix;
    return {
      nextText,
      nextCursor: prefix.length + snippet.length,
      appliedRange: { start, end },
      appended: false,
    };
  }

  // 用户修改了选区或其周边内容，保留所有最新输入并将标记追加
  const nextText = currentText + (currentText.endsWith("\n") ? "" : "\n") + snippet;
  const appliedStart = nextText.length - snippet.length;
  return {
    nextText,
    nextCursor: nextText.length,
    appliedRange: { start: appliedStart, end: appliedStart },
    appended: true,
  };
}

export interface DomRefs {
  contentRef?: RefObject<HTMLTextAreaElement | null>;
  answerRef?: RefObject<HTMLTextAreaElement | null>;
  analysisRef?: RefObject<HTMLTextAreaElement | null>;
  materialGroupRef?: RefObject<HTMLTextAreaElement | null>;
  scheduleFocus?: (callback: () => void) => void;
  isFocusCurrent?: () => boolean;
}

export function getEmbedKindTextarea(kind: EmbedKind, refs?: DomRefs): HTMLTextAreaElement | null {
  if (kind.k === "q") {
    const ref = kind.f === "content"
      ? refs?.contentRef
      : kind.f === "answer"
        ? refs?.answerRef
        : refs?.analysisRef;
    return ref?.current ?? null;
  }
  if (kind.k === "gm") return refs?.materialGroupRef?.current ?? null;
  if (typeof document === "undefined") return null;
  const id = kind.k === "qo"
    ? `bank-opt-q-${kind.key}`
    : kind.k === "gio"
      ? `bank-opt-gi-${kind.i}-${kind.key}`
      : `bank-gi-${kind.i}-${kind.f}`;
  return document.getElementById(id) as HTMLTextAreaElement | null;
}

type EmbedFieldValue = { text: string };

function resolveEmbedFieldValue(detail: BankDetailState, kind: EmbedKind): EmbedFieldValue | null {
  if (kind.k === "qo") return { text: detail.question.options?.[kind.key] ?? "" };
  if (kind.k === "gio" && detail.question_group) {
    const item = detail.question_group.items[kind.i];
    return item ? { text: item.options?.[kind.key] ?? "" } : null;
  }
  if (kind.k === "q") return { text: (detail.question[kind.f] as string) ?? "" };
  if (kind.k === "gm" && detail.question_group) {
    return { text: detail.question_group.material ?? "" };
  }
  if (kind.k === "gi" && detail.question_group) {
    const item = detail.question_group.items[kind.i];
    return item ? { text: (item[kind.f] as string) ?? "" } : null;
  }
  return null;
}

function selectedGroupMemberIndex(detail: BankDetailState): number {
  const match = detail.question.id.match(/__(\d{2})$/);
  return match ? Number.parseInt(match[1], 10) - 1 : -1;
}

function updateEmbedFieldValue(
  detail: BankDetailState,
  kind: EmbedKind,
  value: string,
): BankDetailState {
  if (kind.k === "q") {
    return { ...detail, question: { ...detail.question, [kind.f]: value } };
  }
  if (kind.k === "qo") {
    const options = { ...(detail.question.options ?? {}), [kind.key]: value };
    return { ...detail, question: { ...detail.question, options } };
  }
  const group = detail.question_group;
  if (!group) return detail;
  if (kind.k === "gm") {
    return {
      ...detail,
      question_group: { ...group, material: value },
      question: { ...detail.question, group_material: value },
    };
  }

  const items = [...group.items];
  const member = items[kind.i];
  if (!member) return detail;

  if (kind.k === "gi") {
    items[kind.i] = { ...member, [kind.f]: value };
    const question = selectedGroupMemberIndex(detail) === kind.i
      ? { ...detail.question, [kind.f]: value }
      : detail.question;
    return { ...detail, question_group: { ...group, items }, question };
  }

  const options = { ...(member.options ?? {}), [kind.key]: value };
  items[kind.i] = { ...member, options };
  const question = selectedGroupMemberIndex(detail) === kind.i
    ? { ...detail.question, options }
    : detail.question;
  return { ...detail, question_group: { ...group, items }, question };
}

function scheduleEmbedFocus(
  kind: EmbedKind,
  refs: DomRefs | undefined,
  offset: number,
): void {
  const target = getEmbedKindTextarea(kind, refs);
  if (!target) return;
  const focus = () => {
    if (refs?.isFocusCurrent && !refs.isFocusCurrent()) return;
    if (!target.isConnected || getEmbedKindTextarea(kind, refs) !== target) return;
    focusAsyncFieldAt(target, offset);
  };
  if (refs?.scheduleFocus) refs.scheduleFocus(focus);
  else window.requestAnimationFrame(focus);
}

/**
 * 将生成的 marker 或文本片段安全插入到 BankDetailState 中
 */
export function insertSnippetIntoDetail(
  d: BankDetailState,
  snippet: string,
  kind: EmbedKind,
  saved: { start: number; end: number } | null,
  snapshotText?: string,
  targetQid?: string,
  refs?: DomRefs,
): BankDetailState {
  // Guard: 切题后迟到上传不写入新题
  if (targetQid && d.qualified_id !== targetQid) {
    return d;
  }

  const field = resolveEmbedFieldValue(d, kind);
  if (!field) return d;
  const insertion = applySafeSnippetInsertion(field.text, snippet, saved, snapshotText);
  scheduleEmbedFocus(kind, refs, insertion.nextCursor);
  return updateEmbedFieldValue(d, kind, insertion.nextText);
}

export interface UseBankImageUploadOptions {
  detail: BankDetailState | null;
  setDetail: Dispatch<SetStateAction<BankDetailState | null>>;
  setBusy: (busy: boolean) => void;
  onError: (err: string | null) => void;
  contentRef?: RefObject<HTMLTextAreaElement | null>;
  answerRef?: RefObject<HTMLTextAreaElement | null>;
  analysisRef?: RefObject<HTMLTextAreaElement | null>;
  materialGroupRef?: RefObject<HTMLTextAreaElement | null>;
}

type ImageUploadTarget = {
  id: number;
  kind: EmbedKind;
  saved: { start: number; end: number } | null;
  targetQid: string | null;
  snapshotText: string;
  scope: number;
  session: string | null;
  version?: string;
  targetElement: HTMLTextAreaElement | null;
  fieldKey: string;
  priorIds: number[];
};

type AppliedImageInsertion = {
  id: number;
  snapshotText: string;
  range: { start: number; end: number };
  marker: string;
  appended: boolean;
};

function embedFieldKey(kind: EmbedKind): string {
  if (kind.k === "q") return `q:${kind.f}`;
  if (kind.k === "qo") return `qo:${kind.key}`;
  if (kind.k === "gm") return "gm";
  if (kind.k === "gi") return `gi:${kind.i}:${kind.f}`;
  return `gio:${kind.i}:${kind.key}`;
}

function planImageInsertion(
  currentText: string,
  marker: string,
  request: ImageUploadTarget,
  priorInsertions: AppliedImageInsertion[],
): {
  nextText: string;
  nextCursor: number;
  appliedRange: { start: number; end: number };
  appended: boolean;
} {
  let expectedText = request.snapshotText;
  let saved = request.saved ? { ...request.saved } : null;
  const relevantPrior = priorInsertions
    .filter((item) => request.priorIds.includes(item.id) && item.snapshotText === request.snapshotText)
    .sort((left, right) => left.id - right.id);

  if (relevantPrior.some((item) => item.appended)) {
    const insertion = applySafeSnippetInsertion(currentText, marker, null);
    return insertion;
  }

  for (const prior of relevantPrior) {
    const { start, end } = prior.range;
    if (saved) {
      if (end <= saved.start) {
        const delta = prior.marker.length - (end - start);
        saved = { start: saved.start + delta, end: saved.end + delta };
      } else if (start < saved.end && end > saved.start) {
        const afterPrior = start + prior.marker.length;
        saved = { start: afterPrior, end: afterPrior };
      }
    }
    expectedText = expectedText.slice(0, start) + prior.marker + expectedText.slice(end);
  }

  const insertion = applySafeSnippetInsertion(currentText, marker, saved, expectedText);
  return insertion;
}

export function useBankImageUpload({
  detail,
  setDetail,
  setBusy,
  onError,
  contentRef,
  answerRef,
  analysisRef,
  materialGroupRef,
}: UseBankImageUploadOptions) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef(0);
  const currentQidRef = useRef(detail?.qualified_id);
  const currentSession = loadSessionToken();
  const currentSessionRef = useRef(currentSession);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const mountedRef = useRef(true);
  const nextRequestIdRef = useRef(0);
  const pendingTargetRef = useRef<ImageUploadTarget | null>(null);
  const activeRequestsRef = useRef(new Map<number, ImageUploadTarget>());
  const focusFramesRef = useRef(new Set<number>());
  const latestFocusRequestRef = useRef(new Map<string, number>());
  const insertionTailsRef = useRef(new Map<string, Promise<void>>());
  const appliedInsertionsRef = useRef(new Map<string, AppliedImageInsertion[]>());
  if (
    currentQidRef.current !== detail?.qualified_id ||
    currentSessionRef.current !== currentSession
  ) {
    currentQidRef.current = detail?.qualified_id;
    currentSessionRef.current = currentSession;
    scopeRef.current++;
    pendingTargetRef.current = null;
    insertionTailsRef.current.clear();
    appliedInsertionsRef.current.clear();
    latestFocusRequestRef.current.clear();
  }

  const isTargetCurrent = useCallback((target: ImageUploadTarget) => {
    if (
      !mountedRef.current ||
      target.targetQid === null ||
      target.scope !== scopeRef.current ||
      target.targetQid !== currentQidRef.current ||
      target.targetQid !== detailRef.current?.qualified_id ||
      target.session !== loadSessionToken()
    ) return false;

    const currentElement = getEmbedKindTextarea(target.kind, {
      contentRef,
      answerRef,
      analysisRef,
      materialGroupRef,
    });
    return currentElement === null || currentElement === target.targetElement;
  }, [contentRef, answerRef, analysisRef, materialGroupRef]);

  const publishBusy = useCallback(() => {
    if (!mountedRef.current) return;
    const busy = Array.from(activeRequestsRef.current.values()).some(isTargetCurrent);
    setBusy(busy);
  }, [isTargetCurrent, setBusy]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeRef.current++;
      pendingTargetRef.current = null;
      for (const frame of focusFramesRef.current) window.cancelAnimationFrame(frame);
      focusFramesRef.current.clear();
      latestFocusRequestRef.current.clear();
      activeRequestsRef.current.clear();
      insertionTailsRef.current.clear();
      appliedInsertionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    publishBusy();
  }, [detail?.qualified_id, currentSession, publishBusy]);

  const captureDomRefs = useCallback((
    target: ImageUploadTarget,
    isFocusCurrent: () => boolean,
  ): DomRefs => {
    let scheduled = false;
    const scheduleFocus = (callback: () => void) => {
      if (scheduled || !mountedRef.current) return;
      scheduled = true;
      let frame = 0;
      frame = window.requestAnimationFrame(() => {
        focusFramesRef.current.delete(frame);
        callback();
      });
      focusFramesRef.current.add(frame);
    };
    return {
      contentRef,
      answerRef,
      analysisRef,
      materialGroupRef,
      scheduleFocus,
      isFocusCurrent: () => (
        isFocusCurrent() &&
        !!target.targetElement?.isConnected &&
        getEmbedKindTextarea(target.kind, {
          contentRef,
          answerRef,
          analysisRef,
          materialGroupRef,
        }) === target.targetElement
      ),
    };
  }, [contentRef, answerRef, analysisRef, materialGroupRef]);

  const reserveInsertionTurn = useCallback((fieldKey: string) => {
    const previous = insertionTailsRef.current.get(fieldKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    insertionTailsRef.current.set(fieldKey, current);
    return { previous, current, release };
  }, []);

  const beginImageEmbed = useCallback(
    (kind: EmbedKind, sel: { start: number; end: number } | null) => {
      const session = loadSessionToken();
      if (currentSessionRef.current !== session) {
        currentSessionRef.current = session;
        scopeRef.current++;
        pendingTargetRef.current = null;
        insertionTailsRef.current.clear();
        appliedInsertionsRef.current.clear();
        latestFocusRequestRef.current.clear();
        publishBusy();
      }
      const requestId = ++nextRequestIdRef.current;
      const target: ImageUploadTarget = {
        id: requestId,
        kind: { ...kind },
        saved: sel ? { ...sel } : null,
        targetQid: detail?.qualified_id ?? null,
        snapshotText: detail ? getEmbedKindText(detail, kind) : "",
        scope: scopeRef.current,
        session,
        version: detail?.version,
        targetElement: getEmbedKindTextarea(kind, {
          contentRef,
          answerRef,
          analysisRef,
          materialGroupRef,
        }),
        fieldKey: `${scopeRef.current}:${detail?.qualified_id ?? ""}:${session ?? ""}:${embedFieldKey(kind)}`,
        priorIds: [],
      };
      const existing = appliedInsertionsRef.current.get(target.fieldKey) ?? [];
      const sameSnapshotRecords = existing.filter((item) => item.snapshotText === target.snapshotText);
      if (sameSnapshotRecords.length !== existing.length) {
        if (sameSnapshotRecords.length) appliedInsertionsRef.current.set(target.fieldKey, sameSnapshotRecords);
        else appliedInsertionsRef.current.delete(target.fieldKey);
      }
      target.priorIds = sameSnapshotRecords.map((item) => item.id);
      for (const active of activeRequestsRef.current.values()) {
        if (
          active.id < target.id && active.fieldKey === target.fieldKey &&
          active.snapshotText === target.snapshotText
        ) target.priorIds.push(active.id);
      }
      pendingTargetRef.current = target;
      imageInputRef.current?.click();
    },
    [detail, contentRef, answerRef, analysisRef, materialGroupRef, publishBusy],
  );

  const insertSnippet = useCallback(
    (snippet: string, kind: EmbedKind, saved: { start: number; end: number } | null) => {
      const session = loadSessionToken();
      if (currentSessionRef.current !== session) {
        currentSessionRef.current = session;
        scopeRef.current++;
        pendingTargetRef.current = null;
        insertionTailsRef.current.clear();
        appliedInsertionsRef.current.clear();
        latestFocusRequestRef.current.clear();
        publishBusy();
      }
      const target: ImageUploadTarget = {
        id: ++nextRequestIdRef.current,
        kind: { ...kind },
        saved: saved ? { ...saved } : null,
        targetQid: currentQidRef.current ?? null,
        snapshotText: detailRef.current ? getEmbedKindText(detailRef.current, kind) : "",
        scope: scopeRef.current,
        session,
        version: detailRef.current?.version,
        targetElement: getEmbedKindTextarea(kind, {
          contentRef,
          answerRef,
          analysisRef,
          materialGroupRef,
        }),
        fieldKey: "",
        priorIds: [],
      };
      target.fieldKey = `${target.scope}:${target.targetQid ?? ""}:${target.session ?? ""}:${embedFieldKey(kind)}`;
      const domRefs = captureDomRefs(target, () => (
        isTargetCurrent(target) && latestFocusRequestRef.current.get(target.fieldKey) === target.id
      ));
      setDetail((d) => {
        if (!d || !isTargetCurrent(target)) return d;
        latestFocusRequestRef.current.set(target.fieldKey, target.id);
        return insertSnippetIntoDetail(d, snippet, kind, saved, undefined, target.targetQid ?? undefined, domRefs);
      });
    },
    [setDetail, contentRef, answerRef, analysisRef, materialGroupRef, captureDomRefs, isTargetCurrent, publishBusy],
  );

  const onImageFileSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const target = pendingTargetRef.current;
      pendingTargetRef.current = null;
      e.target.value = "";

      if (!file || !target || !target.targetQid || !isTargetCurrent(target)) {
        return;
      }

      const turn = reserveInsertionTurn(target.fieldKey);
      activeRequestsRef.current.set(target.id, target);
      publishBusy();
      onError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const enc = encodeURIComponent(target.targetQid);
        const r = target.version
          ? await apiPostFormData<{ marker: string }>(`/api/bank/items/${enc}/image`, fd, { "If-Match": target.version })
          : await apiPostFormData<{ marker: string }>(`/api/bank/items/${enc}/image`, fd);
        if (!isTargetCurrent(target)) return;

        if (!r || typeof r.marker !== "string") {
          throw new Error("上传图片返回无效引用");
        }

        const compositionCommitted = await waitForAsyncFieldCompositionCommit(target.targetElement);
        if (!compositionCommitted || !isTargetCurrent(target)) return;
        await turn.previous;
        if (!isTargetCurrent(target)) return;
        const compositionStillCommitted = await waitForAsyncFieldCompositionCommit(target.targetElement);
        if (!compositionStillCommitted || !isTargetCurrent(target)) return;

        const domRefs = captureDomRefs(target, () => (
          isTargetCurrent(target) && latestFocusRequestRef.current.get(target.fieldKey) === target.id
        ));

        setDetail((d) => {
          if (!d || !isTargetCurrent(target)) return d;
          // Guard: 切题后迟到上传不写入新题
          if (d.qualified_id !== target.targetQid) return d;
          const priorInsertions = appliedInsertionsRef.current.get(target.fieldKey) ?? [];
          const currentText = getEmbedKindText(d, target.kind);
          const insertion = planImageInsertion(currentText, r.marker, target, priorInsertions);
          const records = priorInsertions.filter((item) => item.id !== target.id);
          records.push({
            id: target.id,
            snapshotText: target.snapshotText,
            range: insertion.appliedRange,
            marker: r.marker,
            appended: insertion.appended,
          });
          appliedInsertionsRef.current.set(target.fieldKey, records);
          latestFocusRequestRef.current.set(target.fieldKey, target.id);
          scheduleEmbedFocus(target.kind, domRefs, insertion.nextCursor);
          return updateEmbedFieldValue(d, target.kind, insertion.nextText);
        });
      } catch (err) {
        // Guard: 上传失败不插入坏引用
        if (isTargetCurrent(target)) onError(err instanceof Error ? err.message : String(err));
      } finally {
        activeRequestsRef.current.delete(target.id);
        turn.release();
        const currentTail = insertionTailsRef.current.get(target.fieldKey);
        if (currentTail === turn.current) insertionTailsRef.current.delete(target.fieldKey);
        publishBusy();
      }
    },
    [
      onError,
      setDetail,
      isTargetCurrent,
      reserveInsertionTurn,
      publishBusy,
      captureDomRefs,
    ],
  );

  return {
    imageInputRef,
    beginImageEmbed,
    onImageFileSelected,
    insertSnippet,
  };
}
