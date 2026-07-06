import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  Home,
  RefreshCw,
  Save,
  Send,
  UserCog,
} from "lucide-react";
import { resolveApiUrl } from "../../api/client";
import {
  loadSessionToken,
  listStudentPapers,
  listStudentResults,
  recordStudentProctorEvent,
  saveStudentAnswers,
  startStudentPaper,
  submitStudentAttempt,
  updateStudentAccount,
  type PlatformUser,
  type StudentAttemptRecord,
  type StudentAnswerImage,
  type StudentPaperRecord,
  type StudentQuestionRecord,
  type StudentResultRecord,
} from "../../platform/auth";
import { PlatformShell } from "./PlatformShell";

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

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return "不限时";
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function isImageSubmission(mode?: string | null): boolean {
  return mode === "image_manual" || mode === "image_ai";
}

export function StudentWorkspace({ user, onLogout }: Props) {
  const [profile, setProfile] = useState(user);
  const [activeView, setActiveView] = useState<StudentView>(user.must_change_password ? "account" : "home");
  const [accountMode, setAccountMode] = useState<AccountMode>("password");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [papers, setPapers] = useState<StudentPaperRecord[]>([]);
  const [results, setResults] = useState<StudentResultRecord[]>([]);
  const [activeAttempt, setActiveAttempt] = useState<StudentAttemptRecord | null>(null);
  const [questions, setQuestions] = useState<StudentQuestionRecord[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [imageAnswers, setImageAnswers] = useState<Record<string, StudentAnswerImage[]>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const startedAtRef = useRef<number | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const activeAttemptRef = useRef<StudentAttemptRecord | null>(null);
  const questionsRef = useRef<StudentQuestionRecord[]>([]);
  const answersRef = useRef<Record<string, string>>({});
  const imageAnswersRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const answersUrlRef = useRef<string | null>(null);
  const submitUrlRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (mustChangePassword) {
      setActiveView("account");
      setAccountMode("password");
    }
  }, [mustChangePassword]);

  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") {
      return;
    }
    const attemptId = activeAttempt.id;
    const sendEvent = (eventType: string, durationMs?: number | null, payload?: Record<string, unknown>) => {
      void recordStudentProctorEvent(attemptId, {
        event_type: eventType,
        duration_ms: durationMs ?? null,
        payload: payload ?? null,
      }).catch(() => {
        /* best effort proctor event */
      });
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (hiddenAtRef.current != null) {
        const duration = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        sendEvent("visibility_hidden", duration, { source: "visibilitychange" });
      }
    };
    const onBlur = () => sendEvent("window_blur", 0, { source: "window.blur" });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
    };
  }, [activeAttempt]);

  useEffect(() => {
    activeAttemptRef.current = activeAttempt;
    questionsRef.current = questions;
    answersRef.current = answers;
    imageAnswersRef.current = imageAnswers;
  }, [activeAttempt, answers, imageAnswers, questions]);

  useEffect(() => {
    if (!activeAttempt) {
      answersUrlRef.current = null;
      submitUrlRef.current = null;
      setRemainingSeconds(null);
      return;
    }
    void Promise.all([
      resolveApiUrl(`/api/student/attempts/${encodeURIComponent(activeAttempt.id)}/answers`),
      resolveApiUrl(`/api/student/attempts/${encodeURIComponent(activeAttempt.id)}/submit`),
    ]).then(([answersUrl, submitUrl]) => {
      if (activeAttemptRef.current?.id === activeAttempt.id) {
        answersUrlRef.current = answersUrl;
        submitUrlRef.current = submitUrl;
      }
    });
    const limitMinutes = Number(activeAttempt.time_limit_minutes || 0);
    setRemainingSeconds(limitMinutes > 0 ? limitMinutes * 60 : null);
  }, [activeAttempt]);

  useEffect(() => {
    const limitMinutes = Number(activeAttempt?.time_limit_minutes || 0);
    if (!activeAttempt || activeAttempt.status !== "in_progress" || limitMinutes <= 0) {
      return;
    }
    const tick = () => {
      const elapsed = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
      const next = Math.max(0, limitMinutes * 60 - elapsed);
      setRemainingSeconds(next);
      if (next <= 0) {
        void submitActiveAttempt();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttempt?.id, activeAttempt?.status, activeAttempt?.time_limit_minutes]);

  useEffect(() => {
    const onBeforeUnload = () => {
      submitAttemptBestEffort();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  async function startPaper(paper: StudentPaperRecord) {
    setBusy(`start:${paper.publication_id}`);
    setMessage(null);
    try {
      const data = await startStudentPaper(paper.publication_id);
      setActiveAttempt(data.attempt);
      setQuestions(data.questions);
      setAnswers({});
      setImageAnswers({});
      startedAtRef.current = Date.now();
      setRemainingSeconds(Number(data.attempt.time_limit_minutes || 0) > 0 ? Number(data.attempt.time_limit_minutes) * 60 : null);
      setActiveView("exam");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function setAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function readImageFile(file: File): Promise<StudentAnswerImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
      reader.onload = () =>
        resolve({
          name: file.name,
          mime_type: file.type,
          data_url: String(reader.result || ""),
        });
      reader.readAsDataURL(file);
    });
  }

  async function setQuestionImages(questionId: string, files: FileList | null) {
    const selected = Array.from(files ?? []);
    const images = await Promise.all(selected.map(readImageFile));
    setImageAnswers((current) => ({ ...current, [questionId]: images }));
  }

  function buildAnswerPayload(
    attempt: StudentAttemptRecord,
    sourceQuestions: StudentQuestionRecord[],
    sourceAnswers: Record<string, string>,
    sourceImageAnswers: Record<string, StudentAnswerImage[]>,
  ) {
    const imageMode = isImageSubmission(attempt.submission_mode);
    return sourceQuestions.map((question) =>
      imageMode
        ? {
            question_id: question.question_id,
            images: sourceImageAnswers[question.question_id] ?? [],
          }
        : {
            question_id: question.question_id,
            answer: sourceAnswers[question.question_id] ?? "",
          },
    );
  }

  function elapsedSeconds(): number | null {
    return startedAtRef.current ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) : null;
  }

  function submitAttemptBestEffort() {
    const attempt = activeAttemptRef.current;
    if (!attempt || attempt.status !== "in_progress") return;
    const token = loadSessionToken();
    const answersUrl = answersUrlRef.current;
    const submitUrl = submitUrlRef.current;
    if (!token || !answersUrl || !submitUrl) return;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const payload = buildAnswerPayload(attempt, questionsRef.current, answersRef.current, imageAnswersRef.current);
    void fetch(answersUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
    void fetch(submitUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ time_spent_seconds: elapsedSeconds() }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function submitActiveAttempt() {
    if (!activeAttempt) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setBusy("submit");
    setMessage(null);
    try {
      const payload = buildAnswerPayload(activeAttempt, questions, answers, imageAnswers);
      await saveStudentAnswers(activeAttempt.id, payload);
      await submitStudentAttempt(activeAttempt.id, { time_spent_seconds: elapsedSeconds() });
      setActiveAttempt(null);
      setQuestions([]);
      setAnswers({});
      setImageAnswers({});
      setRemainingSeconds(null);
      startedAtRef.current = null;
      await refresh();
      setMessage("试卷已提交");
      setActiveView("results");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      submitInFlightRef.current = false;
    }
  }

  if (activeView === "exam" && activeAttempt) {
    return (
      <PlatformShell
        roleLabel="学生端"
        title={activeAttempt.title}
        subtitle={`${activeAttempt.subject || "未分科"} · ${questions.length} 题`}
        userName={profile.username}
        compactMobile
        hideLogout
      >
        <section className="mx-auto w-full max-w-4xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-950">{activeAttempt.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {activeAttempt.subject || "未分科"} · {questions.length} 题
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                <Clock className="h-4 w-4" />
                {formatCountdown(remainingSeconds)}
              </div>
              <div className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                已开启切屏检测
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {questions.map((question) => (
              <QuestionAnswer
                key={question.question_id}
                question={question}
                value={answers[question.question_id] ?? ""}
                onChange={(value) => setAnswer(question.question_id, value)}
                imageMode={activeAttempt.submission_mode === "image_manual" || activeAttempt.submission_mode === "image_ai"}
                images={imageAnswers[question.question_id] ?? []}
                onImagesChange={(files) => void setQuestionImages(question.question_id, files)}
              />
            ))}
          </div>
          <button
            type="button"
            data-testid="student-submit-attempt"
            disabled={busy === "submit"}
            onClick={() => void submitActiveAttempt()}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
          >
            <Send className="h-4 w-4" />
            提交试卷
          </button>
          {message ? <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</div> : null}
        </section>
      </PlatformShell>
    );
  }

  return (
    <PlatformShell
      roleLabel="学生端"
      title={profile.display_name || profile.username}
      subtitle={mustChangePassword ? "首次登录需要先修改密码。" : "查看待答试卷、历史成绩和个人分析。"}
      userName={profile.username}
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
        ) : null}

        {activeView === "papers" && !mustChangePassword ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">待答试卷</h2>
                <p className="mt-1 text-sm text-slate-500">老师发布到你所在班级的线上试卷会显示在这里。</p>
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
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{paper.subject || "未分科"}</span>
                        <span>{paper.question_count} 题</span>
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
                        {result.score_percent ?? "-"}%
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
                    <StudentAnalysisVisual result={result} />
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
              <input
                data-testid="student-account-current-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="当前密码"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              {accountMode === "password" ? (
                <input
                  data-testid="student-account-new-password"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="新密码"
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
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
          </section>
        ) : null}
      </div>
    </PlatformShell>
  );
}

function StudentNavButton({
  selected,
  disabled,
  icon,
  label,
  testId,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:gap-2 sm:px-3 sm:py-3 sm:text-sm ${
        selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function StudentAnalysisVisual({ result }: { result: StudentResultRecord }) {
  const scorePercent = Math.max(0, Math.min(100, Number(result.score_percent ?? 0)));
  const answered = Math.max(0, Number(result.analysis?.answered_count ?? result.answers.length ?? 0));
  const correct = Math.max(0, Number(result.analysis?.correct_count ?? 0));
  const wrong = Math.max(0, Number(result.analysis?.wrong_count ?? 0));
  const correctPercent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const wrongPercent = answered > 0 ? Math.round((wrong / answered) * 100) : 0;
  const rows = [
    ["得分", scorePercent],
    ["正确率", correctPercent],
    ["错题占比", wrongPercent],
  ] as const;
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3" aria-label="学生个人分析图">
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[56px_minmax(0,1fr)_42px] items-center gap-2 text-xs">
            <span className="text-slate-500">{label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-900" style={{ width: `${value}%` }} />
            </div>
            <span className="text-right font-semibold text-slate-700">{value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionAnswer({
  question,
  value,
  onChange,
  imageMode,
  images,
  onImagesChange,
}: {
  question: StudentQuestionRecord;
  value: string;
  onChange: (value: string) => void;
  imageMode?: boolean;
  images?: StudentAnswerImage[];
  onImagesChange?: (files: FileList | null) => void;
}) {
  const options = question.options ? Object.entries(question.options) : [];
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{question.header}</span>
        <span>{question.section_id}</span>
        <span>{question.score_per_item} 分</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-950">{question.content}</p>
      {imageMode ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
          <input
            data-testid={`student-image-${question.question_id}`}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => onImagesChange?.(event.target.files)}
            className="block w-full text-sm text-slate-700"
          />
          {images && images.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {images.map((image) => (
                <span key={image.name} className="rounded bg-white px-2 py-1">
                  {image.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : options.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map(([key, text]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <input
                type="radio"
                name={`question-${question.question_id}`}
                value={key}
                checked={value === key}
                onChange={() => onChange(key)}
              />
              <span>
                {key}. {text}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          data-testid={`student-answer-${question.question_id}`}
          className="mt-3 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </article>
  );
}
