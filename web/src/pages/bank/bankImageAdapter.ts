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
): { nextText: string; nextCursor: number } {
  if (!saved) {
    const nextText = currentText ? `${currentText}${snippet}` : snippet;
    return { nextText, nextCursor: nextText.length };
  }

  const { start, end } = saved;

  // 场景 1：文本未变更，常规光标或选区替换
  if (snapshotText === undefined || currentText === snapshotText) {
    const s = Math.max(0, Math.min(start, currentText.length));
    const e = Math.max(s, Math.min(end, currentText.length));
    const nextText = currentText.slice(0, s) + snippet + currentText.slice(e);
    return { nextText, nextCursor: s + snippet.length };
  }

  // 场景 2：异步期间用户继续输入或修改
  // 如果选区是单点光标（start === end）
  if (start === end) {
    const prefix = snapshotText.slice(0, start);
    // 用户在光标后追加了内容（prefix 仍完整）
    if (currentText.startsWith(prefix)) {
      const nextText = prefix + snippet + currentText.slice(start);
      return { nextText, nextCursor: start + snippet.length };
    }
    // 用户编辑了光标前内容，安全追加避免破坏修改
    const nextText = currentText + (currentText.endsWith("\n") ? "" : "\n") + snippet;
    return { nextText, nextCursor: nextText.length };
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
    return { nextText, nextCursor: prefix.length + snippet.length };
  }

  // 用户修改了选区或其周边内容，保留所有最新输入并将标记追加
  const nextText = currentText + (currentText.endsWith("\n") ? "" : "\n") + snippet;
  return { nextText, nextCursor: nextText.length };
}

export interface DomRefs {
  contentRef?: RefObject<HTMLTextAreaElement | null>;
  answerRef?: RefObject<HTMLTextAreaElement | null>;
  analysisRef?: RefObject<HTMLTextAreaElement | null>;
  materialGroupRef?: RefObject<HTMLTextAreaElement | null>;
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

  if (kind.k === "qo") {
    const key = kind.key;
    const opts = { ...(d.question.options ?? {}) };
    const prev = opts[key] ?? "";
    const { nextText, nextCursor } = applySafeSnippetInsertion(
      prev,
      snippet,
      saved,
      snapshotText,
    );
    opts[key] = nextText;
    requestAnimationFrame(() => {
      const ta = document.getElementById(`bank-opt-q-${key}`) as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      }
    });
    return { ...d, question: { ...d.question, options: opts } };
  }

  if (kind.k === "gio" && d.question_group) {
    const { i, key } = kind;
    const g = d.question_group;
    const items = [...g.items];
    const row = { ...items[i] };
    const opts = { ...(row.options ?? {}) };
    const prev = opts[key] ?? "";
    const { nextText, nextCursor } = applySafeSnippetInsertion(
      prev,
      snippet,
      saved,
      snapshotText,
    );
    opts[key] = nextText;
    items[i] = { ...row, options: opts };
    const m = d.question.id.match(/__(\d{2})$/);
    const midx = m ? parseInt(m[1], 10) - 1 : -1;
    let q = d.question;
    if (midx === i) {
      q = { ...q, options: opts };
    }
    requestAnimationFrame(() => {
      const ta = document.getElementById(`bank-opt-gi-${i}-${key}`) as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      }
    });
    return { ...d, question_group: { ...g, items }, question: q };
  }

  if (kind.k === "q") {
    const key = kind.f;
    const ref =
      kind.f === "content"
        ? refs?.contentRef
        : kind.f === "answer"
          ? refs?.answerRef
          : refs?.analysisRef;
    const prev = (d.question[key] as string) ?? "";
    const { nextText, nextCursor } = applySafeSnippetInsertion(
      prev,
      snippet,
      saved,
      snapshotText,
    );
    requestAnimationFrame(() => {
      const ta = ref?.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      }
    });
    return { ...d, question: { ...d.question, [key]: nextText } };
  }

  if (kind.k === "gm" && d.question_group) {
    const prev = d.question_group.material ?? "";
    const { nextText, nextCursor } = applySafeSnippetInsertion(
      prev,
      snippet,
      saved,
      snapshotText,
    );
    requestAnimationFrame(() => {
      const ta = refs?.materialGroupRef?.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      }
    });
    return {
      ...d,
      question_group: { ...d.question_group, material: nextText },
      question: { ...d.question, group_material: nextText },
    };
  }

  if (kind.k === "gi" && d.question_group) {
    const { i, f } = kind;
    const g = d.question_group;
    const items = [...g.items];
    const row = { ...items[i] };
    const prev = (row[f] as string) ?? "";
    const { nextText, nextCursor } = applySafeSnippetInsertion(
      prev,
      snippet,
      saved,
      snapshotText,
    );
    (row as Record<string, unknown>)[f] = nextText;
    items[i] = row;
    const m = d.question.id.match(/__(\d{2})$/);
    const midx = m ? parseInt(m[1], 10) - 1 : -1;
    let q = d.question;
    if (midx === i) {
      if (f === "content") {
        q = { ...q, content: nextText };
      } else if (f === "answer") {
        q = { ...q, answer: nextText };
      } else {
        q = { ...q, analysis: nextText };
      }
    }
    requestAnimationFrame(() => {
      const ta = document.getElementById(`bank-gi-${i}-${f}`) as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      }
    });
    return { ...d, question_group: { ...g, items }, question: q };
  }

  return d;
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
  const imageEmbedKindRef = useRef<EmbedKind | null>(null);
  const embedSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const targetQidRef = useRef<string | null>(null);
  const snapshotTextRef = useRef<string>("");
  const scopeRef = useRef(0);
  const currentQidRef = useRef(detail?.qualified_id);
  const imageScopeRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const targetVersionRef = useRef<string | undefined>(undefined);
  if (currentQidRef.current !== detail?.qualified_id) {
    currentQidRef.current = detail?.qualified_id;
    scopeRef.current++;
  }
  useEffect(() => () => { scopeRef.current++; }, []);

  const beginImageEmbed = useCallback(
    (kind: EmbedKind, sel: { start: number; end: number } | null) => {
      imageEmbedKindRef.current = kind;
      embedSelectionRef.current = sel;
      targetQidRef.current = detail?.qualified_id ?? null;
      snapshotTextRef.current = detail ? getEmbedKindText(detail, kind) : "";
      imageScopeRef.current = scopeRef.current;
      sessionRef.current = loadSessionToken();
      targetVersionRef.current = detail?.version;
      imageInputRef.current?.click();
    },
    [detail],
  );

  const insertSnippet = useCallback(
    (snippet: string, kind: EmbedKind, saved: { start: number; end: number } | null) => {
      setDetail((d) => {
        if (!d) return d;
        return insertSnippetIntoDetail(d, snippet, kind, saved, undefined, undefined, {
          contentRef,
          answerRef,
          analysisRef,
          materialGroupRef,
        });
      });
    },
    [setDetail, contentRef, answerRef, analysisRef, materialGroupRef],
  );

  const onImageFileSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const kind = imageEmbedKindRef.current;
      const targetQid = targetQidRef.current;
      const snapshotText = snapshotTextRef.current;
      const saved = embedSelectionRef.current;
      const scope = imageScopeRef.current;
      const session = sessionRef.current;
      const version = targetVersionRef.current;
      const isCurrent = () => scope === scopeRef.current && session === loadSessionToken();

      imageEmbedKindRef.current = null;
      embedSelectionRef.current = null;
      targetQidRef.current = null;
      snapshotTextRef.current = "";
      e.target.value = "";

      if (!file || !targetQid || !kind || !isCurrent()) {
        return;
      }

      setBusy(true);
      onError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const enc = encodeURIComponent(targetQid);
        const r = version
          ? await apiPostFormData<{ marker: string }>(`/api/bank/items/${enc}/image`, fd, { "If-Match": version })
          : await apiPostFormData<{ marker: string }>(`/api/bank/items/${enc}/image`, fd);
        if (!isCurrent()) return;

        if (!r || typeof r.marker !== "string") {
          throw new Error("上传图片返回无效引用");
        }

        setDetail((d) => {
          if (!d || !isCurrent()) return d;
          // Guard: 切题后迟到上传不写入新题
          if (d.qualified_id !== targetQid) {
            return d;
          }
          // Guard: 异步插入不抹掉后续输入
          return insertSnippetIntoDetail(
            d,
            r.marker,
            kind,
            saved,
            snapshotText,
            targetQid,
            { contentRef, answerRef, analysisRef, materialGroupRef },
          );
        });
      } catch (err) {
        // Guard: 上传失败不插入坏引用
        if (isCurrent()) onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [setBusy, onError, setDetail, contentRef, answerRef, analysisRef, materialGroupRef],
  );

  return {
    imageInputRef,
    beginImageEmbed,
    onImageFileSelected,
    insertSnippet,
  };
}
