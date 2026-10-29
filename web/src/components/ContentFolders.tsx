import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Trash2 } from "lucide-react";
import { createContentFolder, deleteContentFolder, updateContentFolder, type ContentFolder, type FolderDeleteResult } from "../platform/auth";
import { CONTENT_ITEMS_MIME, CONTENT_ITEM_MIME, parseContentItemsDragData } from "../lib/contentSelection";

type Props = {
  scope: ContentFolder["scope"];
  folders: ContentFolder[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: (folder: ContentFolder) => void;
  onUpdated?: (folder: ContentFolder) => void;
  onDeleted: (result: FolderDeleteResult) => void;
  onDropItem?: (itemId: string, folderId: string) => void;
  onDropItems?: (itemIds: string[], folderId: string) => void | Promise<void>;
  dropItemsBusy?: boolean;
  onError: (message: string) => void;
  allowPaperFolder?: boolean;
};

export function ContentFolderHelp({ paper = false }: { paper?: boolean }) {
  return <details className="mt-2 rounded border border-slate-200 bg-white p-2 text-[11px] leading-5 text-slate-600">
    <summary className="cursor-pointer font-medium">{paper ? "归类文件夹与试卷文件夹说明" : "文件夹使用说明"}</summary>
    {paper ? <>
      <p>归类文件夹用于按年级、学科或考试归档，可以包含子文件夹和试卷；班级练习可在此归类。</p>
      <p>试卷文件夹用于同一次练习的不同试卷，每名学生在同一文件夹内只能接收一份有效练习。它必须放在归类文件夹内，不能再建子文件夹。</p>
      <p>只有空文件夹能转换类型。含试卷或发布记录的文件夹不能删除，已有发布记录的试卷请移动整个文件夹，以保留答卷和统计关系。</p>
    </> : <p>文件夹仅用于归类。删除后，内容和子文件夹移到上一级；删除根目录文件夹后，内容回到未归类。模板和试卷源文件都会保留。</p>}
    <p>新建重名时自动加“(2)、(3)”；重命名或移动时遇到同目录重名，会提示修改。</p>
  </details>;
}

export function ContentFolders({ scope, folders, selectedId, onSelect, onCreated, onUpdated, onDeleted, onDropItem, onDropItems, dropItemsBusy = false, onError, allowPaperFolder = false }: Props) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ContentFolder["kind"]>("category");
  const [parentId, setParentId] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentFolder | null>(null);
  const selected = folders.find((folder) => folder.id === selectedId);
  const descendants = new Set<string>(selectedId ? [selectedId] : []);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && descendants.has(folder.parent_id) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    }
  }
  const destinations = folders.filter((folder) => folder.kind === "category" && !descendants.has(folder.id));
  const reportError = (error: unknown) => onError(error instanceof Error ? error.message : String(error));

  async function create() {
    setBusy(true);
    try {
      const result = await createContentFolder({ scope, name: name.trim(), parent_id: parentId || null, kind });
      onCreated(result.folder);
      setCreating(false);
      setName("");
      if (parentId) setExpanded((current) => [...new Set([...current, parentId])]);
      onSelect(result.folder.id);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }

  async function update(id: string, patch: Parameters<typeof updateContentFolder>[1]) {
    setBusy(true);
    try {
      const { folder } = await updateContentFolder(id, patch);
      onUpdated?.(folder);
      if (folder.parent_id) setExpanded((current) => [...new Set([...current, folder.parent_id!])]);
      setRenaming(false);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await deleteContentFolder(deleteTarget.id);
      onDeleted(result);
      onSelect(result.parent_id);
      setRenaming(false);
      setCreating(false);
      setDeleteTarget(null);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }

  function nodes(parent: string | null, depth = 0): React.ReactNode {
    return folders.filter((folder) => folder.parent_id === parent).map((folder) => {
      const children = folders.some((candidate) => candidate.parent_id === folder.id);
      const open = expanded.includes(folder.id);
      return <div key={folder.id}>
        <div draggable={!busy && !dropItemsBusy}
          onDragStart={(event) => event.dataTransfer.setData("application/x-or-folder", folder.id)}
          onDragOver={(event) => { if (!busy && !dropItemsBusy && ((event.dataTransfer.types.includes("application/x-or-folder") && folder.kind === "category") || event.dataTransfer.types.includes(CONTENT_ITEM_MIME) || event.dataTransfer.types.includes(CONTENT_ITEMS_MIME))) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            if (busy || dropItemsBusy) return;
            const rawItems = event.dataTransfer.getData(CONTENT_ITEMS_MIME);
            if (rawItems) {
              try {
                if (scope !== "compose" && scope !== "paper") throw new Error("无法识别拖动的内容");
                const ids = parseContentItemsDragData(rawItems, scope);
                if (onDropItems) void Promise.resolve(onDropItems(ids, folder.id)).catch(reportError);
                else if (ids.length === 1) onDropItem?.(ids[0], folder.id);
                else onError("此处不支持批量移动内容");
              } catch (error) { reportError(error); }
              return;
            }
            const rawItem = event.dataTransfer.getData(CONTENT_ITEM_MIME);
            if (rawItem) {
              try { const item = JSON.parse(rawItem) as { scope: string; id: string }; if (item.scope === scope) onDropItem?.(item.id, folder.id); }
              catch { onError("无法识别拖动的内容"); }
              return;
            }
            const moved = event.dataTransfer.getData("application/x-or-folder");
            if (moved && moved !== folder.id) void update(moved, { parent_id: folder.id, move: true });
          }}
          className="flex items-center rounded-md transition-colors duration-150 hover:bg-slate-100" style={{ paddingLeft: depth * 14 }}>
          <button type="button" aria-label={`${open ? "收起" : "展开"}${folder.name}`} className="p-1" onClick={() => setExpanded((current) => open ? current.filter((id) => id !== folder.id) : [...current, folder.id])}>
            {children ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="inline-block w-3.5" />}
          </button>
          <button type="button" title={`${folder.name} · ${folder.kind === "paper" ? "试卷文件夹" : "归类文件夹"}`} onClick={() => { onSelect(folder.id); setRenaming(false); }} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left text-xs transition-colors duration-150 ${selectedId === folder.id ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700"}`}>
            <Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{folder.name}</span>{folder.kind === "paper" ? <span className="shrink-0 text-[10px] text-violet-600">试卷</span> : null}
          </button>
        </div>
        {open ? <div className="origin-top animate-[folder-open_160ms_ease-out]">{nodes(folder.id, depth + 1)}</div> : null}
      </div>;
    });
  }

  return <div className="border-b border-slate-200 pb-2">
    <div className="flex items-center justify-between px-1 py-1"><span className="text-xs font-semibold text-slate-600">文件夹</span><button type="button" title="新建文件夹" disabled={busy} onClick={() => { setCreating(!creating); setParentId(selected?.kind === "category" ? selected.id : selected?.parent_id ?? ""); setKind("category"); }} className="rounded p-1 hover:bg-slate-100"><FolderPlus className="h-4 w-4" /></button></div>
    <button type="button" onClick={() => { onSelect(null); setRenaming(false); }} className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${selectedId === null ? "bg-blue-50 font-semibold text-blue-700" : "hover:bg-slate-100"}`}>全部内容</button>
    <div className="max-h-56 overflow-auto">{nodes(null)}</div>
    {selected ? <div className="mt-1 space-y-1 rounded bg-slate-50 p-1 text-xs">
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={busy} className="rounded border px-1.5 py-0.5" onClick={() => { setRenaming(!renaming); setRenameValue(selected.name); }}>重命名</button>
        <button type="button" disabled={busy || selected.id.startsWith("paper-default-")} title={selected.id.startsWith("paper-default-") ? "默认文件夹由系统保留" : "删除文件夹，保留内容"} onClick={() => setDeleteTarget(selected)} className="inline-flex items-center gap-1 rounded border border-red-200 px-1.5 py-0.5 text-red-700 disabled:opacity-50"><Trash2 className="h-3 w-3" />删除</button>
        <select aria-label="移动文件夹到" disabled={busy} value="" onChange={(event) => void update(selected.id, { parent_id: event.target.value === "__root__" ? null : event.target.value, move: true })} className="min-w-0 flex-1 rounded border"><option value="">移动到…</option>{selected.kind !== "paper" && <option value="__root__">根目录</option>}{destinations.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
      </div>
      {renaming ? <div className="flex gap-1"><input aria-label="重命名文件夹" maxLength={60} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="min-w-0 flex-1 rounded border px-1" /><button type="button" disabled={busy || !renameValue.trim()} onClick={() => void update(selected.id, { name: renameValue.trim() })} className="rounded border px-1">保存</button></div> : null}
    </div> : null}
    {deleteTarget && <div role="alertdialog" aria-label="删除文件夹" className="my-2 space-y-2 rounded border border-red-200 bg-red-50 p-2 text-xs leading-5 text-slate-700">
      <p className="font-medium">删除文件夹“{deleteTarget.name}”？</p>
      <p>{scope === "paper" ? "含试卷或发布记录时不能删除；子文件夹将移到上一级，学生答卷和成绩不会删除。" : "内容和子文件夹将移到上一级；根目录的内容回到未归类。源文件不会删除。"}</p>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)} className="rounded border bg-white px-2 py-1">取消删除</button><button type="button" disabled={busy} onClick={() => void remove()} className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-50">确认删除</button></div>
    </div>}
    {creating ? <div className="space-y-1.5 rounded-md bg-slate-50 p-2 text-xs">
      <input aria-label="文件夹名称" className="w-full rounded border px-2 py-1" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="文件夹名称" />
      <select aria-label="上级文件夹" className="w-full rounded border px-2 py-1" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">根目录</option>{folders.filter((folder) => folder.kind === "category").map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
      {allowPaperFolder ? <select aria-label="文件夹类型" className="w-full rounded border px-2 py-1" value={kind} onChange={(event) => setKind(event.target.value as ContentFolder["kind"])}><option value="category">归类文件夹</option><option value="paper">试卷文件夹</option></select> : null}
      <button type="button" disabled={busy || !name.trim() || (kind === "paper" && !parentId)} onClick={() => void create()} className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-50">创建</button>
    </div> : null}
    <ContentFolderHelp paper={allowPaperFolder} />
  </div>;
}
