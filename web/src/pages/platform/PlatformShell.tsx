import type { ReactNode } from "react";
import { BookOpenCheck, LogOut } from "lucide-react";

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
  compactMobile = false,
  hideLogout = false,
  children,
}: Props) {
  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-slate-50 text-slate-950">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <BookOpenCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-wide text-slate-950">源远教学平台 <span className="text-indigo-600">OR</span></p>
              {!compactMobile && <p className="text-xs text-slate-500">让教学管理更清晰</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">{roleLabel}</span>
            {userName && <span className="hidden max-w-36 truncate text-slate-600 sm:inline">{userName}</span>}
            {onLogout && !hideLogout && (
              <button type="button" onClick={onLogout} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50">
                <LogOut className="h-4 w-4" />退出登录
              </button>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-7">
          <div className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold tracking-wider text-indigo-600">{roleLabel}</p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
