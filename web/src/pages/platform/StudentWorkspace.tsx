import { BarChart3, ClipboardList, History } from "lucide-react";
import type { PlatformUser } from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
};

export function StudentWorkspace({ user, onLogout }: Props) {
  return (
    <PlatformShell
      roleLabel="学生端"
      title={user.display_name || user.username}
      subtitle="查看待答试卷、历史成绩和个人分析。"
      userName={user.username}
      onLogout={onLogout}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <ClipboardList className="mb-3 h-5 w-5 text-slate-600" />
          <h2 className="font-semibold">待答试卷</h2>
          <p className="mt-2 text-sm text-slate-500">线上发布和作答将在下一阶段接入。</p>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <History className="mb-3 h-5 w-5 text-slate-600" />
          <h2 className="font-semibold">历史成绩</h2>
          <p className="mt-2 text-sm text-slate-500">提交记录会在答题系统接入后显示。</p>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <BarChart3 className="mb-3 h-5 w-5 text-slate-600" />
          <h2 className="font-semibold">分析反馈</h2>
          <p className="mt-2 text-sm text-slate-500">教师发布结果后展示个人分析。</p>
        </section>
      </div>
    </PlatformShell>
  );
}
