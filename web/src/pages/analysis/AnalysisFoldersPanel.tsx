import { useState, type DragEvent, type FormEvent } from "react";
import { Folder, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { confirmDialog } from "../../lib/confirmDialog";
import type { AnalysisFolder } from "./useAnalysisFolders";

export const ANALYSIS_ITEMS_MIME = "application/x-or-content-items";
export type AnalysisFolderFilter = "all" | "unassigned" | string;

type AnalysisFoldersPanelProps = {
  folders: AnalysisFolder[];
  assignments: Record<string, string>;
  visibleItemIds: string[];
  filter: AnalysisFolderFilter;
  onFilterChange: (filter: AnalysisFolderFilter) => void;
  selectedItemIds: string[];
  busy: boolean;
  loading: boolean;
  error: string | null;
  onCreateFolder: (name: string) => Promise<boolean>;
  onRenameFolder: (folderId: string, name: string) => Promise<boolean>;
  onDeleteFolder: (folderId: string) => Promise<boolean>;
  onAssignItems: (itemIds: string[], folderId: string | null) => Promise<void>;
};

function readAnalysisItemIds(event: DragEvent<HTMLElement>): string[] {
  try {
    const payload = JSON.parse(event.dataTransfer.getData(ANALYSIS_ITEMS_MIME)) as {
      scope?: unknown;
      ids?: unknown;
    };
    if (payload.scope !== "analysis" || !Array.isArray(payload.ids) || payload.ids.length > 200) return [];
    return Array.from(new Set(payload.ids.filter((id): id is string => typeof id === "string")));
  } catch {
    return [];
  }
}

export function AnalysisFoldersPanel({
  folders,
  assignments,
  visibleItemIds,
  filter,
  onFilterChange,
  selectedItemIds,
  busy,
  loading,
  error,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onAssignItems,
}: AnalysisFoldersPanelProps) {
  const [newName, setNewName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const submitNewFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !newName.trim()) return;
    if (await onCreateFolder(newName)) setNewName("");
  };

  const submitRename = async (event: FormEvent, folderId: string) => {
    event.preventDefault();
    if (busy || !editingName.trim()) return;
    if (await onRenameFolder(folderId, editingName)) setEditingFolderId(null);
  };

  const deleteFolder = async (folder: AnalysisFolder) => {
    const confirmed = await confirmDialog(
      `删除“${folder.name}”文件夹？其中的记录将移回未归类，试卷、成绩和答卷不会删除。`,
    );
    if (confirmed && await onDeleteFolder(folder.id) && filter === folder.id) onFilterChange("all");
  };

  const assignDrop = (event: DragEvent<HTMLElement>, folderId: string | null) => {
    const ids = readAnalysisItemIds(event);
    if (!ids.length) return;
    event.preventDefault();
    void onAssignItems(ids, folderId);
  };

  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.types).includes(ANALYSIS_ITEMS_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };

  const itemCount = (folderId: string | null | "all") => folderId === "all"
    ? visibleItemIds.length
    : visibleItemIds.filter((itemId) => (
      folderId === null ? !assignments[itemId] : assignments[itemId] === folderId
    )).length;

  const filterButtonClass = (active: boolean) => (
    `flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"}`
  );

  return (
    <section aria-label="分析文件夹" className="mb-3 rounded-md border border-slate-200 bg-white p-2">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700">分析文件夹</h4>
        {loading ? <span className="text-[10px] text-slate-400">加载中</span> : null}
      </div>
      <form className="mb-2 flex gap-1" onSubmit={(event) => void submitNewFolder(event)}>
        <input
          aria-label="新建分析文件夹名称"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={80}
          placeholder="新建文件夹"
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="submit"
          aria-label="新建分析文件夹"
          disabled={busy || !newName.trim()}
          className="rounded border border-slate-300 px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        <div
          className={filterButtonClass(filter === "all")}
          role="button"
          tabIndex={0}
          onClick={() => onFilterChange("all")}
          onKeyDown={(event) => { if (event.key === "Enter") onFilterChange("all"); }}
          data-testid="analysis-folder-all"
        >
          <span className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" />全部记录</span>
          <span>{itemCount("all")}</span>
        </div>
        <div
          className={filterButtonClass(filter === "unassigned")}
          role="button"
          tabIndex={0}
          onClick={() => onFilterChange("unassigned")}
          onDragOver={dragOver}
          onDrop={(event) => assignDrop(event, null)}
          onKeyDown={(event) => { if (event.key === "Enter") onFilterChange("unassigned"); }}
          data-testid="analysis-folder-unassigned"
        >
          <span className="flex items-center gap-1.5"><Folder className="h-3.5 w-3.5" />未归类</span>
          <span>{itemCount(null)}</span>
        </div>
        {folders.map((folder) => (
          <div
            key={folder.id}
            className={`rounded border px-2 py-1 ${filter === folder.id ? "border-blue-200 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}
            onDragOver={dragOver}
            onDrop={(event) => assignDrop(event, folder.id)}
            data-testid={`analysis-folder-${folder.id}`}
          >
            {editingFolderId === folder.id ? (
              <form className="flex gap-1" onSubmit={(event) => void submitRename(event, folder.id)}>
                <input
                  aria-label={`重命名分析文件夹 ${folder.name}`}
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  maxLength={80}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                />
                <button type="submit" disabled={busy || !editingName.trim()} className="text-xs text-blue-600 disabled:opacity-50">保存</button>
                <button type="button" onClick={() => setEditingFolderId(null)} className="text-xs text-slate-500">取消</button>
              </form>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onFilterChange(folder.id)}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-xs ${filter === folder.id ? "text-blue-700" : "text-slate-600"}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate"><Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{folder.name}</span></span>
                  <span>{itemCount(folder.id)}</span>
                </button>
                {selectedItemIds.length > 0 ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`将所选记录移入 ${folder.name}`}
                    onClick={() => void onAssignItems(selectedItemIds, folder.id)}
                    className="text-[10px] text-blue-600 disabled:opacity-50"
                  >
                    归类
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`重命名 ${folder.name}`}
                  disabled={busy}
                  onClick={() => { setEditingFolderId(folder.id); setEditingName(folder.name); }}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${folder.name}`}
                  disabled={busy}
                  onClick={() => void deleteFolder(folder)}
                  className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {selectedItemIds.length > 0 ? (
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
          <span>{selectedItemIds.length} 条已勾选</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAssignItems(selectedItemIds, null)}
            className="text-blue-600 disabled:opacity-50"
          >
            移回未归类
          </button>
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-2 text-[11px] text-rose-600">{error}</div> : null}
    </section>
  );
}
