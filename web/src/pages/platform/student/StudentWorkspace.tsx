import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AppearanceFields } from "../../../design-system/AppearanceFields";
import { SelectionIndicator } from "../../../design-system/SelectionIndicator";
import { applyAppearance, appearanceTheme, installAppearance, readAppearance, saveAppearance, saveLoginAppearance, type Appearance } from "../../../design-system/appearance";
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
import { loadSessionToken } from "../../../platform/session";
import { formatSubjectLabel } from "../../../lib/subjectLabels";
import { PlatformShell } from "../PlatformShell";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import { StudentNavButton, StudentAnalysisVisual, StudentResultDetails } from "./StudentPanels";
import { StudentExamPanel } from "./StudentExamPanel";
import { useStudentExam } from "./useStudentExam";
import { DeferredMount } from "../../../components/DeferredMount";
import "../../../ui-redesign/g54/g54.css";
import { Select as AppSelect } from "../../../components/ui/select";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
};

type StudentView = "home" | "papers" | "results" | "account" | "exam";

function statusLabel(status: string): string {
  if (status === "submitted" || status === "completed") return "已提交";
  if (status === "in_progress") return "答题中";
  return "待作答";
}

function resultStatusGroup(status: string): "submitted" | "in_progress" | "pending" {
  if (status === "submitted" || status === "completed") return "submitted";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

function scoreText(score?: number | null, maxScore?: number | null): string {
  if (score === null || score === undefined) return "待公布";
  if (maxScore === null || maxScore === undefined) return `${score}`;
  return `${score}/${maxScore}`;
}

export function StudentWorkspace({ user, onLogout }: Props) {
  const [profile, setProfile] = useState(user);
  const [activeView, setActiveView] = useState<StudentView>(user.must_change_password ? "account" : "home");
  const [username, setUsername] = useState("");
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState("");
  const [usernameCurrentPassword, setUsernameCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showAccountPasswords, setShowAccountPasswords] = useState(false);
  const [resultSearch, setResultSearch] = useState("");
  const [resultSubjectFilter, setResultSubjectFilter] = useState("");
  const [resultStatusFilter, setResultStatusFilter] = useState("");
  const [appearance, setAppearance] = useState(() => readAppearance(user));
  const [density, setDensity] = useState(profile.preferences?.density ?? "comfortable");
  const [fontScale, setFontScale] = useState(Number(profile.preferences?.font_scale ?? 1));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [papers, setPapers] = useState<StudentPaperRecord[]>([]);
  const [results, setResults] = useState<StudentResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const studentNavigationRef = useRef<HTMLElement>(null);
  const navigationEpochRef = useRef(0);
  const accountIdRef = useRef(user.id);
  const renderedAccountRef = useRef(user.id);
  if (accountIdRef.current !== user.id) {
    accountIdRef.current = user.id;
    navigationEpochRef.current += 1;
  }

  const pendingPapers = useMemo(
    () => papers.filter((paper) => paper.status !== "submitted" && paper.status !== "completed"),
    [papers],
  );
  const latestResult = results[0] ?? null;
  const mustChangePassword = Boolean(profile.must_change_password);
  const shouldRefreshResults = activeView === "results" && results.length > 0;
  const resultSubjects = useMemo(
    () => Array.from(new Set(results.map((result) => result.subject?.trim() || "未分科"))),
    [results],
  );
  const filteredResults = useMemo(() => {
    const query = resultSearch.trim().toLocaleLowerCase();
    return results.filter((result) => {
      const searchableText = [result.title, result.subject || "", result.exam_id].join(" ").toLocaleLowerCase();
      return (!query || searchableText.includes(query))
        && (!resultSubjectFilter || (result.subject?.trim() || "未分科") === resultSubjectFilter)
        && (!resultStatusFilter || resultStatusFilter === resultStatusGroup(result.status));
    });
  }, [results, resultSearch, resultSubjectFilter, resultStatusFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [paperData, resultData] = await Promise.all([listStudentPapers(), listStudentResults()]);
      if (accountIdRef.current === user.id) {
        setPapers(paperData.papers);
        setResults(resultData.results);
      }
    } catch (e) {
      if (accountIdRef.current === user.id) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (accountIdRef.current === user.id) setLoading(false);
    }
  }, [user.id]);

  const onExamSubmitted = useCallback(async (submissionMessage: string) => {
    const epoch = navigationEpochRef.current;
    await refresh();
    if (epoch !== navigationEpochRef.current) return;
    setMessage(submissionMessage);
    setActiveView("results");
  }, [refresh]);
  const exam = useStudentExam({ user, onMessage: setMessage, onSubmitted: onExamSubmitted });

  useEffect(() => {
    if (renderedAccountRef.current === user.id) return;
    renderedAccountRef.current = user.id;
    setProfile(user);
    setActiveView(user.must_change_password ? "account" : "home");
    setPapers([]);
    setResults([]);
    setMessage(null);
    setBusy(null);
    setUsername("");
    setPasswordCurrentPassword("");
    setUsernameCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setResultSearch("");
    setResultSubjectFilter("");
    setResultStatusFilter("");
    setAppearance(readAppearance(user));
    setDensity(user.preferences?.density ?? "comfortable");
    setFontScale(Number(user.preferences?.font_scale ?? 1));
  }, [user]);

  useEffect(() => installAppearance(profile.id === user.id ? profile : user), [profile.id, profile.preferences, user.id, user.preferences]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeView === 'exam') return;
    let disposed = false;
    let pending = false;
    const sessionToken = loadSessionToken();
    const isCurrentSession = () => !disposed && loadSessionToken() === sessionToken;
    const timer = window.setInterval(() => {
      if (document.hidden || pending || !isCurrentSession()) return;
      pending = true;
      const requests = [
        listStudentPapers().then(result => { if (isCurrentSession()) setPapers(result.papers); }),
      ];
      if (shouldRefreshResults) {
        requests.push(listStudentResults().then(result => { if (isCurrentSession()) setResults(result.results); }));
      }
      void Promise.allSettled(requests).finally(() => { pending = false; });
    }, 15000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeView, shouldRefreshResults, user.id]);

  useEffect(() => {
    if (mustChangePassword) {
      setActiveView("account");
    }
  }, [mustChangePassword]);

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    setBusy("account");
    setMessage(null);
    try {
      const result = await updateStudentAccount({
        username: null,
        current_password: passwordCurrentPassword,
        new_password: newPassword,
      });
      setProfile(result.user);
      setPasswordCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("密码已更新");
      if (profile.must_change_password && !result.user.must_change_password) {
        setActiveView("home");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitUsernameChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = username.trim();
    if (!nextUsername) {
      setMessage("请输入新用户名");
      return;
    }
    setBusy("account");
    setMessage(null);
    try {
      const result = await updateStudentAccount({
        username: nextUsername,
        current_password: usernameCurrentPassword,
        new_password: null,
      });
      setProfile(result.user);
      setUsername("");
      setUsernameCurrentPassword("");
      setMessage("用户名已更新");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const personalizationDirtyRef = useRef(false);
  const personalizationRevisionRef = useRef(0);
  const personalizationSaveWorkerRef = useRef<Promise<void> | null>(null);
  const personalizationMountedRef = useRef(false);
  const personalizationFeedbackRef = useRef(false);
  const personalizationUnmountFlushRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionToken = loadSessionToken();
  const latestPersonalizationRef = useRef({ profile, appearance, density, fontScale, userId: user.id, sessionToken });
  if (latestPersonalizationRef.current.userId !== user.id || latestPersonalizationRef.current.sessionToken !== sessionToken) {
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = false;
    personalizationFeedbackRef.current = false;
    personalizationUnmountFlushRef.current = false;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }
  latestPersonalizationRef.current = { profile, appearance, density, fontScale, userId: user.id, sessionToken };

  const persistPersonalization = useCallback(async (options?: { silent?: boolean; unmounting?: boolean }) => {
    const silent = options?.silent ?? false;
    const unmounting = options?.unmounting ?? false;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!silent && !unmounting) {
      personalizationFeedbackRef.current = true;
      if (personalizationMountedRef.current) setBusy("personalization");
    }

    if (personalizationSaveWorkerRef.current) {
      await personalizationSaveWorkerRef.current;
      return;
    }

    const worker = (async () => {
      while (personalizationDirtyRef.current) {
        const revision = personalizationRevisionRef.current;
        const current = latestPersonalizationRef.current;
        personalizationDirtyRef.current = false;
        if (current.profile.id !== current.userId || current.sessionToken !== loadSessionToken()) {
          break;
        }
        try {
          const result = await updateAccountProfile({ preferences: { theme: appearanceTheme(current.appearance), density: current.density, font_scale: current.fontScale } });
          const sessionChanged = current.sessionToken !== loadSessionToken();
          if (revision !== personalizationRevisionRef.current || sessionChanged) {
            if (revision === personalizationRevisionRef.current && sessionChanged) {
              personalizationRevisionRef.current += 1;
              personalizationDirtyRef.current = false;
              personalizationFeedbackRef.current = false;
              personalizationUnmountFlushRef.current = false;
            }
            continue;
          }
          personalizationUnmountFlushRef.current = false;
          const stored = saveAppearance(result.profile.id, current.appearance);
          const loginAppearanceStored = saveLoginAppearance(current.appearance);
          if (personalizationMountedRef.current && !unmounting) {
            setProfile((prev) => ({ ...prev, ...result.profile }));
            applyAppearance(result.profile);
            if (personalizationFeedbackRef.current) {
              setMessage(stored && loginAppearanceStored ? "个性化设置已保存" : "设置已保存，当前外观在本次会话中生效");
              setBusy(null);
              personalizationFeedbackRef.current = false;
            }
          }
        } catch (error) {
          if (revision !== personalizationRevisionRef.current) {
            continue;
          }
          personalizationDirtyRef.current = true;
          if (personalizationUnmountFlushRef.current && current.sessionToken === loadSessionToken()) {
            personalizationUnmountFlushRef.current = false;
            continue;
          }
          if (personalizationMountedRef.current && !unmounting) {
            setMessage(error instanceof Error ? error.message : String(error));
            if (personalizationFeedbackRef.current) setBusy(null);
            personalizationFeedbackRef.current = false;
          }
          break;
        }
      }

      if (personalizationMountedRef.current && !unmounting && personalizationFeedbackRef.current) {
        setBusy(null);
        personalizationFeedbackRef.current = false;
      }
    })();
    personalizationSaveWorkerRef.current = worker;
    try {
      await worker;
    } finally {
      if (personalizationSaveWorkerRef.current === worker) {
        personalizationSaveWorkerRef.current = null;
      }
    }
  }, []);

  const scheduleAutoSavePersonalization = useCallback((delayMs = 450) => {
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = true;
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (personalizationDirtyRef.current) {
        void persistPersonalization({ silent: true });
      }
    }, delayMs);
  }, [persistPersonalization]);

  useEffect(() => {
    personalizationMountedRef.current = true;
    return () => {
      personalizationMountedRef.current = false;
      if (personalizationDirtyRef.current || personalizationSaveWorkerRef.current) {
        personalizationUnmountFlushRef.current = true;
      }
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (personalizationDirtyRef.current) {
        void persistPersonalization({ silent: true, unmounting: true });
      }
    };
  }, [persistPersonalization]);

  const handleAppearanceChange = useCallback((nextAppearance: Appearance) => {
    setAppearance(nextAppearance);
    const current = latestPersonalizationRef.current;
    latestPersonalizationRef.current = { ...current, appearance: nextAppearance };
    if (current.profile?.id) {
      saveAppearance(current.profile.id, nextAppearance);
    }
    saveLoginAppearance(nextAppearance);
    applyAppearance({
      id: current.profile?.id ?? "preview",
      preferences: {
        ...current.profile?.preferences,
        theme: appearanceTheme(nextAppearance),
        density: current.density,
        font_scale: current.fontScale,
      },
    });
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  const handleDensityChange = useCallback((nextDensity: string) => {
    setDensity(nextDensity);
    latestPersonalizationRef.current = { ...latestPersonalizationRef.current, density: nextDensity };
    document.documentElement.dataset.ehDensity = nextDensity === "compact" ? "compact" : "comfortable";
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  const handleFontScaleChange = useCallback((nextScale: number) => {
    setFontScale(nextScale);
    latestPersonalizationRef.current = { ...latestPersonalizationRef.current, fontScale: nextScale };
    document.documentElement.style.setProperty("--or-font-scale", String(nextScale));
    document.documentElement.style.fontSize = `${nextScale * 100}%`;
    scheduleAutoSavePersonalization(450);
  }, [scheduleAutoSavePersonalization]);

  async function savePersonalization() {
    personalizationRevisionRef.current += 1;
    personalizationDirtyRef.current = true;
    await persistPersonalization({ silent: false });
  }

  async function startPaper(paper: StudentPaperRecord) {
    const epoch = ++navigationEpochRef.current;
    setBusy(`start:${paper.publication_id}`);
    setMessage(null);
    try {
      const data = await startStudentPaper(paper.publication_id);
      if (epoch !== navigationEpochRef.current) return;
      if (await exam.open(data) && epoch === navigationEpochRef.current) setActiveView("exam");
    } catch (e) {
      if (epoch === navigationEpochRef.current) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (epoch === navigationEpochRef.current) setBusy(null);
    }
  }

  if (renderedAccountRef.current !== user.id) return null;
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
        <nav
          ref={studentNavigationRef}
          className="or-g54-student-nav relative isolate grid grid-cols-4 gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-block)_70%,transparent)] p-2 shadow-sm"
        >
          <SelectionIndicator
            rootRef={studentNavigationRef}
            selector={'[data-state="active"]'}
            className="or-g54-student-nav-indicator"
          />
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
          <div className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-3 text-sm text-[var(--or-text)] shadow-sm">
            {message}
          </div>
        ) : null}

        <div className="or-workspace-content min-w-0">
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
            <section className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight text-[var(--or-text)]">主页</h2>
                  <p className="mt-1 text-sm text-[var(--or-muted)]">
                    待答 {pendingPapers.length} 份 · 成绩 {results.length} 份
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-2 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-60 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={mustChangePassword}
                  onClick={() => setActiveView("papers")}
                  className="group rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-5 text-left hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-block)_70%,transparent)] active:scale-[0.99] transition-all disabled:opacity-60"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--or-text)]">待答试卷</p>
                    <ClipboardList className="h-5 w-5 text-[var(--or-muted)] group-hover:text-[var(--or-muted)] transition-colors" />
                  </div>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--or-text)] font-mono">
                    {pendingPapers.length}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={mustChangePassword}
                  onClick={() => setActiveView("results")}
                  className="group rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-5 text-left hover:border-[var(--or-outline)] hover:bg-[color-mix(in_srgb,var(--or-block)_70%,transparent)] active:scale-[0.99] transition-all disabled:opacity-60"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--or-text)]">成绩分析</p>
                    <BarChart3 className="h-5 w-5 text-[var(--or-muted)] group-hover:text-[var(--or-muted)] transition-colors" />
                  </div>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--or-text)] font-mono">
                    {latestResult?.score_percent ?? "-"}%
                  </p>
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeView === "papers" && !mustChangePassword ? (
          <section className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-[var(--or-text)]">待答试卷</h2>
                <p className="mt-1 text-sm text-[var(--or-muted)]">班级试卷和专门布置给你的练习会显示在这里。</p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-2 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-60 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
            <div className="space-y-3.5">
              {pendingPapers.map((paper) => (
                <div key={paper.publication_id} className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 transition-colors hover:border-[var(--or-outline)]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-base font-semibold text-[var(--or-text)]">{paper.title}</p>
                        {paper.recipient_scope === "student" ? (
                          <span className="or-g54-pill bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                            个人练习
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--or-muted)]">
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">{formatSubjectLabel(paper.subject, "未分科")}</span>
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">{paper.question_count} 题</span>
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">总分 {paper.paper_max_score ?? "-"} 分</span>
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">
                          {paper.time_limit_minutes ? `限时 ${paper.time_limit_minutes} 分钟` : "不限时"}
                        </span>
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">
                          {paper.end_at ? `截止 ${formatLocaleDateTime(paper.end_at)}` : "无截止时间"}
                        </span>
                        <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-muted)]">{statusLabel(paper.status)}</span>
                        {paper.can_answer === false ? (
                          <span className="or-g54-pill bg-[var(--or-error-container)] text-[var(--or-on-error)] font-semibold">暂不可答</span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`student-start-${paper.publication_id}`}
                      disabled={busy === `start:${paper.publication_id}` || paper.can_answer === false}
                      onClick={() => void startPaper(paper)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--or-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] disabled:opacity-60 transition-colors sm:w-auto shrink-0"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {paper.status === "in_progress" ? "继续答题" : "开始答题"}
                    </button>
                  </div>
                </div>
              ))}
              {!loading && pendingPapers.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--or-outline)] p-6 text-center text-sm text-[var(--or-muted)]">
                  暂无待答试卷
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === "results" && !mustChangePassword ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm sm:p-6">
              {Object.entries(exam.unconfirmedTexts).map(([key, entry]) => (
                <details key={key} className="mb-4 rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_80%,transparent)] p-4 text-sm">
                  <summary className="font-semibold text-[var(--or-on-warning)] cursor-pointer">
                    查看未确认的本机文本：{entry.title}
                  </summary>
                  {entry.issue === "too_large" && !Object.keys(entry.answers).length ? (
                    <p className="mt-2 text-[var(--or-on-warning)]">
                      标签页未确认文本暂存达到上限，本条答案未能继续保留；请检查服务器答卷。
                    </p>
                  ) : null}
                  {entry.issue && !(entry.issue === "too_large" && !Object.keys(entry.answers).length) ? (
                    <p className="mt-2 text-[var(--or-on-warning)]">
                      本机存储暂不可用，请在离开本页前复制以下文本。
                    </p>
                  ) : null}
                  <pre className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] p-3 font-mono text-xs text-[var(--or-on-warning)]">
                    {Object.entries(entry.answers).map(([id, value]) => `${id}: ${value || "（空答案）"}`).join("\n")}
                  </pre>
                </details>
              ))}

              {Object.entries(exam.unconfirmedImages).map(([key, entry]) => (
                <details key={key} className="mb-4 rounded-xl border border-[var(--or-warning)] bg-[color-mix(in_srgb,var(--or-warning-container)_80%,transparent)] p-4 text-sm">
                  <summary className="font-semibold text-[var(--or-on-warning)] cursor-pointer">
                    查看未确认的本机图片：{entry.title}
                  </summary>
                  {entry.issue === "too_large" && !Object.keys(entry.images).length ? (
                    <p className="mt-2 text-[var(--or-on-warning)]">
                      标签页未确认图片暂存达到上限，本条图片未能继续保留；请检查服务器答卷或重新选择图片。
                    </p>
                  ) : null}
                  {entry.issue && !(entry.issue === "too_large" && !Object.keys(entry.images).length) ? (
                    <p className="mt-2 text-[var(--or-on-warning)]">
                      本机图片存储结果未能确认或提交未确认，请检查下面保留的图片。
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-3">
                    {Object.entries(entry.images).flatMap(([id, images]) =>
                      images.length ? (
                        images.map((image, index) => (
                          <div key={`${id}:${index}`} className="rounded-lg border border-[color-mix(in_srgb,var(--or-warning)_80%,transparent)] bg-[var(--or-card)] p-2.5">
                            <p className="text-xs font-medium text-[var(--or-text)]">{id} · {image.name}</p>
                            <img
                              src={image.data_url}
                              alt={`${id} 未确认的答题图片`}
                              className="mt-1.5 max-h-48 max-w-full rounded border border-[var(--or-warning)] object-contain"
                            />
                          </div>
                        ))
                      ) : (
                        [<p key={id} className="text-xs text-[var(--or-muted)]">{id} · 图片已移除，尚未确认</p>]
                      )
                    )}
                  </div>
                </details>
              ))}

              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-[var(--or-muted)]" />
                <h2 className="text-lg font-semibold tracking-tight text-[var(--or-text)]">成绩与分析</h2>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] xl:items-end">
                <label className="block text-sm font-medium text-[var(--or-muted)]" htmlFor="student-results-search">
                  搜索成绩
                  <input
                    id="student-results-search"
                    data-testid="student-results-search"
                    type="search"
                    value={resultSearch}
                    onChange={(event) => setResultSearch(event.target.value)}
                    placeholder="按考试名称、科目或编号搜索"
                    className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                  />
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]" htmlFor="student-results-subject-filter">
                  科目
                  <AppSelect
                    id="student-results-subject-filter"
                    data-testid="student-results-subject-filter"
                    value={resultSubjectFilter}
                    onValueChange={(value) => setResultSubjectFilter(value)}
                    className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                  >
                    <option value="">全部科目</option>
                    {resultSubjects.map((subject) => (
                      <option key={subject} value={subject}>{formatSubjectLabel(subject)}</option>
                    ))}
                  </AppSelect>
                </label>
                <label className="block text-sm font-medium text-[var(--or-muted)]" htmlFor="student-results-status-filter">
                  状态
                  <AppSelect
                    id="student-results-status-filter"
                    data-testid="student-results-status-filter"
                    value={resultStatusFilter}
                    onValueChange={(value) => setResultStatusFilter(value)}
                    className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                  >
                    <option value="">全部状态</option>
                    <option value="submitted">已提交</option>
                    <option value="in_progress">答题中</option>
                    <option value="pending">待作答</option>
                  </AppSelect>
                </label>
                <button
                  data-testid="student-results-clear"
                  type="button"
                  onClick={() => {
                    setResultSearch("");
                    setResultSubjectFilter("");
                    setResultStatusFilter("");
                  }}
                  disabled={!resultSearch && !resultSubjectFilter && !resultStatusFilter}
                  className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-2 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                >
                  清空筛选
                </button>
              </div>

              <div className="space-y-4">
                {filteredResults.map((result) => (
                  <article
                    key={result.attempt_id}
                    data-testid={`student-result-${result.attempt_id}`}
                    className="rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-4 sm:p-5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-base font-semibold text-[var(--or-text)]">{result.title}</p>
                        <p className="mt-1 text-xs text-[var(--or-muted)]">{formatSubjectLabel(result.subject, "未分科")}</p>
                      </div>
                      <span className="or-g54-pill bg-[var(--or-block)] text-[var(--or-text)] text-xs font-semibold px-3 py-1">
                        {result.show_results ? `${result.score_percent ?? "-"}%` : "待教师批改"}
                      </span>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2.5 text-center text-xs">
                      <div className="rounded-xl bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] border border-[var(--or-outline)] p-2.5">
                        <p className="text-[var(--or-muted)]">得分</p>
                        <p className="mt-1 font-mono font-semibold text-sm text-[var(--or-text)]">
                          {scoreText(result.score, result.max_score)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] border border-[var(--or-outline)] p-2.5">
                        <p className="text-[var(--or-muted)]">正确</p>
                        <p className="mt-1 font-mono font-semibold text-sm text-[var(--or-text)]">
                          {result.analysis?.correct_count ?? "-"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[color-mix(in_srgb,var(--or-page)_80%,transparent)] border border-[var(--or-outline)] p-2.5">
                        <p className="text-[var(--or-muted)]">错误</p>
                        <p className="mt-1 font-mono font-semibold text-sm text-[var(--or-text)]">
                          {result.analysis?.wrong_count ?? "-"}
                        </p>
                      </div>
                    </div>

                    {result.show_results ? (
                      <>
                        <StudentAnalysisVisual result={result} />
                        <DeferredMount
                          fallback={(
                            <div
                              className="mt-4 min-h-20 rounded-2xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_45%,transparent)] px-4 py-3 text-xs text-[var(--or-muted)]"
                              role="status"
                            >
                              正在准备逐题复盘…
                            </div>
                          )}
                        >
                          <StudentResultDetails result={result} />
                        </DeferredMount>
                      </>
                    ) : (
                      <p className="mt-3.5 rounded-xl border border-[color-mix(in_srgb,var(--or-warning)_70%,transparent)] bg-[color-mix(in_srgb,var(--or-warning-container)_60%,transparent)] px-3.5 py-2.5 text-xs text-[var(--or-on-warning)]">
                        老师完成整份批改并发布后，这里会显示分数、错题、逐题反馈和模块数据。
                      </p>
                    )}
                  </article>
                ))}

                {!loading && results.length === 0 ? (
                  <p className="text-sm text-[var(--or-muted)]">暂无历史成绩</p>
                ) : null}

                {!loading && results.length > 0 && filteredResults.length === 0 ? (
                  <p className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-[var(--or-outline)] p-5 text-sm text-[var(--or-muted)]">
                    <span>没有符合条件的成绩。</span>
                    <button
                      type="button"
                      onClick={() => {
                        setResultSearch("");
                        setResultSubjectFilter("");
                        setResultStatusFilter("");
                      }}
                      className="font-semibold text-[var(--or-text)] underline underline-offset-2"
                    >
                      清空筛选
                    </button>
                  </p>
                ) : null}
              </div>
            </div>

            {latestResult ? (
              <section className="or-g54-card-static rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm">
                <h2 className="text-base font-semibold tracking-tight text-[var(--or-text)]">最近一次分析</h2>
                <p className="mt-2 text-sm font-medium text-[var(--or-muted)]">{latestResult.title}</p>
                <div className="mt-3.5 space-y-2.5 text-sm text-[var(--or-muted)] border-t border-[var(--or-outline)] pt-3">
                  <p className="flex justify-between">
                    <span className="text-[var(--or-muted)]">答题数：</span>
                    <span className="font-mono font-semibold text-[var(--or-text)]">{latestResult.analysis?.answered_count ?? 0}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[var(--or-muted)]">错题数：</span>
                    <span className="font-mono font-semibold text-[var(--or-text)]">{latestResult.analysis?.wrong_count ?? "-"}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[var(--or-muted)]">用时：</span>
                    <span className="font-mono font-semibold text-[var(--or-text)]">{Math.round(Number(latestResult.time_spent_seconds || 0) / 60)} 分钟</span>
                  </p>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {activeView === "account" ? (
          <section className="mx-auto w-full max-w-5xl rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-5 shadow-sm sm:p-6">
            <h2 className="mb-5 text-center text-lg font-semibold tracking-tight text-[var(--or-text)]">账号设置</h2>
            {mustChangePassword ? (
              <p className="mx-auto mb-5 max-w-xl rounded-xl border border-[var(--or-warning)] bg-[var(--or-warning-container)] px-4 py-3 text-sm text-[var(--or-on-warning)]">
                首次登录必须先修改密码，完成后才能进入答题和成绩页面。
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <section className={`rounded-xl border border-[var(--or-outline)] p-5 ${mustChangePassword ? "mx-auto w-full md:col-span-2 md:max-w-xl" : ""}`}>
                <h3 className="mb-3 text-sm font-semibold text-[var(--or-text)]">修改密码</h3>
                <form onSubmit={(event) => void submitPasswordChange(event)} className="space-y-3.5">
                  <label className="block text-sm font-medium text-[var(--or-muted)]">
                    当前密码
                    <input
                      data-testid="student-account-current-password"
                      autoComplete="current-password"
                      className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                      type={showAccountPasswords ? "text" : "password"}
                      value={passwordCurrentPassword}
                      onChange={(event) => setPasswordCurrentPassword(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block text-sm font-medium text-[var(--or-muted)]">
                    新密码
                    <input
                      data-testid="student-account-new-password"
                      autoComplete="new-password"
                      className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                      type={showAccountPasswords ? "text" : "password"}
                      minLength={6}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block text-sm font-medium text-[var(--or-muted)]">
                    确认新密码
                    <input
                      data-testid="student-account-confirm-password"
                      autoComplete="new-password"
                      className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                      type={showAccountPasswords ? "text" : "password"}
                      minLength={6}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                    />
                  </label>
                  <p className="text-xs text-[var(--or-muted)]">
                    密码至少 6 位，建议同时包含字母和数字，且不要与其他网站共用。
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAccountPasswords((value) => !value)}
                    className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--or-muted)] hover:text-[var(--or-text)] transition-colors"
                  >
                    {showAccountPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {showAccountPasswords ? "隐藏密码" : "显示密码"}
                  </button>
                  <button
                    data-testid="student-account-password-save"
                    type="submit"
                    disabled={busy === "account"}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--or-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] disabled:opacity-60 transition-colors"
                  >
                    <Save className="h-4 w-4" />
                    保存密码
                  </button>
                </form>
              </section>

              {!mustChangePassword ? (
                <section className="rounded-xl border border-[var(--or-outline)] p-5">
                  <h3 className="mb-1 text-sm font-semibold text-[var(--or-text)]">修改用户名</h3>
                  <p className="mb-3 text-xs text-[var(--or-muted)]">当前用户名：{profile.username}</p>
                  <form onSubmit={(event) => void submitUsernameChange(event)} className="space-y-3.5">
                    <label className="block text-sm font-medium text-[var(--or-muted)]" htmlFor="student-account-username">
                      新用户名
                      <input
                        id="student-account-username"
                        data-testid="student-account-username"
                        autoComplete="username"
                        className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                      />
                    </label>
                    <label className="block text-sm font-medium text-[var(--or-muted)]">
                      当前密码
                      <input
                        data-testid="student-account-username-current-password"
                        autoComplete="current-password"
                        className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                        type="password"
                        value={usernameCurrentPassword}
                        onChange={(event) => setUsernameCurrentPassword(event.target.value)}
                        required
                      />
                    </label>
                    <button
                      data-testid="student-account-username-save"
                      type="submit"
                      disabled={busy === "account"}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--or-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] disabled:opacity-60 transition-colors"
                    >
                      <Save className="h-4 w-4" />
                      保存用户名
                    </button>
                  </form>
                </section>
              ) : null}
            </div>

            {!mustChangePassword ? (
              <div className="mx-auto mt-6 max-w-3xl border-t border-[var(--or-outline)] pt-5">
                <h3 className="text-center text-sm font-semibold text-[var(--or-text)]">界面个性化</h3>
                <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                  <div className="sm:col-span-2"><AppearanceFields value={appearance} onChange={handleAppearanceChange} /></div>
                  <label className="text-sm font-medium text-[var(--or-muted)]">
                    界面密度
                    <AppSelect
                      value={density}
                      onValueChange={(value) => handleDensityChange(value)}
                      className="mt-1.5 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-2 text-sm text-[var(--or-text)] focus:border-[var(--or-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--or-focus)] transition-colors"
                    >
                      <option value="comfortable">舒适</option>
                      <option value="compact">紧凑</option>
                    </AppSelect>
                  </label>
                  <label className="text-sm font-medium text-[var(--or-muted)] sm:col-span-2">
                    字号比例
                    <input
                      type="range"
                      min="0.85"
                      max="1.2"
                      step="0.05"
                      value={fontScale}
                      onChange={(event) => handleFontScaleChange(Number(event.target.value))}
                      className="mt-2.5 w-full accent-[var(--or-primary)]"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={busy === "personalization"}
                  onClick={() => void savePersonalization()}
                  className="mt-4 w-full rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-2.5 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
                >
                  保存个性化设置
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        </div>
      </div>
    </PlatformShell>
  );
}
