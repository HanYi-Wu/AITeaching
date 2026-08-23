import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Plus, RefreshCw, School, UserPlus } from "lucide-react";
import { apiAgentLlmSettingsGet, type AgentLlmSettingsResponse } from "../../api/client";
import { ExtensionsPanel } from "../../components/ExtensionsPanel";
import { AgentModelSettingsForm } from "../../components/settings/AgentModelSettingsForm";
import {
  createSchool,
  createSchoolUser,
  listSchools,
  type PlatformUser,
  type SchoolRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";
import { GettingStartedChecklist } from "./GettingStartedChecklist";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onError: (message: string | null) => void;
};

type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

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
  const schoolFormRef = useRef<HTMLFormElement | null>(null);
  const schoolAccountFormRef = useRef<HTMLFormElement | null>(null);

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
      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
    >
      <RefreshCw className="h-4 w-4" />
      刷新
    </button>
  );

  return (
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
              onAction: () => schoolFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
            },
            {
              label: "创建学校端账号",
              complete: schools.some((school) => Number(school.school_user_count || 0) > 0),
              actionLabel: "创建学校端账号",
              onAction: () => schoolAccountFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
            },
          ]}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <School className="h-5 w-5 text-slate-600" />
            <h2 className="text-base font-semibold">学校管理</h2>
            <select
              value={schoolPageSize}
              onChange={(event) => {
                setSchoolPageSize(Number(event.target.value));
                setSchoolPage(1);
              }}
              className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="grid gap-3">
            {schools.map((school) => (
              <button
                key={school.id}
                type="button"
                onClick={() => setSelectedSchoolId(school.id)}
                className={`rounded-lg border p-4 text-left shadow-sm ${
                  selectedSchoolId === school.id ? "border-slate-900 bg-white" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{school.name}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{school.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">AI：{school.ai_enabled ? "学校已开启" : "学校未开启"}</p>
              </button>
            ))}
            {schools.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                暂无学校。
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-500">
            <span>
              第 {schoolMeta.page}/{schoolMeta.totalPages} 页，共 {schoolMeta.total} 所
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={schoolMeta.page <= 1}
                onClick={() => setSchoolPage((page) => Math.max(1, page - 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={schoolMeta.page >= schoolMeta.totalPages}
                onClick={() => setSchoolPage((page) => Math.min(schoolMeta.totalPages, page + 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Bot className="h-5 w-5 text-slate-600" />
              <h2 className="text-sm font-semibold">平台 AI 配置</h2>
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

          <form ref={schoolFormRef} onSubmit={(event) => void submitSchool(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">创建学校</h2>
            <input
              value={schoolName}
              onChange={(event) => setSchoolName(event.target.value)}
              placeholder="学校名称"
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              创建
            </button>
          </form>

          <form ref={schoolAccountFormRef} onSubmit={(event) => void submitSchoolUser(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">创建学校端账号</h2>
            <select
              value={selectedSchoolId}
              onChange={(event) => setSelectedSchoolId(event.target.value)}
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            >
              <option value="">选择学校</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
            <input
              value={schoolUsername}
              onChange={(event) => setSchoolUsername(event.target.value)}
              placeholder="用户名"
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            />
            <input
              value={schoolDisplayName}
              onChange={(event) => setSchoolDisplayName(event.target.value)}
              placeholder="显示名称"
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            />
            <input
              value={schoolPassword}
              onChange={(event) => setSchoolPassword(event.target.value)}
              placeholder="初始密码"
              type="password"
              minLength={6}
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
              required
            />
            <button
              type="submit"
              disabled={busy || !selectedSchoolId}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              创建账号
            </button>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">扩展组件</h2>
            <ExtensionsPanel onError={onError} />
          </section>
        </aside>
      </div>
    </PlatformShell>
  );
}
