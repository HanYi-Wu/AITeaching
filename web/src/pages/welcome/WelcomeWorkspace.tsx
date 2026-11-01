import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Clock, FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import welcomeLogo from "../../assets/welcome-logo.png";
import { NewProjectDialog } from "../../components/NewProjectDialog";
import { apiGet, apiPost, ensureApiBase } from "../../api/client";
import { cn } from "../../lib/utils";
import "../../ui-redesign/g55/g55.css";

type RecentItem = { name: string; path: string; last_opened: string };

type Props = {
  onProjectReady: () => void;
  onError: (msg: string | null) => void;
};

export function WelcomeWorkspace({ onProjectReady, onError }: Props) {
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
    <div className="or-g55-page flex h-full min-h-0 min-w-0 w-full flex-col md:flex-row bg-[var(--or-primary)] text-[var(--or-on-primary)]">
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onProjectReady={() => {
          void loadRecent();
          onProjectReady();
        }}
        onError={onError}
      />
      {/* Brand Side Rail - responsive for mobile top banner */}
      <aside className="flex w-full md:w-[min(28%,340px)] shrink-0 flex-col border-b md:border-b-0 md:border-r border-[var(--or-primary)] bg-slate-950/50 p-4 sm:p-6 md:p-8">
        <div className="mb-2 md:mb-8 flex flex-row md:flex-col items-center md:items-start justify-between md:justify-start gap-3">
          <div className="flex max-h-8 md:max-h-none w-full max-w-[7rem] md:max-w-[10rem] items-center justify-center rounded-xl p-1">
            <img
              src={welcomeLogo}
              alt=""
              className="h-6 md:h-auto w-auto md:w-full object-contain object-center"
              aria-hidden
            />
          </div>
          <p className="text-xs md:text-sm font-semibold tracking-tight text-[var(--or-text)]">
            {t("welcome:brand")}
          </p>
        </div>
        <div className="mt-auto hidden md:block space-y-2.5 text-xs text-[var(--or-muted)]">
          <p className="leading-relaxed">{t("welcome:hint1")}</p>
          <p className="flex items-center gap-1.5 pt-1 text-[var(--or-muted)]">
            <BookOpen className="h-4 w-4 shrink-0 text-[var(--or-muted)]" />
            <span>{t("welcome:hint2")}</span>
          </p>
        </div>
      </aside>

      {/* Main Action Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 sm:p-8 md:p-10 or-g55-safe-bottom">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="mb-2 text-xl md:text-2xl font-bold tracking-tight text-white">{t("welcome:title")}</h1>
          <p className="mb-6 md:mb-8 text-xs md:text-sm text-[var(--or-muted)]">{t("welcome:subtitle")}</p>

          <div className="mb-8 md:mb-10 flex flex-col sm:flex-row gap-3">
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
      </div>
    </div>
  );
}
