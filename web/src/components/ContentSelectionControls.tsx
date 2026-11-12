import { useEffect, useState } from "react";
import type { ContentFolder } from "../platform/auth";
import { Select as AppSelect } from "./ui/select";

const UNASSIGNED = "__unassigned__";

type Props = {
  scope: "compose" | "paper";
  folders: ContentFolder[];
  visibleItemIds: string[];
  selectedItemIds: string[];
  busy?: boolean;
  allLabel?: string;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onMoveSelected: (itemIds: string[], folderId: string | null) => void | Promise<void>;
  portalContainer?: HTMLElement | null;
};

export function ContentSelectionControls({
  scope,
  folders,
  visibleItemIds,
  selectedItemIds,
  busy = false,
  allLabel = "全选当前可见",
  onSelectVisible,
  onClearSelection,
  onMoveSelected,
  portalContainer,
}: Props) {
  const [destination, setDestination] = useState("");
  const allVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedItemIds.includes(id));

  useEffect(() => {
    setDestination((current) => current === UNASSIGNED || folders.some((folder) => folder.id === current) ? current : "");
  }, [folders]);

  const canMove = selectedItemIds.length > 0 && Boolean(destination) && !busy;

  return (
    <div className="space-y-2.5 rounded-[12px] border border-[var(--or-outline)] bg-[var(--or-card)] p-3 text-xs sm:text-[13px] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 font-medium text-[var(--or-text)] cursor-pointer">
          <input
            type="checkbox"
            aria-label={allLabel}
            checked={allVisibleSelected}
            disabled={busy || visibleItemIds.length === 0}
            onChange={onSelectVisible}
            className="accent-[var(--or-primary)] rounded"
          />
          {allLabel}
        </label>
        <div className="flex items-center gap-2">
          <span className="or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary-container)] text-[var(--or-on-container)] px-2 py-0.5 text-xs font-semibold leading-none">
            已选 {selectedItemIds.length} 项
          </span>
          <button
            type="button"
            disabled={busy || selectedItemIds.length === 0}
            onClick={onClearSelection}
            className="or-button or-button-tonal px-2.5 py-1 text-sm disabled:opacity-40"
          >
            清空选择
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <AppSelect
          portalContainer={portalContainer}
          aria-label="批量移动到文件夹"
          value={destination}
          disabled={busy || selectedItemIds.length === 0}
          onValueChange={(value) => setDestination(value)}
          className="or-select min-w-0 flex-1 rounded-[8px] border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1.5 text-xs sm:text-[13px]"
        >
          <option value="">移动到…</option>
          {scope === "compose" ? <option value={UNASSIGNED}>未归类</option> : null}
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </AppSelect>
        <button
          type="button"
          disabled={!canMove}
          onClick={() => void onMoveSelected(selectedItemIds, destination === UNASSIGNED ? null : destination)}
          className="or-button or-button-primary shrink-0 rounded-[8px] px-3 py-1.5 text-xs sm:text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          移动所选
        </button>
      </div>
    </div>
  );
}
