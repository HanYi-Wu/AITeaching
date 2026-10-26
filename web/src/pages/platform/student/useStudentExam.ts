import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveApiUrl } from "../../../api/client";
import { compressImageFileToDataUrl } from "../../../lib/imageCompression";
import {
  loadSessionToken, recordStudentProctorEvent, saveStudentAnswers, submitStudentAttempt,
  type PlatformUser, type StudentAnswerImage, type StudentAttemptRecord, type StudentQuestionRecord,
} from "../../../platform/auth";
import {
  acknowledgeStudentTextDraft, markStudentTextDraftSent, pendingStudentTextDraft, retainUnconfirmedStudentText,
  persistStudentTextDraft, restoreStudentTextDraft, studentDraftKey,
  type StudentDraftScope, type TextDraftIssue,
} from "./studentTextDraft";
import {
  acknowledgeStudentImageDraft, persistStudentImageDraft, restoreStudentImageDraft,
  retainUnconfirmedStudentImageDraft, type ImageDraftIssue,
} from "./studentImageDraft";

type SaveStatus = "saved" | "dirty" | "saving" | "error" | "restored";
type StudentExamStart = {
  attempt: StudentAttemptRecord;
  questions: StudentQuestionRecord[];
  saved_answers?: Array<{ question_id: string; answer?: unknown; images?: StudentAnswerImage[] }>;
};
type UnconfirmedText = { title: string; answers: Record<string, string>; issue: TextDraftIssue };
type UnconfirmedImages = { title: string; images: Record<string, StudentAnswerImage[]>; issue: ImageDraftIssue };
type ImageSubmissionSnapshot = {
  attemptId: string;
  title: string;
  scope: StudentDraftScope | null;
  submitted: Record<string, StudentAnswerImage[]>;
  latest: Record<string, StudentAnswerImage[]>;
  accepted: boolean;
  issue: ImageDraftIssue;
};
type StudentExamCallbacks = {
  user: PlatformUser;
  onMessage: (message: string | null) => void;
  onSubmitted: (message: string) => Promise<void> | void;
};

export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return "不限时";
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function useStudentExam({ user, onMessage, onSubmitted }: StudentExamCallbacks) {
  const [activeAttempt, setActiveAttempt] = useState<StudentAttemptRecord | null>(null);
  const [questions, setQuestions] = useState<StudentQuestionRecord[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [imageAnswers, setImageAnswers] = useState<Record<string, StudentAnswerImage[]>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [submitReviewOpen, setSubmitReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [textConflicts, setTextConflicts] = useState<Record<string, string>>({});
  const [textDraftIssue, setTextDraftIssue] = useState<TextDraftIssue>(null);
  const [localTextRestored, setLocalTextRestored] = useState(false);
  const [unconfirmedTexts, setUnconfirmedTexts] = useState<Record<string, UnconfirmedText>>({});
  const [imageDraftIssue, setImageDraftIssue] = useState<ImageDraftIssue>(null);
  const [imageDraftStored, setImageDraftStored] = useState(false);
  const [localImagesRestored, setLocalImagesRestored] = useState(false);
  const [imageConflicts, setImageConflicts] = useState<Record<string, StudentAnswerImage[]>>({});
  const [unconfirmedImages, setUnconfirmedImages] = useState<Record<string, UnconfirmedImages>>({});
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
  const pendingImageWorkRef = useRef<Promise<void>[]>([]);
  const textScopeRef = useRef<StudentDraftScope | null>(null);
  const imageScopeRef = useRef<StudentDraftScope | null>(null);
  const textBaselineRef = useRef<Record<string, string>>({});
  const textSentRef = useRef<Record<string, string>>({});
  const textConflictsRef = useRef<Record<string, string>>({});
  const imageBaselineRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageSentRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageConflictsRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageSubmissionRef = useRef<ImageSubmissionSnapshot | null>(null);

  useEffect(() => {
    activeAttemptRef.current = activeAttempt;
    questionsRef.current = questions;
    answersRef.current = answers;
    imageAnswersRef.current = imageAnswers;
  }, [activeAttempt, answers, imageAnswers, questions]);

  const open = useCallback(async (data: StudentExamStart) => {
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
    imageSubmissionRef.current = null;
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
    imageConflictsRef.current = localImages.conflicts;
    answersRef.current = local.answers;
    imageAnswersRef.current = localImages.images;
    questionsRef.current = data.questions;
    activeAttemptRef.current = data.attempt;
    setActiveAttempt(data.attempt);
    setQuestions(data.questions);
    setAnswers(local.answers);
    setImageAnswers(localImages.images);
    setTextConflicts(local.conflicts);
    setImageConflicts(localImages.conflicts);
    setTextDraftIssue(local.issue);
    setImageDraftIssue(localImages.issue);
    setLocalTextRestored(local.restored);
    setLocalImagesRestored(localImages.restored);
    setImageDraftStored(localImages.restored);
    setSaveStatus(local.restored || localImages.restored ? "dirty" : (data.saved_answers?.length ?? 0) > 0 ? "restored" : "saved");
    setSubmitReviewOpen(false);
    setSubmitting(false);
    answerRevisionRef.current = 0;
    autoSubmitTriggeredRef.current = false;
    startedAtRef.current = Date.now();
    remainingBaselineRef.current = data.attempt.remaining_seconds ?? null;
    setRemainingSeconds(data.attempt.remaining_seconds ?? null);
  }, [user.id]);

  const answeredCount = useMemo(() => {
    if (!activeAttempt) return 0;
    return questions.filter((question) => Boolean((answers[question.question_id] ?? "").trim()) ||
      (imageAnswers[question.question_id]?.length ?? 0) > 0).length;
  }, [activeAttempt, answers, imageAnswers, questions]);

  function cloneImages(images: Record<string, StudentAnswerImage[]>): Record<string, StudentAnswerImage[]> {
    return Object.fromEntries(Object.entries(images).map(([id, value]) => [id, value.map((image) => ({ ...image }))]));
  }

  function hasPendingImageDraft(current: Record<string, StudentAnswerImage[]>, baseline: Record<string, StudentAnswerImage[]>): boolean {
    const ids = new Set([...Object.keys(current), ...Object.keys(baseline)]);
    return [...ids].some((id) => JSON.stringify(current[id] ?? []) !== JSON.stringify(baseline[id] ?? []));
  }

  function unconfirmedImageValues(snapshot: ImageSubmissionSnapshot): Record<string, StudentAnswerImage[]> {
    const values: Record<string, StudentAnswerImage[]> = {};
    const ids = new Set([...Object.keys(snapshot.submitted), ...Object.keys(snapshot.latest)]);
    for (const id of ids) {
      const submitted = snapshot.submitted[id] ?? [];
      const latest = snapshot.latest[id] ?? [];
      if (snapshot.accepted) {
        if (JSON.stringify(latest) !== JSON.stringify(submitted) && latest.length) values[id] = latest;
        continue;
      }
      const combined = [...latest];
      for (const image of submitted) {
        if (!combined.some((item) => JSON.stringify(item) === JSON.stringify(image))) combined.push(image);
      }
      if (combined.length) values[id] = combined;
    }
    return values;
  }

  function updateUnconfirmedImages(snapshot: ImageSubmissionSnapshot) {
    const values = unconfirmedImageValues(snapshot);
    const key = snapshot.scope ? studentDraftKey(snapshot.scope)! : `unscoped:${user.id}:${snapshot.attemptId}`;
    setUnconfirmedImages((current) => {
      const next = { ...current };
      if (Object.keys(values).length) next[key] = { title: snapshot.title, images: values, issue: snapshot.issue };
      else delete next[key];
      return next;
    });
  }

  async function persistLateSubmittedImages(snapshot: ImageSubmissionSnapshot) {
    if (!snapshot.scope) { snapshot.issue = "unavailable"; updateUnconfirmedImages(snapshot); return; }
    snapshot.issue = snapshot.accepted
      ? await persistStudentImageDraft(snapshot.scope, snapshot.latest, snapshot.submitted)
      : await retainUnconfirmedStudentImageDraft(snapshot.scope, snapshot.submitted, snapshot.latest);
    updateUnconfirmedImages(snapshot);
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
    const scope = textScopeRef.current;
    if (scope) setTextDraftIssue(persistStudentTextDraft(scope, next, textBaselineRef.current, textSentRef.current, undefined, Object.keys(conflicts)));
    setSaveStatus("dirty");
  }

  function setQuestionImages(questionId: string, files: FileList | null): Promise<void> {
    const attemptId = activeAttemptRef.current?.id;
    const scopeAtStart = imageScopeRef.current;
    const operation = (async () => {
      if (!attemptId) return;
      const selected = Array.from(files ?? []);
      if (selected.length > 10) { onMessage("每题最多上传 10 张图片；本次选择未加入。"); return; }
      let images: StudentAnswerImage[];
      try { images = await Promise.all(selected.map((file) => compressImageFileToDataUrl(file))); }
      catch (error) { onMessage(error instanceof Error ? `读取图片失败：${error.message}` : "读取图片失败"); return; }
      if (images.some((image) => image.data_url.length > 5_000_000)) { onMessage("图片超过服务器允许的大小；本次选择未加入。"); return; }
      const currentScope = imageScopeRef.current;
      const sameScope = (!currentScope && !scopeAtStart) || Boolean(currentScope && scopeAtStart &&
        studentDraftKey(currentScope) === studentDraftKey(scopeAtStart));
      const stillSameAttempt = activeAttemptRef.current?.id === attemptId && sameScope;
      const submission = imageSubmissionRef.current;
      const sameSubmittedScope = (!submission?.scope && !scopeAtStart) || Boolean(submission?.scope && scopeAtStart &&
        studentDraftKey(submission.scope) === studentDraftKey(scopeAtStart));
      if (!stillSameAttempt && (!submission || submission.attemptId !== attemptId || !sameSubmittedScope)) return;
      if (!stillSameAttempt && submission?.attemptId === attemptId) {
        const latest = { ...submission.latest };
        if (images.length) latest[questionId] = images;
        else delete latest[questionId];
        submission.latest = latest;
        await persistLateSubmittedImages(submission);
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
      if (submission?.attemptId === attemptId) {
        submission.latest = next;
        submission.issue = issue;
        updateUnconfirmedImages(submission);
      }
    })();
    pendingImageWorkRef.current.push(operation);
    void operation.finally(() => { pendingImageWorkRef.current = pendingImageWorkRef.current.filter((item) => item !== operation); });
    return operation;
  }

  async function persistImages(current: Record<string, StudentAnswerImage[]>, sent: Record<string, StudentAnswerImage[]> = {}): Promise<ImageDraftIssue> {
    const scope = imageScopeRef.current;
    if (!scope) { setImageDraftIssue("unavailable"); return "unavailable"; }
    const issue = await persistStudentImageDraft(scope, current, imageBaselineRef.current, sent, Object.keys(imageConflictsRef.current));
    setImageDraftIssue(issue);
    return issue;
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
    if (!localSave.scope || !textScopeRef.current || studentDraftKey(textScopeRef.current) !== studentDraftKey(localSave.scope)) return;
    const issue = acknowledgeStudentTextDraft(localSave.scope, localSave.sent);
    textBaselineRef.current = { ...textBaselineRef.current, ...localSave.sent };
    textSentRef.current = {};
    setTextDraftIssue(issue);
    if (Object.entries(answersRef.current).every(([id, value]) => localSave.sent[id] === value)) setLocalTextRestored(false);
  }

  function beginImageSave(sourceQuestions: StudentQuestionRecord[], sourceImages: Record<string, StudentAnswerImage[]>) {
    const sent = Object.fromEntries(sourceQuestions.map((question) => [
      question.question_id, (sourceImages[question.question_id] ?? []).map((image) => ({ ...image })),
    ]));
    imageSentRef.current = sent;
    return { scope: imageScopeRef.current, sent };
  }

  async function confirmImageSave(localSave: ReturnType<typeof beginImageSave>): Promise<ImageDraftIssue> {
    if (!localSave.scope || !imageScopeRef.current || studentDraftKey(imageScopeRef.current) !== studentDraftKey(localSave.scope)) return "unavailable";
    imageBaselineRef.current = { ...imageBaselineRef.current, ...localSave.sent };
    imageSentRef.current = {};
    const issue = await acknowledgeStudentImageDraft(localSave.scope, localSave.sent);
    setImageDraftIssue(issue);
    const pending = hasPendingImageDraft(imageAnswersRef.current, imageBaselineRef.current) || Object.keys(imageConflictsRef.current).length > 0;
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
    const scope = textScopeRef.current;
    if (scope) setTextDraftIssue(persistStudentTextDraft(scope, next, textBaselineRef.current, textSentRef.current));
    setLocalTextRestored(true);
    setSaveStatus("dirty");
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

  function buildAnswerPayload(sourceQuestions: StudentQuestionRecord[], sourceAnswers: Record<string, string>, sourceImages: Record<string, StudentAnswerImage[]>) {
    return sourceQuestions.map((question) => ({ question_id: question.question_id, answer: sourceAnswers[question.question_id] ?? "", images: sourceImages[question.question_id] ?? [] }));
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
    const payload = buildAnswerPayload(questionsRef.current, answersRef.current, imageAnswersRef.current);
    beginTextSave(questionsRef.current, answersRef.current);
    const localImageSave = beginImageSave(questionsRef.current, imageAnswersRef.current);
    void persistImages(imageAnswersRef.current, localImageSave.sent);
    void fetch(answersUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers: payload }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function saveActiveDraft() {
    const attempt = activeAttemptRef.current;
    if (!attempt || draftSaveInFlightRef.current || submitInFlightRef.current) return;
    draftSaveInFlightRef.current = true;
    const attemptId = attempt.id;
    try {
      await Promise.all([...pendingImageWorkRef.current]);
      if (activeAttemptRef.current?.id !== attemptId) return;
      const sourceQuestions = questionsRef.current;
      const sourceAnswers = { ...answersRef.current };
      const sourceImages = cloneImages(imageAnswersRef.current);
      const revision = answerRevisionRef.current;
      const localSave = beginTextSave(sourceQuestions, sourceAnswers);
      const localImageSave = beginImageSave(sourceQuestions, sourceImages);
      setSaveStatus("saving");
      await persistImages(sourceImages, localImageSave.sent);
      await saveStudentAnswers(attemptId, buildAnswerPayload(sourceQuestions, sourceAnswers, sourceImages));
      confirmTextSave(localSave);
      await confirmImageSave(localImageSave);
      if (activeAttemptRef.current?.id === attemptId) setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
    } catch (error) {
      if (activeAttemptRef.current?.id === attemptId) {
        setSaveStatus("error");
        onMessage(error instanceof Error ? error.message : String(error));
      }
    } finally { draftSaveInFlightRef.current = false; }
  }

  async function submitActiveAttempt() {
    const initialAttempt = activeAttemptRef.current;
    if (!initialAttempt || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    onMessage(null);
    try {
      while (pendingImageWorkRef.current.length) await Promise.all([...pendingImageWorkRef.current]);
      const attempt = activeAttemptRef.current;
      if (!attempt || attempt.id !== initialAttempt.id) return;
      const sourceQuestions = questionsRef.current;
      const submittedText = { ...answersRef.current };
      const submittedImages = cloneImages(imageAnswersRef.current);
      const submittedConflicts = { ...textConflictsRef.current };
      const submittedImageConflicts = { ...imageConflictsRef.current };
      const payload = buildAnswerPayload(sourceQuestions, submittedText, submittedImages);
      const submittedScope = textScopeRef.current;
      const localImageSave = beginImageSave(sourceQuestions, submittedImages);
      await persistImages(submittedImages, localImageSave.sent);
      const result = await submitStudentAttempt(attempt.id, { time_spent_seconds: elapsedSeconds(), answers: payload });
      while (pendingImageWorkRef.current.length) await Promise.all([...pendingImageWorkRef.current]);
      const accepted = result.attempt.submitted_answers_accepted === true;
      const latestText = textScopeRef.current && submittedScope && studentDraftKey(textScopeRef.current) === studentDraftKey(submittedScope)
        ? answersRef.current : submittedText;
      const latestImages = activeAttemptRef.current?.id === attempt.id ? cloneImages(imageAnswersRef.current) : submittedImages;
      const latestImagesWithConflicts = { ...latestImages, ...submittedImageConflicts };
      const imageSnapshot: ImageSubmissionSnapshot = {
        attemptId: attempt.id, title: attempt.title, scope: localImageSave.scope,
        submitted: submittedImages, latest: latestImagesWithConflicts, accepted, issue: null,
      };
      imageSubmissionRef.current = imageSnapshot;
      let retained = false;
      if (submittedScope) {
        const issue = accepted
          ? acknowledgeStudentTextDraft(submittedScope, Object.fromEntries(Object.entries(submittedText).filter(([id]) => !Object.prototype.hasOwnProperty.call(submittedConflicts, id))))
          : retainUnconfirmedStudentText(submittedScope, submittedText);
        const unsent = accepted
          ? Object.fromEntries(Object.entries(latestText).filter(([id, value]) => value !== submittedText[id]))
          : latestText;
        const pending = { ...pendingStudentTextDraft(submittedScope), ...unsent, ...submittedConflicts };
        const key = studentDraftKey(submittedScope)!;
        retained = Object.keys(pending).length > 0;
        setUnconfirmedTexts((current) => {
          const next = { ...current };
          if (retained) next[key] = { title: attempt.title, answers: pending, issue };
          else delete next[key];
          return next;
        });
      } else {
        const latest = activeAttemptRef.current?.id === attempt.id ? { ...answersRef.current } : submittedText;
        const unsent = accepted
          ? Object.fromEntries(Object.entries(latest).filter(([id, value]) => value !== submittedText[id]))
          : latest;
        retained = Object.keys(unsent).length > 0;
        if (retained) setUnconfirmedTexts((current) => ({ ...current, [`unscoped:${user.id}:${attempt.id}`]: { title: attempt.title, answers: unsent, issue: "unavailable" } }));
      }
      let imageIssue: ImageDraftIssue = "unavailable";
      if (localImageSave.scope) {
        imageIssue = accepted
          ? await confirmImageSave(localImageSave)
          : await retainUnconfirmedStudentImageDraft(localImageSave.scope, submittedImages, latestImagesWithConflicts);
      }
      imageSnapshot.issue = imageIssue;
      if (Object.keys(unconfirmedImageValues(imageSnapshot)).length) retained = true;
      updateUnconfirmedImages(imageSnapshot);
      textScopeRef.current = null;
      imageScopeRef.current = null;
      textConflictsRef.current = {};
      imageConflictsRef.current = {};
      setTextConflicts({});
      setImageConflicts({});
      setLocalTextRestored(false);
      setLocalImagesRestored(false);
      setTextDraftIssue(null);
      setImageDraftIssue(null);
      activeAttemptRef.current = null;
      questionsRef.current = [];
      answersRef.current = {};
      imageAnswersRef.current = {};
      setActiveAttempt(null);
      setQuestions([]);
      setAnswers({});
      setImageAnswers({});
      setRemainingSeconds(null);
      setSaveStatus("saved");
      setSubmitReviewOpen(false);
      startedAtRef.current = null;
      await onSubmitted(retained ? "试卷已提交；未确认的本机作答仍保留，可在下方查看。" : "试卷已提交");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") return;
    const attemptId = activeAttempt.id;
    const sendEvent = (eventType: string, durationMs?: number | null, payload?: Record<string, unknown>) => {
      void Promise.resolve(recordStudentProctorEvent(attemptId, {
        event_type: eventType, duration_ms: durationMs ?? null, payload: payload ?? null,
      })).catch(() => { /* best effort proctor event */ });
    };
    const onVisibilityChange = () => {
      if (filePickerActiveRef.current) { hiddenAtRef.current = null; return; }
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        sendEvent("visibility_hidden", 0, { source: "visibilitychange", phase: "hidden" });
      } else if (hiddenAtRef.current != null) {
        const duration = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        sendEvent("visibility_return", duration, { source: "visibilitychange", phase: "visible" });
      }
    };
    const onPageHide = () => { if (!filePickerActiveRef.current) sendEvent("visibility_hidden", 0, { source: "pagehide", phase: "hidden" }); };
    const onBlur = () => { if (!filePickerActiveRef.current) sendEvent("window_blur", 0, { source: "window.blur" }); };
    const onFocus = () => { window.setTimeout(() => { filePickerActiveRef.current = false; }, 0); };
    const onCopy = () => sendEvent("copy", 0, { source: "document.copy" });
    const onPaste = () => sendEvent("paste", 0, { source: "document.paste" });
    const onContextMenu = () => sendEvent("context_menu", 0, { source: "document.contextmenu" });
    const onFullscreenChange = () => { if (!document.fullscreenElement) sendEvent("fullscreen_exit", 0, { source: "fullscreenchange" }); };
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
    if (!activeAttempt) { answersUrlRef.current = null; setRemainingSeconds(null); return; }
    void resolveApiUrl(`/api/student/attempts/${encodeURIComponent(activeAttempt.id)}/answers`).then((answersUrl) => {
      if (activeAttemptRef.current?.id === activeAttempt.id) answersUrlRef.current = answersUrl;
    });
    const serverRemaining = activeAttempt.remaining_seconds;
    const limitMinutes = Number(activeAttempt.time_limit_minutes || 0);
    const initialRemaining = serverRemaining ?? (limitMinutes > 0 ? limitMinutes * 60 : null);
    remainingBaselineRef.current = initialRemaining;
    setRemainingSeconds(initialRemaining);
  }, [activeAttempt]);

  useEffect(() => {
    const limitMinutes = Number(activeAttempt?.time_limit_minutes || 0);
    if (!activeAttempt || activeAttempt.status !== "in_progress" || limitMinutes <= 0) return;
    const tick = () => {
      const elapsed = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
      const next = Math.max(0, Number(remainingBaselineRef.current ?? limitMinutes * 60) - elapsed);
      setRemainingSeconds(next);
      if (next <= 0 && !autoSubmitTriggeredRef.current && !submitInFlightRef.current) {
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
    const onBeforeUnload = () => { saveAttemptBestEffort(); };
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
      if (saveStatus !== "dirty" || draftSaveInFlightRef.current || submitInFlightRef.current || pendingImageWorkRef.current.length) return;
      const attempt = activeAttemptRef.current;
      if (!attempt) return;
      draftSaveInFlightRef.current = true;
      const revision = answerRevisionRef.current;
      setSaveStatus("saving");
      const sourceQuestions = questionsRef.current;
      const sourceAnswers = { ...answersRef.current };
      const sourceImages = cloneImages(imageAnswersRef.current);
      const payload = buildAnswerPayload(sourceQuestions, sourceAnswers, sourceImages);
      const localSave = beginTextSave(sourceQuestions, sourceAnswers);
      const localImageSave = beginImageSave(sourceQuestions, sourceImages);
      void persistImages(sourceImages, localImageSave.sent)
        .then(() => saveStudentAnswers(attempt.id, payload))
        .then(() => {
          confirmTextSave(localSave);
          void confirmImageSave(localImageSave);
          if (activeAttemptRef.current?.id === attempt.id) setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
        })
        .catch(() => { if (activeAttemptRef.current?.id === attempt.id) setSaveStatus("error"); })
        .finally(() => { draftSaveInFlightRef.current = false; });
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttempt?.id, activeAttempt?.status, saveStatus]);

  return {
    activeAttempt, questions, answers, imageAnswers, remainingSeconds, saveStatus, answeredCount,
    submitReviewOpen, setSubmitReviewOpen, submitting, textConflicts, textDraftIssue, localTextRestored,
    imageDraftIssue, imageDraftStored, localImagesRestored, imageConflicts, unconfirmedTexts, unconfirmedImages,
    open, setAnswer, setQuestionImages, recoverConflictingText, recoverConflictingImages, saveActiveDraft,
    submitActiveAttempt,
    onFileDialogOpen: () => { filePickerActiveRef.current = true; },
    onFileDialogClose: () => { window.setTimeout(() => { filePickerActiveRef.current = false; }, 0); },
  };
}

export type StudentExamController = ReturnType<typeof useStudentExam>;
