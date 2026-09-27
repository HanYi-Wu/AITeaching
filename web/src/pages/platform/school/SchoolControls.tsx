import { ChangeEvent, ReactNode } from "react";
import { Download, Search, Upload } from "lucide-react";
import { type SchoolImportKind } from "../../../platform/auth";

export type PageQuery = { q: string; status?: string; page: number; pageSize: number };

export type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function ManagementSection({
  title,
  count,
  controls,
  children,
}: {
  title: string;
  count: number;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>
        </div>
        {controls}
      </div>
      {count === 0 ? <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无数据</p> : children}
    </section>
  );
}

export function Toolbar({
  query,
  onQueryChange,
  status = false,
  bulk,
}: {
  query: PageQuery;
  onQueryChange: (patch: Partial<PageQuery>) => void;
  status?: boolean;
  bulk?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
        <input
          className="w-48 rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm"
          placeholder="搜索"
          value={query.q}
          onChange={(event) => onQueryChange({ q: event.target.value })}
        />
      </div>
      {status ? (
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          value={query.status || "all"}
          onChange={(event) => onQueryChange({ status: event.target.value })}
        >
          <option value="all">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
      ) : null}
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
        value={query.pageSize}
        onChange={(event) => onQueryChange({ pageSize: Number(event.target.value) })}
      >
        <option value={10}>10 条</option>
        <option value={20}>20 条</option>
        <option value={50}>50 条</option>
      </select>
      {bulk}
    </div>
  );
}

export function BulkActions({
  count,
  disabled,
  onEnable,
  onDisable,
}: {
  count: number;
  disabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1">
      <span className="text-xs text-slate-600">已选 {count}</span>
      <button type="button" disabled={disabled} onClick={onEnable} className="text-xs font-medium text-emerald-700 disabled:opacity-60">
        启用
      </button>
      <button type="button" disabled={disabled} onClick={onDisable} className="text-xs font-medium text-rose-700 disabled:opacity-60">
        停用
      </button>
    </div>
  );
}

export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
      <span>
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
      {active ? "启用" : "停用"}
    </span>
  );
}

export function IconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
    >
      {icon}
    </button>
  );
}

export function ImportActions({
  label,
  testId,
  onTemplate,
  onChange,
}: {
  kind: Exclude<SchoolImportKind, "all">;
  label: string;
  testId: string;
  onTemplate: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onTemplate}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        <Download className="h-4 w-4" />
        模板
      </button>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <Upload className="h-4 w-4" />
        {label}
        <input data-testid={testId} className="sr-only" type="file" accept=".json,.xlsx" onChange={onChange} />
      </label>
    </div>
  );
}
