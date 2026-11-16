import {
  type KeyboardEvent,
  type LegacyRef,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MathSymbolsDropdown } from "./latexField/MathSymbolsPanel";
import { MathEditPopup } from "./latexField/MathEditPopup";
import {
  focusVisualEditorAtSerializedOffset,
  getFieldSelection,
  registerAsyncFieldBridge,
} from "./latexField/asyncCallbackBridge";
import { Shapes, Table2 } from "lucide-react";

import { resourceApiUrl } from "../api/client";
import { lintMathContent, type MathLintResult } from "../lib/mathLint";
import { isImeComposingKeyboardEvent } from "../lib/ime";
import { TableEditorModal } from "./TableEditorModal";
import {
  defaultSolaireTable,
  serializeSolaireTableBody,
} from "../lib/solaireTable";
import {
  MATH_WIDGET_CLASS,
  DISPLAY_MATH_WIDGET_CLASS,
  MERMAID_WIDGET_CLASS,
  IMAGE_WIDGET_CLASS,
  TABLE_WIDGET_CLASS,
  buildEditorDom,
  createMathWidget,
  createTableWidget,
  getSerializedSelectionOffsets,
  isCollapsedCaretAtEditorEnd,
  isWidget,
  renderMathHtml,
  renderMermaidToElement,
  serializeEditor,
} from "./latexField/contentPreview";



/* ═══════════════════ Component ═══════════════════ */

export type LatexRichTextFieldProps = {
  value: string;
  onChange: (next: string) => void;
  textAreaRef: RefObject<HTMLTextAreaElement | null>;
  /** 赋给同步用隐藏 textarea，便于外部按 id 定位选区（如题库插入片段） */
  syncTextAreaId?: string;
  className?: string;
  minRows?: number;
  placeholder?: string;
  onRequestMermaid?: (sel: { start: number; end: number } | null) => void;
  onRequestPrimeBrush?: (sel: { start: number; end: number } | null) => void;
  onRequestImage?: (sel: { start: number; end: number } | null) => void;
  busy?: boolean;
  /** 日常录题时隐藏重复工具栏；编辑能力保留，由上层统一展开。 */
  hideToolbar?: boolean;
};

type MathPopupState = {
  widget: HTMLElement;
  latex: string;
  isNew: boolean;
} | null;

type MermaidPopupState = {
  widget: HTMLElement;
  source: string;
} | null;

type ImagePopupState = {
  widget: HTMLElement;
  kind: string;
  path: string;
} | null;

type TablePopupState = {
  widget: HTMLElement;
  source: string;
  isNew: boolean;
} | null;

const MATH_LINT_DEBOUNCE_MS = 250;

export function LatexRichTextField({
  value,
  onChange,
  textAreaRef,
  syncTextAreaId,
  className = "",
  minRows = 4,
  placeholder,
  onRequestMermaid,
  onRequestPrimeBrush,
  onRequestImage,
  busy = false,
  hideToolbar = false,
}: LatexRichTextFieldProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const mermaidRenderSeqRef = useRef(0);
  const lastEmittedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const compositionFrameRef = useRef<number | null>(null);
  const compositionFrameVersionRef = useRef(0);
  const compositionCommitCallbackRef = useRef<(() => void) | null>(null);
  const compositionPendingAtUnmountRef = useRef(false);
  const compositionBaseValueRef = useRef(value);
  const compositionCommitTextRef = useRef<string | null>(null);
  const compositionSourceTextRef = useRef<string | null>(null);
  const compositionWaitersRef = useRef<Set<(committed: boolean) => void>>(new Set());
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [lintValue, setLintValue] = useState(value);

  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [sourceComposingValue, setSourceComposingValue] = useState<string | null>(null);
  const sourceComposingValueRef = useRef<string | null>(null);
  sourceComposingValueRef.current = sourceComposingValue;

  /* popup state */
  const [mathPopup, setMathPopup] = useState<MathPopupState>(null);
  const [mathPopupPos, setMathPopupPos] = useState({ top: 0, left: 0 });
  const mathPopupStateRef = useRef<MathPopupState>(null);
  mathPopupStateRef.current = mathPopup;

  const [mermaidPopup, setMermaidPopup] = useState<MermaidPopupState>(null);
  const [mermaidPopupPos, setMermaidPopupPos] = useState({ top: 0, left: 0 });
  const [mermaidDraft, setMermaidDraft] = useState("");
  const mermaidPreviewRef = useRef<HTMLDivElement>(null);
  const mermaidPopupStateRef = useRef<MermaidPopupState>(null);
  mermaidPopupStateRef.current = mermaidPopup;

  const [imagePopup, setImagePopup] = useState<ImagePopupState>(null);
  const [imagePopupPos, setImagePopupPos] = useState({ top: 0, left: 0 });
  const imagePopupStateRef = useRef<ImagePopupState>(null);
  imagePopupStateRef.current = imagePopup;

  const [tablePopup, setTablePopup] = useState<TablePopupState>(null);
  const tablePopupStateRef = useRef<TablePopupState>(null);
  tablePopupStateRef.current = tablePopup;

  const anyPopupOpen = !!(mathPopup || mermaidPopup || imagePopup || tablePopup);

  const minH = `${Math.max(6, minRows * 1.45)}rem`;

  const scheduleCompositionCommit = useCallback((commit: () => void) => {
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current);
    }
    const version = ++compositionFrameVersionRef.current;
    compositionCommitCallbackRef.current = commit;
    compositionFrameRef.current = window.requestAnimationFrame(() => {
      if (version !== compositionFrameVersionRef.current) return;
      compositionFrameRef.current = null;
      const pendingCommit = compositionCommitCallbackRef.current;
      compositionCommitCallbackRef.current = null;
      pendingCommit?.();
    });
  }, []);

  const cancelScheduledCompositionCommit = useCallback(() => {
    compositionFrameVersionRef.current++;
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current);
      compositionFrameRef.current = null;
    }
    compositionCommitCallbackRef.current = null;
  }, []);

  const flushScheduledCompositionCommit = useCallback(() => {
    const pendingCommit = compositionCommitCallbackRef.current;
    if (!pendingCommit) return;
    cancelScheduledCompositionCommit();
    pendingCommit();
  }, [cancelScheduledCompositionCommit]);

  const resolveCompositionWaiters = useCallback((committed: boolean) => {
    const waiters = Array.from(compositionWaitersRef.current);
    compositionWaitersRef.current.clear();
    for (const resolve of waiters) resolve(committed);
  }, []);

  const acknowledgeCompositionValue = useCallback((committedValue: string) => {
    if (compositionCommitTextRef.current !== committedValue) return;
    compositionCommitTextRef.current = null;
    compositionBaseValueRef.current = committedValue;
    resolveCompositionWaiters(true);
  }, [resolveCompositionWaiters]);

  const waitForCompositionCommit = useCallback((): Promise<boolean> => {
    if (
      !composingRef.current &&
      compositionFrameRef.current === null &&
      compositionCommitTextRef.current === null
    ) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => compositionWaitersRef.current.add(resolve));
  }, []);

  useLayoutEffect(() => () => {
    compositionPendingAtUnmountRef.current = (
      composingRef.current ||
      compositionFrameRef.current !== null ||
      compositionCommitCallbackRef.current !== null ||
      compositionCommitTextRef.current !== null
    );
    cancelScheduledCompositionCommit();
    compositionCommitTextRef.current = null;
    compositionSourceTextRef.current = null;
    resolveCompositionWaiters(false);
  }, [cancelScheduledCompositionCommit, resolveCompositionWaiters]);

  /* ─── Lint ─── */
  useEffect(() => {
    if (lintValue === value) return;
    const timer = window.setTimeout(() => setLintValue(value), MATH_LINT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value, lintValue]);

  const lintResults = useMemo<MathLintResult[]>(() => lintMathContent(lintValue), [lintValue]);

  /* ─── Hidden textarea sync ─── */

  const syncHiddenSelection = useCallback((serializedValue?: string) => {
    const editor = editorRef.current;
    const hiddenTextarea = textAreaRef.current;
    const selection = window.getSelection();
    if (
      serializedValue !== undefined &&
      mode === "visual" &&
      editor &&
      hiddenTextarea &&
      selection?.rangeCount === 1 &&
      isCollapsedCaretAtEditorEnd(editor, selection.getRangeAt(0))
    ) {
      try {
        const end = serializedValue.length;
        hiddenTextarea.setSelectionRange(end, end);
      } catch {
        // Keep the established full offset path for unusual textarea states.
        getFieldSelection(
          editor,
          hiddenTextarea,
          sourceTextareaRef.current,
          mode,
          getSerializedSelectionOffsets,
        );
      }
      return;
    }
    getFieldSelection(
      editor,
      hiddenTextarea,
      sourceTextareaRef.current,
      mode,
      getSerializedSelectionOffsets,
    );
  }, [mode, textAreaRef]);
  const handleSelectionEvent = useCallback(() => syncHiddenSelection(), [syncHiddenSelection]);

  const focusAtSerializedOffset = useCallback((offset: number): boolean => {
    if (mode === "source") {
      const textarea = sourceTextareaRef.current;
      if (!textarea) return false;
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      syncHiddenSelection();
      return true;
    }
    const root = editorRef.current;
    if (!root) return false;
    focusVisualEditorAtSerializedOffset(root, offset);
    syncHiddenSelection();
    return true;
  }, [mode, syncHiddenSelection]);

  useLayoutEffect(() => {
    const syncTextarea = textAreaRef.current;
    if (!syncTextarea) return;
    return registerAsyncFieldBridge(syncTextarea, {
      waitForCompositionCommit,
      focusAt: focusAtSerializedOffset,
      hasPendingComposition: () => (
        compositionPendingAtUnmountRef.current ||
        composingRef.current ||
        compositionFrameRef.current !== null ||
        compositionCommitCallbackRef.current !== null ||
        compositionCommitTextRef.current !== null
      ),
    });
  }, [textAreaRef, waitForCompositionCommit, focusAtSerializedOffset]);

  /* ─── Emit changes ─── */

  const emitFromEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return null;
    const next = serializeEditor(root);
    lastEmittedRef.current = next;
    onChangeRef.current(next);
    return next;
  }, []);

  const emitCompositionFromEditor = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    const next = serializeEditor(root);
    lastEmittedRef.current = next;
    compositionCommitTextRef.current = next;
    onChangeRef.current(next);
    syncHiddenSelection(next);
    if (valueRef.current === next) acknowledgeCompositionValue(next);
  }, [syncHiddenSelection, acknowledgeCompositionValue]);

  const emitCompositionFromSource = useCallback((next: string) => {
    lastEmittedRef.current = next;
    compositionCommitTextRef.current = next;
    setSourceComposingValue(null);
    onChangeRef.current(next);
    syncHiddenSelection();
    if (valueRef.current === next) acknowledgeCompositionValue(next);
  }, [syncHiddenSelection, acknowledgeCompositionValue]);

  const handleSourceValueEvent = useCallback((nextValue: string) => {
    if (composingRef.current) {
      compositionSourceTextRef.current = nextValue;
      setSourceComposingValue((prev) => (prev === nextValue ? prev : nextValue));
      return;
    }
    const pendingComposition = (
      compositionFrameRef.current !== null ||
      compositionCommitTextRef.current !== null
    );
    if (nextValue === lastEmittedRef.current) return;
    if (
      sourceComposingValueRef.current === null &&
      !pendingComposition &&
      nextValue === valueRef.current
    ) {
      return;
    }
    setSourceComposingValue(null);
    lastEmittedRef.current = nextValue;
    onChangeRef.current(nextValue);
  }, []);

  useEffect(() => {
    if (mode !== "source") return;
    const textarea = sourceTextareaRef.current;
    if (!textarea) return;
    const onNativeChange = () => handleSourceValueEvent(textarea.value);
    textarea.addEventListener("change", onNativeChange);
    return () => textarea.removeEventListener("change", onNativeChange);
  }, [mode, handleSourceValueEvent]);

  const deleteWidgetWithUndo = useCallback(
    (widget: HTMLElement) => {
      const root = editorRef.current;
      if (!root || !root.contains(widget)) return;

      root.focus();
      const sel = window.getSelection();
      if (!sel) return;

      const range = document.createRange();
      range.selectNode(widget);
      sel.removeAllRanges();
      sel.addRange(range);

      try {
        document.execCommand("delete");
      } catch {
        // Fall back below when the browser refuses the editing command.
      }

      if (widget.isConnected) {
        widget.remove();
      }

      window.requestAnimationFrame(() => {
        const next = emitFromEditor();
        syncHiddenSelection(next ?? undefined);
      });
    },
    [emitFromEditor, syncHiddenSelection],
  );

  /* ─── Rebuild editor from prop ─── */

  useLayoutEffect(() => {
    const compositionPending = (
      composingRef.current ||
      compositionFrameRef.current !== null ||
      compositionCommitTextRef.current !== null
    );
    const expectedCompositionValue = compositionCommitTextRef.current ?? compositionBaseValueRef.current;
    if (compositionPending && value !== expectedCompositionValue) {
      if (!composingRef.current && value === lastEmittedRef.current) {
        // A browser may dispatch the final non-composing input after compositionend.
        // Treat the latest value emitted by this field as the commit and discard the
        // older deferred snapshot so it cannot overwrite input typed immediately after.
        cancelScheduledCompositionCommit();
        compositionCommitTextRef.current = value;
        compositionSourceTextRef.current = null;
      } else {
        composingRef.current = false;
        cancelScheduledCompositionCommit();
        compositionCommitTextRef.current = null;
        compositionSourceTextRef.current = null;
        setSourceComposingValue(null);
        resolveCompositionWaiters(false);
      }
    }
    if (mode === "visual") {
      setSourceComposingValue(null);
      const root = editorRef.current;
      if (!root || composingRef.current) return;
      const isFocused = document.activeElement === root;
      if (!(isFocused && value === lastEmittedRef.current)) {
        // A popup keeps a reference to its widget. Replacing the whole tree while
        // it is open prevents a stale popup from editing a newly supplied value.
        buildEditorDom(root, value, !anyPopupOpen);
        lastEmittedRef.current = value;
      }
    }
    if (!composingRef.current) acknowledgeCompositionValue(value);
  }, [value, mode, acknowledgeCompositionValue, cancelScheduledCompositionCommit, resolveCompositionWaiters]);

  /* ─── Selection tracking ─── */

  useEffect(() => {
    const onSel = () => {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      syncHiddenSelection();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [syncHiddenSelection]);

  /* ═══════════════════ MATH POPUP ═══════════════════ */

  const openMathPopup = useCallback((widget: HTMLElement, latex: string, isNew: boolean) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    const popupW = Math.min(344, vw - 16);
    setMathPopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - popupW - 8)) });
    setMathPopup({ widget, latex, isNew });
  }, []);

  const closeMathPopup = useCallback((confirm: boolean, latexOverride?: string) => {
    const popup = mathPopupStateRef.current;
    if (!popup) return;
    if (confirm) {
      const latex = (latexOverride ?? popup.latex).trim();
      const isDisplay = popup.widget.classList.contains(DISPLAY_MATH_WIDGET_CLASS);
      if (latex) {
        popup.widget.dataset.latex = latex;
        popup.widget.innerHTML = renderMathHtml(latex, isDisplay);
      } else if (popup.isNew) {
        popup.widget.remove();
      }
    } else if (!confirm && popup.isNew) {
      popup.widget.remove();
    }
    setMathPopup(null);
    const root = editorRef.current;
    if (root) {
      const next = serializeEditor(root);
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      root.focus();
    }
  }, []);

  /* ═══════════════════ MERMAID POPUP ═══════════════════ */

  const openMermaidPopup = useCallback((widget: HTMLElement, source: string) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - 500));
    const top = rect.bottom + 6 + 420 > vh ? Math.max(8, rect.top - 426) : rect.bottom + 6;
    setMermaidPopupPos({ top, left });
    setMermaidDraft(source);
    setMermaidPopup({ widget, source });
  }, []);

  const closeMermaidPopup = useCallback((confirm: boolean) => {
    const popup = mermaidPopupStateRef.current;
    if (!popup) return;
    if (confirm) {
      const src = mermaidDraft.trim();
      popup.widget.dataset.mermaidSource = src;
      const preview = popup.widget.querySelector(".mt-1\\.5") as HTMLElement | null;
      if (preview) {
        preview.textContent = "渲染中…";
        preview.classList.remove("text-[var(--or-on-warning)]");
        void renderMermaidToElement(src, preview);
      }
    }
    setMermaidPopup(null);
    const root = editorRef.current;
    if (root) {
      const next = serializeEditor(root);
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      root.focus();
    }
  }, [mermaidDraft]);

  useEffect(() => {
    if (!mermaidPopup || !mermaidPreviewRef.current) return;
    const el = mermaidPreviewRef.current;
    el.textContent = "渲染中…";
    el.classList.remove("text-[var(--or-on-warning)]");
    const seq = ++mermaidRenderSeqRef.current;
    el.dataset.renderSeq = String(seq);
    const timer = setTimeout(() => void renderMermaidToElement(mermaidDraft, el, seq), 400);
    return () => clearTimeout(timer);
  }, [mermaidDraft, mermaidPopup]);

  /* ═══════════════════ IMAGE POPUP ═══════════════════ */

  const openImagePopup = useCallback((widget: HTMLElement, kind: string, path: string) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    const popupW = Math.min(328, vw - 16);
    setImagePopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - popupW - 8)) });
    setImagePopup({ widget, kind, path });
  }, []);

  const closeImagePopup = useCallback(() => {
    setImagePopup(null);
    editorRef.current?.focus();
  }, []);

  const removeImageWidget = useCallback(() => {
    const popup = imagePopupStateRef.current;
    if (!popup) return;
    setImagePopup(null);
    deleteWidgetWithUndo(popup.widget);
  }, [deleteWidgetWithUndo]);

  const removeMermaidWidget = useCallback(() => {
    const popup = mermaidPopupStateRef.current;
    if (!popup) return;
    setMermaidPopup(null);
    deleteWidgetWithUndo(popup.widget);
  }, [deleteWidgetWithUndo]);

  /* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?TABLE POPUP 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

  const openTablePopup = useCallback((widget: HTMLElement, source: string, isNew: boolean) => {
    setTablePopup({ widget, source, isNew });
  }, []);

  const closeTablePopup = useCallback(
    (confirm: boolean, nextSource?: string) => {
      const popup = tablePopupStateRef.current;
      if (!popup) return;
      if (confirm && nextSource != null) {
        const nextWidget = createTableWidget(nextSource);
        popup.widget.replaceWith(nextWidget);
      } else if (!confirm && popup.isNew) {
        popup.widget.remove();
      }
      setTablePopup(null);
      const root = editorRef.current;
      if (root) {
        const next = serializeEditor(root);
        lastEmittedRef.current = next;
        onChangeRef.current(next);
        root.focus();
      }
    },
    [],
  );

  /* ═══════════════════ Outside-click dismiss ═══════════════════ */

  useEffect(() => {
    if (!anyPopupOpen) return;
    const handler = (e: MouseEvent) => {
      const mathEl = document.getElementById("lrt-math-popup");
      const mermaidEl = document.getElementById("lrt-mermaid-popup");
      const imageEl = document.getElementById("lrt-image-popup");
      if (mathEl && !mathEl.contains(e.target as Node)) closeMathPopup(true);
      if (mermaidEl && !mermaidEl.contains(e.target as Node)) closeMermaidPopup(true);
      if (imageEl && !imageEl.contains(e.target as Node)) closeImagePopup();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [anyPopupOpen, closeMathPopup, closeMermaidPopup, closeImagePopup]);

  /* ═══════════════════ Insert helpers ═══════════════════ */

  const insertMathAtCursor = useCallback(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const widget = createMathWidget("");
    range.deleteContents();
    range.insertNode(widget);
    const after = document.createTextNode("\u200B");
    widget.after(after);
    const nr = document.createRange();
    nr.setStartAfter(after);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    openMathPopup(widget, "", true);
  }, [mode, openMathPopup]);

  const insertMathTemplate = useCallback(
    (template: string) => {
      if (mode !== "visual") return;
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const widget = createMathWidget(template);
      range.deleteContents();
      range.insertNode(widget);
      const after = document.createTextNode("\u200B");
      widget.after(after);
      const nr = document.createRange();
      nr.setStartAfter(after);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      openMathPopup(widget, template, true);
    },
    [mode, openMathPopup],
  );

  const insertTableAtCursor = useCallback(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const source = serializeSolaireTableBody(defaultSolaireTable());
    const widget = createTableWidget(source);
    range.deleteContents();
    range.insertNode(widget);
    const after = document.createTextNode("\u200B");
    widget.after(after);
    const nr = document.createRange();
    nr.setStartAfter(after);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    openTablePopup(widget, source, true);
  }, [mode, openTablePopup]);

  const handleRequestMermaid = useCallback(() => {
    const ta = textAreaRef.current;
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    onRequestMermaid?.(sel);
  }, [textAreaRef, onRequestMermaid]);

  const handleRequestPrimeBrush = useCallback(() => {
    const ta = textAreaRef.current;
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    onRequestPrimeBrush?.(sel);
  }, [textAreaRef, onRequestPrimeBrush]);

  const handleRequestImage = useCallback(() => {
    const ta = textAreaRef.current;
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    onRequestImage?.(sel);
  }, [textAreaRef, onRequestImage]);

  /* ═══════════════════ Event handlers ═══════════════════ */

  const handleInput = () => {
    if (composingRef.current) return;
    const next = emitFromEditor();
    syncHiddenSelection(next ?? undefined);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (composingRef.current || isImeComposingKeyboardEvent(e)) return;
    if (anyPopupOpen) return;
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    if (e.key === "$") {
      e.preventDefault();
      const widget = createMathWidget("");
      range.deleteContents();
      range.insertNode(widget);
      const after = document.createTextNode("\u200B");
      widget.after(after);
      const nr = document.createRange();
      nr.setStartAfter(after);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      openMathPopup(widget, "", true);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "m") {
      e.preventDefault();
      insertMathAtCursor();
      return;
    }

    if (!range.collapsed) return;

    if (e.key === "Backspace") {
      const { startContainer, startOffset } = range;
      if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
        const prev = startContainer.previousSibling;
        if (prev instanceof HTMLElement && isWidget(prev)) {
          e.preventDefault();
          deleteWidgetWithUndo(prev);
          return;
        }
      }
      if (startContainer === root && startOffset > 0) {
        const prev = root.childNodes[startOffset - 1];
        if (prev instanceof HTMLElement && isWidget(prev)) {
          e.preventDefault();
          deleteWidgetWithUndo(prev);
        }
      }
      return;
    }

    if (e.key === "Delete") {
      const { startContainer, startOffset } = range;
      if (startContainer === root) {
        const next = root.childNodes[startOffset];
        if (next instanceof HTMLElement && isWidget(next)) {
          e.preventDefault();
          deleteWidgetWithUndo(next);
        }
        return;
      }
      if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.textContent ?? "";
        if (startOffset === text.length) {
          const next = startContainer.nextSibling;
          if (next instanceof HTMLElement && isWidget(next)) {
            e.preventDefault();
            deleteWidgetWithUndo(next);
          }
        }
      }
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const mathW = t.closest?.(`.${MATH_WIDGET_CLASS}`) as HTMLElement | null;
    if (mathW && editorRef.current?.contains(mathW)) {
      e.preventDefault();
      openMathPopup(mathW, mathW.dataset.latex ?? "", false);
      return;
    }
    const dispMathW = t.closest?.(`.${DISPLAY_MATH_WIDGET_CLASS}`) as HTMLElement | null;
    if (dispMathW && editorRef.current?.contains(dispMathW)) {
      e.preventDefault();
      openMathPopup(dispMathW, dispMathW.dataset.latex ?? "", false);
      return;
    }
    const mmdW = t.closest?.(`.${MERMAID_WIDGET_CLASS}`) as HTMLElement | null;
    if (mmdW && editorRef.current?.contains(mmdW)) {
      e.preventDefault();
      openMermaidPopup(mmdW, mmdW.dataset.mermaidSource ?? "");
      return;
    }
    const imgW = t.closest?.(`.${IMAGE_WIDGET_CLASS}`) as HTMLElement | null;
    if (imgW && editorRef.current?.contains(imgW)) {
      e.preventDefault();
      openImagePopup(imgW, imgW.dataset.imageKind ?? "EMBED_IMG", imgW.dataset.imagePath ?? "");
      return;
    }
    const tableW = t.closest?.(`.${TABLE_WIDGET_CLASS}`) as HTMLElement | null;
    if (tableW && editorRef.current?.contains(tableW)) {
      e.preventDefault();
      openTablePopup(tableW, tableW.dataset.tableSource ?? "", false);
      return;
    }
    if (editorRef.current?.contains(t)) syncHiddenSelection();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  /* ─── Mode switching ─── */

  const switchToVisual = useCallback(() => {
    flushScheduledCompositionCommit();
    lastEmittedRef.current = null;
    setMode("visual");
  }, [flushScheduledCompositionCommit]);
  const switchToSource = useCallback(() => {
    flushScheduledCompositionCommit();
    setMode("source");
  }, [flushScheduledCompositionCommit]);

  

  /* ═══════════════════ Render ═══════════════════ */

  return (
    <div className={`relative ${className}`}>
      {/* hidden textarea for external selection sync */}
      <textarea
        ref={textAreaRef as LegacyRef<HTMLTextAreaElement>}
        id={syncTextAreaId}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        value={value}
        readOnly
        onChange={() => {}}
      />

      {/* ── Toolbar ── */}
      {!hideToolbar ?
        <div className="flex flex-wrap items-center gap-1.5 rounded-t-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_90%,transparent)] px-2.5 py-1.5">
        {/* mode toggle */}
        <span className="or-tabs mr-1 inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--or-inset)_80%,transparent)] p-0.5 text-sm">
          <button
            type="button"
            className={`or-tab rounded-full px-3 py-1 text-sm font-medium transition-all ${mode === "visual" ? "bg-[var(--or-card)] text-[var(--or-text)] shadow-sm" : "text-[var(--or-muted)] hover:text-[var(--or-text)]"}`}
            onClick={switchToVisual}
          >
            可视化
          </button>
          <button
            type="button"
            className={`or-tab rounded-full px-3 py-1 text-sm font-medium transition-all ${mode === "source" ? "bg-[var(--or-card)] text-[var(--or-text)] shadow-sm" : "text-[var(--or-muted)] hover:text-[var(--or-text)]"}`}
            onClick={switchToSource}
          >
            源码
          </button>
        </span>

        <div className="mx-0.5 h-4 w-px bg-[var(--or-inset)]" />

        {/* insert math */}
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={insertMathAtCursor}
          title="插入行内公式（快捷键：$ 或 Ctrl+M）"
        >
          <span className="font-serif italic text-sm">Σ</span>
          <span>公式</span>
        </button>

        {/* quick math templates */}
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\frac{}{}")}
          title="分数"
        >
          <sup>a</sup>/<sub>b</sub>
        </button>
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\sqrt{}")}
          title="平方根"
        >
          √
        </button>
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("x^{}")}
          title="上标"
        >
          x<sup>n</sup>
        </button>
        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("x_{}")}
          title="下标"
        >
          x<sub>n</sub>
        </button>

        {/* symbols dropdown */}
        <MathSymbolsDropdown
          disabled={mode !== "visual"}
          onSelectSymbol={insertMathTemplate}
        />

        <div className="mx-0.5 h-4 w-px bg-[var(--or-inset)]" />

        {/* insert primebrush */}
        {onRequestPrimeBrush && (
          <button
            type="button"
            className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] hover:text-[var(--or-on-container)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestPrimeBrush}
            title="插入教育绘图 / PrimeBrush"
          >
            <Shapes className="h-4 w-4 shrink-0" aria-hidden />
            <span>绘图</span>
          </button>
        )}
        {/* insert mermaid */}
        {onRequestMermaid && (
          <button
            type="button"
            className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] hover:text-[var(--or-on-success)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestMermaid}
            title="插入流程图 / Mermaid 图表"
          >
            <span>📊</span>
            <span>图表</span>
          </button>
        )}

        <button
          type="button"
          className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] hover:text-cyan-700 active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
          disabled={mode !== "visual" || busy}
          onClick={insertTableAtCursor}
          title="插入表格"
        >
          <Table2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>表格</span>
        </button>

        {/* insert image */}
        {onRequestImage && (
          <button
            type="button"
            className="or-button or-pill inline-flex items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-outline)_80%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] hover:text-violet-700 active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestImage}
            title="插入图片"
          >
            <span>🖼️</span>
            <span>图片</span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 text-[13px] text-[var(--or-muted)]">
          <kbd className="rounded-md border border-[var(--or-outline)] bg-[var(--or-card)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--or-muted)] shadow-2xs">$</kbd>
          <span>公式</span>
        </div>
      </div> : null}

      {/* ── Editor area ── */}
      {mode === "visual" ? (
        <div
          ref={editorRef}
          className={`w-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--or-text)] outline-none focus-visible:border-[var(--or-primary)] focus-visible:ring-1 focus-visible:ring-[var(--or-focus)] ${hideToolbar ? "rounded-2xl" : "rounded-b-2xl border-t-0"}`}
          style={{ minHeight: minH }}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          spellCheck={false}
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onPaste={handlePaste}
          onCompositionStart={() => {
            cancelScheduledCompositionCommit();
            compositionBaseValueRef.current = valueRef.current;
            lastEmittedRef.current = null;
            compositionSourceTextRef.current = null;
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            const target = e.currentTarget;
            scheduleCompositionCommit(() => {
              emitCompositionFromEditor(target);
            });
          }}
          onKeyUp={handleSelectionEvent}
          onMouseUp={handleSelectionEvent}
        />
      ) : (
        <textarea
          ref={sourceTextareaRef}
          onKeyUp={handleSelectionEvent}
          onMouseUp={handleSelectionEvent}
          className={`w-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2.5 font-mono text-sm leading-relaxed text-[var(--or-text)] outline-none focus-visible:border-[var(--or-primary)] focus-visible:ring-1 focus-visible:ring-[var(--or-focus)] ${hideToolbar ? "rounded-2xl" : "rounded-b-2xl border-t-0"}`}
          style={{ minHeight: minH }}
          value={sourceComposingValue ?? value}
          onInput={(e) => handleSourceValueEvent(e.currentTarget.value)}
          onChange={(e) => handleSourceValueEvent(e.target.value)}
          onCompositionStart={(e) => {
            cancelScheduledCompositionCommit();
            compositionBaseValueRef.current = valueRef.current;
            lastEmittedRef.current = null;
            compositionSourceTextRef.current = null;
            composingRef.current = true;
            setSourceComposingValue(e.currentTarget.value);
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            const targetValue = e.currentTarget.value;
            const next = targetValue !== compositionBaseValueRef.current
              ? targetValue
              : compositionSourceTextRef.current ?? targetValue;
            compositionSourceTextRef.current = null;
            setSourceComposingValue(next);
            scheduleCompositionCommit(() => {
              emitCompositionFromSource(next);
            });
          }}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}

      {/* ── Lint 提示条 ── */}
      {lintResults.length > 0 && (
        <div className="mt-1 space-y-1">
          {lintResults.map((r, i) => (
            <div
              key={`${r.code}-${i}`}
              className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] leading-snug ${
                r.severity === "error"
                  ? "bg-[var(--or-error-container)] text-[var(--or-on-error)]"
                  : "bg-[var(--or-warning-container)] text-[var(--or-on-warning)]"
              }`}
              role="alert"
            >
              <span className="mt-px shrink-0 font-bold">
                {r.severity === "error" ? "✕" : "⚠"}
              </span>
              <span>{r.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Math editing popup ═══ */}
      <MathEditPopup
        open={!!mathPopup}
        isNew={mathPopup?.isNew ?? false}
        position={mathPopupPos}
        initialLatex={mathPopup?.latex ?? ""}
        onConfirm={(latex) => closeMathPopup(true, latex)}
        onCancel={() => closeMathPopup(false)}
      />

      {/* ═══ Mermaid editing popup ═══ */}
      {mermaidPopup && (
        <div
          id="lrt-mermaid-popup"
          className="fixed z-50"
          style={{ top: mermaidPopupPos.top, left: mermaidPopupPos.left }}
        >
          <div className="or-dialog w-[490px] max-w-[calc(100vw-1rem)] rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-3.5 shadow-2xl ring-1 ring-black/5 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--or-on-success)]">编辑 Mermaid 图表</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[13px] font-medium text-[var(--or-muted)]">源码</p>
                <textarea
                  className="or-input h-48 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-2.5 py-2 font-mono text-sm leading-relaxed text-[var(--or-text)] outline-none focus:ring-2 focus:ring-emerald-400"
                  value={mermaidDraft}
                  onChange={(e) => setMermaidDraft(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div>
                <p className="mb-1 text-[13px] font-medium text-[var(--or-muted)]">预览</p>
                <div
                  ref={mermaidPreviewRef}
                  className="flex h-48 items-center justify-center overflow-auto rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] p-2 text-[13px] text-[var(--or-muted)]"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                className="or-button or-button-danger or-pill inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--or-on-error)] hover:bg-[var(--or-error-container)]"
                onClick={removeMermaidWidget}
              >
                删除图表
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)]"
                  onClick={() => closeMermaidPopup(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="or-button or-button-primary or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-on-primary)] hover:bg-[var(--or-primary)]"
                  onClick={() => closeMermaidPopup(true)}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Image popup ═══ */}
      {imagePopup && (
        <div
          id="lrt-image-popup"
          className="fixed z-50"
          style={{ top: imagePopupPos.top, left: imagePopupPos.left }}
        >
          <div className="or-dialog w-80 max-w-[95vw] rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-4 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-violet-700">图片</span>
              <span className="truncate text-[13px] text-[var(--or-muted)]">
                {imagePopup.path.trim().split("/").pop()}
              </span>
            </div>
            <img
              src={resourceApiUrl(imagePopup.path.trim())}
              alt=""
              className="max-h-64 w-full rounded-xl border border-[var(--or-outline)] object-contain"
            />
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                className="or-button or-button-danger or-pill inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--or-on-error)] hover:bg-[var(--or-error-container)]"
                onClick={removeImageWidget}
              >
                删除图片
              </button>
              <button
                type="button"
                className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)]"
                onClick={closeImagePopup}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <TableEditorModal
        open={!!tablePopup}
        initialSource={tablePopup?.source}
        onClose={() => closeTablePopup(false)}
        onConfirm={(source) => closeTablePopup(true, source)}
      />
    </div>
  );
}
