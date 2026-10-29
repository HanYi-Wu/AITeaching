import { useEffect, useState } from "react";
import type { ContentFolder } from "../platform/auth";

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
}: Props) {
  const [destination, setDestination] = useState("");
  const allVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedItemIds.includes(id));

  useEffect(() => {
    setDestination((current) => current === UNASSIGNED || folders.some((folder) => folder.id === current) ? current : "");
  }, [folders]);

  const canMove = selectedItemIds.length > 0 && Boolean(destination) && !busy;
  return <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
        <input type="checkbox" aria-label={allLabel} checked={allVisibleSelected} disabled={busy || visibleItemIds.length === 0} onChange={onSelectVisible} />
        {allLabel}
      </label>
      <span className="text-slate-500">已选 {selectedItemIds.length} 项</span>
      <button type="button" disabled={busy || selectedItemIds.length === 0} onClick={onClearSelection} className="text-slate-600 underline underline-offset-2 disabled:opacity-50">清空选择</button>
    </div>
    <div className="flex gap-1.5">
      <select aria-label="批量移动到文件夹" value={destination} disabled={busy || selectedItemIds.length === 0} onChange={(event) => setDestination(event.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5">
        <option value="">移动到…</option>
        {scope === "compose" ? <option value={UNASSIGNED}>未归类</option> : null}
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      <button
        type="button"
        disabled={!canMove}
        onClick={() => void onMoveSelected(selectedItemIds, destination === UNASSIGNED ? null : destination)}
        className="shrink-0 rounded bg-slate-900 px-2 py-1.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        移动所选
      </button>
    </div>
  </div>;
}
