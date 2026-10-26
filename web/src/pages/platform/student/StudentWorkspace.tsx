import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Home,
  RefreshCw,
  Save,
  UserCog,
} from "lucide-react";
import { formatLocaleDateTime } from "../../../lib/locale";
import {
  updateAccountProfile,
  listStudentPapers,
  listStudentResults,
  startStudentPaper,
  updateStudentAccount,
  type PlatformUser,
  type StudentPaperRecord,
  type StudentResultRecord,
} from "../../../platform/auth";
import { PlatformShell } from "../PlatformShell";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import { StudentNavButton, StudentAnalysisVisual, StudentResultDetails } from "./StudentPanels";
import { StudentExamPanel } from "./StudentExamPanel";
import { useStudentExam } from "./useStudentExam";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
};

type StudentView = "home" | "papers" | "results" | "account" | "exam";

type AccountMode = "password" | "username";

function statusLabel(status: string): string {
  if (status === "submitted" || status === "completed") return "已提交";
  if (status === "in_progress") return "答题中";
  return "待作答";
}

function scoreText(score?: number | null, maxScore?: number | null): string {
  if (score === null || score === undefined) return "待公布";
  if (maxScore === null || maxScore === undefined) return `${score}`;
  return `${score}/${maxScore}`;
}

export function StudentWorkspace({ user, onLogout }: Props) {
  const [profile, setProfile] = useState(user);
  const [activeView, setActiveView] = useState<StudentView>(user.must_change_password ? "account" : "home");
  const [accountMode, setAccountMode] = useState<AccountMode>("password");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showAccountPasswords, setShowAccountPasswords] = useState(false);
  const [theme, setTheme] = useState(profile.preferences?.theme ?? "classic");
  const [density, setDensity] = useState(profile.preferences?.density ?? "comfortable");
  const [fontScale, setFontScale] = useState(Number(profile.preferences?.font_scale ?? 1));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [papers, setPapers] = useState<StudentPaperRecord[]>([]);
  const [results, setResults] = useState<StudentResultRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const pendingPapers = useMemo(
    () => papers.filter((paper) => paper.status !== "submitted" && paper.status !== "completed"),
    [papers],
  );
  const latestResult = results[0] ?? null;
  const mustChangePassword = Boolean(profile.must_change_password);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [paperData, resultData] = await Promise.all([listStudentPapers(), listStudentResults()]);
      setPapers(paperData.papers);
      setResults(resultData.results);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const onExamSubmitted = useCallback(async (submissionMessage: string) => {
    await refresh();
    setMessage(submissionMessage);
    setActiveView("results");
  }, [refresh]);
  const exam = useStudentExam({ user, onMessage: setMessage, onSubmitted: onExamSubmitted });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeView === 'exam') return;
    let disposed = false;
    let pending = false;
    const timer = window.setInterval(() => {
      if (document.hidden || pending) return;
      pending = true;
      void listStudentPapers().then(result => { if (!disposed) setPapers(result.papers); }).catch(() => {}).finally(() => { pending = false; });
    }, 15000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeView]);

  useEffect(() => {
    if (mustChangePassword) {
      setActiveView("account");
      setAccountMode("password");
    }
  }, [mustChangePassword]);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountMode === "password" && newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    setBusy("account");
    setMessage(null);
    try {
      const result = await updateStudentAccount({
        username: accountMode === "username" ? username.trim() || null : null,
        current_password: currentPassword,
        new_password: accountMode === "password" ? newPassword || null : null,
      });
      setProfile(result.user);
      setUsername("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(accountMode === "password" ? "密码已更新" : "用户名已更新");
      if (profile.must_change_password && !result.user.must_change_password) {
        setActiveView("home");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePersonalization() {
    setBusy("personalization");
    try {
      const result = await updateAccountProfile({ preferences: { theme, density, font_scale: fontScale } });
      setProfile((current) => ({ ...current, ...result.profile }));
      document.documentElement.dataset.ehTheme = theme;
      document.documentElement.style.fontSize = `${fontScale * 100}%`;
      localStorage.setItem("eh-theme", theme);
      localStorage.setItem("eh-density", density);
      setMessage("个性化设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function startPaper(paper: StudentPaperRecord) {
    setBusy(`start:${paper.publication_id}`);
    setMessage(null);
    try {
      const data = await startStudentPaper(paper.publication_id);
      await exam.open(data);
      setActiveView("exam");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (activeView === "exam" && exam.activeAttempt) {
    return <StudentExamPanel controller={exam} userName={profile.username} message={message} />;
  }
  return (
    <PlatformShell
      roleLabel="学生端"
      title={profile.display_name || profile.username}
      subtitle={mustChangePassword ? "首次登录需要先修改密码。" : "查看待答试卷、历史成绩和个人分析。"}
      onLogout={onLogout}
      compactMobile
    >
      <div className="space-y-5">
        <nav className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <StudentNavButton
            testId="student-page-home"
            selected={activeView === "home"}
            disabled={mustChangePassword}
            icon={<Home className="h-4 w-4" />}
            label="主页"
            onClick={() => setActiveView("home")}
          />
          <StudentNavButton
            testId="student-page-papers"
            selected={activeView === "papers"}
            disabled={mustChangePassword}
            icon={<ClipboardList className="h-4 w-4" />}
            label="待答"
            onClick={() => setActiveView("papers")}
          />
          <StudentNavButton
            testId="student-page-results"
            selected={activeView === "results"}
            disabled={mustChangePassword}
            icon={<BarChart3 className="h-4 w-4" />}
            label="成绩"
            onClick={() => setActiveView("results")}
          />
          <StudentNavButton
            testId="student-page-account"
            selected={activeView === "account"}
            icon={<UserCog className="h-4 w-4" />}
            label="设置"
            onClick={() => setActiveView("account")}
          />
        </nav>

        {message ? (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {message}
          </div>
        ) : null}

        {activeView === "home" && !mustChangePassword ? (
          <>
          <GettingStartedChecklist
            description="完成改密、查看待答试卷并提交第一份答卷"
            steps={[
              { label: "完成首次改密", complete: !mustChangePassword, actionLabel: "前往设置", onAction: () => setActiveView("account") },
              { label: "查看待答试卷", complete: papers.length > 0, actionLabel: "查看试卷", onAction: () => setActiveView("papers") },
              { label: "提交第一份答卷", complete: results.length > 0, actionLabel: "开始答题", onAction: () => setActiveView("papers") },
            ]}
          />
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-950">主页</h2>
                <p className="mt-1 text-sm text-slate-500">
                  待答 {pendingPapers.length} 份 · 成绩 {results.length} 份
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={mustChangePassword}
                onClick={() => setActiveView("papers")}
                className="rounded-md border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 disabled:opacity-60"
              >
                <p className="text-sm font-semibold text-slate-950">待答试卷</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{pendingPapers.length}</p>
              </button>
              <button
                type="button"
                disabled={mustChangePassword}
                onClick={() => setActiveView("results")}
                className="rounded-md border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 disabled:opacity-60"
              >
                <p className="text-sm font-semibold text-slate-950">成绩分析</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{latestResult?.score_percent ?? "-"}%</p>
              </button>
            </div>
          </section>
          </>
        ) : null}

        {activeView === "papers" && !mustChangePassword ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">待答试卷</h2>
                <p className="mt-1 text-sm text-slate-500">班级试卷和专门布置给你的练习会显示在这里。</p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
            <div className="space-y-2">
              {pendingPapers.map((paper) => (
                <div key={paper.publication_id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-slate-950">{paper.title}</p>
                      {paper.recipient_scope === "student" ? <span className="mt-1 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-700">个人练习</span> : null}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{paper.subject || "未分科"}</span>
                        <span>{paper.question_count} 题</span>
                        <span>总分 {paper.paper_max_score ?? "-"} 分</span>
                        <span>{paper.time_limit_minutes ? `限时 ${paper.time_limit_minutes} 分钟` : "不限时"}</span>
                        <span>{paper.end_at ? `截止 ${formatLocaleDateTime(paper.end_at)}` : "无截止时间"}</span>
                        <span>{statusLabel(paper.status)}</span>
                        {paper.can_answer === false ? <span>暂不可答</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`student-start-${paper.publication_id}`}
                      disabled={busy === `start:${paper.publication_id}` || paper.can_answer === false}
                      onClick={() => void startPaper(paper)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {paper.status === "in_progress" ? "继续答题" : "开始答题"}
                    </button>
                  </div>
                </div>
              ))}
              {!loading && pendingPapers.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无待答试卷</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === "results" && !mustChangePassword ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              {Object.entries(exam.unconfirmedTexts).map(([key, entry]) => <details key={key} className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <summary>查看未确认的本机文本：{entry.title}</summary>
                {entry.issue ? <p className="mt-2">本机存储暂不可用，请在离开本页前复制以下文本。</p> : null}
                <pre className="mt-2 whitespace-pre-wrap break-words">{Object.entries(entry.answers).map(([id, value]) => `${id}: ${value || "（空答案）"}`).join("\n")}</pre>
              </details>)}
              {Object.entries(exam.unconfirmedImages).map(([key, entry]) => <details key={key} className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <summary>查看未确认的本机图片：{entry.title}</summary>
                {entry.issue ? <p className="mt-2">本机图片存储结果未能确认或提交未确认，请检查下面保留的图片。</p> : null}
                <div className="mt-2 space-y-3">
                  {Object.entries(entry.images).flatMap(([id, images]) => images.map((image, index) => (
                    <div key={`${id}:${index}`}><p>{id} · {image.name}</p><img src={image.data_url} alt={`${id} 未确认的答题图片`} className="mt-1 max-h-48 max-w-full rounded border border-amber-200 object-contain" /></div>
                  )))}
                </div>
              </details>)}
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-slate-600" />
                <h2 className="font-semibold text-slate-950">成绩与分析</h2>
              </div>
              <div className="space-y-3">
                {results.map((result) => (
                  <article key={result.attempt_id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-slate-950">{result.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{result.subject || "未分科"}</p>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
                        {result.show_results ? `${result.score_percent ?? "-"}%` : "待教师批改"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded bg-slate-50 p-2">
                        <p className="text-slate-500">得分</p>
                        <p className="mt-1 font-semibold text-slate-950">{scoreText(result.score, result.max_score)}</p>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <p className="text-slate-500">正确</p>
                        <p className="mt-1 font-semibold text-slate-950">{result.analysis?.correct_count ?? "-"}</p>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <p className="text-slate-500">错误</p>
                        <p className="mt-1 font-semibold text-slate-950">{result.analysis?.wrong_count ?? "-"}</p>
                      </div>
                    </div>
                    {result.show_results ? (
                      <>
                        <StudentAnalysisVisual result={result} />
                        <StudentResultDetails result={result} />
                      </>
                    ) : (
                      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">老师完成整份批改并发布后，这里会显示分数、错题、逐题反馈和模块数据。</p>
                    )}
                  </article>
                ))}
                {!loading && results.length === 0 ? <p className="text-sm text-slate-500">暂无历史成绩</p> : null}
              </div>
            </div>

            {latestResult ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-950">最近一次分析</h2>
                <p className="mt-2 text-sm text-slate-600">{latestResult.title}</p>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <p>答题数：{latestResult.analysis?.answered_count ?? 0}</p>
                  <p>错题数：{latestResult.analysis?.wrong_count ?? "-"}</p>
                  <p>用时：{Math.round(Number(latestResult.time_spent_seconds || 0) / 60)} 分钟</p>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {activeView === "account" ? (
          <section className="max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-slate-950">账号设置</h2>
            {mustChangePassword ? (
              <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                首次登录必须先修改密码，完成后才能进入答题和成绩页面。
              </p>
            ) : (
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setAccountMode("password")}
                  className={`rounded px-3 py-2 text-sm font-medium ${accountMode === "password" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}
                >
                  修改密码
                </button>
                <button
                  type="button"
                  onClick={() => setAccountMode("username")}
                  className={`rounded px-3 py-2 text-sm font-medium ${accountMode === "username" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}
                >
                  修改用户名
                </button>
              </div>
            )}
            <form onSubmit={(event) => void submitAccount(event)} className="space-y-3">
              {accountMode === "username" && !mustChangePassword ? (
                <input
                  data-testid="student-account-username"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="新用户名"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              ) : null}
              <label className="block text-sm text-slate-700">当前密码
              <input
                data-testid="student-account-current-password"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type={showAccountPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              </label>
              {accountMode === "password" ? (
                <>
                  <label className="block text-sm text-slate-700">新密码
                    <input data-testid="student-account-new-password" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" type={showAccountPasswords ? "text" : "password"} minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
                  </label>
                  <label className="block text-sm text-slate-700">确认新密码
                    <input data-testid="student-account-confirm-password" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" type={showAccountPasswords ? "text" : "password"} minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                  </label>
                  <p className="text-xs text-slate-500">密码至少 6 位，建议同时包含字母和数字，且不要与其他网站共用。</p>
                  <button type="button" onClick={() => setShowAccountPasswords((value) => !value)} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                    {showAccountPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showAccountPasswords ? "隐藏密码" : "显示密码"}
                  </button>
                </>
              ) : null}
              <button
                data-testid="student-account-save"
                type="submit"
                disabled={busy === "account"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {accountMode === "password" ? "保存密码" : "保存用户名"}
              </button>
            </form>
            {!mustChangePassword ? (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">界面个性化</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">皮肤<select value={theme} onChange={(event) => setTheme(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"><option value="classic">经典明亮</option><option value="ocean">海洋蓝</option><option value="forest">森林绿</option><option value="warm">暖阳橙</option><option value="night">深色夜间</option></select></label>
                  <label className="text-sm text-slate-700">界面密度<select value={density} onChange={(event) => setDensity(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
                  <label className="text-sm text-slate-700 sm:col-span-2">字号比例<input type="range" min="0.85" max="1.2" step="0.05" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} className="mt-2 w-full" /></label>
                </div>
                <button type="button" disabled={busy === "personalization"} onClick={() => void savePersonalization()} className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">保存个性化设置</button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </PlatformShell>
  );
}
