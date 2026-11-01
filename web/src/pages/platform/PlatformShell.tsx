import type { ReactNode } from "react";
import { LogOut } from "lucide-react";

type Props = {
  roleLabel: string;
  title: string;
  subtitle?: string;
  userName?: string;
  actions?: ReactNode;
  onLogout?: () => void;
  compactMobile?: boolean;
  hideLogout?: boolean;
  children: ReactNode;
};

export function PlatformShell({
  roleLabel,
  title,
  subtitle,
  userName,
  actions,
  onLogout,
  hideLogout = false,
  children,
}: Props) {
  return (
    <div className="or-app flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-[var(--or-page)] text-[var(--or-text)]">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2.5 sm:gap-3 sm:px-7 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--or-outline)] bg-white shadow-sm">
              <img src="/splash-logo.png" alt="" width={40} height={40} draggable={false} className="block h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-wide text-[var(--or-text)]">
                源远教学平台
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5 text-sm">
            <span className="or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary-container)] px-2.5 py-1 sm:px-3 text-xs font-semibold text-[var(--or-on-container)]">
              {roleLabel}
            </span>
            {userName && <span className="hidden max-w-36 truncate text-sm text-[var(--or-muted)] sm:inline">{userName}</span>}
            {onLogout && !hideLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="or-button or-button-outline inline-flex min-h-[36px] items-center gap-1.5 sm:gap-2 rounded-[10px] border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 sm:px-3 text-xs sm:text-sm font-medium text-[var(--or-text)] hover:bg-[var(--or-block)] transition-colors"
              >
                <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />退出登录
              </button>
            )}
          </div>
        </header>
        <main className="or-workspace-content min-h-0 flex-1 overflow-auto p-3.5 sm:p-7">
          <div className="mb-4 flex flex-col gap-3 border-b border-[var(--or-outline)] pb-4 sm:mb-6 sm:pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--or-text)]">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-[var(--or-muted)]">{subtitle}</p>}
            </div>
            {actions && <div className="flex w-full sm:w-auto shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
