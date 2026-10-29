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
import { getFieldSelection } from "./latexField/asyncCallbackBridge";
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
  getSerializedCaretOffset,
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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [mode, setMode] = useState<"visual" | "source">("visual");

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
    compositionFrameRef.current = window.requestAnimationFrame(() => {
      if (version !== compositionFrameVersionRef.current) return;
      compositionFrameRef.current = null;
      commit();
    });
  }, []);

  useLayoutEffect(() => () => {
    compositionFrameVersionRef.current++;
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current);
      compositionFrameRef.current = null;
    }
  }, []);

  /* ─── Lint ─── */
  const lintResults = useMemo<MathLintResult[]>(() => lintMathContent(value), [value]);

  /* ─── Hidden textarea sync ─── */

  const syncHiddenSelection = useCallback(() => {
    getFieldSelection(
      editorRef.current,
      textAreaRef.current,
      sourceTextareaRef.current,
      mode,
      getSerializedCaretOffset,
    );
  }, [mode, textAreaRef]);

  /* ─── Emit changes ─── */

  const emitFromEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const next = serializeEditor(root);
    lastEmittedRef.current = next;
    onChangeRef.current(next);
  }, []);

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
        emitFromEditor();
        syncHiddenSelection();
      });
    },
    [emitFromEditor, syncHiddenSelection],
  );

  /* ─── Rebuild editor from prop ─── */

  useLayoutEffect(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    if (composingRef.current) return;
    const isFocused = document.activeElement === root;
    if (isFocused && value === lastEmittedRef.current) return;
    // A popup keeps a reference to its widget. Replacing the whole tree while
    // it is open prevents a stale popup from editing a newly supplied value.
    buildEditorDom(root, value, !anyPopupOpen);
    lastEmittedRef.current = value;
  }, [value, mode]);

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
    setMathPopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - 340)) });
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
        preview.classList.remove("text-amber-600");
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
    el.classList.remove("text-amber-600");
    const seq = ++mermaidRenderSeqRef.current;
    el.dataset.renderSeq = String(seq);
    const timer = setTimeout(() => void renderMermaidToElement(mermaidDraft, el, seq), 400);
    return () => clearTimeout(timer);
  }, [mermaidDraft, mermaidPopup]);

  /* ═══════════════════ IMAGE POPUP ═══════════════════ */

  const openImagePopup = useCallback((widget: HTMLElement, kind: string, path: string) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    setImagePopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - 340)) });
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
    emitFromEditor();
    syncHiddenSelection();
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
    lastEmittedRef.current = null;
    setMode("visual");
  }, []);
  const switchToSource = useCallback(() => setMode("source"), []);

  

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
      {!hideToolbar ? <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100/80 px-1.5 py-1">
        {/* mode toggle */}
        <span className="mr-0.5 inline-flex overflow-hidden rounded border border-slate-200 bg-white text-[11px]">
          <button
            type="button"
            className={`px-2 py-0.5 font-medium transition-colors ${mode === "visual" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            onClick={switchToVisual}
          >
            可视化
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 font-medium transition-colors ${mode === "source" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            onClick={switchToSource}
          >
            源码
          </button>
        </span>

        <div className="mx-1 h-4 w-px bg-slate-300" />

        {/* insert math */}
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-blue-700 hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={insertMathAtCursor}
          title="插入行内公式（快捷键：$ 或 Ctrl+M）"
        >
          <span className="font-serif italic">Σ</span>
          <span className="ml-0.5 text-[10px]">公式</span>
        </button>

        {/* quick math templates */}
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\frac{}{}")}
          title="分数"
        >
          <sup>a</sup>/<sub>b</sub>
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\sqrt{}")}
          title="平方根"
        >
          √
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("x^{}")}
          title="上标"
        >
          x<sup>n</sup>
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
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

        <div className="mx-1 h-4 w-px bg-slate-300" />

        {/* insert primebrush */}
        {onRequestPrimeBrush && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-sky-700 hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestPrimeBrush}
            title="插入教育绘图 / PrimeBrush"
          >
            <Shapes className="h-3.5 w-3.5" aria-hidden />
            <span>绘图</span>
          </button>
        )}
        {/* insert mermaid */}
        {onRequestMermaid && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-emerald-700 hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestMermaid}
            title="插入流程图 / Mermaid 图表"
          >
            <span className="mr-0.5">📊</span>图表
          </button>
        )}

        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-cyan-700 hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual" || busy}
          onClick={insertTableAtCursor}
          title="插入表格"
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          <span>表格</span>
        </button>

        {/* insert image */}
        {onRequestImage && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-violet-700 hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestImage}
            title="插入图片"
          >
            <span className="mr-0.5">🖼️</span>图片
          </button>
        )}

        <div className="ml-auto text-[10px] text-slate-400">
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1">$</kbd> 公式
        </div>
      </div> : null}

      {/* ── Editor area ── */}
      {mode === "visual" ? (
        <div
          ref={editorRef}
          className={`w-full border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-0 ${hideToolbar ? "rounded-md" : "rounded-b-md border-t-0"}`}
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
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            scheduleCompositionCommit(() => {
              emitFromEditor();
              syncHiddenSelection();
            });
          }}
          onKeyUp={syncHiddenSelection}
          onMouseUp={syncHiddenSelection}
        />
      ) : (
        <textarea
          ref={sourceTextareaRef}
          onKeyUp={syncHiddenSelection}
          onMouseUp={syncHiddenSelection}
          className={`w-full border border-slate-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${hideToolbar ? "rounded-md" : "rounded-b-md border-t-0"}`}
          style={{ minHeight: minH }}
          value={value}
          onChange={(e) => {
            if (composingRef.current) return;
            lastEmittedRef.current = e.target.value;
            onChange(e.target.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            const target = e.currentTarget;
            scheduleCompositionCommit(() => {
              lastEmittedRef.current = target.value;
              onChangeRef.current(target.value);
            });
          }}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}

      {/* ── Lint 提示条 ── */}
      {lintResults.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {lintResults.map((r, i) => (
            <div
              key={`${r.code}-${i}`}
              className={`flex items-start gap-1.5 rounded px-2 py-1 text-[11px] leading-snug ${
                r.severity === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-700"
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
          <div className="w-[480px] max-w-[95vw] rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">编辑 Mermaid 图表</span>
              <span className="text-[10px] text-slate-400">编辑源码，实时预览</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">源码</p>
                <textarea
                  className="h-48 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
                  value={mermaidDraft}
                  onChange={(e) => setMermaidDraft(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">预览</p>
                <div
                  ref={mermaidPreviewRef}
                  className="flex h-48 items-center justify-center overflow-auto rounded-md border border-slate-200 bg-white p-1 text-xs text-slate-400"
                />
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={removeMermaidWidget}
              >
                删除图表
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  onClick={() => closeMermaidPopup(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
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
          <div className="w-80 max-w-[95vw] rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-700">图片</span>
              <span className="truncate text-[10px] text-slate-400">
                {imagePopup.path.trim().split("/").pop()}
              </span>
            </div>
            <img
              src={resourceApiUrl(imagePopup.path.trim())}
              alt=""
              className="max-h-64 w-full rounded-md border border-slate-200 object-contain"
            />
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={removeImageWidget}
              >
                删除图片
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
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
