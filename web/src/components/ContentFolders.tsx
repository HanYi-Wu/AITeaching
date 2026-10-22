import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { createContentFolder, updateContentFolder, type ContentFolder } from "../platform/auth";

type Props = {
  scope: ContentFolder["scope"];
  folders: ContentFolder[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: (folder: ContentFolder) => void;
  onUpdated?: (folder: ContentFolder) => void;
  onDropItem?: (itemId: string, folderId: string) => void;
  onError: (message: string) => void;
  allowPaperFolder?: boolean;
};

export function ContentFolders({ scope, folders, selectedId, onSelect, onCreated, onUpdated, onDropItem, onError, allowPaperFolder = false }: Props) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ContentFolder["kind"]>("category");
  const [parentId, setParentId] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  async function create() {
    try {
      const result = await createContentFolder({ scope, name, parent_id: parentId || null, kind });
      onCreated(result.folder);
      setCreating(false);
      setName("");
      if (parentId) setExpanded((current) => [...new Set([...current, parentId])]);
      onSelect(result.folder.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function nodes(parent: string | null, depth = 0): React.ReactNode {
    return folders.filter((folder) => folder.parent_id === parent).map((folder) => {
      const children = folders.some((candidate) => candidate.parent_id === folder.id);
      const open = expanded.includes(folder.id);
      return <div key={folder.id}>
        <div draggable onDragStart={(event) => event.dataTransfer.setData("application/x-or-folder", folder.id)} onDragOver={(event) => { if ((event.dataTransfer.types.includes("application/x-or-folder") && folder.kind === "category") || event.dataTransfer.types.includes("application/x-or-content-item")) event.preventDefault(); }} onDrop={(event) => { const rawItem = event.dataTransfer.getData("application/x-or-content-item"); if (rawItem) { event.preventDefault(); try { const item = JSON.parse(rawItem) as { scope: string; id: string }; if (item.scope === scope) onDropItem?.(item.id, folder.id); } catch { onError("无法识别拖动的内容"); } return; } const moved = event.dataTransfer.getData("application/x-or-folder"); if (!moved || moved === folder.id) return; event.preventDefault(); void updateContentFolder(moved, { parent_id: folder.id, move: true }).then(({ folder: updated }) => { onUpdated?.(updated); setExpanded((current) => [...new Set([...current, folder.id])]); }).catch((error) => onError(error instanceof Error ? error.message : String(error))); }} className="flex items-center rounded-md transition-colors duration-150 hover:bg-slate-100" style={{ paddingLeft: depth * 14 }}>
          <button type="button" aria-label={`${open ? "收起" : "展开"}${folder.name}`} className="p-1" onClick={() => setExpanded((current) => open ? current.filter((id) => id !== folder.id) : [...current, folder.id])}>
            {children ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="inline-block w-3.5" />}
          </button>
          <button type="button" title={`${folder.name} · ${folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}`} onClick={() => onSelect(folder.id)} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left text-xs transition-colors duration-150 ${selectedId === folder.id ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700"}`}>
            <Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{folder.name}</span>{folder.kind === "paper" ? <span className="shrink-0 text-[10px] text-violet-600">试卷</span> : null}
          </button>
        </div>
        {open ? <div className="origin-top animate-[folder-open_160ms_ease-out]">{nodes(folder.id, depth + 1)}</div> : null}
      </div>;
    });
  }

  return <div className="border-b border-slate-200 pb-2">
    <div className="flex items-center justify-between px-1 py-1"><span className="text-xs font-semibold text-slate-600">文件夹</span><button type="button" title="新建文件夹" onClick={() => { setCreating(!creating); setParentId(selectedId || ""); }} className="rounded p-1 hover:bg-slate-100"><FolderPlus className="h-4 w-4" /></button></div>
    <button type="button" onClick={() => onSelect(null)} className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${selectedId === null ? "bg-blue-50 font-semibold text-blue-700" : "hover:bg-slate-100"}`}>全部内容</button>
    <div className="max-h-56 overflow-auto">{nodes(null)}</div>
    {selectedId ? <div className="mt-1 space-y-1 rounded bg-slate-50 p-1 text-xs"><div className="flex gap-1"><button type="button" className="rounded border px-1.5 py-0.5" onClick={() => { setRenaming(!renaming); setRenameValue(folders.find((folder) => folder.id === selectedId)?.name ?? ""); }}>重命名</button><select aria-label="移动文件夹到" value="" onChange={(event) => { void updateContentFolder(selectedId, { parent_id: event.target.value === "__root__" ? null : event.target.value, move: true }).then(({ folder }) => onUpdated?.(folder)).catch((error) => onError(error instanceof Error ? error.message : String(error))); }} className="min-w-0 flex-1 rounded border"><option value="">移动到…</option><option value="__root__">根目录</option>{folders.filter((folder) => folder.id !== selectedId && folder.kind === "category").map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>{renaming ? <div className="flex gap-1"><input aria-label="重命名文件夹" maxLength={60} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="min-w-0 flex-1 rounded border px-1" /><button type="button" disabled={!renameValue.trim()} onClick={() => { void updateContentFolder(selectedId, { name: renameValue }).then(({ folder }) => { onUpdated?.(folder); setRenaming(false); }).catch((error) => onError(error instanceof Error ? error.message : String(error))); }} className="rounded border px-1">保存</button></div> : null}</div> : null}
    {creating ? <div className="space-y-1.5 rounded-md bg-slate-50 p-2 text-xs">
      <input aria-label="文件夹名称" className="w-full rounded border px-2 py-1" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="文件夹名称" />
      <select aria-label="上级文件夹" className="w-full rounded border px-2 py-1" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">根目录</option>{folders.filter((folder) => folder.kind === "category").map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
      {allowPaperFolder ? <select aria-label="文件夹类型" className="w-full rounded border px-2 py-1" value={kind} onChange={(event) => setKind(event.target.value as ContentFolder["kind"])}><option value="category">归类文件夹</option><option value="paper">试卷文件夹</option></select> : null}
      <button type="button" disabled={!name.trim() || (kind === "paper" && !parentId)} onClick={() => void create()} className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-50">创建</button>
    </div> : null}
  </div>;
}
