import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { NewProjectDialog } from "../../components/NewProjectDialog";
import { apiGet, apiPost, ensureApiBase } from "../../api/client";
import { cn } from "../../lib/utils";
import "../../ui-redesign/g55/g55.css";

type RecentItem = { name: string; path: string; last_opened: string };

type Props = {
  onProjectReady: () => void;
  onError: (msg: string | null) => void;
};

export function ProjectPane({ onProjectReady, onError }: Props) {
  const { t } = useTranslation(["welcome", "app"]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const loadRecent = useCallback(async () => {
    try {
      onError(null);
      await ensureApiBase();
      const data = await apiGet<{ items: RecentItem[] }>("/api/recent-projects");
      setRecent(data.items ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const openByPath = useCallback(
    async (root: string) => {
      setLoading(true);
      onError(null);
      try {
        await apiPost("/api/project/open", { root });
        onProjectReady();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [onError, onProjectReady],
  );

  const removeFromRecent = useCallback(
    async (root: string) => {
      onError(null);
      try {
        await ensureApiBase();
        await apiPost<{ ok: boolean; removed: boolean }>("/api/recent-projects/remove", { path: root });
        await loadRecent();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadRecent, onError],
  );

  const handleOpenFolder = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const isTauri =
        w &&
        ("__TAURI_INTERNALS__" in w ||
          (w as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined);
      if (isTauri) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const sel = await open({ directory: true, multiple: false, title: t("welcome:pickFolderTitle") });
        const path = Array.isArray(sel) ? sel[0] : sel;
        if (typeof path === "string" && path) {
          await openByPath(path);
        }
      } else {
        await apiPost("/api/project/pick-open", {});
        onProjectReady();
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError, onProjectReady, openByPath, t]);

  return (
    <div className="max-w-2xl">
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onProjectReady={() => {
          void loadRecent();
          onProjectReady();
        }}
        onError={onError}
      />
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          disabled={loading}
          onClick={() => setNewProjectOpen(true)}
          className={cn(
            "inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2.5 rounded-lg bg-or-primary px-5 text-[15px] font-semibold text-or-on-primary shadow-sm transition hover:brightness-95",
            loading && "cursor-not-allowed opacity-60",
          )}
        >
          <FolderPlus className="h-4 w-4" />
          <span>{t("welcome:newProject")}</span>
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleOpenFolder()}
          className={cn(
            "inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2.5 rounded-lg border border-[var(--or-primary)] bg-[color-mix(in_srgb,var(--or-primary)_80%,transparent)] px-5 text-[15px] font-medium text-[var(--or-text)] transition hover:bg-slate-700",
            loading && "cursor-not-allowed opacity-60",
          )}
        >
          <FolderOpen className="h-4 w-4 text-[var(--or-muted)]" />
          <span>{t("welcome:openProject")}</span>
        </button>
      </div>

      <div>
        <div className="mb-3.5 flex items-center gap-2 text-sm font-semibold text-[var(--or-muted)]">
          <Clock className="h-4 w-4 text-[var(--or-muted)]" />
          <span>{t("welcome:recent")}</span>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--or-primary)] bg-slate-950/40 px-4 py-8 text-center text-sm text-[var(--or-muted)]">
            {t("welcome:recentEmpty")}
          </div>
        ) : (
          <ul className="min-w-0 space-y-2">
            {recent.map((item) => (
              <li key={item.path} className="group flex min-w-0 items-stretch gap-1.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void openByPath(item.path)}
                  className="flex min-w-0 flex-1 flex-col items-start rounded-xl border border-[var(--or-primary)] bg-slate-950/60 px-4 py-3 text-left transition hover:border-or-primary/50 hover:bg-[color-mix(in_srgb,var(--or-primary)_70%,transparent)]"
                >
                  <span className="text-[15px] font-medium text-[var(--or-text)]">{item.name}</span>
                  <span className="mt-1 break-all text-xs text-[var(--or-muted)]" title={item.path}>
                    {item.path}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  title={t("welcome:removeFromRecentTitle")}
                  aria-label={t("welcome:removeFromRecentAria")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFromRecent(item.path);
                  }}
                  className={cn(
                    "flex shrink-0 items-center justify-center self-stretch rounded-xl border border-transparent px-3 text-[var(--or-muted)] transition",
                    "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
                    "hover:border-or-error/30 hover:bg-[var(--or-error-container)] hover:text-or-error",
                    "focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-or-focus",
                    loading && "pointer-events-none",
                  )}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
