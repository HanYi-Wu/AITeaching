import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AgentSessionListItem } from "../../api/client";

export interface AgentSessionHistoryMenuProps {
  isOpen: boolean;
  onClose: () => void;
  sessionList: AgentSessionListItem[];
  busy: boolean;
  onLoadSession: (id: string) => Promise<void>;
  onRemoveSession: (id: string) => Promise<void>;
}

export function AgentSessionHistoryMenu({
  isOpen,
  onClose,
  sessionList,
  busy,
  onLoadSession,
  onRemoveSession,
}: AgentSessionHistoryMenuProps) {
  const { t } = useTranslation("agent");

  if (!isOpen) return null;

  return (
    <div
      className="absolute left-0 right-0 top-full z-30 max-h-[min(52vh,21rem)] overflow-hidden border-b border-slate-200 bg-white text-[11px] shadow-md"
      role="region"
      aria-label={t("historyDialogTitle")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
        <span className="font-semibold text-slate-700">{t("historyDialogTitle")}</span>
        <button
          type="button"
          className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label={t("closeAria")}
          title={t("closeAria")}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <ul className="max-h-[min(46vh,17.5rem)] overflow-y-auto py-0.5">
        {sessionList.length === 0 && (
          <li className="px-2 py-4 text-center text-slate-400">{t("noHistory")}</li>
        )}
        {sessionList.map((s) => (
          <li
            key={s.session_id}
            className="flex items-stretch border-b border-slate-50 last:border-0"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-2 py-2 text-left text-slate-800 hover:bg-violet-50 disabled:opacity-50"
              title={s.title}
              disabled={busy}
              onClick={() => void onLoadSession(s.session_id)}
            >
              {s.title}
            </button>
            <button
              type="button"
              className="flex w-8 shrink-0 items-center justify-center text-[15px] leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              title={t("removeSessionTitle")}
              aria-label={t("removeSessionTitle")}
              disabled={busy}
              onClick={() => void onRemoveSession(s.session_id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
