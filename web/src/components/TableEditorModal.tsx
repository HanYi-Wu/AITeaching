import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Columns3,
  Merge,
  Plus,
  Rows3,
  Split,
  Trash2,
  X,
} from "lucide-react";

import {
  anchorsToSolaireTable,
  defaultSolaireTable,
  expandSolaireTable,
  parseSolaireTable,
  serializeSolaireTableBody,
  type SolaireTableCell,
  type SolaireTableDoc,
} from "../lib/solaireTable";

type Selection = { r1: number; c1: number; r2: number; c2: number };
type EditingCell = { row: number; col: number; value: string } | null;

type TableEditorModalProps = {
  open: boolean;
  initialSource?: string;
  onClose: () => void;
  onConfirm: (source: string) => void;
};

function rect(sel: Selection) {
  return {
    top: Math.min(sel.r1, sel.r2),
    bottom: Math.max(sel.r1, sel.r2),
    left: Math.min(sel.c1, sel.c2),
    right: Math.max(sel.c1, sel.c2),
  };
}

function spans(cell: SolaireTableCell) {
  return { rowSpan: cell.rowSpan ?? 1, colSpan: cell.colSpan ?? 1 };
}

function intersects(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function cellRect(anchor: { row: number; col: number; cell: SolaireTableCell }) {
  const s = spans(anchor.cell);
  return {
    top: anchor.row,
    bottom: anchor.row + s.rowSpan - 1,
    left: anchor.col,
    right: anchor.col + s.colSpan - 1,
  };
}

function containsRect(
  outer: { top: number; bottom: number; left: number; right: number },
  inner: { top: number; bottom: number; left: number; right: number },
) {
  return (
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom &&
    outer.left <= inner.left &&
    outer.right >= inner.right
  );
}

function patchCell(
  doc: SolaireTableDoc,
  row: number,
  col: number,
  updater: (cell: SolaireTableCell) => SolaireTableCell,
): SolaireTableDoc {
  const expanded = expandSolaireTable(doc);
  const anchors = expanded.anchors.map((a) => {
    if (a.row === row && a.col === col) {
      return { row: a.row, col: a.col, cell: updater({ ...a.cell }) };
    }
    return { row: a.row, col: a.col, cell: { ...a.cell } };
  });
  return anchorsToSolaireTable(anchors, expanded.height);
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] shadow-2xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TableEditorModal({ open, initialSource, onClose, onConfirm }: TableEditorModalProps) {
  const [doc, setDoc] = useState<SolaireTableDoc>(() => defaultSolaireTable());
  const [selection, setSelection] = useState<Selection>({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    try {
      setDoc(initialSource?.trim() ? parseSolaireTable(initialSource) : defaultSolaireTable());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDoc(defaultSolaireTable());
    }
    setSelection({ r1: 0, c1: 0, r2: 0, c2: 0 });
    setEditingCell(null);
  }, [open, initialSource]);

  const expanded = useMemo(() => expandSolaireTable(doc), [doc]);
  const activeSlot = expanded.slots[selection.r1]?.[selection.c1];
  const activeAnchor = activeSlot
    ? expanded.anchors.find((a) => a.row === activeSlot.anchorRow && a.col === activeSlot.anchorCol)
    : null;
  const activeCell = activeAnchor?.cell ?? null;
  const selectedRect = rect(selection);

  if (!open) return null;

  function applyAnchors(
    updater: (
      anchors: Array<{ row: number; col: number; cell: SolaireTableCell }>,
      expandedHeight: number,
      expandedWidth: number,
    ) => {
      anchors: Array<{ row: number; col: number; cell: SolaireTableCell }>;
      height?: number;
      selection?: Selection;
    },
  ) {
    try {
      const current = expandSolaireTable(doc);
      const result = updater(
        current.anchors.map((a) => ({ row: a.row, col: a.col, cell: { ...a.cell } })),
        current.height,
        current.width,
      );
      setDoc(anchorsToSolaireTable(result.anchors, result.height ?? current.height));
      if (result.selection) setSelection(result.selection);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function mergeSelection() {
    const target = selectedRect;
    const selectedAnchors = expanded.anchors.filter((a) => intersects(cellRect(a), target));
    if (selectedAnchors.length < 2) return;
    if (!selectedAnchors.every((a) => containsRect(target, cellRect(a)))) {
      setError("选区不能切开已有合并单元格。");
      return;
    }
    const mergedText = selectedAnchors
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((a) => a.cell.text.trim())
      .filter(Boolean)
      .join("\n");
    applyAnchors((anchors, height) => ({
      height,
      anchors: [
        ...anchors.filter((a) => !intersects(cellRect(a), target)),
        {
          row: target.top,
          col: target.left,
          cell: {
            text: mergedText,
            header: selectedAnchors.every((a) => a.cell.header === true) || undefined,
            align: selectedAnchors[0]?.cell.align,
            rowSpan: target.bottom - target.top + 1,
            colSpan: target.right - target.left + 1,
          },
        },
      ],
      selection: { r1: target.top, c1: target.left, r2: target.top, c2: target.left },
    }));
  }

  function splitActiveCell() {
    if (!activeAnchor) return;
    const s = spans(activeAnchor.cell);
    if (s.rowSpan === 1 && s.colSpan === 1) return;
    applyAnchors((anchors, height) => {
      const next = anchors.filter((a) => !(a.row === activeAnchor.row && a.col === activeAnchor.col));
      for (let r = activeAnchor.row; r < activeAnchor.row + s.rowSpan; r += 1) {
        for (let c = activeAnchor.col; c < activeAnchor.col + s.colSpan; c += 1) {
          next.push({
            row: r,
            col: c,
            cell: {
              text: r === activeAnchor.row && c === activeAnchor.col ? activeAnchor.cell.text : "",
              header: activeAnchor.cell.header,
              align: activeAnchor.cell.align,
            },
          });
        }
      }
      return { anchors: next, height };
    });
  }

  function updateActiveCell(updater: (cell: SolaireTableCell) => SolaireTableCell) {
    if (!activeAnchor) return;
    try {
      setDoc(patchCell(doc, activeAnchor.row, activeAnchor.col, updater));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function docWithCommittedEditing(): SolaireTableDoc {
    if (!editingCell) return doc;
    try {
      return patchCell(doc, editingCell.row, editingCell.col, (cell) => ({
        ...cell,
        text: editingCell.value,
      }));
    } catch {
      return doc;
    }
  }

  function addRow() {
    const committed = docWithCommittedEditing();
    const exp = expandSolaireTable(committed);
    setDoc({
      ...committed,
      rows: [...committed.rows, Array.from({ length: exp.width }, () => ({ text: "" }))],
    });
  }

  function addColumn() {
    const committed = docWithCommittedEditing();
    setDoc({
      ...committed,
      rows: committed.rows.map((row) => [...row, { text: "" }]),
    });
  }

  function deleteLastRow() {
    const committed = docWithCommittedEditing();
    if (committed.rows.length <= 1) return;
    setDoc({
      ...committed,
      rows: committed.rows.slice(0, -1),
    });
  }

  function deleteLastColumn() {
    const committed = docWithCommittedEditing();
    const exp = expandSolaireTable(committed);
    if (exp.width <= 1) return;
    setDoc({
      ...committed,
      rows: committed.rows.map((row) => row.slice(0, -1)),
    });
  }

  function beginEditing(row: number, col: number, text: string) {
    setEditingCell({ row, col, value: text });
  }

  function commitEditing() {
    if (!editingCell) return;
    setDoc(docWithCommittedEditing());
    setEditingCell(null);
  }

  function cancelEditing() {
    setEditingCell(null);
  }

  function selectCell(r: number, c: number, extend = false) {
    if (extend) {
      setSelection((prev) => ({ ...prev, r2: r, c2: c }));
    } else {
      setSelection({ r1: r, c1: c, r2: r, c2: c });
    }
  }

  const activeAlign = activeCell?.align ?? "left";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-2.5 sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="编辑表格" className="or-dialog or-g48-dialog flex max-h-[92vh] w-[940px] max-w-[96vw] flex-col rounded-3xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] shadow-2xl ring-1 ring-black/5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--or-outline)] px-3.5 py-3 sm:px-5 sm:py-3.5">
          <div>
            <h3 className="text-base font-semibold text-[var(--or-text)]">编辑表格</h3>
            <p className="mt-0.5 text-[13px] text-[var(--or-muted)]">拖选单元格后可合并；双击单元格编辑，Enter 确认。</p>
          </div>
          <button
            type="button"
            className="or-icon-button inline-flex h-8 w-8 items-center justify-center rounded-full text-sm text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] px-4 py-2">
          <IconButton title="增加行" onClick={addRow}>
            <Rows3 className="h-4 w-4" />
            <Plus className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="增加列" onClick={addColumn}>
            <Columns3 className="h-4 w-4" />
            <Plus className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="删除最后一行" onClick={deleteLastRow} disabled={expanded.height <= 1}>
            <Rows3 className="h-4 w-4" />
            <Trash2 className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="删除最后一列" onClick={deleteLastColumn} disabled={expanded.width <= 1}>
            <Columns3 className="h-4 w-4" />
            <Trash2 className="-ml-1 h-3 w-3" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-[var(--or-inset)]" />
          <IconButton title="合并选区" onClick={mergeSelection}>
            <Merge className="h-4 w-4" />
          </IconButton>
          <IconButton title="拆分单元格" onClick={splitActiveCell} disabled={!activeCell || ((activeCell.rowSpan ?? 1) === 1 && (activeCell.colSpan ?? 1) === 1)}>
            <Split className="h-4 w-4" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-[var(--or-inset)]" />
          <IconButton title="左对齐" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "left" }))}>
            <AlignLeft className={activeAlign === "left" ? "h-4 w-4 text-[var(--or-on-container)]" : "h-4 w-4"} />
          </IconButton>
          <IconButton title="居中" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "center" }))}>
            <AlignCenter className={activeAlign === "center" ? "h-4 w-4 text-[var(--or-on-container)]" : "h-4 w-4"} />
          </IconButton>
          <IconButton title="右对齐" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "right" }))}>
            <AlignRight className={activeAlign === "right" ? "h-4 w-4 text-[var(--or-on-container)]" : "h-4 w-4"} />
          </IconButton>
          <button
            type="button"
            className={`or-button or-pill inline-flex h-8 items-center justify-center rounded-full border px-3.5 text-sm font-medium transition-colors ${
              activeCell?.header ? "border-blue-300 bg-[var(--or-primary-container)] text-[var(--or-on-container)]" : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-muted)] hover:bg-[var(--or-page)]"
            }`}
            onClick={() => updateActiveCell((cell) => ({ ...cell, header: !cell.header || undefined }))}
          >
            表头
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-2.5 sm:p-4">
          <div className="h-full min-h-0 overflow-auto rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_50%,transparent)] p-2.5">
            <table className="min-w-full border-collapse bg-[var(--or-card)] text-sm" onMouseUp={() => setDragging(false)}>
              <tbody>
                {expanded.slots.map((row, r) => (
                  <tr key={r}>
                    {row.map((slot, c) => {
                      if (slot.covered) return null;
                      const CellTag = slot.cell.header ? "th" : "td";
                      const s = spans(slot.cell);
                      const cr = cellRect({ row: r, col: c, cell: slot.cell });
                      const selected = intersects(cr, selectedRect);
                      const editing = editingCell?.row === r && editingCell?.col === c;
                      return (
                        <CellTag
                          key={`${r}-${c}`}
                          rowSpan={s.rowSpan}
                          colSpan={s.colSpan}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setDragging(true);
                            selectCell(r, c, e.shiftKey);
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            beginEditing(r, c, slot.cell.text);
                          }}
                          onMouseEnter={() => {
                            if (dragging) selectCell(r, c, true);
                          }}
                          className={`min-w-24 cursor-cell border px-2.5 py-2 align-top ${
                            selected ? "border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary-container)_70%,transparent)] ring-1 ring-inset ring-[var(--or-focus)]" : "border-[var(--or-outline)]"
                          } ${slot.cell.header ? "font-semibold text-[var(--or-text)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)]" : "text-[var(--or-muted)]"}`}
                          style={{ textAlign: slot.cell.align ?? "left" }}
                        >
                          {editing ? (
                            <textarea
                              autoFocus
                              className="block min-h-16 w-full resize-none rounded-lg border border-[var(--or-primary)] bg-[var(--or-card)] px-2 py-1 text-sm font-normal leading-relaxed text-[var(--or-text)] outline-none ring-2 ring-blue-200"
                              value={editingCell.value}
                              onMouseDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setEditingCell((cur) =>
                                  cur && cur.row === r && cur.col === c ? { ...cur, value: e.target.value } : cur,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  commitEditing();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEditing();
                                }
                              }}
                              onBlur={commitEditing}
                              spellCheck={false}
                            />
                          ) : (
                            <span className="whitespace-pre-wrap break-words">{slot.cell.text || "\u00a0"}</span>
                          )}
                        </CellTag>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--or-muted)]">
            <span>{expanded.height} 行 x {expanded.width} 列 · 双击单元格编辑，Enter 确认，Shift+Enter 换行</span>
            {error && <span className="or-pill rounded-full bg-[var(--or-error-container)] px-2.5 py-0.5 text-[13px] font-medium text-[var(--or-on-error)]">{error}</span>}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 border-t border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-3 sm:px-5 sm:py-3.5">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-full bg-[var(--or-primary)] px-4 text-sm font-medium text-[var(--or-on-primary)] shadow-sm hover:bg-[var(--or-primary)] active:bg-slate-950 transition-colors"
            onClick={() => {
              const next = docWithCommittedEditing();
              setDoc(next);
              setEditingCell(null);
              onConfirm(serializeSolaireTableBody(next));
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
