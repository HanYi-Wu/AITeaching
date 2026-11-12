import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Download, Search, Upload } from "lucide-react";
import { type SchoolImportKind } from "../../../platform/auth";
import "../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../components/ui/select";

export type PageQuery = { q: string; status?: string; page: number; pageSize: number };

export type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="management-metric or-g53-card p-3.5 sm:p-4 transition-colors">
      <p className="text-sm font-medium text-or-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-or-text">{value}</p>
    </div>
  );
}

export function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="management-summary rounded-xl border border-or-outline/80 bg-or-block/80 p-3 sm:p-3.5 transition-colors">
      <p className="text-sm font-medium text-or-muted">{label}</p>
      <p className="mt-1 text-base font-semibold text-or-text">{value}</p>
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
    <section className="management-panel or-g53-card p-4 sm:p-5">
      <div className="management-panel-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold tracking-tight text-or-text">{title}</h2>
          <span className="or-g53-pill or-g53-pill-neutral font-medium">{count}</span>
        </div>
        {controls}
      </div>
      {count === 0 ? (
        <p className="management-empty rounded-xl border border-dashed border-or-outline p-6 text-center text-sm text-or-muted">
          暂无数据
        </p>
      ) : (
        children
      )}
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
  const [searchText, setSearchText] = useState(query.q);
  const composingRef = useRef(false);

  useEffect(() => {
    setSearchText(query.q);
  }, [query.q]);

  return (
    <div className="management-toolbar flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
      <div className="relative flex-1 min-w-[150px] sm:w-52 sm:flex-initial">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-or-muted" />
        <input
          className="or-g53-input w-full py-1.5 pl-9 pr-3 text-sm"
          aria-label="搜索名单"
          placeholder="搜索"
          value={searchText}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const value = event.currentTarget.value;
            setSearchText(value);
            onQueryChange({ q: value });
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setSearchText(value);
            const nativeEvent = event.nativeEvent as InputEvent;
            if (composingRef.current || nativeEvent.isComposing) return;
            onQueryChange({ q: value });
          }}
        />
      </div>
      {status ? (
        <AppSelect
          aria-label="名单状态"
          className="or-g53-select py-1.5 text-sm"
          value={query.status || "all"}
          onValueChange={(value) => onQueryChange({ status: value })}
        >
          <option value="all">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </AppSelect>
      ) : null}
      <AppSelect
        aria-label="每页条数"
        className="or-g53-select py-1.5 text-sm"
        value={query.pageSize}
        onValueChange={(value) => onQueryChange({ pageSize: Number(value) })}
      >
        <option value={10}>10 条/页</option>
        <option value={20}>20 条/页</option>
        <option value={50}>50 条/页</option>
      </AppSelect>
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
    <div className="management-bulk-actions inline-flex flex-wrap items-center gap-2 rounded-full border border-or-outline bg-or-inset/90 px-3 py-1">
      <span className="text-xs font-medium text-or-muted">已选 {count}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onEnable}
        className="or-g53-pill or-g53-pill-success text-xs font-semibold hover:opacity-80 disabled:opacity-50"
      >
        启用
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDisable}
        className="or-g53-pill or-g53-pill-error font-semibold hover:opacity-80 disabled:opacity-50"
      >
        停用
      </button>
    </div>
  );
}

export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <div className="management-pager mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-or-outline pt-3.5 text-sm text-or-muted">
      <span className="font-medium text-or-muted text-center sm:text-left">
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex justify-center sm:justify-end gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          className="or-g53-btn-tonal flex-1 sm:flex-initial px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
          className="or-g53-btn-tonal flex-1 sm:flex-initial px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
    <span className={`or-g53-pill ${active ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>
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
      className="or-g53-icon-btn disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={onTemplate}
        className="or-g53-btn-tonal py-2 text-sm text-or-text hover:bg-or-block"
      >
        <Download className="h-4 w-4 shrink-0" />
        模板
      </button>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-or-outline bg-or-card px-3 py-2 text-sm font-medium text-or-text transition hover:border-or-outline hover:bg-or-block">
        <Upload className="h-4 w-4 shrink-0 text-or-muted" />
        <span className="min-w-0 text-center leading-snug">{label}</span>
        <input data-testid={testId} className="sr-only" type="file" accept=".json,.xlsx" onChange={onChange} />
      </label>
    </div>
  );
}
