import type { ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";

type Props = {
  roleLabel: string;
  title: string;
  subtitle?: string;
  userName?: string;
  actions?: ReactNode;
  onLogout?: () => void;
  children: ReactNode;
};

export function PlatformShell({ roleLabel, title, subtitle, userName, actions, onLogout, children }: Props) {
  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 bg-slate-50 text-slate-950">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-slate-100">
        <div className="border-b border-slate-800 p-5">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Solaire Platform</p>
          <h1 className="mt-1 text-lg font-semibold text-white">{roleLabel}</h1>
          {userName ? <p className="mt-1 truncate text-sm text-slate-400">{userName}</p> : null}
        </div>
        <div className="min-h-0 flex-1 p-4 text-sm leading-6 text-slate-400">
          <p>项目级权限、学校账号、教师班级和学生答题统一在这里管理。</p>
        </div>
        {onLogout ? (
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
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{roleLabel}</p>
            <h2 className="truncate text-xl font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
