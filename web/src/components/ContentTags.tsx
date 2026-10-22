import { useEffect, useState } from "react";
import { listContentTags, listItemTags, saveContentTag, setItemTags, type ContentTag } from "../platform/auth";

const colors: ContentTag["color"][] = ["slate", "blue", "green", "amber", "rose", "violet"];
const colorClass: Record<ContentTag["color"], string> = {
  slate: "bg-slate-100 text-slate-700", blue: "bg-blue-100 text-blue-700", green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-800", rose: "bg-rose-100 text-rose-700", violet: "bg-violet-100 text-violet-700",
};

export function TagChips({ tags, max = 2 }: { tags: ContentTag[]; max?: number }) {
  return <span className="inline-flex min-w-0 items-center gap-1" title={tags.map((tag) => tag.name).join("、")}>{tags.slice(0, max).map((tag) => <span key={tag.id} className={`truncate rounded px-1.5 py-0.5 text-[10px] ${colorClass[tag.color]}`}>{tag.name}</span>)}{tags.length > max ? <span className="text-[10px] text-slate-400">+{tags.length - max}</span> : null}</span>;
}

export function ContentTags({ scope, itemId, onError, onChange }: { scope: "bank" | "template" | "compose" | "paper"; itemId: string; onError: (message: string) => void; onChange?: () => void }) {
  const [all, setAll] = useState<ContentTag[]>([]);
  const [selected, setSelected] = useState<ContentTag[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ContentTag["color"]>("blue");
  const [editTagId, setEditTagId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([listContentTags(), listItemTags(scope, itemId)]).then(([tags, links]) => { if (active) { setAll(tags.tags); setSelected(links.tags); } }).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
    // Callback identity is intentionally not a reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, itemId]);
  async function toggle(tag: ContentTag) {
    const ids = selected.some((item) => item.id === tag.id) ? selected.filter((item) => item.id !== tag.id).map((item) => item.id) : [...selected.map((item) => item.id), tag.id];
    try { await setItemTags(scope, itemId, ids); setSelected(all.filter((item) => ids.includes(item.id))); onChange?.(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }
  async function create() {
    try {
      const result = await saveContentTag({ name: name.trim(), color }, editTagId ?? undefined);
      if (editTagId) {
        setAll((current) => current.map((item) => item.id === editTagId ? result.tag : item));
        setSelected((current) => current.map((item) => item.id === editTagId ? result.tag : item));
      } else {
        setAll((current) => [...current, result.tag]);
        await setItemTags(scope, itemId, [...selected.map((item) => item.id), result.tag.id]);
        setSelected((current) => [...current, result.tag]);
      }
      setName(""); setEditTagId(null); onChange?.();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }
  return <div className="relative inline-flex items-center gap-1" title={selected.map((tag) => tag.name).join("、")}>
    <TagChips tags={selected} /><button type="button" onClick={() => setEditing(!editing)} className="rounded border px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100">标签</button>
    {editing ? <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-xl" onClick={(event) => event.stopPropagation()}>
      <p className="mb-1 font-semibold">内容标签</p><div className="max-h-32 space-y-1 overflow-auto">{all.map((tag) => <div key={tag.id} className="flex items-center gap-2 rounded p-1 hover:bg-slate-50"><input aria-label={`选择${tag.name}`} type="checkbox" checked={selected.some((item) => item.id === tag.id)} onChange={() => void toggle(tag)} /><span className={`flex-1 rounded px-1.5 py-0.5 ${colorClass[tag.color]}`}>{tag.name}</span><button type="button" title={`编辑${tag.name}`} onClick={() => { setEditTagId(tag.id); setName(tag.name); setColor(tag.color); }}>编辑</button></div>)}</div>
      <div className="mt-2 flex gap-1"><input aria-label="标签名称" maxLength={5} value={name} onChange={(event) => setName(event.target.value)} placeholder="最多5字" className="min-w-0 flex-1 rounded border px-1" /><select aria-label="标签颜色" value={color} onChange={(event) => setColor(event.target.value as ContentTag["color"])} className="w-14 rounded border">{colors.map((value) => <option key={value} value={value}>{value}</option>)}</select><button type="button" disabled={!name.trim()} onClick={() => void create()} className="rounded bg-slate-900 px-1.5 text-white disabled:opacity-50">{editTagId ? "存" : "+"}</button></div>
    </div> : null}
  </div>;
}
