import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Plus, RefreshCw, School, UserPlus } from "lucide-react";
import { apiAgentLlmSettingsGet, type AgentLlmSettingsResponse } from "../../../api/client";
import { ExtensionsPanel } from "../../../components/ExtensionsPanel";
import { AgentModelSettingsForm } from "../../../components/settings/AgentModelSettingsForm";
import {
  createSchool,
  createSchoolUser,
  listSchools,
  type PlatformUser,
  type SchoolRecord,
} from "../../../platform/auth";
import { PlatformShell } from "../PlatformShell";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import "../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../components/ui/select";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };
type AdminSection = "schools" | "ai" | "extensions";

const DEFAULT_META: PageMeta = { total: 0, page: 1, pageSize: 10, totalPages: 1 };

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

export function AdminWorkspace({ user, onLogout, onError }: Props) {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [schoolMeta, setSchoolMeta] = useState<PageMeta>(DEFAULT_META);
  const [schoolPage, setSchoolPage] = useState(1);
  const [schoolPageSize, setSchoolPageSize] = useState(10);
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [schoolUsername, setSchoolUsername] = useState("");
  const [schoolPassword, setSchoolPassword] = useState("");
  const [schoolDisplayName, setSchoolDisplayName] = useState("");
  const [llmSettings, setLlmSettings] = useState<AgentLlmSettingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<AdminSection>("schools");
  const schoolFormRef = useRef<HTMLFormElement | null>(null);
  const schoolAccountFormRef = useRef<HTMLFormElement | null>(null);

  function openSchoolForm(target: "school" | "account") {
    setActiveSection("schools");
    window.setTimeout(() => {
      const ref = target === "school" ? schoolFormRef : schoolAccountFormRef;
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  async function refresh() {
    onError(null);
    setAiLoading(true);
    try {
      const [schoolData, llmData] = await Promise.all([
        listSchools({ page: schoolPage, pageSize: schoolPageSize }),
        apiAgentLlmSettingsGet(),
      ]);
      setSchools(schoolData.schools);
      setSchoolMeta(mergeMeta(schoolData, schoolPage, schoolPageSize, schoolData.schools.length));
      setLlmSettings(llmData);
      if (!selectedSchoolId && schoolData.schools.length > 0) {
        setSelectedSchoolId(schoolData.schools[0].id);
      }
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolPage, schoolPageSize]);

  async function submitSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await createSchool({ name: schoolName });
      setSchoolName("");
      setSchoolPage(1);
      await refresh();
      setSelectedSchoolId(created.school.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitSchoolUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSchoolId) return;
    setBusy(true);
    try {
      await createSchoolUser(selectedSchoolId, {
        username: schoolUsername,
        password: schoolPassword,
        display_name: schoolDisplayName,
      });
      setSchoolUsername("");
      setSchoolPassword("");
      setSchoolDisplayName("");
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <button
      type="button"
      onClick={() => void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)))}
      className="or-g53-btn-tonal px-3.5 py-2 text-sm font-medium"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-or-muted" />
      刷新
    </button>
  );

  return (
    <div className="or-g53-root contents">
      <PlatformShell
        roleLabel="管理员"
        title={user.display_name || user.username}
        subtitle="配置平台级 AI 能力、学校账号和系统组件。"
        userName={user.username}
        actions={actions}
        onLogout={onLogout}
      >
        <div className="mb-6">
          <GettingStartedChecklist
            description="先创建学校，再为该学校创建可登录的学校端账号"
            steps={[
              {
                label: "创建学校",
                complete: schoolMeta.total > 0,
                actionLabel: "创建第一所学校",
                onAction: () => openSchoolForm("school"),
              },
              {
                label: "创建学校端账号",
                complete: schools.some((school) => Number(school.school_user_count || 0) > 0),
                actionLabel: "创建学校端账号",
                onAction: () => openSchoolForm("account"),
              },
            ]}
          />
        </div>
        <div
          role="tablist"
          aria-label="管理员工作区"
          className="or-g53-tablist mb-6"
        >
          {([
            ["schools", "学校与账号"],
            ["ai", "平台 AI"],
            ["extensions", "扩展组件"],
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
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <section className="or-g53-card p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <School className="h-5 w-5 text-or-text" />
                    <h2 className="text-base font-semibold text-or-text">学校管理</h2>
                  </div>
                  <AppSelect
                    value={schoolPageSize}
                    onValueChange={(value) => {
                      setSchoolPageSize(Number(value));
                      setSchoolPage(1);
                    }}
                    className="or-g53-select py-1 text-sm font-medium"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </AppSelect>
                </div>
                <div className="grid gap-3">
                  {schools.map((school) => (
                    <button
                      key={school.id}
                      type="button"
                      onClick={() => setSelectedSchoolId(school.id)}
                      className={`or-g53-card-interactive p-4 text-left ${
                        selectedSchoolId === school.id ? "is-selected" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-or-text">{school.name}</p>
                        <span className="or-g53-pill or-g53-pill-neutral font-medium">
                          {school.status === "active"
                            ? "启用"
                            : school.status === "disabled"
                              ? "停用"
                              : school.status}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-or-muted font-medium">
                        AI：{school.ai_enabled ? "学校已开启" : "学校未开启"}
                      </p>
                    </button>
                  ))}
                  {schools.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-or-outline bg-or-card p-8 text-center text-sm text-or-muted">
                      暂无学校。
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-or-outline pt-3 text-sm text-or-muted">
                  <span className="font-medium text-or-muted text-center sm:text-left">
                    第 {schoolMeta.page}/{schoolMeta.totalPages} 页，共 {schoolMeta.total} 所
                  </span>
                  <div className="flex justify-center sm:justify-end gap-2">
                    <button
                      type="button"
                      disabled={schoolMeta.page <= 1}
                      onClick={() => setSchoolPage((page) => Math.max(1, page - 1))}
                      className="or-g53-btn-tonal flex-1 sm:flex-initial px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={schoolMeta.page >= schoolMeta.totalPages}
                      onClick={() => setSchoolPage((page) => Math.min(schoolMeta.totalPages, page + 1))}
                      className="or-g53-btn-tonal flex-1 sm:flex-initial px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </section>

              <div className="space-y-5">
                <form
                  ref={schoolFormRef}
                  onSubmit={(event) => void submitSchool(event)}
                  className="or-g53-card p-4 sm:p-5"
                >
                  <h2 className="mb-3 text-base font-semibold text-or-text">创建学校</h2>
                  <input
                    value={schoolName}
                    onChange={(event) => setSchoolName(event.target.value)}
                    placeholder="学校名称"
                    className="or-g53-input mb-3 w-full text-sm"
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="or-g53-btn-primary w-full py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    创建
                  </button>
                </form>

                <form
                  ref={schoolAccountFormRef}
                  onSubmit={(event) => void submitSchoolUser(event)}
                  className="or-g53-card p-4 sm:p-5"
                >
                  <h2 className="mb-3 text-base font-semibold text-or-text">创建学校端账号</h2>
                  <AppSelect
                    value={selectedSchoolId}
                    onValueChange={(value) => setSelectedSchoolId(value)}
                    className="or-g53-select mb-3 w-full text-sm font-medium"
                    required
                  >
                    <option value="">选择学校</option>
                    {schools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </AppSelect>
                  <input
                    value={schoolUsername}
                    onChange={(event) => setSchoolUsername(event.target.value)}
                    placeholder="用户名"
                    className="or-g53-input mb-3 w-full text-sm"
                    required
                  />
                  <input
                    value={schoolDisplayName}
                    onChange={(event) => setSchoolDisplayName(event.target.value)}
                    placeholder="显示名称"
                    className="or-g53-input mb-3 w-full text-sm"
                    required
                  />
                  <input
                    value={schoolPassword}
                    onChange={(event) => setSchoolPassword(event.target.value)}
                    placeholder="初始密码"
                    type="password"
                    minLength={6}
                    className="or-g53-input mb-3 w-full text-sm"
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy || !selectedSchoolId}
                    className="or-g53-btn-primary w-full py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4 shrink-0" />
                    创建账号
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          {activeSection === "ai" ? (
            <div className="mx-auto w-full max-w-5xl">
              <section className="or-g53-card p-4 sm:p-6">
                <div className="mb-4 flex items-center gap-2.5">
                  <Bot className="h-5 w-5 text-or-text" />
                  <h2 className="text-base font-semibold text-or-text">平台 AI 配置</h2>
                </div>
                <AgentModelSettingsForm
                  variant="settings"
                  data={llmSettings}
                  loading={aiLoading}
                  saving={busy}
                  onError={onError}
                  onReload={refresh}
                />
              </section>
            </div>
          ) : null}

          {activeSection === "extensions" ? (
            <div className="mx-auto w-full max-w-6xl">
              <section className="or-g53-card p-4 sm:p-6">
                <h2 className="mb-4 text-base font-semibold text-or-text">扩展组件</h2>
                <ExtensionsPanel onError={onError} />
              </section>
            </div>
          ) : null}
        </div>
      </PlatformShell>
    </div>
  );
}
