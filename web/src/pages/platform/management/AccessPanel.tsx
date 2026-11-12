import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { listSchools } from "../../../platform/auth";
import type { PlatformUser, SchoolAccountRecord, SchoolRecord } from "../../../platform/authTypes";
import {
  createManagementRole,
  getManagementAccess,
  getManagementUserAccess,
  listManagementRoles,
  listManagementUsers,
  updateManagementRole,
  updateManagementUserAccess,
  type ManagementAccess,
  type ManagementRole,
  type ManagementRolePayload,
  type ManagementScope,
  type ManagementUserAccess,
} from "../../../platform/managementApi";
import { canManage } from "../../../platform/managementAccess";
import { loadSessionToken } from "../../../platform/session";
import { PermissionExplorer } from "./PermissionExplorer";

export type AccessView = "trace" | "matrix" | "list";
type Props = {
  user: PlatformUser;
  scope: ManagementScope;
  requestedView?: AccessView;
  requestedTrace?: { kind: "user" | "role" | "menu" | "permission"; id: string };
  preferredSchoolId?: string;
  onSchoolChange?: (schoolId: string) => void;
  onNavigateSection?: (section: string) => void;
};
type Page = { total: number; page: number; page_size: number; total_pages: number };
const PAGE_SIZE = 10;
const EMPTY_PAGE: Page = { total: 0, page: 1, page_size: PAGE_SIZE, total_pages: 1 };
const EMPTY_ROLE: ManagementRolePayload = { name: "", description: "", status: "active", permissions: [] };
type PinnedEditTarget = { id: string; username: string };

function roleCaption(role: string) {
  if (role === "admin") return "平台管理员";
  if (role === "school") return "学校管理员";
  if (role === "teacher") return "教师";
  if (role === "student") return "学生";
  return role;
}

export function AccessPanel({ user, scope, requestedView, requestedTrace, preferredSchoolId, onSchoolChange, onNavigateSection }: Props) {
  const canRead = scope === "admin" || canManage(user, "school.access.read");
  const canManageRoles = scope === "admin" || (user.school_access_mode !== "custom" && canManage(user, "school.roles.manage"));
  const selfOnly = scope === "school" && !canManageRoles;
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [view, setView] = useState<AccessView>(requestedView ?? "trace");
  const [graphRevision, setGraphRevision] = useState(0);
  const preferredSchoolRef = useRef(preferredSchoolId);
  preferredSchoolRef.current = preferredSchoolId;
  const schoolChangeRef = useRef(onSchoolChange);
  schoolChangeRef.current = onSchoolChange;
  const apiSchoolId = scope === "admin" ? schoolId || undefined : undefined;
  const [catalog, setCatalog] = useState<ManagementAccess | null>(null);
  const [roles, setRoles] = useState<ManagementRole[]>([]);
  const [accounts, setAccounts] = useState<SchoolAccountRecord[]>([]);
  const [userMeta, setUserMeta] = useState<Page>(EMPTY_PAGE);
  const [page, setPage] = useState(1);
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [editTarget, setEditTarget] = useState<PinnedEditTarget | null>(null);
  const [userAccess, setUserAccess] = useState<ManagementUserAccess | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<ManagementRole | null>(null);
  const [roleForm, setRoleForm] = useState<ManagementRolePayload>(EMPTY_ROLE);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<"full" | "custom">("full");
  const [accessRoleIds, setAccessRoleIds] = useState<string[]>([]);
  const [accessSaving, setAccessSaving] = useState(false);
  const dataRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const roleRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const editTargetRef = useRef<PinnedEditTarget | null>(null);
  const scopeKey = JSON.stringify([
    user.id,
    user.status ?? "",
    user.school_id ?? "",
    user.school_access_mode ?? "",
    [...(user.management_permissions ?? [])].sort(),
    scope,
    apiSchoolId ?? "",
    loadSessionToken() ?? "",
  ]);
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const dataKey = `${scopeKey}:${canRead}:${selfOnly}:${q}:${page}`;
  const activeDataKeyRef = useRef(dataKey);
  activeDataKeyRef.current = dataKey;
  const detailTargetUserId = selfOnly ? user.id : selectedUserId;
  const detailKey = `${scopeKey}:${detailTargetUserId}:${selfOnly}`;
  const activeDetailKeyRef = useRef(detailKey);
  activeDetailKeyRef.current = detailKey;
  const activeViewRef = useRef(view);
  activeViewRef.current = view;

  function clearEditTarget() {
    editTargetRef.current = null;
    setEditTarget(null);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      roleRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    roleRequestRef.current += 1;
    editTargetRef.current = null;
    setEditTarget(null);
  }, [scopeKey]);

  useEffect(() => {
    if (requestedTrace) setView("trace");
    else if (requestedView) setView(requestedView);
  }, [requestedView, requestedTrace?.kind, requestedTrace?.id]);

  useEffect(() => {
    if (scope === "admin" && schoolId) schoolChangeRef.current?.(schoolId);
  }, [schoolId, scope]);

  useEffect(() => {
    if (scope === "admin" && preferredSchoolId && schools.some((school) => school.id === preferredSchoolId)) {
      setSchoolId(preferredSchoolId);
    }
  }, [preferredSchoolId, schools, scope]);

  useEffect(() => {
    if (scope !== "admin") return undefined;
    let current = true;
    const requestedSessionToken = loadSessionToken();
    setSchoolLoading(true);
    listSchools({ page: 1, pageSize: 50 }).then(async (first) => {
      const remaining = Math.max(0, Number(first.total_pages ?? 1) - 1);
      const rest = await Promise.all(Array.from({ length: remaining }, (_, index) => listSchools({ page: index + 2, pageSize: 50 })));
      if (!current || loadSessionToken() !== requestedSessionToken) return;
      const allSchools = [...first.schools, ...rest.flatMap((result) => result.schools)];
      setSchools(allSchools);
      setSchoolId((previous) => {
        const preferred = preferredSchoolRef.current;
        if (preferred && allSchools.some((school) => school.id === preferred)) return preferred;
        return previous && allSchools.some((school) => school.id === previous) ? previous : allSchools[0]?.id ?? "";
      });
    }).catch((reason: unknown) => {
      if (current && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (current && loadSessionToken() === requestedSessionToken) setSchoolLoading(false); });
    return () => { current = false; };
  }, [scope, user.id, user.school_id]);

  useEffect(() => {
    let current = true;
    const requestId = ++dataRequestRef.current;
    const requestedDataKey = dataKey;
    const requestedSessionToken = loadSessionToken();
    setError(null);
    if (view !== "list" || !canRead || (scope === "admin" && !apiSchoolId)) {
      setRoles([]);
      setAccounts([]);
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    const roleRequest = selfOnly ? Promise.resolve({ roles: [] as ManagementRole[] }) : listManagementRoles(scope, apiSchoolId);
    const accountRequest = selfOnly
      ? Promise.resolve(null)
      : listManagementUsers(scope, { q: q || undefined, page, pageSize: PAGE_SIZE }, apiSchoolId);
    Promise.all([roleRequest, accountRequest]).then(([roleResult, accountResult]) => {
      if (!current || dataRequestRef.current !== requestId || activeDataKeyRef.current !== requestedDataKey || loadSessionToken() !== requestedSessionToken) return;
      setRoles(roleResult.roles);
      if (accountResult) {
        setAccounts(accountResult.users);
        setUserMeta({ total: accountResult.total, page: accountResult.page, page_size: accountResult.page_size, total_pages: Math.max(1, accountResult.total_pages) });
        setSelectedUserId((previous) => {
          const pinnedTargetId = editTargetRef.current?.id;
          if (pinnedTargetId) return pinnedTargetId;
          return accountResult.users.some((item) => item.id === previous)
            ? previous
            : accountResult.users[0]?.id ?? "";
        });
      } else {
        setAccounts([]);
        setUserMeta(EMPTY_PAGE);
        setSelectedUserId(user.id);
      }
    }).catch((reason: unknown) => {
      if (current && dataRequestRef.current === requestId && activeDataKeyRef.current === requestedDataKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && dataRequestRef.current === requestId && activeDataKeyRef.current === requestedDataKey && loadSessionToken() === requestedSessionToken) setLoading(false);
    });
    return () => { current = false; };
  }, [view, canRead, scope, apiSchoolId, scopeKey, dataKey, q, page, selfOnly, user.id]);

  useEffect(() => {
    let current = true;
    const requestedSessionToken = loadSessionToken();
    const requestedScope = scopeKey;
    getManagementAccess(scope).then((result) => { if (current && activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setCatalog(result); }).catch((reason: unknown) => {
      if (current && activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { current = false; };
  }, [scope, user.id, user.school_id, scopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQ(draftQ.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [draftQ]);

  useEffect(() => {
    if (view !== "list" || !canRead || !detailTargetUserId || (scope === "admin" && !apiSchoolId)) {
      setUserAccess(null);
      setDetailLoading(false);
      return undefined;
    }
    let current = true;
    const requestId = ++detailRequestRef.current;
    const requestedDetailKey = detailKey;
    const requestedSessionToken = loadSessionToken();
    setDetailLoading(true);
    setUserAccess(null);
    const detailRequest: Promise<ManagementUserAccess> = selfOnly
      ? getManagementAccess(scope).then((access) => ({ user, access }))
      : getManagementUserAccess(scope, detailTargetUserId, apiSchoolId);
    detailRequest.then((result) => {
      if (!current || detailRequestRef.current !== requestId || activeDetailKeyRef.current !== requestedDetailKey || loadSessionToken() !== requestedSessionToken) return;
      setUserAccess(result);
      setAccessMode(result.access.full_access ? "full" : "custom");
      setAccessRoleIds(result.access.assigned_roles.map((role) => role.id));
    }).catch((reason: unknown) => {
      if (current && detailRequestRef.current === requestId && activeDetailKeyRef.current === requestedDetailKey && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (current && detailRequestRef.current === requestId && activeDetailKeyRef.current === requestedDetailKey && loadSessionToken() === requestedSessionToken) setDetailLoading(false);
    });
    return () => { current = false; };
  }, [view, canRead, scope, apiSchoolId, detailTargetUserId, selfOnly, scopeKey, detailKey]);

  const selectedAccount = selfOnly ? userAccess?.user : accounts.find((account) => account.id === selectedUserId);
  const accessSchoolLabel = userAccess?.access.school_id
    ? scope === "admin" ? schools.find((school) => school.id === userAccess.access.school_id)?.name ?? "已选择学校" : "仅当前学校数据"
    : "平台范围";
  const descriptors = catalog?.catalog ?? userAccess?.access.catalog ?? [];
  const rolePermissions = useMemo(() => descriptors.filter((item) => item.assignable && !item.key.startsWith("admin.") && item.key !== "school.roles.manage"), [descriptors]);
  const effectiveKeys = new Set(userAccess?.access.effective_permissions ?? []);
  const effectiveDescriptors = descriptors.filter((item) => effectiveKeys.has(item.key));
  const availableRoles = roles.filter((role) => role.status === "active" || accessRoleIds.includes(role.id));
  const ownFullAccess = scope === "school" && selectedUserId === user.id && Boolean(userAccess?.access.full_access);

  function openRoleDialog(role?: ManagementRole) {
    setEditingRole(role ?? null);
    setRoleForm(role ? { name: role.name, description: role.description, status: role.status, permissions: [...role.permissions] } : { ...EMPTY_ROLE, permissions: [] });
    setDialogError(null);
    setRoleDialogOpen(true);
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roleName = roleForm.name.trim();
    if (!roleName) { setDialogError("请填写角色名称。"); return; }
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setBusy(true);
    setDialogError(null);
    try {
      const payload = { ...roleForm, name: roleName, description: roleForm.description?.trim() ?? "", permissions: [...new Set(roleForm.permissions.filter((key) => !key.startsWith("admin.") && key !== "school.roles.manage"))] };
      if (editingRole) await updateManagementRole(scope, editingRole.id, payload, apiSchoolId);
      else await createManagementRole(scope, payload, apiSchoolId);
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) {
        setDialogError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      }
      return;
    }
    if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
    setGraphRevision((value) => value + 1);
    setRoleDialogOpen(false);
    setNotice(editingRole ? "角色已更新。" : "角色已创建。");
    try {
      const [refreshed, refreshedAccess] = await Promise.all([
        listManagementRoles(scope, apiSchoolId),
        selectedUserId ? getManagementUserAccess(scope, selectedUserId, apiSchoolId) : Promise.resolve(null),
      ]);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setRoles(refreshed.roles);
      if (refreshedAccess) setUserAccess(refreshedAccess);
      setPage(1);
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setBusy(false);
    }
  }

  async function toggleRoleStatus(role: ManagementRole) {
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    const status = role.status === "active" ? "disabled" : "active";
    setBusy(true);
    setError(null);
    try {
      await updateManagementRole(scope, role.id, { status }, apiSchoolId);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setGraphRevision((value) => value + 1);
      const [roleResult, accessResult] = await Promise.all([
        listManagementRoles(scope, apiSchoolId),
        selectedUserId ? getManagementUserAccess(scope, selectedUserId, apiSchoolId) : Promise.resolve(null),
      ]);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setRoles(roleResult.roles);
      if (accessResult) setUserAccess(accessResult);
      setNotice(status === "active" ? "角色已启用。" : "角色已停用。");
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setBusy(false);
    }
  }

  async function saveUserAccess() {
    if (!selectedUserId || !userAccess) return;
    if (ownFullAccess && accessMode === "custom") {
      setError("学校管理员不能将自己的账号改为自定义权限。");
      return;
    }
    const requestedScope = scopeKey;
    const requestedSessionToken = loadSessionToken();
    setAccessSaving(true);
    setError(null);
    try {
      await updateManagementUserAccess(scope, selectedUserId, { mode: accessMode, role_ids: accessMode === "custom" ? accessRoleIds : [] }, apiSchoolId);
      if (activeScopeRef.current !== requestedScope || loadSessionToken() !== requestedSessionToken) return;
      setGraphRevision((value) => value + 1);
      setNotice("账号权限已更新。");
      const refreshed = await getManagementUserAccess(scope, selectedUserId, apiSchoolId);
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setUserAccess(refreshed);
    } catch (reason) {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (activeScopeRef.current === requestedScope && loadSessionToken() === requestedSessionToken) setAccessSaving(false);
    }
  }

  if (!canRead) {
    return <section className="management-panel or-g53-card p-5"><p className="management-empty">当前账号没有查看权限链的权限。</p></section>;
  }

  const schoolPicker = scope === "admin" ? (
    <label className="management-field min-w-48">
      <span className="sr-only">选择学校</span>
      <select aria-label="权限管理学校" value={schoolId} onChange={(event) => { roleRequestRef.current += 1; clearEditTarget(); setSchoolId(event.target.value); setRoles([]); setAccounts([]); setSelectedUserId(""); setUserAccess(null); setDetailLoading(false); setPage(1); setNotice(null); setError(null); setDialogError(null); setRoleDialogOpen(false); setBusy(false); setAccessSaving(false); }} className="or-g53-select text-sm" disabled={schoolLoading || schools.length === 0 || busy || accessSaving}>
        {schools.length === 0 ? <option value="">{schoolLoading ? "正在加载学校…" : "暂无学校"}</option> : null}
        {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
      </select>
    </label>
  ) : null;

  return (
    <div className="space-y-5">
      <section className="management-panel or-g53-card p-4 sm:p-5">
        <div className="management-panel-header">
          <div className="flex min-w-0 flex-wrap items-center gap-4"><h2 className="text-base font-semibold text-or-text">权限管理</h2>{schoolPicker}</div>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="权限查看方式" className="inline-flex gap-1 rounded-xl bg-or-block p-1">
              {([["trace", "溯源"], ["matrix", "矩阵"], ["list", "列表"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={`${view === id ? "or-g53-btn-primary" : "or-g53-btn-tonal"} px-4 py-2 text-sm`}>{label}</button>)}
            </div>
            {view !== "list" && canManageRoles ? <button type="button" disabled={scope === "admin" && !apiSchoolId} onClick={() => openRoleDialog()} className="or-g53-btn-primary px-4 py-2 text-sm">新建角色</button> : null}
          </div>
        </div>
        {error ? <p className="management-notice mt-4" role="alert">{error}</p> : null}
        {notice ? <p className="management-notice mt-4" role="status">{notice}</p> : null}
      </section>

      {view !== "list" ? (
        <PermissionExplorer
          user={user}
          scope={scope}
          schoolId={apiSchoolId}
          view={view}
          onViewChange={setView}
          revision={graphRevision}
          target={requestedTrace}
          onNavigateSection={onNavigateSection}
          onOpenListView={() => setView("list")}
          onEditUserAccess={!selfOnly ? (targetUserId, targetUsername) => {
            const target = { id: targetUserId, username: targetUsername?.trim() ?? "" };
            editTargetRef.current = target;
            setEditTarget(target);
            setSelectedUserId(targetUserId);
            setDraftQ(target.username);
            setQ(target.username);
            setPage(1);
            setUserAccess(null);
            setError(null);
            setNotice(null);
            setView("list");
          } : undefined}
          onEditRole={canManageRoles ? (targetRoleId) => {
            const requestId = ++roleRequestRef.current;
            const requestedScope = scopeKey;
            const requestedSessionToken = loadSessionToken();
            const isCurrentRoleRequest = () =>
              mountedRef.current &&
              roleRequestRef.current === requestId &&
              activeScopeRef.current === requestedScope &&
              loadSessionToken() === requestedSessionToken &&
              activeViewRef.current === "trace";
            if (!targetRoleId) {
              openRoleDialog();
              return;
            }
            const existing = roles.find((item) => item.id === targetRoleId);
            if (existing) {
              openRoleDialog(existing);
              return;
            }
            void listManagementRoles(scope, apiSchoolId)
              .then((result) => {
                if (!isCurrentRoleRequest()) return;
                setRoles(result.roles);
                const found = result.roles.find((item) => item.id === targetRoleId);
                if (found) openRoleDialog(found);
                else setError("该角色已不存在或不属于当前学校。");
              })
              .catch((reason: unknown) => {
                if (isCurrentRoleRequest()) {
                  setError(reason instanceof Error ? reason.message : "加载角色失败，请重试。");
                }
              });
          } : undefined}
        />
      ) : <>
      {!selfOnly ? (
        <section className="management-panel or-g53-card p-4 sm:p-5">
          <div className="management-panel-header mb-4"><div><h3 className="text-base font-semibold text-or-text">校内角色</h3></div>{canManageRoles ? <button type="button" onClick={() => openRoleDialog()} className="or-g53-btn-primary px-3.5 py-2 text-sm">新建角色</button> : null}</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy={loading}>
            {roles.map((role) => (
              <article key={role.id} className="management-panel rounded-xl border border-or-outline p-4">
                <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-or-text">{role.name}</h4>{role.description ? <p className="mt-1 text-sm text-or-muted">{role.description}</p> : null}</div><span className={`or-g53-pill ${role.status === "active" ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>{role.status === "active" ? "启用" : "停用"}</span></div>
                <p className="mt-3 text-xs text-or-muted">{role.permissions.length} 项权限 · {role.user_count ?? 0} 个账号</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">{role.permissions.map((permission) => <li key={permission} className="rounded-full bg-or-block px-2 py-1 text-xs text-or-muted">{descriptors.find((item) => item.key === permission)?.label ?? permission}</li>)}</ul>
                {canManageRoles ? <div className="management-row-actions mt-4 flex gap-2"><button type="button" className="or-g53-btn-tonal px-3 py-1.5 text-xs" onClick={() => openRoleDialog(role)}>编辑角色</button><button type="button" className="or-g53-btn-tonal px-3 py-1.5 text-xs" disabled={busy} onClick={() => void toggleRoleStatus(role)}>{role.status === "active" ? "停用" : "启用"}</button></div> : null}
              </article>
            ))}
            {roles.length === 0 ? <div className="management-empty md:col-span-2 xl:col-span-3">{loading ? "正在加载角色…" : "还没有校内角色。"}</div> : null}
          </div>
        </section>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        {!selfOnly ? (
          <section className="management-panel or-g53-card min-w-0 p-4 sm:p-5">
            <div className="management-panel-header mb-4"><div><h3 className="text-base font-semibold text-or-text">账号权限</h3></div></div>
            <label className="management-field mb-3"><span>搜索账号</span><input aria-label="搜索权限账号" value={draftQ} onChange={(event) => { clearEditTarget(); setDraftQ(event.target.value); }} placeholder="账号或姓名" className="or-g53-input w-full text-sm" disabled={busy || accessSaving} /></label>
            {editTarget && !accounts.some((account) => account.id === editTarget.id) ? (
              <p className="management-notice mb-3" role="status">
                已定位账号「{userAccess?.user.id === editTarget.id ? userAccess.user.display_name || userAccess.user.username : editTarget.username || editTarget.id}」，但当前筛选页未显示此账号；右侧权限链{detailLoading ? "正在读取。" : userAccess?.user.id === editTarget.id ? "已针对该账号加载。" : "未能加载，请查看错误提示。"}
              </p>
            ) : null}
            <div className="management-table-wrap overflow-x-auto" aria-busy={loading}>
              <table className="management-table w-full text-left text-sm"><thead><tr><th>账号</th><th>状态</th><th>查看</th></tr></thead><tbody>
                {accounts.map((account) => <tr key={account.id} className={selectedUserId === account.id ? "is-selected" : undefined}><td><div className="font-semibold">{account.display_name || account.username}</div><div className="mt-1 text-xs text-or-muted">{account.username} · {roleCaption(account.role)}</div></td><td>{account.status === "active" ? "启用" : "停用"}</td><td><button type="button" className="or-g53-btn-tonal px-3 py-1.5 text-xs" disabled={accessSaving || busy} onClick={() => { clearEditTarget(); setSelectedUserId(account.id); }}>权限链</button></td></tr>)}
                {accounts.length === 0 ? <tr><td colSpan={3}><div className="management-empty">{loading ? "正在加载账号…" : "没有匹配的账号。"}</div></td></tr> : null}
              </tbody></table>
            </div>
            <div className="management-pagination mt-3 flex items-center justify-between gap-3 border-t border-or-outline pt-3 text-sm text-or-muted"><span>第 {userMeta.page}/{userMeta.total_pages} 页 · 共 {userMeta.total} 个账号</span><div className="flex gap-2"><button type="button" aria-label="权限账号上一页" disabled={page <= 1 || loading || busy} onClick={() => { clearEditTarget(); setPage((value) => Math.max(1, value - 1)); }} className="or-g53-btn-tonal px-3 py-1.5 text-xs disabled:opacity-50">上一页</button><button type="button" aria-label="权限账号下一页" disabled={page >= userMeta.total_pages || loading || busy} onClick={() => { clearEditTarget(); setPage((value) => Math.min(userMeta.total_pages, value + 1)); }} className="or-g53-btn-tonal px-3 py-1.5 text-xs disabled:opacity-50">下一页</button></div></div>
          </section>
        ) : null}

        <section className="management-panel or-g53-card min-w-0 p-4 sm:p-5">
          <div className="management-panel-header mb-4"><div><h3 className="text-base font-semibold text-or-text">权限链路</h3></div></div>
          {detailLoading ? <p className="management-empty" role="status">正在加载权限链…</p> : null}
          {!detailLoading && !userAccess ? <p className="management-empty">{selfOnly ? "正在读取当前账号的权限链。" : "选择账号查看权限。"}</p> : null}
          {userAccess ? (
            <div className="space-y-4">
              <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <li className="rounded-xl bg-or-block p-3"><p className="text-xs text-or-muted">账号</p><p className="mt-1 font-semibold">{selectedAccount?.display_name || userAccess.user.display_name || userAccess.user.username}</p><p className="text-xs text-or-muted">{userAccess.user.username}</p></li>
                <li className="rounded-xl bg-or-block p-3"><p className="text-xs text-or-muted">基础角色</p><p className="mt-1 font-semibold">{roleCaption(userAccess.user.role)}</p></li>
                <li className="rounded-xl bg-or-block p-3"><p className="text-xs text-or-muted">校内角色</p><p className="mt-1 font-semibold">{userAccess.access.full_access ? "完整管理权限" : userAccess.access.assigned_roles.map((role) => role.name).join("、") || "未分配角色"}</p></li>
                <li className="rounded-xl bg-or-block p-3"><p className="text-xs text-or-muted">数据范围</p><p className="mt-1 font-semibold">{accessSchoolLabel}</p></li>
              </ol>
              {canManageRoles ? (
                <section className="rounded-xl border border-or-outline p-4">
                  <h4 className="font-semibold">账号权限模式</h4>
                  <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2"><input type="radio" name="access-mode" checked={accessMode === "full"} onChange={() => setAccessMode("full")} />完整管理权限</label>
                    <label className="inline-flex items-center gap-2"><input type="radio" name="access-mode" checked={accessMode === "custom"} disabled={ownFullAccess} onChange={() => setAccessMode("custom")} />按校内角色授予</label>
                  </fieldset>
                  {accessMode === "custom" ? <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">{availableRoles.map((role) => <label key={role.id} className="inline-flex items-start gap-2 rounded-lg bg-or-block p-2.5 text-sm"><input type="checkbox" checked={accessRoleIds.includes(role.id)} disabled={role.status !== "active" && !accessRoleIds.includes(role.id)} onChange={(event) => setAccessRoleIds((previous) => event.target.checked ? [...new Set([...previous, role.id])] : previous.filter((id) => id !== role.id))} /><span><span className="block font-medium">{role.name}{role.status === "disabled" ? "（停用）" : ""}</span>{role.description ? <span className="text-xs text-or-muted">{role.description}</span> : null}</span></label>)}{availableRoles.length === 0 ? <p className="text-sm text-or-muted">暂无可分配的启用角色。</p> : null}</fieldset> : null}
                  {ownFullAccess ? <p className="mt-2 text-xs text-or-muted">不能将自己的账号改为自定义权限。</p> : null}
                  <button type="button" className="or-g53-btn-primary mt-4 px-4 py-2 text-sm" disabled={accessSaving || detailLoading} onClick={() => void saveUserAccess()}>{accessSaving ? "正在保存…" : "保存账号权限"}</button>
                </section>
              ) : null}
              <section>
                <h4 className="mb-2 font-semibold">页面与操作权限</h4>
                <div className="space-y-2">
                  {(userAccess.access.full_access ? [] : effectiveDescriptors).map((permission) => <article key={permission.key} className="rounded-xl border border-or-outline p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h5 className="font-medium">{permission.label}</h5><span className="text-xs text-or-muted">{permission.group}</span></div><details className="mt-2 text-xs text-or-muted"><summary className="cursor-pointer font-medium">权限详情</summary><p className="mt-2">{permission.description}</p><p className="mt-2">允许的操作：{permission.methods.join("、") || "—"}</p><ul className="mt-1 break-all">{permission.paths.map((path) => <li key={path}>{path}</li>)}</ul></details></article>)}
                  {!userAccess.access.full_access && effectiveDescriptors.length === 0 ? <p className="management-empty">该账号目前没有分配可见的管理权限。</p> : null}
                  {userAccess.access.full_access ? <details className="rounded-xl border border-or-outline p-3"><summary className="cursor-pointer text-sm font-medium">展开完整权限目录</summary><ul className="mt-3 space-y-2">{userAccess.access.catalog.map((permission) => <li key={permission.key}><span className="font-medium">{permission.label}</span><details className="mt-1 text-xs text-or-muted"><summary className="cursor-pointer">权限详情</summary><p className="mt-1">{permission.methods.join("、")} · {permission.paths.join("、")}</p></details></li>)}</ul></details> : null}
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </div>

      </>}

      {roleDialogOpen ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) { setRoleDialogOpen(false); setDialogError(null); } }}>
          <Dialog.Portal><Dialog.Overlay className="management-dialog-overlay" /><Dialog.Content className="management-dialog">
            <header className="management-dialog-header"><div><Dialog.Title>{editingRole ? "编辑校内角色" : "新建校内角色"}</Dialog.Title><Dialog.Description className="sr-only">选择可授予的权限。</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="关闭角色编辑" disabled={busy}>×</button></Dialog.Close></header>
            {dialogError ? <p className="management-notice mb-4" role="alert">{dialogError}</p> : null}
            <form onSubmit={(event) => void saveRole(event)}>
              <div className="management-form-grid">
                <label className="management-field"><span>角色名称</span><input autoFocus required value={roleForm.name} onChange={(event) => { setRoleForm((previous) => ({ ...previous, name: event.target.value })); setDialogError(null); }} className="or-g53-input text-sm" /></label>
                <label className="management-field"><span>说明</span><input value={roleForm.description ?? ""} onChange={(event) => setRoleForm((previous) => ({ ...previous, description: event.target.value }))} className="or-g53-input text-sm" /></label>
                <label className="management-field"><span>状态</span><select value={roleForm.status ?? "active"} onChange={(event) => setRoleForm((previous) => ({ ...previous, status: event.target.value as "active" | "disabled" }))} className="or-g53-select text-sm"><option value="active">启用</option><option value="disabled">停用</option></select></label>
              </div>
              <fieldset className="mt-5"><legend className="mb-2 text-sm font-semibold">可分配权限</legend><div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">{rolePermissions.map((permission) => <label key={permission.key} className="inline-flex items-start gap-2 rounded-lg bg-or-block p-2.5 text-sm"><input type="checkbox" checked={roleForm.permissions.includes(permission.key)} onChange={(event) => setRoleForm((previous) => ({ ...previous, permissions: event.target.checked ? [...new Set([...previous.permissions, permission.key])] : previous.permissions.filter((key) => key !== permission.key) }))} /><span><span className="block font-medium">{permission.label}</span>{permission.description ? <span className="block text-xs text-or-muted">{permission.description}</span> : null}</span></label>)}</div></fieldset>
              <footer className="management-dialog-footer"><button type="button" disabled={busy} onClick={() => setRoleDialogOpen(false)} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button><button type="submit" disabled={busy || rolePermissions.length === 0} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold">{busy ? "正在保存…" : editingRole ? "保存角色" : "创建角色"}</button></footer>
            </form>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
