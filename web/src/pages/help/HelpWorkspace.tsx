import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { BookOpen } from "lucide-react";
import "katex/dist/katex.min.css";
import { apiGet } from "../../api/client";
import { useAgentContext } from "../../contexts/AgentContext";
import { cn } from "../../lib/utils";
import { mdComponents } from "./markdownComponents";

type HelpIndexEntry = { id: string; title: string; audience: string; section?: string };

type HelpIndex = { pages: HelpIndexEntry[] };

type HelpPage = { id: string; title: string; audience: string; markdown: string };

const SECTION_ORDER = ["入门与理念", "知识图谱", "题库建设", "试卷生成", "考后分析", "智能辅助", "其它"] as const;

export function HelpWorkspace({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useTranslation("help");
  const { setPageContext } = useAgentContext();
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
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2 text-slate-800">
          <BookOpen className="h-5 w-5" strokeWidth={1.75} />
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <span className="text-xs text-slate-500">{t("subtitle")}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[17rem] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          {loading && <p className="px-2 text-xs text-slate-500">{t("loading")}</p>}
          {!loading && index && index.length === 0 && <p className="px-2 text-xs text-slate-500">{t("empty")}</p>}
          {!loading &&
            sectionGroups.map((group) => (
              <div key={group.name} className="mb-4">
                <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500">{group.name}</div>
                <ul className="space-y-0.5">
                  {group.pages.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-sm",
                          selectedId === p.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          {page && (
            <article className="mx-auto max-w-3xl">
              <h2 className="mb-6 text-2xl font-semibold text-slate-900">{page.title}</h2>
              <div className="help-md [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={mdComponents}
                >
                  {page.markdown}
                </ReactMarkdown>
              </div>
            </article>
          )}
          {!page && loading && <p className="text-sm text-slate-500">{t("loadingBody")}</p>}
        </div>
      </div>
    </div>
  );
}
