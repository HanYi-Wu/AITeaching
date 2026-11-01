import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export type TabItem = {
  id: string;
  label: string;
  dirty?: boolean;
  closable?: boolean;
};

type Props = {
  tabs: TabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onCloseOthers?: () => void;
  className?: string;
};

export function TabPanel({ tabs, activeId, onSelect, onClose, onCloseOthers, className }: Props) {
  const { t } = useTranslation("common");
  if (tabs.length === 0) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex min-h-10 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[var(--or-outline)] bg-[var(--or-card)] px-1",
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={cn(
              "group relative flex min-w-0 max-w-[15rem] items-center border-b-2 px-3 py-1.5 text-left text-sm font-medium transition-colors select-none",
              active
                ? "border-[var(--or-primary)] bg-[var(--or-primary-container)]/30 text-[var(--or-text)]"
                : "border-transparent text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)]",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onSelect(tab.id)}
              title={tab.label}
            >
              {tab.dirty ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-hidden /> : null}
              <span className="align-middle">{tab.label}</span>
            </button>
            {tab.closable !== false && onClose ? (
              <button
                type="button"
                className="ml-1 shrink-0 rounded p-0.5 text-[var(--or-muted)] opacity-100 md:opacity-0 hover:bg-[var(--or-block)] hover:text-[var(--or-text)] md:group-hover:opacity-100 transition-opacity"
                aria-label={t("close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      {onCloseOthers && tabs.length > 1 ? (
        <button
          type="button"
          className="ml-auto shrink-0 px-3 text-xs font-medium text-[var(--or-muted)] hover:text-[var(--or-text)] transition-colors"
          onClick={onCloseOthers}
        >
          {t("closeOtherTabs")}
        </button>
      ) : null}
    </div>
  );
}
