import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  Home,
  RefreshCw,
  Save,
  Send,
  UserCog,
} from "lucide-react";
import { resolveApiUrl } from "../../api/client";
import { ContentWithPrimeBrush as KatexText } from "../../components/ContentWithPrimeBrush";
import { compressImageFileToDataUrl } from "../../lib/imageCompression";
import { formatLocaleDateTime } from "../../lib/locale";
import {
  loadSessionToken,
  updateAccountProfile,
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
import { GettingStartedChecklist } from "./GettingStartedChecklist";

type Props = {
  user: PlatformUser;
  onLogout: () => void;
};

type StudentView = "home" | "papers" | "results" | "account" | "exam";
type AccountMode = "password" | "username";
type SaveStatus = "saved" | "dirty" | "saving" | "error" | "restored";

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
  const [activeAttempt, setActiveAttempt] = useState<StudentAttemptRecord | null>(null);
  const [questions, setQuestions] = useState<StudentQuestionRecord[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [imageAnswers, setImageAnswers] = useState<Record<string, StudentAnswerImage[]>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(true);
  const [submitReviewOpen, setSubmitReviewOpen] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const activeAttemptRef = useRef<StudentAttemptRecord | null>(null);
  const questionsRef = useRef<StudentQuestionRecord[]>([]);
  const answersRef = useRef<Record<string, string>>({});
  const imageAnswersRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const answersUrlRef = useRef<string | null>(null);
  const remainingBaselineRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const autoSubmitTriggeredRef = useRef(false);
  const answerRevisionRef = useRef(0);
  const draftSaveInFlightRef = useRef(false);
  const filePickerActiveRef = useRef(false);

  const pendingPapers = useMemo(
    () => papers.filter((paper) => paper.status !== "submitted" && paper.status !== "completed"),
    [papers],
  );
  const latestResult = results[0] ?? null;
  const mustChangePassword = Boolean(profile.must_change_password);
  const answeredCount = useMemo(() => {
    if (!activeAttempt) return 0;
    return questions.filter(
      (question) =>
        Boolean((answers[question.question_id] ?? "").trim()) ||
        (imageAnswers[question.question_id]?.length ?? 0) > 0,
    ).length;
  }, [activeAttempt, answers, imageAnswers, questions]);

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
      void Promise.resolve(
        recordStudentProctorEvent(attemptId, {
          event_type: eventType,
          duration_ms: durationMs ?? null,
          payload: payload ?? null,
        }),
      ).catch(() => {
        /* best effort proctor event */
      });
    };
    const onVisibilityChange = () => {
      if (filePickerActiveRef.current) {
        hiddenAtRef.current = null;
        return;
      }
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        sendEvent("visibility_hidden", 0, { source: "visibilitychange", phase: "hidden" });
        return;
      }
      if (hiddenAtRef.current != null) {
        const duration = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        sendEvent("visibility_return", duration, { source: "visibilitychange", phase: "visible" });
      }
    };
    const onPageHide = () => {
      if (!filePickerActiveRef.current) sendEvent("visibility_hidden", 0, { source: "pagehide", phase: "hidden" });
    };
    const onBlur = () => {
      if (!filePickerActiveRef.current) sendEvent("window_blur", 0, { source: "window.blur" });
    };
    const onFocus = () => {
      window.setTimeout(() => {
        filePickerActiveRef.current = false;
      }, 0);
    };
    const onCopy = () => sendEvent("copy", 0, { source: "document.copy" });
    const onPaste = () => sendEvent("paste", 0, { source: "document.paste" });
    const onContextMenu = () => sendEvent("context_menu", 0, { source: "document.contextmenu" });
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) sendEvent("fullscreen_exit", 0, { source: "fullscreenchange" });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
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
      setRemainingSeconds(null);
      return;
    }
    void resolveApiUrl(`/api/student/attempts/${encodeURIComponent(activeAttempt.id)}/answers`).then((answersUrl) => {
      if (activeAttemptRef.current?.id === activeAttempt.id) {
        answersUrlRef.current = answersUrl;
      }
    });
    const serverRemaining = activeAttempt.remaining_seconds;
    const limitMinutes = Number(activeAttempt.time_limit_minutes || 0);
    const initialRemaining = serverRemaining ?? (limitMinutes > 0 ? limitMinutes * 60 : null);
    remainingBaselineRef.current = initialRemaining;
    setRemainingSeconds(initialRemaining);
  }, [activeAttempt]);

  useEffect(() => {
    const limitMinutes = Number(activeAttempt?.time_limit_minutes || 0);
    if (!activeAttempt || activeAttempt.status !== "in_progress" || limitMinutes <= 0) {
      return;
    }
    const tick = () => {
      const elapsed = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
      const next = Math.max(0, Number(remainingBaselineRef.current ?? limitMinutes * 60) - elapsed);
      setRemainingSeconds(next);
      if (next <= 0 && !autoSubmitTriggeredRef.current) {
        autoSubmitTriggeredRef.current = true;
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
      saveAttemptBestEffort();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      if (saveStatus !== "dirty" || draftSaveInFlightRef.current) return;
      const attempt = activeAttemptRef.current;
      if (!attempt) return;
      draftSaveInFlightRef.current = true;
      const revision = answerRevisionRef.current;
      setSaveStatus("saving");
      const payload = buildAnswerPayload(questionsRef.current, answersRef.current, imageAnswersRef.current);
      void saveStudentAnswers(attempt.id, payload)
        .then(() => setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty"))
        .catch(() => setSaveStatus("error"))
        .finally(() => {
          draftSaveInFlightRef.current = false;
        });
    }, 30_000);
    return () => window.clearInterval(timer);
    // buildAnswerPayload only reads refs; restarting the timer on every keypress is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttempt?.id, activeAttempt?.status, saveStatus]);

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
      setActiveAttempt(data.attempt);
      setQuestions(data.questions);
      const restoredAnswers: Record<string, string> = {};
      const restoredImages: Record<string, StudentAnswerImage[]> = {};
      for (const item of data.saved_answers ?? []) {
        if (item.answer !== null && item.answer !== undefined) restoredAnswers[item.question_id] = String(item.answer);
        if (item.images?.length) restoredImages[item.question_id] = item.images;
      }
      setAnswers(restoredAnswers);
      setImageAnswers(restoredImages);
      setSaveStatus((data.saved_answers?.length ?? 0) > 0 ? "restored" : "saved");
      setSubmitReviewOpen(false);
      answerRevisionRef.current = 0;
      autoSubmitTriggeredRef.current = false;
      startedAtRef.current = Date.now();
      remainingBaselineRef.current = data.attempt.remaining_seconds ?? null;
      setRemainingSeconds(data.attempt.remaining_seconds ?? null);
      setActiveView("exam");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function setAnswer(questionId: string, value: string) {
    answerRevisionRef.current += 1;
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setSaveStatus("dirty");
  }

  function readImageFile(file: File): Promise<StudentAnswerImage> {
    return compressImageFileToDataUrl(file);
  }

  async function setQuestionImages(questionId: string, files: FileList | null) {
    const selected = Array.from(files ?? []);
    const images = await Promise.all(selected.map(readImageFile));
    answerRevisionRef.current += 1;
    setImageAnswers((current) => ({ ...current, [questionId]: images }));
    setSaveStatus("dirty");
  }

  function buildAnswerPayload(
    sourceQuestions: StudentQuestionRecord[],
    sourceAnswers: Record<string, string>,
    sourceImageAnswers: Record<string, StudentAnswerImage[]>,
  ) {
    return sourceQuestions.map((question) => ({
      question_id: question.question_id,
      answer: sourceAnswers[question.question_id] ?? "",
      images: sourceImageAnswers[question.question_id] ?? [],
    }));
  }

  function elapsedSeconds(): number | null {
    return startedAtRef.current ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) : null;
  }

  function saveAttemptBestEffort() {
    const attempt = activeAttemptRef.current;
    if (!attempt || attempt.status !== "in_progress") return;
    const token = loadSessionToken();
    const answersUrl = answersUrlRef.current;
    if (!token || !answersUrl) return;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const payload = buildAnswerPayload(questionsRef.current, answersRef.current, imageAnswersRef.current);
    void fetch(answersUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ answers: payload }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function saveActiveDraft() {
    if (!activeAttempt || draftSaveInFlightRef.current) return;
    draftSaveInFlightRef.current = true;
    const revision = answerRevisionRef.current;
    setSaveStatus("saving");
    try {
      await saveStudentAnswers(activeAttempt.id, buildAnswerPayload(questions, answers, imageAnswers));
      setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
    } catch (e) {
      setSaveStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      draftSaveInFlightRef.current = false;
    }
  }

  async function submitActiveAttempt() {
    if (!activeAttempt) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setBusy("submit");
    setMessage(null);
    try {
      const payload = buildAnswerPayload(questions, answers, imageAnswers);
      await submitStudentAttempt(activeAttempt.id, { time_spent_seconds: elapsedSeconds(), answers: payload });
      setActiveAttempt(null);
      setQuestions([]);
      setAnswers({});
      setImageAnswers({});
      setRemainingSeconds(null);
      setSaveStatus("saved");
      setSubmitReviewOpen(false);
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
              <p className="mt-2 text-sm font-medium text-slate-700">已作答 {answeredCount} / {questions.length}</p>
              <p className="mt-1 text-xs text-slate-500" role="status">
                {saveStatus === "restored"
                  ? "草稿已恢复"
                  : saveStatus === "dirty"
                    ? "有未保存修改"
                    : saveStatus === "saving"
                      ? "正在保存草稿…"
                      : saveStatus === "error"
                        ? "草稿保存失败，请重试"
                        : "草稿已保存"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                <Clock className="h-4 w-4" />
                {formatCountdown(remainingSeconds)}
              </div>
              <div className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                已记录切屏、复制粘贴、右键与退出全屏；选择答题图片不会计为切屏
              </div>
            </div>
          </div>
          <nav className="mb-4 flex flex-wrap gap-2" aria-label="答题导航">
            {questions.map((question, index) => (
              <a
                key={question.question_id}
                href={`#student-question-${index + 1}`}
                className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold ${
                  (Boolean((answers[question.question_id] ?? "").trim()) ||
                    (imageAnswers[question.question_id]?.length ?? 0) > 0)
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                {index + 1}
              </a>
            ))}
          </nav>
          <div className="space-y-4">
            {questions.map((question, index) => (
              <QuestionAnswer
                key={question.question_id}
                anchorId={`student-question-${index + 1}`}
                question={question}
                value={answers[question.question_id] ?? ""}
                onChange={(value) => setAnswer(question.question_id, value)}
                imageMode={activeAttempt.submission_mode === "image_manual" || activeAttempt.submission_mode === "image_ai"}
                images={imageAnswers[question.question_id] ?? []}
                onImagesChange={(files) => void setQuestionImages(question.question_id, files)}
                onFileDialogOpen={() => {
                  filePickerActiveRef.current = true;
                }}
                onFileDialogClose={() => {
                  window.setTimeout(() => {
                    filePickerActiveRef.current = false;
                  }, 0);
                }}
              />
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-testid="student-save-draft"
              disabled={saveStatus === "saving"}
              onClick={() => void saveActiveDraft()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
            >
              <Save className="h-4 w-4" />
              保存草稿
            </button>
            <button
              type="button"
              data-testid="student-submit-attempt"
              disabled={busy === "submit"}
              onClick={() => setSubmitReviewOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
            >
              <Send className="h-4 w-4" />
              提交试卷
            </button>
          </div>
          {message ? <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</div> : null}
        </section>
        {submitReviewOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="提交前确认">
            <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
              <h2 className="text-lg font-semibold text-slate-950">提交前确认</h2>
              <p className="mt-1 text-sm text-slate-600">提交后不能撤回，请核对答题进度。</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-emerald-50 p-4">
                  <p className="text-xs text-emerald-700">答题进度</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-900">已答 {answeredCount} 题</p>
                </div>
                <div className={`rounded-lg p-4 ${questions.length - answeredCount > 0 ? "bg-rose-50" : "bg-slate-50"}`}>
                  <p className={`text-xs ${questions.length - answeredCount > 0 ? "text-rose-700" : "text-slate-600"}`}>需要检查</p>
                  <p className={`mt-1 text-lg font-semibold ${questions.length - answeredCount > 0 ? "text-rose-900" : "text-slate-900"}`}>未答 {Math.max(0, questions.length - answeredCount)} 题</p>
                </div>
              </div>
              <dl className="mt-4 space-y-2 rounded-lg border border-slate-200 p-4 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">草稿状态</dt><dd className="text-right font-medium text-slate-800">{saveStatus === "dirty" ? "有未保存修改，将随提交一并保存" : saveStatus === "saving" ? "草稿正在保存，提交时会携带最新答案" : saveStatus === "error" ? "草稿保存失败，但提交时会携带当前答案" : saveStatus === "restored" ? "草稿已恢复，可安全提交" : "草稿已保存，可安全提交"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">剩余时间</dt><dd className="font-medium text-slate-800">{formatCountdown(remainingSeconds)}</dd></div>
              </dl>
              {questions.length - answeredCount > 0 ? <p className="mt-4 text-sm font-medium text-rose-700">还有未答题，建议返回检查后再提交。</p> : null}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setSubmitReviewOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">继续检查</button>
                <button type="button" disabled={busy === "submit"} onClick={() => { setSubmitReviewOpen(false); void submitActiveAttempt(); }} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">确认提交</button>
              </div>
            </section>
          </div>
        ) : null}
      </PlatformShell>
    );
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

function StudentResultDetails({ result }: { result: StudentResultRecord }) {
  const [wrongOnly, setWrongOnly] = useState(false);
  const reviewAnswers = wrongOnly ? result.answers.filter((answer) => answer.is_correct === false) : result.answers;
  const sections = new Map<string, { score: number; max: number; count: number }>();
  result.answers.forEach((answer) => {
    const section = answer.section_id || "其他";
    const item = sections.get(section) ?? { score: 0, max: 0, count: 0 };
    item.score += Number(answer.score || 0);
    item.max += Number(answer.score_per_item || 0);
    item.count += 1;
    sections.set(section, item);
  });
  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from(sections.entries()).map(([section, item]) => (
          <div key={section} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">{section}</p>
            <p className="mt-1">{item.count} 题 · {item.max > 0 ? `${Math.round((item.score / item.max) * 100)}%` : "暂无得分率"}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">平均每题用时：{result.analysis?.average_time_per_question_seconds ?? 0} 秒</p>
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">逐题复盘</p>
          <button type="button" onClick={() => setWrongOnly((value) => !value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {wrongOnly ? "查看全部题目" : "只看错题"}
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {reviewAnswers.map((answer, index) => (
            <article key={answer.question_id} className={`rounded-lg border bg-white p-4 text-sm ${answer.is_correct === false ? "border-rose-200" : answer.is_correct === true ? "border-emerald-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{answer.header || `第 ${index + 1} 题`}</p>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${answer.is_correct === false ? "bg-rose-50 text-rose-700" : answer.is_correct === true ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {answer.is_correct === false ? "需订正" : answer.is_correct === true ? "回答正确" : "已评分"} · {answer.score ?? 0}/{answer.score_per_item ?? "-"} 分
                </span>
              </div>
              {answer.content ? <KatexText text={answer.content} className="mt-2 text-slate-800" /> : null}
              {answer.options ? <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">{Object.entries(answer.options).map(([key, text]) => <div key={key}><b>{key}.</b> <KatexText text={text} className="inline" /></div>)}</div> : null}
              <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
                <p>我的答案：{String(answer.answer ?? "未作答")}</p>
                <p>正确答案：{String(answer.correct_answer ?? "以教师批改为准")}</p>
              </div>
              {answer.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{answer.images.map((image) => <img key={image.name} src={image.data_url} alt={`答题图片 ${image.name}`} className="h-24 max-w-40 rounded border border-slate-200 object-contain" />)}</div> : null}
              {answer.analysis ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900"><b>题目解析：</b><KatexText text={answer.analysis} className="mt-1" /></div> : null}
              {answer.feedback ? <p className="mt-3 rounded-md bg-blue-50 p-3 text-xs text-blue-800">教师评语：<span>{answer.feedback}</span></p> : null}
            </article>
          ))}
          {reviewAnswers.length === 0 ? <p className="py-3 text-center text-xs text-slate-500">本次没有已确认错题。</p> : null}
        </div>
      </div>
    </div>
  );
}

function QuestionAnswer({
  question,
  anchorId,
  value,
  onChange,
  imageMode,
  images,
  onImagesChange,
  onFileDialogOpen,
  onFileDialogClose,
}: {
  question: StudentQuestionRecord;
  anchorId?: string;
  value: string;
  onChange: (value: string) => void;
  imageMode?: boolean;
  images?: StudentAnswerImage[];
  onImagesChange?: (files: FileList | null) => void;
  onFileDialogOpen?: () => void;
  onFileDialogClose?: () => void;
}) {
  const options = question.options ? Object.entries(question.options) : [];
  return (
    <article id={anchorId} className="scroll-mt-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{question.header}</span>
        <span>{question.section_id}</span>
        <span>{question.score_per_item} 分</span>
      </div>
      <KatexText text={question.content} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-950" />
      {imageMode ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
          <input
            data-testid={`student-image-${question.question_id}`}
            type="file"
            accept="image/*"
            multiple
            onClick={() => onFileDialogOpen?.()}
            onChange={(event) => {
              onImagesChange?.(event.target.files);
              onFileDialogClose?.();
            }}
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
                type={question.type === "multiple_choice" ? "checkbox" : "radio"}
                name={`question-${question.question_id}`}
                value={key}
                aria-label={`${key}. ${text}`}
                checked={question.type === "multiple_choice" ? value.includes(key) : value === key}
                onChange={() => {
                  if (question.type !== "multiple_choice") {
                    onChange(key);
                    return;
                  }
                  const optionKeys = options.map(([optionKey]) => optionKey);
                  const selected = new Set(optionKeys.filter((optionKey) => value.includes(optionKey)));
                  if (selected.has(key)) selected.delete(key);
                  else selected.add(key);
                  onChange(optionKeys.filter((optionKey) => selected.has(optionKey)).join(""));
                }}
              />
              <span className="flex min-w-0 items-baseline gap-1">
                <span>{key}.</span>
                <KatexText text={text} className="min-w-0" />
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <textarea
            data-testid={`student-answer-${question.question_id}`}
            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="可输入文字、公式说明，也可以在下方上传手写过程图片"
          />
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">上传答题图片（可多张）</p>
            <input
              data-testid={`student-image-${question.question_id}`}
              type="file"
              accept="image/*"
              multiple
              onClick={() => onFileDialogOpen?.()}
              onChange={(event) => {
                onImagesChange?.(event.target.files);
                onFileDialogClose?.();
              }}
              className="block w-full text-sm text-slate-700"
            />
            {images && images.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {images.map((image) => <span key={image.name} className="rounded bg-white px-2 py-1">{image.name}</span>)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
