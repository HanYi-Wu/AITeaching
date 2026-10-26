import { useEffect, useRef, useState, type ReactNode } from "react";
import { Folder } from "lucide-react";
import {
  boxSelection,
  rangeSelection,
  toggleSingleSelection,
} from "../pages/bank/bankOperationModel";

export interface BankFileGridItem {
  qualified_id: string;
  content_preview?: string;
}

export interface BankFileGridProps<T extends BankFileGridItem> {
  folders: string[];
  questions: T[];
  selectedFolder: string;
  focusedFolder: string;
  dropHighlight: string | null;
  selectedIds: string[];
  busy: boolean;
  clipboard: { ids?: string[]; folder?: string } | null;
  onSelectIds?: (ids: string[]) => void;
  onSetFocusedFolder: (folder: string) => void;
  onOpenFolder: (folder: string) => void;
  onOpenItem?: (id: string) => void;
  onContextMenu: (info: { x: number; y: number; folder: string | null; id?: string }) => void;
  onStartDrag: (event: React.DragEvent, id?: string, folder?: string) => void;
  onDrop: (event: React.DragEvent, target: string) => void;
  onCut: () => void;
  onPaste: () => void;
  onToggleAll: (path: string) => void;
  onClearSelection: () => void;
}

export function BankFileGrid<T extends BankFileGridItem>({
  folders,
  questions,
  selectedFolder,
  focusedFolder,
  dropHighlight,
  selectedIds,
  busy,
  clipboard: _clipboard,
  onSelectIds,
  onSetFocusedFolder,
  onOpenFolder,
  onOpenItem,
  onContextMenu,
  onStartDrag,
  onDrop,
  onCut,
  onPaste,
  onToggleAll,
  onClearSelection,
}: BankFileGridProps<T>): ReactNode {
  const [rectangle, setRectangle] = useState<{
    x: number;
    y: number;
    right: number;
    bottom: number;
  } | null>(null);

  const drag = useRef<{ x: number; y: number; base: string[] } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  // Clean up drag and marquee rectangle if window loses focus or pointer is lost
  useEffect(() => {
    const cancelMarquee = () => {
      if (drag.current) {
        drag.current = null;
        setRectangle(null);
      }
    };
    window.addEventListener("blur", cancelMarquee);
    return () => {
      window.removeEventListener("blur", cancelMarquee);
      cancelMarquee();
    };
  }, []);

  return (
    <>
      <div
        ref={grid}
        data-file-area
        tabIndex={0}
        aria-label="题库文件区域"
        className="relative min-h-0 flex-1 select-none overflow-auto bg-slate-50 p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, selectedFolder)}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest("[data-question],[data-folder]")) {
            e.preventDefault();
            onSetFocusedFolder("");
            onContextMenu({ x: e.clientX, y: e.clientY, folder: null });
          }
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) {
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            onToggleAll(selectedFolder);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
            e.preventDefault();
            if (!busy) onCut();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
            e.preventDefault();
            if (!busy) onPaste();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onClearSelection();
          }
        }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          // Guard: edit inputs, text selection, buttons, and question/folder items must NOT trigger marquee box selection
          if (
            event.button !== 0 ||
            target.closest("button, input, textarea, select, [contenteditable='true'], [data-question], [data-folder]")
          ) {
            return;
          }

          // If user has active text selection, do not start marquee
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && selection.toString().trim()) {
            return;
          }

          drag.current = {
            x: event.clientX,
            y: event.clientY,
            base: event.ctrlKey || event.metaKey ? selectedIds : [],
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          onSelectIds?.(drag.current.base);
          onSetFocusedFolder("");
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const box = {
            x: Math.min(drag.current.x, event.clientX),
            y: Math.min(drag.current.y, event.clientY),
            right: Math.max(drag.current.x, event.clientX),
            bottom: Math.max(drag.current.y, event.clientY),
          };
          setRectangle(box);
          const ids = [
            ...(grid.current?.querySelectorAll<HTMLElement>("[data-question]") ?? []),
          ]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.right >= box.x &&
                rect.left <= box.right &&
                rect.bottom >= box.y &&
                rect.top <= box.bottom
              );
            })
            .map((element) => element.dataset.question!);
          onSelectIds?.(boxSelection(drag.current.base, ids));
        }}
        onPointerUp={(event) => {
          if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          drag.current = null;
          setRectangle(null);
        }}
        onPointerCancel={(event) => {
          if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          drag.current = null;
          setRectangle(null);
        }}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {folders.map((path) => (
            <button
              key={path}
              data-folder={path}
              draggable
              onDragStart={(e) => onStartDrag(e, undefined, path)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, path)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSetFocusedFolder(path);
                onSelectIds?.([]);
                onContextMenu({ x: e.clientX, y: e.clientY, folder: path });
              }}
              className={`rounded border p-3 text-left ${
                focusedFolder === path || dropHighlight === path
                  ? "border-blue-500 bg-blue-100"
                  : "bg-amber-50"
              }`}
              onClick={() => {
                onSetFocusedFolder(path);
                onSelectIds?.([]);
              }}
              onDoubleClick={() => {
                onOpenFolder(path);
              }}
            >
              <Folder className="h-6 w-6 text-amber-600" />
              {path.split("/").at(-1)}
            </button>
          ))}
          {questions.map((item) => (
            <div
              key={item.qualified_id}
              data-question={item.qualified_id}
              draggable
              onDragStart={(e) => onStartDrag(e, item.qualified_id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedIds.includes(item.qualified_id)) {
                  onSelectIds?.([item.qualified_id]);
                }
                onSetFocusedFolder("");
                onContextMenu({ x: e.clientX, y: e.clientY, folder: null, id: item.qualified_id });
              }}
              onDoubleClick={() => {
                onOpenItem?.(item.qualified_id);
              }}
              role="checkbox"
              aria-checked={selectedIds.includes(item.qualified_id)}
              tabIndex={0}
              title={item.content_preview || item.qualified_id}
              className={`min-h-24 cursor-pointer break-all rounded border p-3 text-xs ${
                selectedIds.includes(item.qualified_id)
                  ? "border-blue-500 bg-blue-100"
                  : "bg-white"
              }`}
              onClick={(event) => {
                onSetFocusedFolder("");
                const visible = questions.map((q) => q.qualified_id);
                onSelectIds?.(
                  event.shiftKey
                    ? rangeSelection(selectedIds, visible, anchor.current, item.qualified_id)
                    : event.ctrlKey || event.metaKey
                      ? toggleSingleSelection(selectedIds, item.qualified_id)
                      : [item.qualified_id],
                );
                anchor.current = item.qualified_id;
              }}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onSelectIds?.(toggleSingleSelection(selectedIds, item.qualified_id));
                }
              }}
            >
              <p className="mb-2 font-semibold">{item.qualified_id}</p>
              <p className="line-clamp-4">{item.content_preview}</p>
            </div>
          ))}
        </div>
      </div>
      {rectangle ? (
        <div
          data-testid="marquee-rectangle"
          className="pointer-events-none fixed z-[51] border border-blue-500 bg-blue-200/30"
          style={{
            left: rectangle.x,
            top: rectangle.y,
            width: rectangle.right - rectangle.x,
            height: rectangle.bottom - rectangle.y,
          }}
        />
      ) : null}
    </>
  );
}
