export type FieldSelection = { start: number; end: number };

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
  getSerializedCaretOffsetFn: (root: HTMLElement, range: Range) => number,
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
        const rs = document.createRange();
        rs.setStart(r.startContainer, r.startOffset);
        rs.collapse(true);
        const start = getSerializedCaretOffsetFn(editorEl, rs);

        const re = document.createRange();
        re.setStart(r.endContainer, r.endOffset);
        re.collapse(true);
        const end = r.collapsed ? start : getSerializedCaretOffsetFn(editorEl, re);

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

/**
 * 迟到写入防护：
 * 当用户正在当前字段活跃输入（包括中文 IME 组合输入中）时，
 * 若外部迟到回调带来与本地输入不一致的旧快照，拦截该次更新，
 * 避免后来输入被迟到回调覆盖。
 */
export function shouldIgnoreLateValueUpdate(
  incomingValue: string,
  lastEmittedValue: string | null,
  isFocused: boolean,
  isComposing: boolean,
): boolean {
  if (isComposing) {
    return true;
  }
  if (!isFocused || lastEmittedValue === null) {
    return false;
  }
  // 用户正处于聚焦输入中，且收到的外部值不等于最新已发射的值
  if (incomingValue !== lastEmittedValue) {
    return true;
  }
  return false;
}
