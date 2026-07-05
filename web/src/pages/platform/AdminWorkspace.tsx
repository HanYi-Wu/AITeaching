import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Plus, RefreshCw, School, UserPlus } from "lucide-react";
import {
  createSchool,
  createSchoolUser,
  listSchools,
  type PlatformUser,
  type SchoolRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
  onOpenTeacherWorkspace: () => void;
  onError: (message: string | null) => void;
};

export function AdminWorkspace({ user, onLogout, onOpenTeacherWorkspace, onError }: Props) {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [schoolUsername, setSchoolUsername] = useState("");
  const [schoolPassword, setSchoolPassword] = useState("");
  const [schoolDisplayName, setSchoolDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    onError(null);
    const data = await listSchools();
    setSchools(data.schools);
    if (!selectedSchoolId && data.schools.length > 0) {
      setSelectedSchoolId(data.schools[0].id);
    }
  }

  useEffect(() => {
    void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await createSchool({ name: schoolName });
      setSchoolName("");
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
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <>
          <button
            type="button"
            onClick={onOpenTeacherWorkspace}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowRight className="h-4 w-4" />
            教师端
          </button>
          <button
            type="button"
            onClick={() => void refresh().catch((e) => onError(e instanceof Error ? e.message : String(e)))}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
    </>
  );

  return (
    <PlatformShell
      roleLabel="管理员"
      title={user.display_name || user.username}
      subtitle="配置学校账号和平台级能力。"
      userName={user.username}
      actions={actions}
      onLogout={onLogout}
    >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <School className="h-5 w-5 text-slate-600" />
              <h2 className="text-base font-semibold">学校管理</h2>
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
                  <p className="mt-1 text-sm text-slate-500">AI：{school.ai_enabled ? "已开启" : "未开启"}</p>
                </button>
              ))}
              {schools.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                  暂无学校。
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <form onSubmit={(event) => void submitSchool(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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

            <form onSubmit={(event) => void submitSchoolUser(event)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
          </aside>
        </div>
    </PlatformShell>
  );
}
