import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { listSchools } from "../../../platform/auth";
import type { PlatformUser, SchoolRecord } from "../../../platform/authTypes";
import { listManagementAudit, type AuditEvent, type AuditQuery, type ManagementScope } from "../../../platform/managementApi";
import { canManage } from "../../../platform/managementAccess";
import { loadSessionToken } from "../../../platform/session";

type Props = { user: PlatformUser; scope: ManagementScope };
type Page = { total: number; page: number; page_size: number; total_pages: number };
const PAGE_SIZE = 20;
const EMPTY_PAGE: Page = { total: 0, page: 1, page_size: PAGE_SIZE, total_pages: 1 };

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function outcomeLabel(value: AuditEvent["outcome"]) {
  if (value === "success") return "成功";
  if (value === "denied") return "拒绝";
  return "失败";
}

function actorRoleLabel(value: string) {
  const labels: Record<string, string> = {
    admin: "平台管理员",
    school: "学校管理员",
    teacher: "教师",
    student: "学生",
  };
  return labels[value] ?? "其他账号";
}

function resourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    school: "学校",
    school_user: "学校账号",
    teacher: "教师",
    class: "班级",
    student: "学生",
    assignment: "教师班级分配",
    ai_settings: "AI 设置",
    management_settings: "管理设置",
    dictionary_item: "字典条目",
    management_role: "校内角色",
    management_user_access: "账号权限",
  };
  return labels[value] ?? "管理对象";
}

export function AuditPanel({ user, scope }: Props) {
  const allowed = scope === "admin" || canManage(user, "school.audit.read");
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<Array<{ key: string; label: string }>>([]);
  const [meta, setMeta] = useState<Page>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [draftQ, setDraftQ] = useState("");
  const [query, setQuery] = useState<AuditQuery>({ page: 1, pageSize: PAGE_SIZE });
  const requestRef = useRef(0);
  const schoolRequestRef = useRef(0);
  const identityKey = `${user.id}:${user.school_id ?? ""}:${scope}:${loadSessionToken() ?? ""}`;
  const currentIdentityRef = useRef(identityKey);
  currentIdentityRef.current = identityKey;
  const auditKey = `${identityKey}:${JSON.stringify(query)}`;
  const currentAuditKeyRef = useRef(auditKey);
  currentAuditKeyRef.current = auditKey;

  useEffect(() => {
    if (scope !== "admin") {
      setSchools([]);
      return undefined;
    }
    let current = true;
    const requestId = ++schoolRequestRef.current;
    const requestedSessionToken = loadSessionToken();
    setSchoolLoading(true);
    listSchools({ page: 1, pageSize: 50 }).then(async (first) => {
      const remaining = Math.max(0, Number(first.total_pages ?? 1) - 1);
      const rest = await Promise.all(Array.from({ length: remaining }, (_, index) => listSchools({ page: index + 2, pageSize: 50 })));
      if (current && schoolRequestRef.current === requestId && currentIdentityRef.current === identityKey && loadSessionToken() === requestedSessionToken) setSchools([...first.schools, ...rest.flatMap((item) => item.schools)]);
    }).catch((reason: unknown) => {
      if (current && schoolRequestRef.current === requestId && currentIdentityRef.current === identityKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && schoolRequestRef.current === requestId && currentIdentityRef.current === identityKey && loadSessionToken() === requestedSessionToken) setSchoolLoading(false);
    });
    return () => { current = false; };
  }, [scope, user.id, user.school_id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery((previous) => ({ ...previous, q: draftQ.trim() || undefined, page: 1 }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftQ]);

  useEffect(() => {
    if (!allowed) return undefined;
    let current = true;
    const requestId = ++requestRef.current;
    const requestedAuditKey = auditKey;
    const requestedSessionToken = loadSessionToken();
    setLoading(true);
    setError(null);
    listManagementAudit(scope, query).then((result) => {
      if (!current || requestRef.current !== requestId || currentAuditKeyRef.current !== requestedAuditKey || loadSessionToken() !== requestedSessionToken) return;
      setEvents(result.events);
      setActions(result.actions);
      setMeta({ total: result.total, page: result.page, page_size: result.page_size, total_pages: Math.max(1, result.total_pages) });
    }).catch((reason: unknown) => {
      if (current && requestRef.current === requestId && currentAuditKeyRef.current === requestedAuditKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && requestRef.current === requestId && currentAuditKeyRef.current === requestedAuditKey && loadSessionToken() === requestedSessionToken) setLoading(false);
    });
    return () => { current = false; };
  }, [allowed, scope, user.id, user.school_id, query, auditKey]);

  function updateFilters(patch: Partial<AuditQuery>) {
    setQuery((previous) => ({ ...previous, ...patch, page: 1 }));
  }

  if (!allowed) {
    return <section className="management-panel or-g53-card p-5"><p className="management-empty">当前账号没有查看操作日志的权限。</p></section>;
  }

  return (
    <section className="management-panel or-g53-card min-w-0 p-4 sm:p-5" aria-labelledby="management-audit-heading">
      <div className="management-panel-header mb-4">
        <div>
          <h2 id="management-audit-heading" className="text-base font-semibold text-or-text">操作日志</h2>
        </div>
      </div>
      <div className="management-toolbar mb-4">
        {scope === "admin" ? (
          <label className="management-field">
            <span>学校</span>
            <select aria-label="按学校筛选日志" value={query.school_id ?? ""} onChange={(event) => updateFilters({ school_id: event.target.value || undefined })} className="or-g53-select text-sm" disabled={schoolLoading}>
              <option value="">全部学校</option>
              {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="management-field management-search-field">
          <span>操作者</span>
          <input aria-label="按操作者筛选日志" value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="账号或姓名" className="or-g53-input w-full text-sm" />
        </label>
        <label className="management-field">
          <span>操作</span>
          <select aria-label="按操作筛选日志" value={query.action ?? ""} onChange={(event) => updateFilters({ action: event.target.value || undefined })} className="or-g53-select text-sm">
            <option value="">全部操作</option>
            {actions.map((action) => <option key={action.key} value={action.key}>{action.label}</option>)}
          </select>
        </label>
        <label className="management-field">
          <span>结果</span>
          <select aria-label="按结果筛选日志" value={query.outcome ?? ""} onChange={(event) => updateFilters({ outcome: event.target.value || undefined })} className="or-g53-select text-sm">
            <option value="">全部结果</option><option value="success">成功</option><option value="denied">拒绝</option><option value="failure">失败</option>
          </select>
        </label>
        <label className="management-field">
          <span>开始日期</span>
          <input aria-label="日志开始日期" type="date" value={query.date_from ?? ""} onChange={(event) => updateFilters({ date_from: event.target.value || undefined })} className="or-g53-input text-sm" />
        </label>
        <label className="management-field">
          <span>结束日期</span>
          <input aria-label="日志结束日期" type="date" value={query.date_to ?? ""} onChange={(event) => updateFilters({ date_to: event.target.value || undefined })} className="or-g53-input text-sm" />
        </label>
      </div>
      {error ? <p className="management-notice mb-4" role="alert">{error}</p> : null}
      <div className="management-table-wrap overflow-x-auto" aria-busy={loading}>
        <table className="management-table w-full text-left text-sm">
          <thead><tr><th>时间</th>{scope === "admin" ? <th>学校</th> : null}<th>操作者</th><th>操作</th><th>目标</th><th>结果</th><th>详情</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{dateLabel(event.occurred_at)}</td>
                {scope === "admin" ? <td>{event.school_name || "平台"}</td> : null}
                <td><div className="font-semibold text-or-text">{event.actor_name || "未知账号"}</div><div className="mt-1 text-xs text-or-muted">{actorRoleLabel(event.actor_role)}</div></td>
                <td>{event.action_label}</td>
                <td>{resourceTypeLabel(event.resource_type)}</td>
                <td><span className={`or-g53-pill ${event.outcome === "success" ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>{outcomeLabel(event.outcome)}</span></td>
                <td><button type="button" className="or-g53-btn-tonal px-3 py-1.5 text-xs" onClick={() => setSelectedEvent(event)}>查看</button></td>
              </tr>
            ))}
            {events.length === 0 ? <tr><td colSpan={scope === "admin" ? 7 : 6}><div className="management-empty" role={loading ? "status" : undefined}>{loading ? "正在加载日志…" : "没有符合条件的日志。"}</div></td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="management-pagination mt-4 flex flex-col gap-3 border-t border-or-outline pt-3 text-sm text-or-muted sm:flex-row sm:items-center sm:justify-between">
        <span>第 {meta.page}/{meta.total_pages} 页，共 {meta.total} 条记录</span>
        <div className="flex gap-2">
          <button type="button" aria-label="日志上一页" disabled={meta.page <= 1 || loading} onClick={() => setQuery((previous) => ({ ...previous, page: Math.max(1, meta.page - 1) }))} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">上一页</button>
          <button type="button" aria-label="日志下一页" disabled={meta.page >= meta.total_pages || loading} onClick={() => setQuery((previous) => ({ ...previous, page: Math.min(meta.total_pages, meta.page + 1) }))} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">下一页</button>
        </div>
      </div>
      {selectedEvent ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="management-dialog-overlay" />
            <Dialog.Content className="management-dialog">
              <header className="management-dialog-header"><div><Dialog.Title>日志详情</Dialog.Title></div><Dialog.Close asChild><button type="button" aria-label="关闭日志详情">×</button></Dialog.Close></header>
              <dl className="management-form-grid text-sm">
                <div><dt className="text-or-muted">时间</dt><dd>{dateLabel(selectedEvent.occurred_at)}</dd></div>
                <div><dt className="text-or-muted">操作者</dt><dd>{selectedEvent.actor_name}（{selectedEvent.actor_role}）</dd></div>
                <div><dt className="text-or-muted">操作</dt><dd>{selectedEvent.action_label} · {selectedEvent.action}</dd></div>
                <div><dt className="text-or-muted">目标</dt><dd>{selectedEvent.resource_type}{selectedEvent.resource_id ? ` · ${selectedEvent.resource_id}` : ""}</dd></div>
                <div><dt className="text-or-muted">结果</dt><dd>{outcomeLabel(selectedEvent.outcome)} · HTTP {selectedEvent.http_status}</dd></div>
                <div><dt className="text-or-muted">请求编号</dt><dd className="break-all">{selectedEvent.request_id || "—"}</dd></div>
                <div><dt className="text-or-muted">请求</dt><dd>{selectedEvent.method} {selectedEvent.route_path}</dd></div>
                {selectedEvent.affected_count > 0 ? <div><dt className="text-or-muted">影响数量</dt><dd>{selectedEvent.affected_count}</dd></div> : null}
              </dl>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </section>
  );
}
