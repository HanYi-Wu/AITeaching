import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { BookOpen, ChevronRight } from "lucide-react";
import "katex/dist/katex.min.css";
import { apiGet } from "../../api/client";
import { useAgentActions } from "../../contexts/AgentContext";
import { cn } from "../../lib/utils";
import { mdComponents } from "./markdownComponents";
import "../../ui-redesign/g55/g55.css";
import { Select as AppSelect } from "../../components/ui/select";

type HelpIndexEntry = { id: string; title: string; audience: string; section?: string };

type HelpIndex = { pages: HelpIndexEntry[] };

type HelpPage = { id: string; title: string; audience: string; markdown: string };

const SECTION_ORDER = ["入门与理念", "知识图谱", "题库建设", "试卷生成", "考后分析", "智能辅助", "其它"] as const;

export function HelpWorkspace({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useTranslation("help");
  const { setPageContext } = useAgentActions();
  const [index, setIndex] = useState<HelpIndexEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<HelpPage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const title = page?.title;
    setPageContext({
      current_page: "help",
      summary: title ? t("pageSummaryWithTitle", { title }) : t("pageSummaryDefault"),
    });
    return () => setPageContext(null);
  }, [page?.title, setPageContext, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        onError(null);
        const data = await apiGet<HelpIndex>("/api/help/index");
        if (cancelled) return;
        const pages = data.pages as HelpIndexEntry[];
        setIndex(pages);
        if (pages.length > 0) {
          const withSection = pages.map((p) => ({ ...p, section: (p.section ?? "").trim() }));
          const preferred = SECTION_ORDER.map((s) => withSection.find((p) => p.section === s)).find(Boolean);
          setSelectedId((preferred ?? withSection[0]).id);
        }
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
          setIndex([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!selectedId) {
      setPage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        onError(null);
        const data = await apiGet<HelpPage>(`/api/help/page/${encodeURIComponent(selectedId)}`);
        if (!cancelled) setPage(data);
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
          setPage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, onError]);

  const sectionGroups = useMemo(() => {
    const pages = (index ?? []).map((p) => ({ ...p, section: (p.section ?? "").trim() || "其它" }));
    const map = new Map<string, HelpIndexEntry[]>();
    for (const p of pages) {
      const key = (p.section ?? "").trim() || "其它";
      const arr = map.get(key);
      if (arr) {
        arr.push(p);
      } else {
        map.set(key, [p]);
      }
    }
    const known: Array<{ name: string; pages: HelpIndexEntry[] }> = [];
    for (const name of SECTION_ORDER) {
      const arr = map.get(name);
      if (arr && arr.length > 0) {
        known.push({ name, pages: arr });
        map.delete(name);
      }
    }
    const unknown = Array.from(map.entries()).map(([name, groupPages]) => ({ name, pages: groupPages }));
    return [...known, ...unknown];
  }, [index]);

  return (
    <div className="or-g55-page flex h-full min-h-0 flex-col bg-[var(--or-page)] ">
      {/* Top Header with mobile responsive article selector */}
      <div className="shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 sm:px-6 sm:py-4  ">
        <div className="flex items-center gap-3 text-[var(--or-text)] ">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-or-primary-container text-or-primary">
            <BookOpen className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{t("title")}</h1>
          </div>
        </div>

        {/* Mobile quick article dropdown */}
        {!loading && index && index.length > 0 && (
          <div className="mt-3 lg:hidden">
            <AppSelect
              aria-label={t("title")}
              value={selectedId ?? ""}
              onValueChange={(value) => setSelectedId(value)}
              className="w-full h-10 rounded-xl border border-[var(--or-outline)] bg-[var(--or-page)] px-3 text-sm font-medium text-[var(--or-text)] outline-none transition focus:border-or-focus   "
            >
              {sectionGroups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </AppSelect>
          </div>
        )}
      </div>

      {/* Main Workspace Body */}
      <div className="flex min-h-0 flex-1">
        {/* Navigation Sidebar (hidden on small mobile screens where dropdown is active) */}
        <aside className="hidden lg:block w-64 shrink-0 overflow-y-auto border-r border-[var(--or-outline)] bg-[var(--or-card)] p-3.5  ">
          {loading && <p className="px-3 py-2 text-xs text-[var(--or-muted)]">{t("loading")}</p>}
          {!loading && index && index.length === 0 && <p className="px-3 py-2 text-xs text-[var(--or-muted)]">{t("empty")}</p>}
          {!loading &&
            sectionGroups.map((group) => (
              <div key={group.name} className="mb-4">
                <div className="px-3 pb-1.5 text-xs font-semibold tracking-wider text-[var(--or-muted)] ">
                  {group.name}
                </div>
                <ul className="space-y-1">
                  {group.pages.map((p) => {
                    const active = selectedId === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(p.id)}
                          className={cn(
                            "relative flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition",
                            active
                              ? "bg-or-primary-container text-or-on-container shadow-sm"
                              : "text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-block)_80%,transparent)] hover:text-[var(--or-text)]  dark:hover:bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)] dark:hover:text-[var(--or-text)]",
                          )}
                        >
                          <span className="truncate">{p.title}</span>
                          {active && <ChevronRight className="h-4 w-4 shrink-0 text-or-primary" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </aside>

        {/* Content Area */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 or-g55-safe-bottom">
          {page && (
            <article className="mx-auto max-w-3xl">
              <h2 className="mb-4 sm:mb-6 text-xl sm:text-2xl font-bold tracking-tight text-[var(--or-text)] ">
                {page.title}
              </h2>
              <div className="help-md text-[15px] leading-relaxed text-[var(--or-text)]  [&_.katex-display]:my-5 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1.5">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={mdComponents}
                >
                  {page.markdown.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "")}
                </ReactMarkdown>
              </div>
            </article>
          )}
          {!page && loading && (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--or-muted)]">
              {t("loadingBody")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
