import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { resolveApiUrl } from "../../../api/client";
import { compressImageFileToDataUrl } from "../../../lib/imageCompression";
import { formatLocaleDateTime } from "../../../lib/locale";
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
} from "../../../platform/auth";
import { PlatformShell } from "../PlatformShell";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import { StudentNavButton, StudentAnalysisVisual, StudentResultDetails, QuestionAnswer } from "./StudentPanels";
import {
  acknowledgeStudentTextDraft, markStudentTextDraftSent, pendingStudentTextDraft, retainUnconfirmedStudentText,
  persistStudentTextDraft, restoreStudentTextDraft, studentDraftKey,
  type StudentDraftScope, type TextDraftIssue,
} from "./studentTextDraft";
import {
  acknowledgeStudentImageDraft, persistStudentImageDraft, restoreStudentImageDraft,
  retainUnconfirmedStudentImageDraft, type ImageDraftIssue,
} from "./studentImageDraft";

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
  const imageScopeRef = useRef<StudentDraftScope | null>(null);
  const imageBaselineRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageSentRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageConflictsRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const answersUrlRef = useRef<string | null>(null);
  const remainingBaselineRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const autoSubmitTriggeredRef = useRef(false);
  const answerRevisionRef = useRef(0);
  const draftSaveInFlightRef = useRef(false);
  const filePickerActiveRef = useRef(false);
  const textScopeRef = useRef<StudentDraftScope | null>(null);
  const textBaselineRef = useRef<Record<string, string>>({});
  const textSentRef = useRef<Record<string, string>>({});
  const textConflictsRef = useRef<Record<string, string>>({});
  const [textConflicts, setTextConflicts] = useState<Record<string, string>>({});
  const [textDraftIssue, setTextDraftIssue] = useState<TextDraftIssue>(null);
  const [localTextRestored, setLocalTextRestored] = useState(false);
  const [unconfirmedTexts, setUnconfirmedTexts] = useState<Record<string, { title: string; answers: Record<string, string>; issue: TextDraftIssue }>>({});
  const [imageDraftIssue, setImageDraftIssue] = useState<ImageDraftIssue>(null);
  const [imageDraftStored, setImageDraftStored] = useState(false);
  const [localImagesRestored, setLocalImagesRestored] = useState(false);
  const [imageConflicts, setImageConflicts] = useState<Record<string, StudentAnswerImage[]>>({});
  const [unconfirmedImages, setUnconfirmedImages] = useState<Record<string, { title: string; images: Record<string, StudentAnswerImage[]>; issue: ImageDraftIssue }>>({});

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
      const localSave = beginTextSave(questionsRef.current, answersRef.current);
      const localImageSave = beginImageSave(questionsRef.current, imageAnswersRef.current);
      void persistImages(imageAnswersRef.current, localImageSave.sent)
        .then(() => saveStudentAnswers(attempt.id, payload))
        .then(() => {
          confirmTextSave(localSave);
          void confirmImageSave(localImageSave);
          setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
        })
        .catch(() => setSaveStatus("error"))
        .finally(() => { draftSaveInFlightRef.current = false; });
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
      const scope: StudentDraftScope = {
        accountId: user.id, projectScope: data.attempt.project_scope ?? "",
        publicationId: data.attempt.publication_id, attemptId: data.attempt.id,
        snapshotVersion: data.attempt.snapshot_version ?? "",
      };
      textScopeRef.current = studentDraftKey(scope) ? scope : null;
      imageScopeRef.current = textScopeRef.current ? scope : null;
      textBaselineRef.current = restoredAnswers;
      textSentRef.current = {};
      imageBaselineRef.current = restoredImages;
      imageSentRef.current = {};
      const local = textScopeRef.current && data.attempt.status === "in_progress"
        ? restoreStudentTextDraft(scope, restoredAnswers, data.questions.map((item) => item.question_id))
        : { answers: restoredAnswers, conflicts: {}, restored: false, issue: textScopeRef.current ? null : "unavailable" as const };
      const localImages = imageScopeRef.current && data.attempt.status === "in_progress"
        ? await restoreStudentImageDraft(scope, restoredImages, data.questions.map((item) => item.question_id))
        : { images: restoredImages, conflicts: {}, restored: false, issue: null as ImageDraftIssue };
      textConflictsRef.current = local.conflicts;
      setTextConflicts(local.conflicts);
      setTextDraftIssue(local.issue);
      setLocalTextRestored(local.restored);
      answersRef.current = local.answers;
      setAnswers(local.answers);
      imageAnswersRef.current = localImages.images;
      imageConflictsRef.current = localImages.conflicts;
      setImageAnswers(localImages.images);
      setImageConflicts(localImages.conflicts);
      setImageDraftIssue(localImages.issue);
      setLocalImagesRestored(localImages.restored);
      setImageDraftStored(localImages.restored);
      setSaveStatus(local.restored || localImages.restored ? "dirty" : (data.saved_answers?.length ?? 0) > 0 ? "restored" : "saved");
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
    const next = { ...answersRef.current, [questionId]: value };
    const conflicts = { ...textConflictsRef.current };
    delete conflicts[questionId];
    textConflictsRef.current = conflicts;
    setTextConflicts(conflicts);
    answersRef.current = next;
    setAnswers(next);
    persistTextAnswers(next);
    setSaveStatus("dirty");
  }

  function persistTextAnswers(next: Record<string, string>) {
    const scope = textScopeRef.current;
    if (scope) setTextDraftIssue(persistStudentTextDraft(scope, next, textBaselineRef.current, textSentRef.current, undefined, Object.keys(textConflictsRef.current)));
  }

  function beginTextSave(sourceQuestions: StudentQuestionRecord[], sourceAnswers: Record<string, string>) {
    const scope = textScopeRef.current;
    const sent = Object.fromEntries(sourceQuestions.filter((item) => !Object.prototype.hasOwnProperty.call(textConflictsRef.current, item.question_id))
      .map((item) => [item.question_id, sourceAnswers[item.question_id] ?? ""]));
    textSentRef.current = sent;
    if (scope) setTextDraftIssue(markStudentTextDraftSent(scope, sent));
    return { scope, sent };
  }

  function confirmTextSave(localSave: ReturnType<typeof beginTextSave>) {
    if (!localSave.scope) return;
    const issue = acknowledgeStudentTextDraft(localSave.scope, localSave.sent);
    if (textScopeRef.current && studentDraftKey(textScopeRef.current) === studentDraftKey(localSave.scope)) {
      textBaselineRef.current = { ...textBaselineRef.current, ...localSave.sent };
      textSentRef.current = {};
      setTextDraftIssue(issue);
      if (Object.entries(answersRef.current).every(([id, value]) => localSave.sent[id] === value)) setLocalTextRestored(false);
    }
  }

  function beginImageSave(sourceQuestions: StudentQuestionRecord[], sourceImages: Record<string, StudentAnswerImage[]>): {
    scope: StudentDraftScope | null; sent: Record<string, StudentAnswerImage[]>;
  } {
    const sent = Object.fromEntries(sourceQuestions.map((question) => [
      question.question_id, (sourceImages[question.question_id] ?? []).map((image) => ({ ...image })),
    ]));
    imageSentRef.current = sent;
    return { scope: imageScopeRef.current, sent };
  }

  async function confirmImageSave(localSave: ReturnType<typeof beginImageSave>): Promise<ImageDraftIssue> {
    if (!localSave.scope) return "unavailable";
    imageBaselineRef.current = { ...imageBaselineRef.current, ...localSave.sent };
    imageSentRef.current = {};
    const issue = await acknowledgeStudentImageDraft(localSave.scope, localSave.sent);
    setImageDraftIssue(issue);
    const pending = hasPendingImageDraft(imageAnswersRef.current, imageBaselineRef.current);
    setImageDraftStored(issue === null && pending);
    if (!pending) setLocalImagesRestored(false);
    return issue;
  }

  function recoverConflictingText() {
    const next = { ...answersRef.current, ...textConflictsRef.current };
    textConflictsRef.current = {};
    setTextConflicts({});
    answersRef.current = next;
    setAnswers(next);
    answerRevisionRef.current += 1;
    persistTextAnswers(next);
    setLocalTextRestored(true);
    setSaveStatus("dirty");
  }

  function readImageFile(file: File): Promise<StudentAnswerImage> {
    return compressImageFileToDataUrl(file);
  }

  async function setQuestionImages(questionId: string, files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length > 10) {
      setMessage("每题最多上传 10 张图片；本次选择未加入。");
      return;
    }
    let images: StudentAnswerImage[];
    try { images = await Promise.all(selected.map(readImageFile)); }
    catch (error) {
      setMessage(error instanceof Error ? `读取图片失败：${error.message}` : "读取图片失败");
      return;
    }
    if (images.some((image) => image.data_url.length > 5_000_000)) {
      setMessage("图片超过服务器允许的大小；本次选择未加入。");
      return;
    }
    answerRevisionRef.current += 1;
    const next = { ...imageAnswersRef.current };
    if (images.length) next[questionId] = images;
    else delete next[questionId];
    imageAnswersRef.current = next;
    setImageAnswers(next);
    const conflicts = { ...imageConflictsRef.current };
    delete conflicts[questionId];
    imageConflictsRef.current = conflicts;
    setImageConflicts(conflicts);
    setSaveStatus("dirty");
    const issue = await persistImages(next, imageSentRef.current);
    setImageDraftStored(issue === null && hasPendingImageDraft(next, imageBaselineRef.current));
    setLocalImagesRestored(false);
  }

  function cloneImages(images: Record<string, StudentAnswerImage[]>): Record<string, StudentAnswerImage[]> {
    return Object.fromEntries(Object.entries(images).map(([id, value]) => [id, value.map((image) => ({ ...image }))]));
  }

  function hasPendingImageDraft(current: Record<string, StudentAnswerImage[]>, baseline: Record<string, StudentAnswerImage[]>): boolean {
    const ids = new Set([...Object.keys(current), ...Object.keys(baseline)]);
    return [...ids].some((id) => JSON.stringify(current[id] ?? []) !== JSON.stringify(baseline[id] ?? []));
  }

  async function persistImages(current: Record<string, StudentAnswerImage[]>, sent: Record<string, StudentAnswerImage[]> = {}): Promise<ImageDraftIssue> {
    const scope = imageScopeRef.current;
    if (!scope) {
      setImageDraftIssue("unavailable");
      return "unavailable";
    }
    const issue = await persistStudentImageDraft(
      scope, current, imageBaselineRef.current, sent, Object.keys(imageConflictsRef.current),
    );
    setImageDraftIssue(issue);
    return issue;
  }

  function recoverConflictingImages() {
    const next = { ...imageAnswersRef.current, ...imageConflictsRef.current };
    imageAnswersRef.current = next;
    setImageAnswers(next);
    imageConflictsRef.current = {};
    setImageConflicts({});
    answerRevisionRef.current += 1;
    setSaveStatus("dirty");
    void persistImages(next, imageSentRef.current).then((issue) => {
      setImageDraftStored(issue === null && hasPendingImageDraft(next, imageBaselineRef.current));
    });
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
    beginTextSave(questionsRef.current, answersRef.current);
    const localImageSave = beginImageSave(questionsRef.current, imageAnswersRef.current);
    void persistImages(imageAnswersRef.current, localImageSave.sent);
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
    const localSave = beginTextSave(questions, answers);
    const localImageSave = beginImageSave(questions, imageAnswers);
    setSaveStatus("saving");
    try {
      await persistImages(imageAnswers, localImageSave.sent);
      await saveStudentAnswers(activeAttempt.id, buildAnswerPayload(questions, answers, imageAnswers));
      confirmTextSave(localSave);
      await confirmImageSave(localImageSave);
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
    const submittedScope = textScopeRef.current;
    const submittedText = Object.fromEntries(questions.map((question) => [question.question_id, answers[question.question_id] ?? ""]));
    const submittedImages = cloneImages(imageAnswersRef.current);
    const localImageSave = beginImageSave(questions, submittedImages);
    const submittedConflicts = { ...textConflictsRef.current };
    const submittedImageConflicts = { ...imageConflictsRef.current };
    try {
      const payload = buildAnswerPayload(questions, answers, imageAnswers);
      await persistImages(submittedImages, localImageSave.sent);
      const result = await submitStudentAttempt(activeAttempt.id, { time_spent_seconds: elapsedSeconds(), answers: payload });
      const accepted = result.attempt.submitted_answers_accepted === true;
      const latestImages = imageScopeRef.current && localImageSave.scope &&
        studentDraftKey(imageScopeRef.current) === studentDraftKey(localImageSave.scope)
        ? cloneImages(imageAnswersRef.current) : submittedImages;
      const latestImagesWithConflicts = { ...latestImages, ...submittedImageConflicts };
      let retained = false;
      if (submittedScope) {
        let issue: TextDraftIssue;
        if (result.attempt.submitted_answers_accepted === true) {
          const confirmedText = Object.fromEntries(Object.entries(submittedText).filter(([id]) => !Object.prototype.hasOwnProperty.call(submittedConflicts, id)));
          issue = acknowledgeStudentTextDraft(submittedScope, confirmedText);
        } else {
          issue = retainUnconfirmedStudentText(submittedScope, submittedText);
        }
        const latest = textScopeRef.current && studentDraftKey(textScopeRef.current) === studentDraftKey(submittedScope)
          ? answersRef.current : submittedText;
        const unsent = result.attempt.submitted_answers_accepted === true
          ? Object.fromEntries(Object.entries(latest).filter(([id, value]) => value !== submittedText[id]))
          : latest;
        const pending = { ...pendingStudentTextDraft(submittedScope), ...unsent, ...submittedConflicts };
        const scopeKey = studentDraftKey(submittedScope)!;
        retained = Object.keys(pending).length > 0;
        setUnconfirmedTexts((current) => {
          const next = { ...current };
          if (retained) next[scopeKey] = { title: activeAttempt.title, answers: pending, issue };
          else delete next[scopeKey];
          return next;
        });
      } else {
        const latest = activeAttemptRef.current?.id === activeAttempt.id ? answersRef.current : submittedText;
        const pending = result.attempt.submitted_answers_accepted === true
          ? Object.fromEntries(Object.entries(latest).filter(([id, value]) => value !== submittedText[id]))
          : latest;
        retained = Object.keys(pending).length > 0;
        if (retained) setUnconfirmedTexts((current) => ({
          ...current,
          [`unscoped:${user.id}:${activeAttempt.id}`]: { title: activeAttempt.title, answers: pending, issue: "unavailable" },
        }));
      }
      let imageIssue: ImageDraftIssue = "unavailable";
      if (localImageSave.scope) {
        imageIssue = accepted
          ? await confirmImageSave(localImageSave)
          : await retainUnconfirmedStudentImageDraft(localImageSave.scope, submittedImages, latestImagesWithConflicts);
      }
      const unconfirmedImageValues = accepted
        ? Object.fromEntries(Object.entries(latestImagesWithConflicts).filter(([id, value]) => JSON.stringify(value) !== JSON.stringify(submittedImages[id] ?? [])))
        : Object.fromEntries(Object.entries(submittedImages).filter(([, value]) => value.length > 0));
      if (Object.keys(unconfirmedImageValues).length) {
        retained = true;
        const key = localImageSave.scope ? studentDraftKey(localImageSave.scope)! : `unscoped:${user.id}:${activeAttempt.id}`;
        setUnconfirmedImages((current) => ({
          ...current, [key]: { title: activeAttempt.title, images: unconfirmedImageValues, issue: imageIssue },
        }));
      }
      textScopeRef.current = null;
      imageScopeRef.current = null;
      setTextConflicts({});
      textConflictsRef.current = {};
      setImageConflicts({});
      imageConflictsRef.current = {};
      setLocalTextRestored(false);
      setLocalImagesRestored(false);
      setTextDraftIssue(null);
      setImageDraftIssue(null);
      setActiveAttempt(null);
      setQuestions([]);
      setAnswers({});
      setImageAnswers({});
      imageAnswersRef.current = {};
      setRemainingSeconds(null);
      setSaveStatus("saved");
      setSubmitReviewOpen(false);
      startedAtRef.current = null;
      await refresh();
      setMessage(retained ? "试卷已提交；未确认的本机作答仍保留，可在下方查看。" : "试卷已提交");
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
          {localTextRestored ? <p className="mb-3 text-sm text-amber-800" role="status">已恢复本机文本草稿，等待保存到服务器。</p> : null}
          {localImagesRestored ? <p className="mb-3 text-sm text-amber-800" role="status">已恢复本机图片草稿，等待保存到服务器。</p> : null}
          {Object.keys(textConflicts).length ? <div className="mb-3 text-sm text-amber-800" role="status">
            服务器答案已有其他更新，本机文本草稿仍保留。
            <button type="button" onClick={recoverConflictingText} className="ml-2 underline">恢复本机文本草稿</button>
          </div> : null}
          {textDraftIssue ? <p className="mb-3 text-sm text-amber-800" role="status">本机文本草稿暂不可用，请及时保存到服务器。</p> : null}
          {Object.keys(imageConflicts).length ? <div className="mb-3 text-sm text-amber-800" role="status">
            服务器图片答案已有其他更新，本机图片草稿仍保留。
            <button type="button" onClick={recoverConflictingImages} className="ml-2 underline">恢复本机图片草稿</button>
          </div> : null}
          {imageDraftIssue === "unavailable" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片存储暂不可用，图片只保留在当前页面；请及时保存到服务器。</p> : null}
          {imageDraftIssue === "too_large" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片草稿超过 20 MB 限额，未能暂存；请及时保存到服务器。</p> : null}
          {imageDraftIssue === "corrupt" ? <p className="mb-3 text-sm text-amber-800" role="status">本机图片草稿损坏，未自动恢复；请检查图片后保存到服务器。</p> : null}
          {imageDraftStored && !imageDraftIssue ? <p className="mb-3 text-sm text-slate-600" role="status">图片已暂存在本机，尚未确认保存到服务器。</p> : null}
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
              {Object.entries(unconfirmedTexts).map(([key, entry]) => <details key={key} className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <summary>查看未确认的本机文本：{entry.title}</summary>
                {entry.issue ? <p className="mt-2">本机存储暂不可用，请在离开本页前复制以下文本。</p> : null}
                <pre className="mt-2 whitespace-pre-wrap break-words">{Object.entries(entry.answers).map(([id, value]) => `${id}: ${value || "（空答案）"}`).join("\n")}</pre>
              </details>)}
              {Object.entries(unconfirmedImages).map(([key, entry]) => <details key={key} className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <summary>查看未确认的本机图片：{entry.title}</summary>
                {entry.issue ? <p className="mt-2">本机图片存储不可用或提交未确认；图片只在当前页面内存中保留。</p> : null}
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
