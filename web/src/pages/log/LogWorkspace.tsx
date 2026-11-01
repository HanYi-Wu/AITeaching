import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clipboard, ScrollText, Trash2 } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  clearLogs,
  copyLogsAsText,
  getLogSnapshot,
  subscribeLogs,
  type LogEntry,
  type LogLevel,
} from "../../lib/appLog";
import { useAgentContext } from "../../contexts/AgentContext";
import { formatLocaleTime } from "../../lib/locale";
import { cn } from "../../lib/utils";
import "../../ui-redesign/g55/g55.css";
import { Select as AppSelect } from "../../components/ui/select";

function useLogs() {
  return useSyncExternalStore(subscribeLogs, getLogSnapshot, getLogSnapshot);
}

export function LogWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation(["log", "common"]);
  const { setPageContext } = useAgentContext();
  const entries = useLogs();
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);

  useEffect(() => {
    if (embedded) return;
    setPageContext({
      current_page: "log",
      summary: t("log:pageSummary"),
    });
    return () => setPageContext(null);
  }, [embedded, setPageContext, t]);

  const filtered = useMemo(() => {
    if (levelFilter === "all") {
      return [...entries].reverse();
    }
    return [...entries].filter((e) => e.level === levelFilter).reverse();
  }, [entries, levelFilter]);

  async function handleCopy() {
    const clip = copyLogsAsText();
    try {
      await copyTextToClipboard(clip);
      setManualCopy(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setManualCopy(clip);
    }
  }

  return (
    <div
      className={cn(
        "or-g55-page flex min-h-0 flex-col bg-[var(--or-page)] ",
        embedded ? "h-[28rem] rounded-2xl border border-[var(--or-outline)] " : "h-full",
      )}
    >
      {/* Workspace Header & Toolbar */}
      <div
        className={cn(
          "shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)]  ",
          embedded ? "rounded-t-2xl px-4 py-3" : "px-4 py-3 sm:px-6 sm:py-4",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2.5 text-[var(--or-text)] ">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-or-primary-container text-or-primary">
              <ScrollText className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <h1 className="text-base font-bold tracking-tight">{t("log:title")}</h1>
            {!embedded && <span className="hidden text-xs text-[var(--or-muted)] sm:inline ">{t("log:intro")}</span>}
          </div>
          <span className="or-g55-pill bg-[var(--or-block)] text-xs font-semibold text-[var(--or-muted)]  ">
            {t("log:count", { n: entries.length })}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-2.5">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--or-muted)] ">
            <span>{t("log:level")}</span>
            <AppSelect
              className="h-9 sm:h-8 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 text-xs text-[var(--or-text)] outline-none transition focus:border-or-focus   "
              value={levelFilter}
              onValueChange={(value) => setLevelFilter(value as LogLevel | "all")}
            >
              <option value="all">{t("common:all")}</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
            </AppSelect>
          </label>

          <button
            type="button"
            className="inline-flex h-9 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 text-xs font-medium text-[var(--or-muted)] shadow-sm transition hover:bg-[var(--or-page)]    dark:hover:bg-slate-700"
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-or-success" /> : <Clipboard className="h-3.5 w-3.5" />}
            <span>{copied ? t("log:copied") : t("log:copyAll")}</span>
          </button>

          <button
            type="button"
            className="or-g55-btn-error inline-flex h-9 sm:h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-sm transition"
            onClick={() => clearLogs()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("log:clear")}</span>
          </button>
        </div>
      </div>

      {/* Log Entries Container */}
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6 or-g55-safe-bottom">
        {manualCopy !== null && (
          <div className="or-g55-status-warning mb-4 space-y-2 rounded-xl p-4" role="alert">
            <p className="text-sm font-medium">{t("log:manualCopyHint")}</p>
            <textarea
              aria-label={t("log:manualCopyText")}
              readOnly
              value={manualCopy}
              onFocus={(event) => event.currentTarget.select()}
              className="h-36 w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] p-2.5 font-mono text-xs text-[var(--or-text)] outline-none   "
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-[var(--or-muted)] ">
            {t("log:empty")}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry: e }: { entry: LogEntry }) {
  const time = formatLocaleTime(new Date(e.ts), {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <li
      className={cn(
        "or-g55-static-card rounded-xl border p-3 font-mono text-xs shadow-sm transition-none",
        e.level === "error" && "or-g55-status-error",
        e.level === "warn" && "or-g55-status-warning",
        e.level === "info" && "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)]   ",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[11px] text-[var(--or-muted)] ">{time}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-sm font-bold uppercase",
            e.level === "error" && "or-g55-status-error",
            e.level === "warn" && "or-g55-status-warning",
            e.level === "info" && "bg-[var(--or-block)] text-[var(--or-muted)]  ",
          )}
        >
          {e.level}
        </span>
        <span className="text-[var(--or-muted)] ">[{e.source}]</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed">{e.message}</p>
      {e.detail ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-2.5 font-mono text-[11px] leading-relaxed text-[var(--or-muted)] dark:bg-black/30 ">
          {e.detail}
        </pre>
      ) : null}
    </li>
  );
}
