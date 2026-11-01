import { useEffect, useState } from "react";
import { listContentTags, listItemTags, saveContentTag, setItemTags, type ContentTag } from "../platform/auth";
import { Select as AppSelect } from "./ui/select";

const colors: ContentTag["color"][] = ["slate", "blue", "green", "amber", "rose", "violet"];
const colorClass: Record<ContentTag["color"], string> = {
  slate: "bg-[var(--or-block)] text-[var(--or-muted)]  ",
  blue: "bg-[var(--or-primary-container)] text-[var(--or-on-container)]  ",
  green: "bg-[var(--or-success-container)] text-[var(--or-on-success)] dark:bg-green-950/60 dark:text-green-300",
  amber: "bg-[var(--or-warning-container)] text-[var(--or-on-warning)] dark:bg-amber-950/60 dark:text-amber-300",
  rose: "bg-[var(--or-error-container)] text-[var(--or-on-error)] dark:bg-rose-950/60 dark:text-rose-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
};

export function TagChips({ tags, max = 2 }: { tags: ContentTag[]; max?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={tags.map((tag) => tag.name).join("、")}>
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag.id}
          className={`or-pill inline-flex items-center justify-center truncate rounded-full px-2 py-0.5 text-xs font-medium leading-none ${colorClass[tag.color]}`}
        >
          {tag.name}
        </span>
      ))}
      {tags.length > max ? (
        <span className="or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-block)] px-1.5 py-0.5 text-xs font-medium text-[var(--or-muted)] leading-none">
          +{tags.length - max}
        </span>
      ) : null}
    </span>
  );
}

export function ContentTags({
  scope,
  itemId,
  onError,
  onChange,
}: {
  scope: "bank" | "template" | "compose" | "paper";
  itemId: string;
  onError: (message: string) => void;
  onChange?: () => void;
}) {
  const [all, setAll] = useState<ContentTag[]>([]);
  const [selected, setSelected] = useState<ContentTag[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ContentTag["color"]>("blue");
  const [editTagId, setEditTagId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listContentTags(), listItemTags(scope, itemId)])
      .then(([tags, links]) => {
        if (active) {
          setAll(tags.tags);
          setSelected(links.tags);
        }
      })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => {
      active = false;
    };
    // Callback identity is intentionally not a reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, itemId]);

  async function toggle(tag: ContentTag) {
    const ids = selected.some((item) => item.id === tag.id)
      ? selected.filter((item) => item.id !== tag.id).map((item) => item.id)
      : [...selected.map((item) => item.id), tag.id];
    try {
      await setItemTags(scope, itemId, ids);
      setSelected(all.filter((item) => ids.includes(item.id)));
      onChange?.();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function create() {
    try {
      const result = await saveContentTag({ name: name.trim(), color }, editTagId ?? undefined);
      if (editTagId) {
        setAll((current) => current.map((item) => (item.id === editTagId ? result.tag : item)));
        setSelected((current) => current.map((item) => (item.id === editTagId ? result.tag : item)));
      } else {
        setAll((current) => [...current, result.tag]);
        await setItemTags(scope, itemId, [...selected.map((item) => item.id), result.tag.id]);
        setSelected((current) => [...current, result.tag]);
      }
      setName("");
      setEditTagId(null);
      onChange?.();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="relative inline-flex items-center gap-1.5" title={selected.map((tag) => tag.name).join("、")}>
      <TagChips tags={selected} />
      <button
        type="button"
        onClick={() => setEditing(!editing)}
        className="or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-0.5 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] transition-colors leading-none"
      >
        标签
      </button>

      {editing ? (
        <div
          className="absolute left-0 top-full z-30 mt-1.5 w-60 max-w-[calc(100vw-2rem)] rounded-[14px] border border-[var(--or-outline)] bg-[var(--or-card)] p-3 text-xs sm:text-[13px] shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="mb-2 font-semibold text-[var(--or-text)]">内容标签</p>
          <div className="max-h-36 space-y-1 overflow-auto py-0.5">
            {all.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 rounded-[8px] p-1.5 hover:bg-[var(--or-block)]">
                <input
                  aria-label={`选择${tag.name}`}
                  type="checkbox"
                  checked={selected.some((item) => item.id === tag.id)}
                  onChange={() => void toggle(tag)}
                  className="accent-[var(--or-primary)]"
                />
                <span className={`or-pill flex-1 truncate rounded-full px-2 py-0.5 text-xs font-medium ${colorClass[tag.color]}`}>
                  {tag.name}
                </span>
                <button
                  type="button"
                  title={`编辑${tag.name}`}
                  onClick={() => {
                    setEditTagId(tag.id);
                    setName(tag.name);
                    setColor(tag.color);
                  }}
                  className="text-xs text-[var(--or-muted)] hover:text-[var(--or-text)] px-1"
                >
                  编辑
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--or-outline)] pt-2.5">
            <input
              aria-label="标签名称"
              maxLength={5}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="最多5字"
              className="or-input min-w-0 flex-1 rounded-[6px] border border-[var(--or-outline)] bg-[var(--or-card)] px-2 py-1 text-xs"
            />
            <AppSelect
              aria-label="标签颜色"
              value={color}
              onValueChange={(value) => setColor(value as ContentTag["color"])}
              className="or-select w-16 rounded-[6px] border border-[var(--or-outline)] bg-[var(--or-card)] px-1 py-1 text-xs"
            >
              {colors.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </AppSelect>
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => void create()}
              className="or-button or-button-primary rounded-[6px] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {editTagId ? "存" : "+"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
