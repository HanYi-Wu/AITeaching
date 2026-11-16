import {
  isWidget,
  widgetSerializedLength,
  type SerializedSelectionOffsets,
} from "./contentPreview";

export type FieldSelection = { start: number; end: number };

export interface AsyncFieldBridge {
  waitForCompositionCommit: () => Promise<boolean>;
  focusAt: (serializedOffset: number) => boolean;
  hasPendingComposition: () => boolean;
}

const asyncFieldBridges = new WeakMap<HTMLTextAreaElement, AsyncFieldBridge>();
const detachedFieldHadPendingComposition = new WeakMap<HTMLTextAreaElement, boolean>();

export function registerAsyncFieldBridge(
  syncTextarea: HTMLTextAreaElement,
  bridge: AsyncFieldBridge,
): () => void {
  asyncFieldBridges.set(syncTextarea, bridge);
  detachedFieldHadPendingComposition.delete(syncTextarea);
  return () => {
    if (asyncFieldBridges.get(syncTextarea) === bridge) {
      asyncFieldBridges.delete(syncTextarea);
      detachedFieldHadPendingComposition.set(syncTextarea, bridge.hasPendingComposition());
    }
  };
}

export function waitForAsyncFieldCompositionCommit(
  syncTextarea: HTMLTextAreaElement | null,
): Promise<boolean> {
  if (!syncTextarea) return Promise.resolve(true);
  if (!syncTextarea.isConnected) {
    return Promise.resolve(detachedFieldHadPendingComposition.get(syncTextarea) !== true);
  }
  const bridge = asyncFieldBridges.get(syncTextarea);
  return bridge ? bridge.waitForCompositionCommit() : Promise.resolve(true);
}

export function focusAsyncFieldAt(
  syncTextarea: HTMLTextAreaElement | null,
  serializedOffset: number,
): boolean {
  if (!syncTextarea?.isConnected) return false;
  const bridge = asyncFieldBridges.get(syncTextarea);
  if (bridge) return bridge.focusAt(serializedOffset);
  if (syncTextarea.classList.contains("sr-only") || syncTextarea.readOnly) return false;
  syncTextarea.focus();
  syncTextarea.setSelectionRange(serializedOffset, serializedOffset);
  return true;
}

function setVisualCaretAtSerializedOffset(root: HTMLElement, serializedOffset: number): void {
  const range = document.createRange();
  let remaining = Math.max(0, serializedOffset);
  let placed = false;

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        placed = true;
        return true;
      }
      remaining -= length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const element = node as HTMLElement;
    if (isWidget(element)) {
      const length = widgetSerializedLength(element);
      if (remaining === 0) {
        range.setStartBefore(element);
        placed = true;
        return true;
      }
      if (remaining <= length) {
        range.setStartAfter(element);
        placed = true;
        return true;
      }
      remaining -= length;
      return false;
    }
    if (element.tagName === "BR") {
      if (remaining === 0) {
        range.setStartBefore(element);
        placed = true;
        return true;
      }
      if (remaining === 1) {
        range.setStartAfter(element);
        placed = true;
        return true;
      }
      remaining--;
      return false;
    }
    for (const child of element.childNodes) {
      if (walk(child)) return true;
    }
    return false;
  };

  for (const child of root.childNodes) {
    if (walk(child)) break;
  }
  if (!placed) range.setStart(root, root.childNodes.length);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

export function focusVisualEditorAtSerializedOffset(
  root: HTMLElement,
  serializedOffset: number,
): void {
  root.focus();
  setVisualCaretAtSerializedOffset(root, serializedOffset);
}

/**
 * 统一获取当前字段选区。
 * 在可视化模式优先计算 DOM 选区并同步至隐藏 textarea；
 * 在源码模式计算源码 textarea 选区并同步至隐藏 textarea；
 * 确保外部延迟回调或插入时拿到的选区是最新的。
 */
export function getFieldSelection(
  editorEl: HTMLElement | null,
  hiddenTextareaEl: HTMLTextAreaElement | null,
  sourceTextareaEl: HTMLTextAreaElement | null,
  mode: "visual" | "source",
  getSerializedSelectionOffsetsFn: (root: HTMLElement, range: Range) => SerializedSelectionOffsets,
): FieldSelection {
  if (mode === "source" && sourceTextareaEl) {
    const start = sourceTextareaEl.selectionStart ?? 0;
    const end = sourceTextareaEl.selectionEnd ?? 0;
    if (hiddenTextareaEl) {
      try {
        hiddenTextareaEl.setSelectionRange(start, end);
      } catch {
        // safe fallback
      }
    }
    return { start, end };
  }

  if (editorEl) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editorEl.contains(r.commonAncestorContainer)) {
        const { start, end } = getSerializedSelectionOffsetsFn(editorEl, r);

        const min = Math.min(start, end);
        const max = Math.max(start, end);
        if (hiddenTextareaEl) {
          try {
            hiddenTextareaEl.setSelectionRange(min, max);
          } catch {
            // safe fallback
          }
        }
        return { start: min, end: max };
      }
    }
  }

  if (hiddenTextareaEl) {
    return {
      start: hiddenTextareaEl.selectionStart ?? 0,
      end: hiddenTextareaEl.selectionEnd ?? 0,
    };
  }

  return { start: 0, end: 0 };
}
