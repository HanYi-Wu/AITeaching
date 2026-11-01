import { useTranslation } from "react-i18next";
import { Trash2, X } from "lucide-react";
import type { AgentSessionListItem } from "../../api/client";
import "../../ui-redesign/g55/g55.css";

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
      className="absolute left-0 right-0 top-full z-30 max-h-[min(52vh,22rem)] overflow-hidden border-b border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-card)_95%,transparent)] text-xs shadow-lg backdrop-blur-md  "
      role="region"
      aria-label={t("historyDialogTitle")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--or-outline)] px-3 py-2 ">
        <span className="font-semibold text-[var(--or-text)] ">{t("historyDialogTitle")}</span>
        <button
          type="button"
          className="rounded-lg p-1 text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-muted)] dark:hover:bg-[var(--or-primary)] dark:hover:text-[var(--or-on-primary)]"
          aria-label={t("closeAria")}
          title={t("closeAria")}
          onClick={onClose}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      <ul className="max-h-[min(46vh,18rem)] overflow-y-auto py-1">
        {sessionList.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-[var(--or-muted)]">{t("noHistory")}</li>
        )}
        {sessionList.map((s) => (
          <li
            key={s.session_id}
            className="flex items-center border-b border-[var(--or-outline)] last:border-0 "
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-medium text-[var(--or-text)] transition hover:bg-[var(--or-page)] disabled:opacity-50  dark:hover:bg-[color-mix(in_srgb,var(--or-primary)_60%,transparent)]"
              title={s.title}
              disabled={busy}
              onClick={() => void onLoadSession(s.session_id)}
            >
              {s.title}
            </button>
            <button
              type="button"
              className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--or-muted)] transition hover:bg-[var(--or-error-container)] hover:text-or-error disabled:opacity-50"
              title={t("removeSessionTitle")}
              aria-label={t("removeSessionTitle")}
              disabled={busy}
              onClick={() => void onRemoveSession(s.session_id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
