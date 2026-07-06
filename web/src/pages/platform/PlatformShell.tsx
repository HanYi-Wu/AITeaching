import type { ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";

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
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-slate-50 text-slate-950 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-slate-950 text-slate-100 lg:w-64 lg:border-b-0 lg:border-r">
        <div className={`flex items-center border-b border-slate-800 lg:block lg:p-5 ${compactMobile ? "gap-2 p-2" : "gap-3 p-4"}`}>
          <div
            className={`flex shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white lg:mb-4 lg:h-10 lg:w-10 ${
              compactMobile ? "h-8 w-8" : "h-10 w-10"
            }`}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className={`${compactMobile ? "hidden lg:block" : ""} text-xs font-semibold uppercase tracking-wide text-slate-500`}>
              Solaire Platform
            </p>
            <h1 className={`${compactMobile ? "text-sm lg:mt-1 lg:text-lg" : "mt-1 text-lg"} font-semibold text-white`}>{roleLabel}</h1>
            {userName ? (
              <p className={`${compactMobile ? "text-xs lg:mt-1 lg:text-sm" : "mt-1 text-sm"} truncate text-slate-400`}>{userName}</p>
            ) : null}
          </div>
        </div>
        <div className="hidden min-h-0 flex-1 p-4 text-sm leading-6 text-slate-400 lg:block">
          <p>平台权限、学校账号、教师班级和学生答题统一在这里管理。</p>
        </div>
        {onLogout && !hideLogout ? (
          <div className="border-t border-slate-800 p-3">
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        ) : null}
      </aside>
      <div className="flex min-w-0 w-full flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{roleLabel}</p>
            <h2 className="truncate text-xl font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
