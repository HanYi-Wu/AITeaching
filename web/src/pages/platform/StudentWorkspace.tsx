import { FormEvent, ReactNode, useState } from "react";
import { BarChart3, ClipboardList, History, Save } from "lucide-react";
import { updateStudentAccount, type PlatformUser } from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
};

export function StudentWorkspace({ user, onLogout }: Props) {
  const [profile, setProfile] = useState(user);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateStudentAccount({
        username: username.trim() || null,
        current_password: currentPassword,
        new_password: newPassword || null,
      });
      setProfile(result.user);
      setUsername("");
      setCurrentPassword("");
      setNewPassword("");
      setMessage("账号已更新");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformShell
      roleLabel="学生端"
      title={profile.display_name || profile.username}
      subtitle="查看待答试卷、历史成绩和个人分析。"
      userName={profile.username}
      onLogout={onLogout}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid gap-4 md:grid-cols-3">
          <InfoCard icon={<ClipboardList className="mb-3 h-5 w-5 text-slate-600" />} title="待答试卷" text="线上发布和作答将在下一阶段接入。" />
          <InfoCard icon={<History className="mb-3 h-5 w-5 text-slate-600" />} title="历史成绩" text="提交记录会在答题系统接入后显示。" />
          <InfoCard icon={<BarChart3 className="mb-3 h-5 w-5 text-slate-600" />} title="分析反馈" text="教师发布结果后展示个人分析。" />
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-950">账号设置</h2>
          <form onSubmit={(event) => void submitAccount(event)} className="space-y-3">
            <input
              data-testid="student-account-username"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="新用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              data-testid="student-account-current-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="当前密码"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <input
              data-testid="student-account-new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="新密码"
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button
              data-testid="student-account-save"
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              保存账号
            </button>
          </form>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </aside>
      </div>
    </PlatformShell>
  );
}

function InfoCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {icon}
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{text}</p>
    </section>
  );
}
