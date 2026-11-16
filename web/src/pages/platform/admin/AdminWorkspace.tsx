import { FormEvent, lazy, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Bot, KeyRound, Pencil, Plus, RefreshCw, School, UserPlus } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { apiAgentLlmSettingsGet, type AgentLlmSettingsResponse } from "../../../api/client";
import {
  createSchool,
  createSchoolUser,
  listSchoolUsers,
  listSchools,
  resetSchoolUserPassword,
  updateSchoolUser,
  type PlatformUser,
  type SchoolAccountRecord,
  type SchoolRecord,
} from "../../../platform/auth";
import { ActivityPanel } from "../management/ActivityPanel";
import { AccessPanel } from "../management/AccessPanel";
import { AuditPanel } from "../management/AuditPanel";
import { ManagementSettingsPanel } from "../management/ManagementSettingsPanel";
import { ManagementOptionsProvider, useManagementOptions } from "../../../platform/useManagementOptions";
import type { ManagementHelpLink } from "../../../platform/managementHelpApi";
import { PlatformShell } from "../PlatformShell";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import "../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../components/ui/select";

const ExtensionsPanel = lazy(() => import("../../../components/ExtensionsPanel").then((module) => ({ default: module.ExtensionsPanel })));
const AgentModelSettingsForm = lazy(() => import("../../../components/settings/AgentModelSettingsForm").then((module) => ({ default: module.AgentModelSettingsForm })));

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
  onProfileUpdated?: (user: PlatformUser) => void;
};

type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };
type AdminSection = "schools" | "ai" | "extensions" | "audit" | "access" | "settings" | "activity";
type SchoolQuery = { q: string; status: string; page: number; pageSize: number };
type AccountQuery = SchoolQuery;

const DEFAULT_META: PageMeta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };
const DEFAULT_SCHOOL_QUERY: SchoolQuery = { q: "", status: "all", page: 1, pageSize: 10 };
const DEFAULT_ACCOUNT_QUERY: AccountQuery = { q: "", status: "all", page: 1, pageSize: 10 };

function mergeMeta(
  data: { total?: number; page?: number; page_size?: number; total_pages?: number },
  page: number,
  pageSize: number,
  itemCount: number,
): PageMeta {
  const cleanPageSize = Number(data.page_size ?? pageSize);
  const total = Number(data.total ?? itemCount);
  return {
    total,
    page: Number(data.page ?? page),
    pageSize: cleanPageSize,
    totalPages: Number(data.total_pages ?? Math.max(1, Math.ceil(total / cleanPageSize))),
  };
}

function statusLabel(status: string) {
  if (status === "active") return "启用";
  if (status === "disabled") return "停用";
  return status;
}

function ManagementDialog({
  title,
  description,
  error,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  error?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="management-dialog-overlay" />
        <Dialog.Content className="management-dialog" {...(!description ? { "aria-describedby": undefined } : {})}>
          <header className="management-dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? <Dialog.Description>{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭对话框">×</button>
            </Dialog.Close>
          </header>
          {error ? <p className="management-notice mb-4" role="alert">{error}</p> : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AdminWorkspace({ user, onLogout, onError, onProfileUpdated }: Props) {
  const managementOptions = useManagementOptions(user);
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [hasAnySchool, setHasAnySchool] = useState(false);
  const [schoolMeta, setSchoolMeta] = useState<PageMeta>(DEFAULT_META);
  const [schoolQuery, setSchoolQuery] = useState<SchoolQuery>(DEFAULT_SCHOOL_QUERY);
  const [selectedSchool, setSelectedSchool] = useState<SchoolRecord | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const [schoolUsers, setSchoolUsers] = useState<SchoolAccountRecord[]>([]);
  const [schoolUsersLoading, setSchoolUsersLoading] = useState(false);
  const [schoolUserMeta, setSchoolUserMeta] = useState<PageMeta>(DEFAULT_META);
  const [accountQuery, setAccountQuery] = useState<AccountQuery>(DEFAULT_ACCOUNT_QUERY);
  const [schoolAccountDialogOpen, setSchoolAccountDialogOpen] = useState(false);
  const [hasAnySchoolAccount, setHasAnySchoolAccount] = useState(false);
  const [schoolUsername, setSchoolUsername] = useState("");
  const [schoolPassword, setSchoolPassword] = useState("");
  const [schoolDisplayName, setSchoolDisplayName] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [editingAccount, setEditingAccount] = useState<SchoolAccountRecord | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [resettingAccount, setResettingAccount] = useState<SchoolAccountRecord | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [llmSettings, setLlmSettings] = useState<AgentLlmSettingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<AdminSection>("schools");
  const [permissionSchoolId, setPermissionSchoolId] = useState<string>();
  const [permissionHelpTarget, setPermissionHelpTarget] = useState<ManagementHelpLink | null>(null);
  const [permissionNavigation, setPermissionNavigation] = useState(0);
  const schoolQueryRef = useRef<SchoolQuery>(DEFAULT_SCHOOL_QUERY);
  const accountQueryRef = useRef<AccountQuery>(DEFAULT_ACCOUNT_QUERY);
  const schoolRequestRef = useRef(0);
  const accountRequestRef = useRef(0);
  const selectedSchoolRef = useRef<SchoolRecord | null>(null);
  const aiRequestRef = useRef(0);
  const accountIdRef = useRef(user.id);
  const workspaceAccountRef = useRef(user.id);
  const mountedRef = useRef(true);
  const dialogSessionRef = useRef(0);
  const appliedOptionsUserRef = useRef("");
  const schoolPageSizeTouchedRef = useRef(false);
  const accountPageSizeTouchedRef = useRef(false);
  accountIdRef.current = user.id;

  useEffect(() => {
    setPermissionSchoolId(undefined);
    setPermissionHelpTarget(null);
    setPermissionNavigation(0);
  }, [user.id]);

  useEffect(() => {
    if (!managementOptions || appliedOptionsUserRef.current === user.id) return;
    appliedOptionsUserRef.current = user.id;
    const pageSize = managementOptions.settings.default_page_size;
    setSchoolQuery((previous) => {
      if (schoolPageSizeTouchedRef.current || previous.page !== 1 || previous.q !== "" || previous.status !== "all" || previous.pageSize !== 10) return previous;
      const next = { ...previous, pageSize };
      schoolQueryRef.current = next;
      return next;
    });
    setAccountQuery((previous) => {
      if (accountPageSizeTouchedRef.current || previous.page !== 1 || previous.q !== "" || previous.status !== "all" || previous.pageSize !== 10) return previous;
      const next = { ...previous, pageSize };
      accountQueryRef.current = next;
      return next;
    });
  }, [managementOptions, user.id]);

  function isActiveAccount(accountId: string) {
    return mountedRef.current && accountIdRef.current === accountId;
  }

  function invalidateDialogSession() {
    dialogSessionRef.current += 1;
    setDialogError(null);
  }

  function openManagementDialog(open: () => void) {
    invalidateDialogSession();
    open();
  }

  function closeManagementDialog(close: () => void) {
    invalidateDialogSession();
    close();
  }

  function setErrorForDialogSession(session: number, message: string) {
    if (dialogSessionRef.current === session) setDialogError(message);
  }

  function clearDialogError() {
    setDialogError(null);
  }

  function selectSchool(nextSchool: SchoolRecord | null) {
    const previousId = selectedSchoolRef.current?.id ?? "";
    const nextId = nextSchool?.id ?? "";
    selectedSchoolRef.current = nextSchool;
    setSelectedSchool(nextSchool);
    if (previousId !== nextId) {
      invalidateDialogSession();
      accountRequestRef.current += 1;
      accountQueryRef.current = { ...accountQueryRef.current, page: 1 };
      setAccountQuery(accountQueryRef.current);
      setSchoolUsers([]);
      setSchoolUserMeta(DEFAULT_META);
      setSchoolUsersLoading(Boolean(nextSchool));
      setNotice(null);
    }
  }

  function changeSchoolPage(page: number) {
    const nextPage = Math.max(1, page);
    schoolQueryRef.current = { ...schoolQueryRef.current, page: nextPage };
    setSchoolQuery(schoolQueryRef.current);
  }

  function changeSchoolPageSize(pageSize: number) {
    schoolPageSizeTouchedRef.current = true;
    schoolQueryRef.current = { ...schoolQueryRef.current, page: 1, pageSize };
    setSchoolQuery(schoolQueryRef.current);
  }

  function changeSchoolFilters(values: Partial<Pick<SchoolQuery, "q" | "status">>) {
    schoolQueryRef.current = { ...schoolQueryRef.current, ...values, page: 1 };
    setSchoolQuery(schoolQueryRef.current);
  }

  function changeAccountPage(page: number) {
    const nextPage = Math.max(1, page);
    accountQueryRef.current = { ...accountQueryRef.current, page: nextPage };
    setAccountQuery(accountQueryRef.current);
  }

  function changeAccountPageSize(pageSize: number) {
    accountPageSizeTouchedRef.current = true;
    accountQueryRef.current = { ...accountQueryRef.current, page: 1, pageSize };
    setAccountQuery(accountQueryRef.current);
  }

  function changeAccountFilters(values: Partial<Pick<AccountQuery, "q" | "status">>) {
    accountQueryRef.current = { ...accountQueryRef.current, ...values, page: 1 };
    setAccountQuery(accountQueryRef.current);
  }

  async function refreshSchools(query = schoolQueryRef.current) {
    const requestId = ++schoolRequestRef.current;
    const accountId = user.id;
    const isCurrent = () =>
      schoolRequestRef.current === requestId &&
      isActiveAccount(accountId) &&
      schoolQueryRef.current.q === query.q &&
      schoolQueryRef.current.status === query.status &&
      schoolQueryRef.current.page === query.page &&
      schoolQueryRef.current.pageSize === query.pageSize;
    onError(null);
    setSchoolsLoading(true);
    try {
      const data = await listSchools({ q: query.q, status: query.status, page: query.page, pageSize: query.pageSize });
      if (!isCurrent()) return;
      setSchools(data.schools);
      setSchoolMeta(mergeMeta(data, query.page, query.pageSize, data.schools.length));
      if (Number(data.total ?? data.schools.length) > 0) setHasAnySchool(true);
      if (data.schools.some((school) => Number(school.school_user_count || 0) > 0)) {
        setHasAnySchoolAccount(true);
      }
      const currentSelectedId = selectedSchoolRef.current?.id;
      const matchingSelectedSchool = data.schools.find((school) => school.id === currentSelectedId);
      if (matchingSelectedSchool) {
        selectedSchoolRef.current = matchingSelectedSchool;
        setSelectedSchool(matchingSelectedSchool);
      } else if (!currentSelectedId && data.schools.length > 0) {
        selectSchool(data.schools[0]);
      }
    } catch (error) {
      if (isCurrent()) throw error;
    } finally {
      if (isCurrent()) setSchoolsLoading(false);
    }
  }

  async function refreshSchoolUsers(
    schoolId = selectedSchoolRef.current?.id,
    query = accountQueryRef.current,
  ) {
    if (!schoolId) return;
    const requestId = ++accountRequestRef.current;
    const accountId = user.id;
    const isCurrent = () =>
      accountRequestRef.current === requestId &&
      isActiveAccount(accountId) &&
      selectedSchoolRef.current?.id === schoolId &&
      accountQueryRef.current.q === query.q &&
      accountQueryRef.current.status === query.status &&
      accountQueryRef.current.page === query.page &&
      accountQueryRef.current.pageSize === query.pageSize;
    onError(null);
    setSchoolUsersLoading(true);
    try {
      const data = await listSchoolUsers(schoolId, {
        q: query.q,
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      });
      if (!isCurrent()) return;
      setSchoolUsers(data.users);
      setSchoolUserMeta(mergeMeta(data, query.page, query.pageSize, data.users.length));
      if (Number(data.total ?? data.users.length) > 0) setHasAnySchoolAccount(true);
    } catch (error) {
      if (isCurrent()) throw error;
    } finally {
      if (isCurrent()) setSchoolUsersLoading(false);
    }
  }

  async function refreshAi() {
    const requestId = ++aiRequestRef.current;
    const accountId = user.id;
    const isCurrent = () => aiRequestRef.current === requestId && accountIdRef.current === accountId;
    onError(null);
    setAiLoading(true);
    try {
      const llmData = await apiAgentLlmSettingsGet();
      if (isCurrent()) setLlmSettings(llmData);
    } finally {
      if (isCurrent()) setAiLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection !== "ai") return;
    void refreshAi().catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { aiRequestRef.current += 1; };
    // The selected AI tab loads its settings independently of school pagination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, user.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (workspaceAccountRef.current === user.id) return;
    workspaceAccountRef.current = user.id;
    appliedOptionsUserRef.current = "";
    schoolPageSizeTouchedRef.current = false;
    accountPageSizeTouchedRef.current = false;
    selectSchool(null);
    setSchools([]);
    setSchoolsLoading(true);
    setHasAnySchool(false);
    setSchoolMeta(DEFAULT_META);
    schoolQueryRef.current = DEFAULT_SCHOOL_QUERY;
    setSchoolQuery(DEFAULT_SCHOOL_QUERY);
    accountQueryRef.current = DEFAULT_ACCOUNT_QUERY;
    setAccountQuery(DEFAULT_ACCOUNT_QUERY);
    setSchoolUsers([]);
    setSchoolUserMeta(DEFAULT_META);
    setSchoolUsersLoading(false);
    setHasAnySchoolAccount(false);
    setNotice(null);
    setBusy(false);
    invalidateDialogSession();
    setSchoolDialogOpen(false);
    setSchoolAccountDialogOpen(false);
    setEditingAccount(null);
    setResettingAccount(null);
    setSchoolName("");
    setSchoolUsername("");
    setSchoolPassword("");
    setSchoolDisplayName("");
    setSchoolEmail("");
    setEditUsername("");
    setEditDisplayName("");
    setEditEmail("");
    setResetPassword("");
    setResetPasswordConfirmation("");
  }, [user.id]);

  useEffect(() => {
    void refreshSchools(schoolQuery).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { schoolRequestRef.current += 1; };
    // Query identity is checked against the ref before any response can update the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolQuery.q, schoolQuery.status, schoolQuery.page, schoolQuery.pageSize, user.id]);

  useEffect(() => {
    if (!selectedSchool?.id) {
      setSchoolUsers([]);
      setSchoolUserMeta(DEFAULT_META);
      setSchoolUsersLoading(false);
      return;
    }
    void refreshSchoolUsers(selectedSchool.id, accountQuery).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    return () => { accountRequestRef.current += 1; };
    // School id and query values fully scope this request and its response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchool?.id, accountQuery.q, accountQuery.status, accountQuery.page, accountQuery.pageSize, user.id]);

  async function submitSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountId = user.id;
    const dialogSession = dialogSessionRef.current;
    const nextQuery = { ...schoolQueryRef.current, q: "", status: "all", page: 1 };
    const queryChanged =
      schoolQueryRef.current.q !== nextQuery.q ||
      schoolQueryRef.current.status !== nextQuery.status ||
      schoolQueryRef.current.page !== nextQuery.page;
    setBusy(true);
    clearDialogError();
    onError(null);
    try {
      const created = await createSchool({ name: schoolName });
      if (!isActiveAccount(accountId)) return;
      setSchoolName("");
      closeManagementDialog(() => setSchoolDialogOpen(false));
      setHasAnySchool(true);
      selectSchool(created.school);
      schoolQueryRef.current = nextQuery;
      setSchoolQuery(nextQuery);
      if (!queryChanged) await refreshSchools(nextQuery);
    } catch (error) {
      if (isActiveAccount(accountId)) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorForDialogSession(dialogSession, message);
        onError(message);
      }
    } finally {
      if (isActiveAccount(accountId)) setBusy(false);
    }
  }

  async function submitSchoolUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const schoolId = selectedSchoolRef.current?.id;
    if (!schoolId) return;
    const accountId = user.id;
    const dialogSession = dialogSessionRef.current;
    setBusy(true);
    clearDialogError();
    onError(null);
    try {
      await createSchoolUser(schoolId, {
        username: schoolUsername,
        password: schoolPassword,
        display_name: schoolDisplayName,
        email: schoolEmail,
      });
      if (!isActiveAccount(accountId) || selectedSchoolRef.current?.id !== schoolId) return;
      setSchoolUsername("");
      setSchoolPassword("");
      setSchoolDisplayName("");
      setSchoolEmail("");
      closeManagementDialog(() => setSchoolAccountDialogOpen(false));
      setHasAnySchoolAccount(true);
      setNotice("学校端账号已创建");
      void refreshSchoolUsers(schoolId).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      if (isActiveAccount(accountId) && selectedSchoolRef.current?.id === schoolId) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorForDialogSession(dialogSession, message);
        onError(message);
      }
    } finally {
      if (isActiveAccount(accountId)) setBusy(false);
    }
  }

  function openEditAccount(account: SchoolAccountRecord) {
    openManagementDialog(() => {
      setEditingAccount(account);
      setEditUsername(account.username);
      setEditDisplayName(account.display_name);
      setEditEmail(account.email ?? "");
      setEditStatus(account.status);
    });
  }

  async function submitAccountEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const schoolId = selectedSchoolRef.current?.id;
    const account = editingAccount;
    if (!schoolId || !account) return;
    const activeAccountId = user.id;
    const dialogSession = dialogSessionRef.current;
    setBusy(true);
    clearDialogError();
    onError(null);
    try {
      await updateSchoolUser(schoolId, account.id, {
        username: editUsername,
        display_name: editDisplayName,
        email: editEmail,
        status: editStatus,
      });
      if (!isActiveAccount(activeAccountId) || selectedSchoolRef.current?.id !== schoolId) return;
      closeManagementDialog(() => setEditingAccount(null));
      setNotice("学校端账号信息已保存");
      void refreshSchoolUsers(schoolId).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      if (isActiveAccount(activeAccountId) && selectedSchoolRef.current?.id === schoolId) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorForDialogSession(dialogSession, message);
        onError(message);
      }
    } finally {
      if (isActiveAccount(activeAccountId)) setBusy(false);
    }
  }

  async function toggleAccountStatus(account: SchoolAccountRecord) {
    const schoolId = selectedSchoolRef.current?.id;
    if (!schoolId) return;
    const activeAccountId = user.id;
    const nextStatus = account.status === "active" ? "disabled" : "active";
    setBusy(true);
    onError(null);
    try {
      await updateSchoolUser(schoolId, account.id, { status: nextStatus });
      if (!isActiveAccount(activeAccountId) || selectedSchoolRef.current?.id !== schoolId) return;
      setNotice(nextStatus === "disabled" ? "学校端账号已停用" : "学校端账号已启用");
      void refreshSchoolUsers(schoolId).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      if (isActiveAccount(activeAccountId) && selectedSchoolRef.current?.id === schoolId) {
        onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isActiveAccount(activeAccountId)) setBusy(false);
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const schoolId = selectedSchoolRef.current?.id;
    const account = resettingAccount;
    if (!schoolId || !account) return;
    const dialogSession = dialogSessionRef.current;
    if (resetPassword !== resetPasswordConfirmation) {
      const message = "两次输入的密码不一致";
      setErrorForDialogSession(dialogSession, message);
      onError(message);
      return;
    }
    const activeAccountId = user.id;
    setBusy(true);
    clearDialogError();
    onError(null);
    try {
      await resetSchoolUserPassword(schoolId, account.id, resetPassword);
      if (!isActiveAccount(activeAccountId) || selectedSchoolRef.current?.id !== schoolId) return;
      closeManagementDialog(() => setResettingAccount(null));
      setResetPassword("");
      setResetPasswordConfirmation("");
      setNotice("密码已重置，该账号的已有登录会话已失效");
      void refreshSchoolUsers(schoolId).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      if (isActiveAccount(activeAccountId) && selectedSchoolRef.current?.id === schoolId) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorForDialogSession(dialogSession, message);
        onError(message);
      }
    } finally {
      if (isActiveAccount(activeAccountId)) setBusy(false);
    }
  }

  const actions = activeSection === "schools" || activeSection === "ai" ? (
    <button
      type="button"
      onClick={() => void (activeSection === "ai"
        ? refreshAi()
        : Promise.all([refreshSchools(), refreshSchoolUsers()])).catch((error) => onError(error instanceof Error ? error.message : String(error)))}
      className="or-g53-btn-tonal px-3.5 py-2 text-sm font-medium"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-or-muted" />
      刷新
    </button>
  ) : null;

  return (
    <ManagementOptionsProvider user={user} value={managementOptions}>
    <div className="or-g53-root contents">
      <PlatformShell
        roleLabel="管理员"
        title={user.display_name || user.username}
        userName={user.username}
        actions={actions}
        onLogout={onLogout}
        accountUser={user}
        onProfileUpdated={onProfileUpdated}
        helpContext={{ section: activeSection, school_id: activeSection === "access" ? permissionSchoolId ?? selectedSchool?.id : selectedSchool?.id }}
        onHelpNavigate={(link) => {
          if (!["schools", "ai", "extensions", "audit", "access", "settings", "activity"].includes(link.section)) return;
          if (link.section === "access") {
            if (link.school_id) setPermissionSchoolId(link.school_id);
            setPermissionHelpTarget(link);
            setPermissionNavigation((value) => value + 1);
          }
          setActiveSection(link.section as AdminSection);
        }}
      >
        {activeSection === "schools" ? <div className="mb-6">
          <GettingStartedChecklist
            steps={[
              {
                label: "创建学校",
                complete: hasAnySchool || schoolMeta.total > 0 || selectedSchool !== null,
                actionLabel: "创建第一所学校",
                onAction: () => openManagementDialog(() => setSchoolDialogOpen(true)),
              },
              {
                label: "创建学校端账号",
                complete: hasAnySchoolAccount || schools.some((school) => Number(school.school_user_count || 0) > 0) || schoolUsers.length > 0,
                actionLabel: "创建学校端账号",
                onAction: () => {
                  if (selectedSchoolRef.current) openManagementDialog(() => setSchoolAccountDialogOpen(true));
                },
              },
            ]}
          />
        </div> : null}
        <div role="tablist" aria-label="管理员工作区" className="or-g53-tablist mb-6 management-section-nav">
          {([
            ["schools", "学校与账号"],
            ["ai", "平台 AI"],
            ["extensions", "扩展组件"],
            ["audit", "操作日志"],
            ["access", "权限管理"],
            ["settings", "学科与设置"],
            ["activity", "管理活动"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeSection === id}
              onClick={() => setActiveSection(id)}
              className="or-g53-tab"
            >
              {label}
            </button>
          ))}
        </div>
        <div data-testid="admin-workspace-content" className="or-workspace-content min-w-0">
          {activeSection === "schools" ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]">
              <section className="management-panel or-g53-card p-4 sm:p-5">
                <div className="management-panel-header mb-4">
                  <div className="flex items-center gap-2.5">
                    <School className="h-5 w-5 text-or-text" />
                    <div>
                      <h2 className="text-base font-semibold text-or-text">学校管理</h2>
                    </div>
                  </div>
                  <button type="button" onClick={() => openManagementDialog(() => setSchoolDialogOpen(true))} className="or-g53-btn-primary px-3.5 py-2 text-sm font-semibold">
                    <Plus className="h-4 w-4" />新建学校
                  </button>
                </div>
                <div className="management-toolbar mb-4">
                  <label className="management-field management-search-field">
                    <span className="sr-only">搜索学校</span>
                    <input
                      aria-label="搜索学校"
                      type="search"
                      value={schoolQuery.q}
                      onChange={(event) => changeSchoolFilters({ q: event.target.value })}
                      placeholder="搜索学校名称"
                      className="or-g53-input w-full text-sm"
                    />
                  </label>
                  <label className="management-field">
                    <span className="sr-only">学校状态筛选</span>
                    <AppSelect aria-label="学校状态筛选" value={schoolQuery.status} onValueChange={(value) => changeSchoolFilters({ status: value })} className="or-g53-select text-sm">
                      <option value="all">全部状态</option>
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                    </AppSelect>
                  </label>
                  <label className="management-field management-page-size">
                    <span className="sr-only">每页学校数</span>
                    <AppSelect aria-label="每页学校数" value={schoolQuery.pageSize} onValueChange={(value) => changeSchoolPageSize(Number(value))} className="or-g53-select text-sm">
                      <option value={10}>10 条</option>
                      <option value={20}>20 条</option>
                      <option value={50}>50 条</option>
                    </AppSelect>
                  </label>
                </div>
                <div className="management-table-wrap overflow-x-auto" aria-busy={schoolsLoading}>
                  <table className="management-table w-full text-left text-sm">
                    <thead><tr><th>学校</th><th>账号</th><th>状态</th></tr></thead>
                    <tbody>
                      {schools.map((school) => (
                        <tr key={school.id} className={selectedSchool?.id === school.id ? "is-selected" : undefined}>
                          <td>
                            <button type="button" className="font-semibold text-or-text hover:underline" onClick={() => selectSchool(school)}>
                              {school.name}
                            </button>
                            <div className="mt-1 text-xs text-or-muted">AI：{school.ai_enabled ? "已开启" : "未开启"}</div>
                          </td>
                          <td>{Number(school.school_user_count || 0)}</td>
                          <td><span className={`or-g53-pill ${school.status === "active" ? "or-g53-pill-success" : "or-g53-pill-neutral"}`}>{statusLabel(school.status)}</span></td>
                        </tr>
                      ))}
                      {schools.length === 0 ? (
                        <tr><td colSpan={3}><div className="management-empty" role={schoolsLoading ? "status" : undefined}>{schoolsLoading ? "正在加载学校…" : schoolQuery.q || schoolQuery.status !== "all" ? "没有符合条件的学校。" : "暂无学校，请先创建学校。"}</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="management-pagination mt-4 flex flex-col gap-3 border-t border-or-outline pt-3 text-sm text-or-muted sm:flex-row sm:items-center sm:justify-between">
                  <span>第 {schoolMeta.page}/{schoolMeta.totalPages} 页，共 {schoolMeta.total} 所</span>
                  <div className="flex gap-2">
                    <button type="button" aria-label="学校列表上一页" disabled={schoolMeta.page <= 1} onClick={() => changeSchoolPage(schoolQuery.page - 1)} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">上一页</button>
                    <button type="button" aria-label="学校列表下一页" disabled={schoolMeta.page >= schoolMeta.totalPages} onClick={() => changeSchoolPage(Math.min(schoolMeta.totalPages, schoolQuery.page + 1))} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">下一页</button>
                  </div>
                </div>
              </section>

              <section className="management-panel or-g53-card min-w-0 p-4 sm:p-5">
                <div className="management-panel-header mb-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-or-text">学校端账号</h2>
                    <p className="mt-1 truncate text-sm text-or-muted">
                      当前学校：<strong className="font-semibold text-or-text">{selectedSchool?.name || "请选择学校"}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedSchool}
                    onClick={() => openManagementDialog(() => setSchoolAccountDialogOpen(true))}
                    className="or-g53-btn-primary px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" />创建账号
                  </button>
                </div>
                {notice ? <p className="management-notice mb-4" role="status">{notice}</p> : null}
                <div className="management-toolbar mb-4">
                  <label className="management-field management-search-field">
                    <span className="sr-only">搜索学校端账号</span>
                    <input
                      aria-label="搜索学校端账号"
                      type="search"
                      value={accountQuery.q}
                      onChange={(event) => changeAccountFilters({ q: event.target.value })}
                      placeholder="搜索账号、姓名或邮箱"
                      className="or-g53-input w-full text-sm"
                      disabled={!selectedSchool}
                    />
                  </label>
                  <label className="management-field">
                    <span className="sr-only">学校端账号状态筛选</span>
                    <AppSelect aria-label="学校端账号状态筛选" value={accountQuery.status} onValueChange={(value) => changeAccountFilters({ status: value })} className="or-g53-select text-sm" disabled={!selectedSchool}>
                      <option value="all">全部状态</option>
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                    </AppSelect>
                  </label>
                  <label className="management-field management-page-size">
                    <span className="sr-only">每页账号数</span>
                    <AppSelect aria-label="每页账号数" value={accountQuery.pageSize} onValueChange={(value) => changeAccountPageSize(Number(value))} className="or-g53-select text-sm" disabled={!selectedSchool}>
                      <option value={10}>10 条</option>
                      <option value={20}>20 条</option>
                      <option value={50}>50 条</option>
                    </AppSelect>
                  </label>
                </div>
                {selectedSchool ? (
                  <>
                    <div className="management-table-wrap overflow-x-auto" aria-busy={schoolUsersLoading}>
                      <table className="management-table w-full text-left text-sm">
                        <thead><tr><th>账号</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                          {schoolUsers.map((account) => (
                            <tr key={account.id}>
                              <td>
                                <div className="font-semibold text-or-text">{account.display_name || account.username}</div>
                                <div className="mt-1 text-xs text-or-muted">{account.username}</div>
                              </td>
                              <td>{account.email || "—"}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => void toggleAccountStatus(account)}
                                  disabled={busy}
                                  aria-label={`${account.status === "active" ? "停用" : "启用"} ${account.username}`}
                                  className={`or-g53-pill font-medium ${account.status === "active" ? "or-g53-pill-success" : "or-g53-pill-neutral"} disabled:opacity-50`}
                                >
                                  {statusLabel(account.status)}
                                </button>
                              </td>
                              <td>
                                <div className="management-row-actions flex flex-wrap gap-2">
                                  <button type="button" onClick={() => openEditAccount(account)} className="or-g53-btn-tonal inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium">
                                    <Pencil className="h-3.5 w-3.5" />编辑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openManagementDialog(() => {
                                      setResettingAccount(account);
                                      setResetPassword("");
                                      setResetPasswordConfirmation("");
                                    })}
                                    className="or-g53-btn-tonal inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium"
                                  >
                                    <KeyRound className="h-3.5 w-3.5" />重置密码
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {schoolUsers.length === 0 ? (
                            <tr><td colSpan={4}><div className="management-empty" role={schoolUsersLoading ? "status" : undefined}>
                              {schoolUsersLoading ? "正在加载学校端账号…" : accountQuery.q || accountQuery.status !== "all" ? "没有符合条件的账号。" : "该校还没有学校端账号。"}
                            </div></td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="management-pagination mt-4 flex flex-col gap-3 border-t border-or-outline pt-3 text-sm text-or-muted sm:flex-row sm:items-center sm:justify-between">
                      <span>第 {schoolUserMeta.page}/{schoolUserMeta.totalPages} 页，共 {schoolUserMeta.total} 个账号</span>
                      <div className="flex gap-2">
                        <button type="button" aria-label="学校端账号上一页" disabled={schoolUserMeta.page <= 1} onClick={() => changeAccountPage(accountQuery.page - 1)} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">上一页</button>
                        <button type="button" aria-label="学校端账号下一页" disabled={schoolUserMeta.page >= schoolUserMeta.totalPages} onClick={() => changeAccountPage(Math.min(schoolUserMeta.totalPages, accountQuery.page + 1))} className="or-g53-btn-tonal px-4 py-1.5 text-sm disabled:opacity-50">下一页</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="management-empty">先从左侧选择一所学校。</div>
                )}
              </section>
            </div>
          ) : null}

          {activeSection === "ai" ? (
            <div className="mx-auto w-full max-w-5xl">
              <section className="or-g53-card p-4 sm:p-6">
                <div className="mb-4 flex items-center gap-2.5">
                  <Bot className="h-5 w-5 text-or-text" />
                  <h2 className="text-base font-semibold text-or-text">平台 AI 配置</h2>
                </div>
                <Suspense fallback={<p role="status" className="p-4 text-sm text-or-muted">正在加载 AI 设置…</p>}>
                  <AgentModelSettingsForm
                    variant="settings"
                    data={llmSettings}
                    loading={aiLoading}
                    saving={busy}
                    onError={onError}
                    onReload={refreshAi}
                  />
                </Suspense>
              </section>
            </div>
          ) : null}

          {activeSection === "extensions" ? (
            <div className="mx-auto w-full max-w-6xl">
              <section className="or-g53-card p-4 sm:p-6">
                <h2 className="mb-4 text-base font-semibold text-or-text">扩展组件</h2>
                <Suspense fallback={<p role="status" className="p-4 text-sm text-or-muted">正在加载扩展组件…</p>}>
                  <ExtensionsPanel onError={onError} />
                </Suspense>
              </section>
            </div>
          ) : null}

          {activeSection === "audit" ? <AuditPanel key={`${user.id}:${user.school_id ?? ""}:admin`} user={user} scope="admin" /> : null}
          {activeSection === "access" ? <AccessPanel key={`${user.id}:${user.school_id ?? ""}:admin:${permissionNavigation}`} user={user} scope="admin" preferredSchoolId={permissionSchoolId ?? selectedSchool?.id} onSchoolChange={(schoolId) => {
            if (permissionSchoolId && permissionSchoolId !== schoolId) setPermissionHelpTarget(null);
            setPermissionSchoolId(schoolId);
          }} requestedView={permissionHelpTarget?.view} requestedTrace={permissionHelpTarget?.trace} onNavigateSection={(section) => {
            if (["schools", "ai", "extensions", "audit", "access", "settings", "activity"].includes(section)) {
              setActiveSection(section as AdminSection);
            }
          }} /> : null}
          {activeSection === "settings" ? <ManagementSettingsPanel key={`${user.id}:${user.school_id ?? ""}:admin`} user={user} scope="admin" /> : null}
          {activeSection === "activity" ? <ActivityPanel key={`${user.id}:${user.school_id ?? ""}:admin`} user={user} scope="admin" /> : null}
        </div>

        {schoolDialogOpen ? (
          <ManagementDialog title="创建学校" error={dialogError} onClose={() => closeManagementDialog(() => setSchoolDialogOpen(false))}>
            <form onSubmit={(event) => void submitSchool(event)}>
              <div className="management-form-grid">
                <label className="management-field">
                  <span>学校名称</span>
                  <input autoFocus value={schoolName} onChange={(event) => { clearDialogError(); setSchoolName(event.target.value); }} placeholder="输入学校名称" required className="or-g53-input w-full text-sm" />
                </label>
              </div>
              <footer className="management-dialog-footer">
                <button type="button" onClick={() => closeManagementDialog(() => setSchoolDialogOpen(false))} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button>
                <button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">创建学校</button>
              </footer>
            </form>
          </ManagementDialog>
        ) : null}

        {schoolAccountDialogOpen && selectedSchool ? (
          <ManagementDialog title="创建学校端账号" description={`学校：${selectedSchool.name}`} error={dialogError} onClose={() => closeManagementDialog(() => setSchoolAccountDialogOpen(false))}>
            <form onSubmit={(event) => void submitSchoolUser(event)}>
              <div className="management-form-grid">
                <label className="management-field">
                  <span>用户名</span>
                  <input autoFocus value={schoolUsername} onChange={(event) => { clearDialogError(); setSchoolUsername(event.target.value); }} minLength={3} required autoComplete="username" placeholder="至少 3 个字符" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>显示名称</span>
                  <input value={schoolDisplayName} onChange={(event) => { clearDialogError(); setSchoolDisplayName(event.target.value); }} required placeholder="学校管理员姓名" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>邮箱</span>
                  <input type="email" value={schoolEmail} onChange={(event) => { clearDialogError(); setSchoolEmail(event.target.value); }} placeholder="可选" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>初始密码</span>
                  <input type="password" value={schoolPassword} onChange={(event) => { clearDialogError(); setSchoolPassword(event.target.value); }} minLength={6} required autoComplete="new-password" placeholder="至少 6 个字符" className="or-g53-input w-full text-sm" />
                </label>
              </div>
              <footer className="management-dialog-footer">
                <button type="button" onClick={() => closeManagementDialog(() => setSchoolAccountDialogOpen(false))} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button>
                <button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">创建账号</button>
              </footer>
            </form>
          </ManagementDialog>
        ) : null}

        {editingAccount ? (
          <ManagementDialog title="编辑学校端账号" error={dialogError} onClose={() => closeManagementDialog(() => setEditingAccount(null))}>
            <form onSubmit={(event) => void submitAccountEdit(event)}>
              <div className="management-form-grid">
                <label className="management-field">
                  <span>用户名</span>
                  <input autoFocus value={editUsername} onChange={(event) => { clearDialogError(); setEditUsername(event.target.value); }} minLength={3} required autoComplete="username" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>显示名称</span>
                  <input value={editDisplayName} onChange={(event) => { clearDialogError(); setEditDisplayName(event.target.value); }} required className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>邮箱</span>
                  <input type="email" value={editEmail} onChange={(event) => { clearDialogError(); setEditEmail(event.target.value); }} placeholder="可选" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>账号状态</span>
                  <AppSelect aria-label="学校端账号状态" value={editStatus} onValueChange={(value) => { clearDialogError(); setEditStatus(value); }} className="or-g53-select w-full text-sm">
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                  </AppSelect>
                </label>
              </div>
              <footer className="management-dialog-footer">
                <button type="button" onClick={() => closeManagementDialog(() => setEditingAccount(null))} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button>
                <button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">保存修改</button>
              </footer>
            </form>
          </ManagementDialog>
        ) : null}

        {resettingAccount ? (
          <ManagementDialog title="重置学校端账号密码" description={`账号：${resettingAccount.username}；现有会话将失效。`} error={dialogError} onClose={() => closeManagementDialog(() => setResettingAccount(null))}>
            <form onSubmit={(event) => void submitPasswordReset(event)}>
              <div className="management-form-grid">
                <label className="management-field">
                  <span>新密码</span>
                  <input autoFocus type="password" value={resetPassword} onChange={(event) => { clearDialogError(); setResetPassword(event.target.value); }} minLength={6} required autoComplete="new-password" className="or-g53-input w-full text-sm" />
                </label>
                <label className="management-field">
                  <span>确认新密码</span>
                  <input type="password" value={resetPasswordConfirmation} onChange={(event) => { clearDialogError(); setResetPasswordConfirmation(event.target.value); }} minLength={6} required autoComplete="new-password" className="or-g53-input w-full text-sm" />
                </label>
              </div>
              <footer className="management-dialog-footer">
                <button type="button" onClick={() => closeManagementDialog(() => setResettingAccount(null))} className="or-g53-btn-tonal px-4 py-2 text-sm">取消</button>
                <button type="submit" disabled={busy} className="or-g53-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">确认重置</button>
              </footer>
            </form>
          </ManagementDialog>
        ) : null}
      </PlatformShell>
    </div>
    </ManagementOptionsProvider>
  );
}
