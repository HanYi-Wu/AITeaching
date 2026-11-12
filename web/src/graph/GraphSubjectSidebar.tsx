import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Network, Plus, Edit2, Trash2, X } from "lucide-react";
import type { GraphInfo } from "../api/client";
import { cn } from "../lib/utils";
import { isImeComposingKeyboardEvent, isImeCompositionActive } from "../lib/ime";

interface Props {
  graphs: GraphInfo[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onCreateGraph: (displayName: string) => Promise<void>;
  onDeleteGraph: (slug: string) => Promise<void>;
  onRenameGraph: (slug: string, newName: string) => Promise<void>;
  busy?: boolean;
  className?: string;
  onClose?: () => void;
}

export function GraphSubjectSidebar({
  graphs,
  activeSlug,
  onSelect,
  onCreateGraph,
  onDeleteGraph,
  onRenameGraph,
  busy,
  className,
  onClose,
}: Props) {
  const { t } = useTranslation("graph");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreateGraph(newName.trim());
    setNewName("");
    setCreating(false);
  };

  const startRename = (g: GraphInfo) => {
    setRenamingSlug(g.slug);
    setRenameValue(g.display_name);
  };

  const commitRename = async () => {
    if (!renamingSlug || !renameValue.trim()) {
      setRenamingSlug(null);
      return;
    }
    await onRenameGraph(renamingSlug, renameValue.trim());
    setRenamingSlug(null);
  };

  return (
    <aside className={cn("or-g50-sidebar flex h-full w-full flex-col", className)}>
      <div className="flex items-center justify-between border-b border-[var(--or-outline)]  px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[var(--or-muted)] " />
          <h2 className="text-sm font-semibold text-[var(--or-text)] ">
            {t("graphsTitle")}
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            className="md:!hidden or-g50-btn or-g50-btn-ghost !h-7 !w-7 !p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--or-focus)]"
            onClick={onClose}
            title={t("collapse")}
            aria-label={t("collapse")}
            data-graph-sidebar-close
          >
            <X className="h-4 w-4 text-[var(--or-muted)]" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {graphs.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-[var(--or-muted)] ">
            {t("noGraphsHint")}
          </p>
        ) : (
          <ul className="space-y-1">
            {graphs.map((g) => {
              const isActive = activeSlug === g.slug;
              const isRenaming = renamingSlug === g.slug;

              return (
                <li key={g.slug}>
                  {isRenaming ? (
                    <div className="flex items-center gap-1.5 p-1">
                      <input
                        className="or-g50-input w-full !h-8 !text-sm"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (isImeComposingKeyboardEvent(e)) return;
                          if (e.key === "Enter") void commitRename();
                          if (e.key === "Escape") setRenamingSlug(null);
                        }}
                        onBlur={() => {
                          if (!isImeCompositionActive()) void commitRename();
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        className={cn(
                          "flex min-w-0 flex-1 items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors",
                          isActive
                            ? "bg-[var(--or-primary)] text-[var(--or-on-primary)] shadow-sm "
                            : "text-[var(--or-muted)] hover:bg-[var(--or-block)]  dark:hover:bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)]",
                        )}
                        onClick={() => onSelect(g.slug)}
                      >
                        <span className="min-w-0 flex-1 truncate">{g.display_name}</span>

                        <span
                          className={cn(
                            "ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-none shrink-0",
                            isActive
                              ? "bg-[color-mix(in_srgb,var(--or-card)_20%,transparent)] text-white"
                              : "bg-[var(--or-block)] text-[var(--or-muted)]  ",
                          )}
                        >
                          <span className="inline-block transform translate-y-[0.5px]">
                            {g.node_count}
                          </span>
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-on-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--or-focus)]  dark:hover:bg-[var(--or-primary)] dark:hover:text-[var(--or-on-primary)]"
                          title={`${t("rename")} ${g.display_name}`}
                          aria-label={`${t("rename")} ${g.display_name}`}
                          onClick={() => startRename(g)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--or-on-error)] hover:bg-[var(--or-error-container)] hover:text-[var(--or-on-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40"
                          title={`${t("delete")} ${g.display_name}`}
                          aria-label={`${t("delete")} ${g.display_name}`}
                          onClick={() => void onDeleteGraph(g.slug)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Creation bottom section */}
      <div className="border-t border-[var(--or-outline)]  p-3">
        {creating ? (
          <div className="space-y-2">
            <input
              className="or-g50-input w-full !h-8 !text-sm"
              placeholder={t("newGraphNamePh")}
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposingKeyboardEvent(e)) return;
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="or-g50-btn or-g50-btn-primary flex-1 !h-8 !text-xs font-medium"
                disabled={busy || !newName.trim()}
                onClick={() => void handleCreate()}
              >
                <span>{t("confirm")}</span>
              </button>
              <button
                type="button"
                className="or-g50-btn or-g50-btn-secondary !h-8 !text-xs font-medium"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                <span>{t("cancel")}</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="or-g50-btn or-g50-btn-secondary w-full !h-8 !text-xs font-medium"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t("newGraph")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
