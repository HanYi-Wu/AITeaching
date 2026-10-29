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
  retainUnconfirmedStudentImageDraft, retainLateStudentImage, sameAnswerImage, sameImages, type ImageDraftIssue,
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

const unconfirmedTextByAccount = new Map<string, Record<string, UnconfirmedText>>();
const unconfirmedImagesByAccount = new Map<string, Record<string, UnconfirmedImages>>();
const MAX_UNCONFIRMED_TEXT_BYTES = 1_000_000;
const MAX_UNCONFIRMED_IMAGE_BYTES = 20_000_000;

function accountMapBytes<T>(map: Map<string, Record<string, T>>): number {
  let total = 0;
  for (const [accountId, entries] of map) {
    total += new TextEncoder().encode(JSON.stringify([accountId, entries])).byteLength;
  }
  return total;
}

function isMemoryLimitMarker(accountId: string, entries: Record<string, unknown>): boolean {
  const keys = Object.keys(entries);
  return keys.length === 1 && keys[0] === `unscoped:${accountId}:memory-limit`;
}

function textMemoryLimitMarker(accountId: string, entries: Record<string, UnconfirmedText>): Record<string, UnconfirmedText> {
  const title = Object.values(entries)[0]?.title ?? "未确认作答";
  return { [`unscoped:${accountId}:memory-limit`]: { title, answers: {}, issue: "too_large" } };
}

function imageMemoryLimitMarker(accountId: string, entries: Record<string, UnconfirmedImages>): Record<string, UnconfirmedImages> {
  const title = Object.values(entries)[0]?.title ?? "未确认作答";
  return { [`unscoped:${accountId}:memory-limit`]: { title, images: {}, issue: "too_large" } };
}

function fitUnconfirmedMemory<T>(
  map: Map<string, Record<string, T>>, accountId: string, limitBytes: number,
  marker: (id: string, entries: Record<string, T>) => Record<string, T>,
): Record<string, T> {
  while (accountMapBytes(map) > limitBytes) {
    const olderFullAccount = [...map.entries()].find(([id, entries]) =>
      id !== accountId && !isMemoryLimitMarker(id, entries as Record<string, unknown>));
    if (olderFullAccount) {
      map.set(olderFullAccount[0], marker(olderFullAccount[0], olderFullAccount[1]));
      continue;
    }
    const current = map.get(accountId);
    if (current && !isMemoryLimitMarker(accountId, current as Record<string, unknown>)) {
      map.set(accountId, marker(accountId, current));
      continue;
    }
    const oldestMarker = [...map.keys()].find((id) => id !== accountId);
    if (!oldestMarker) break;
    map.delete(oldestMarker);
  }
  return map.get(accountId) ?? {};
}

function belongsToAccount(key: string, accountId: string): boolean {
  return key.startsWith(`eh:student-text-draft:v1:${encodeURIComponent(accountId)}:`) ||
    key.startsWith(`unscoped:${accountId}:`);
}

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
  const [unconfirmedTexts, setUnconfirmedTexts] = useState<Record<string, UnconfirmedText>>(() => ({ ...(unconfirmedTextByAccount.get(user.id) ?? {}) }));
  const [imageDraftIssue, setImageDraftIssue] = useState<ImageDraftIssue>(null);
  const [imageDraftStored, setImageDraftStored] = useState(false);
  const [pendingImageWorkCount, setPendingImageWorkCount] = useState(0);
  const [localImagesRestored, setLocalImagesRestored] = useState(false);
  const [imageConflicts, setImageConflicts] = useState<Record<string, StudentAnswerImage[]>>({});
  const [unconfirmedImages, setUnconfirmedImages] = useState<Record<string, UnconfirmedImages>>(() => ({ ...(unconfirmedImagesByAccount.get(user.id) ?? {}) }));
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
  const imageWorkByIdentityRef = useRef(new Map<string, Set<Promise<void>>>());
  const imageSelectionRef = useRef(new Map<string, number>());
  const imageSelectionSequenceRef = useRef(0);
  const textScopeRef = useRef<StudentDraftScope | null>(null);
  const imageScopeRef = useRef<StudentDraftScope | null>(null);
  const textBaselineRef = useRef<Record<string, string>>({});
  const textSentRef = useRef<Record<string, string>>({});
  const textConflictsRef = useRef<Record<string, string>>({});
  const imageBaselineRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageSentRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageConflictsRef = useRef<Record<string, StudentAnswerImage[]>>({});
  const imageSubmissionRef = useRef<ImageSubmissionSnapshot | null>(null);
  const unsafeExitRef = useRef(false);

  const lifecycleRef = useRef(0);
  const activeIdentityRef = useRef<string | null>(null);
  const stateAccountRef = useRef(user.id);
  const accountStateMatches = stateAccountRef.current === user.id;
  const uncertainSaveScopesRef = useRef(new Set<string>());
  const forceFullSaveRef = useRef(false);
  const ownerRef = useRef(user.id);
  if (ownerRef.current !== user.id) {
    ownerRef.current = user.id;
    lifecycleRef.current += 1;
    activeAttemptRef.current = null;
    activeIdentityRef.current = null;
    questionsRef.current = [];
    answersRef.current = {};
    imageAnswersRef.current = {};
    textBaselineRef.current = {};
    textSentRef.current = {};
    imageBaselineRef.current = {};
    imageSentRef.current = {};
    textConflictsRef.current = {};
    imageConflictsRef.current = {};
    imageSubmissionRef.current = null;
    textScopeRef.current = null;
    imageScopeRef.current = null;
  }

  function updateUnconfirmedText(accountId: string, key: string, value: UnconfirmedText | null) {
    const next = { ...(unconfirmedTextByAccount.get(accountId) ?? {}) };
    if (value) next[key] = value;
    else delete next[key];
    if (Object.keys(next).length) unconfirmedTextByAccount.set(accountId, next);
    else unconfirmedTextByAccount.delete(accountId);
    const bounded = fitUnconfirmedMemory(unconfirmedTextByAccount, accountId, MAX_UNCONFIRMED_TEXT_BYTES, textMemoryLimitMarker);
    if (ownerRef.current === accountId) setUnconfirmedTexts(bounded);
  }

  function updateUnconfirmedImage(accountId: string, key: string, value: UnconfirmedImages | null) {
    const next = { ...(unconfirmedImagesByAccount.get(accountId) ?? {}) };
    if (value) next[key] = value;
    else delete next[key];
    if (Object.keys(next).length) unconfirmedImagesByAccount.set(accountId, next);
    else unconfirmedImagesByAccount.delete(accountId);
    const bounded = fitUnconfirmedMemory(unconfirmedImagesByAccount, accountId, MAX_UNCONFIRMED_IMAGE_BYTES, imageMemoryLimitMarker);
    if (ownerRef.current === accountId) setUnconfirmedImages(bounded);
  }

  useEffect(() => {
    setActiveAttempt(null);
    setQuestions([]);
    setAnswers({});
    setImageAnswers({});
    setUnconfirmedTexts({ ...(unconfirmedTextByAccount.get(user.id) ?? {}) });
    setUnconfirmedImages({ ...(unconfirmedImagesByAccount.get(user.id) ?? {}) });
    stateAccountRef.current = user.id;
  }, [user.id]);

  const open = useCallback(async (data: StudentExamStart) => {
    const lifecycle = ++lifecycleRef.current;
    activeAttemptRef.current = null;
    activeIdentityRef.current = null;
    textScopeRef.current = null;
    imageScopeRef.current = null;
    draftSaveInFlightRef.current = false;
    submitInFlightRef.current = false;
    pendingImageWorkRef.current = [];
    setPendingImageWorkCount(0);
    setActiveAttempt(null);
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
    const validScope = studentDraftKey(scope) ? scope : null;
    const identity = JSON.stringify([scope.accountId, scope.projectScope, scope.publicationId, scope.attemptId, scope.snapshotVersion]);
    const local = validScope && data.attempt.status === "in_progress"
      ? restoreStudentTextDraft(scope, restoredAnswers, data.questions.map((item) => item.question_id))
      : { answers: restoredAnswers, conflicts: {}, restored: false, issue: validScope ? null : "unavailable" as const };
    const pendingImages = Array.from(imageWorkByIdentityRef.current.get(identity) ?? []);
    if (pendingImages.length) await Promise.all(pendingImages);
    if (lifecycle !== lifecycleRef.current) return false;
    const localImages = validScope && data.attempt.status === "in_progress"
      ? await restoreStudentImageDraft(scope, restoredImages, data.questions.map((item) => item.question_id), undefined, () => lifecycle === lifecycleRef.current)
      : { images: restoredImages, conflicts: {}, restored: false, issue: null as ImageDraftIssue };
    if (lifecycle !== lifecycleRef.current) return false;
    textScopeRef.current = validScope;
    imageScopeRef.current = validScope;
    imageSubmissionRef.current = null;
    activeIdentityRef.current = identity;
    pendingImageWorkRef.current = Array.from(imageWorkByIdentityRef.current.get(identity) ?? []);
    forceFullSaveRef.current = data.attempt.status === "in_progress" && uncertainSaveScopesRef.current.has(identity);
    if (data.attempt.status !== "in_progress") uncertainSaveScopesRef.current.delete(identity);
    textBaselineRef.current = restoredAnswers;
    textSentRef.current = {};
    imageBaselineRef.current = restoredImages;
    imageSentRef.current = {};
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
    setSaveStatus(local.restored || localImages.restored || forceFullSaveRef.current ? "dirty" : (data.saved_answers?.length ?? 0) > 0 ? "restored" : "saved");
    setSubmitReviewOpen(false);
    setSubmitting(false);
    answerRevisionRef.current = 0;
    autoSubmitTriggeredRef.current = false;
    startedAtRef.current = Date.now();
    remainingBaselineRef.current = data.attempt.remaining_seconds ?? null;
    setRemainingSeconds(data.attempt.remaining_seconds ?? null);
    return true;
  }, [user.id]);

  const answeredCount = useMemo(() => {
    if (!activeAttempt) return 0;
    return questions.filter((question) => Boolean((answers[question.question_id] ?? "").trim()) ||
      (imageAnswers[question.question_id]?.length ?? 0) > 0).length;
  }, [activeAttempt, answers, imageAnswers, questions]);

  function cloneImages(images: Record<string, StudentAnswerImage[]>): Record<string, StudentAnswerImage[]> {
    return Object.fromEntries(Object.entries(images).map(([id, value]) => [id, value.slice()]));
  }

  function hasPendingImageDraft(current: Record<string, StudentAnswerImage[]>, baseline: Record<string, StudentAnswerImage[]>): boolean {
    const ids = new Set([...Object.keys(current), ...Object.keys(baseline)]);
    return [...ids].some((id) => !sameImages(current[id], baseline[id]));
  }

  function unconfirmedImageValues(snapshot: ImageSubmissionSnapshot): Record<string, StudentAnswerImage[]> {
    const values: Record<string, StudentAnswerImage[]> = {};
    const ids = new Set([...Object.keys(snapshot.submitted), ...Object.keys(snapshot.latest)]);
    for (const id of ids) {
      const submitted = snapshot.submitted[id] ?? [];
      const latest = snapshot.latest[id] ?? [];
      if (snapshot.accepted) {
        if (!sameImages(latest, submitted)) values[id] = latest;
        continue;
      }
      const combined = [...latest];
      for (const image of submitted) {
        if (!combined.some((item) => sameAnswerImage(item, image))) combined.push(image);
      }
      if (combined.length) values[id] = combined;
    }
    return values;
  }

  function updateUnconfirmedImages(snapshot: ImageSubmissionSnapshot) {
    const values = unconfirmedImageValues(snapshot);
    const key = snapshot.scope ? studentDraftKey(snapshot.scope)! : `unscoped:${user.id}:${snapshot.attemptId}`;
    const accountId = snapshot.scope?.accountId ?? user.id;
    updateUnconfirmedImage(accountId, key, Object.keys(values).length
      ? { title: snapshot.title, images: values, issue: snapshot.issue }
      : null);
  }

  async function persistLateSubmittedImages(snapshot: ImageSubmissionSnapshot) {
    if (!snapshot.scope) { snapshot.issue = "unavailable"; updateUnconfirmedImages(snapshot); return; }
    snapshot.issue = snapshot.accepted
      ? await persistStudentImageDraft(snapshot.scope, snapshot.latest, snapshot.submitted)
      : await retainUnconfirmedStudentImageDraft(snapshot.scope, snapshot.submitted, snapshot.latest);
    updateUnconfirmedImages(snapshot);
  }

  const setAnswer = useCallback((questionId: string, value: string) => {
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
  }, []);

  const setQuestionImages = useCallback((questionId: string, files: FileList | null): Promise<void> => {
    const attemptId = activeAttemptRef.current?.id;
    const titleAtStart = activeAttemptRef.current?.title ?? "";
    const lifecycle = lifecycleRef.current;
    const identityAtStart = activeIdentityRef.current;
    const selectionKey = identityAtStart ? JSON.stringify([identityAtStart, questionId]) : null;
    const selection = selectionKey ? ++imageSelectionSequenceRef.current : 0;
    if (selectionKey) imageSelectionRef.current.set(selectionKey, selection);
    const scopeAtStart = imageScopeRef.current;
    const baselineAtStart = imageBaselineRef.current[questionId] ?? [];
    const sentAtStart = imageSentRef.current[questionId];
    const operation = (async () => {
      if (!attemptId) return;
      const selected = Array.from(files ?? []);
      if (selected.length > 10) { onMessage("每题最多上传 10 张图片；本次选择未加入。"); return; }
      let images: StudentAnswerImage[];
      try { images = await Promise.all(selected.map((file) => compressImageFileToDataUrl(file))); }
      catch (error) { if (lifecycle === lifecycleRef.current) onMessage(error instanceof Error ? `读取图片失败：${error.message}` : "读取图片失败"); return; }
      if (images.some((image) => image.data_url.length > 5_000_000)) {
        if (lifecycle === lifecycleRef.current) onMessage("图片超过服务器允许的大小；本次选择未加入。");
        return;
      }
      if (selectionKey && imageSelectionRef.current.get(selectionKey) !== selection) return;
      if (lifecycle !== lifecycleRef.current && (!identityAtStart || activeIdentityRef.current !== identityAtStart)) {
        const issue = scopeAtStart
          ? await retainLateStudentImage(scopeAtStart, questionId, images, baselineAtStart, sentAtStart)
          : "unavailable" as const;
        if (images.length || !sameImages(images, sentAtStart ?? baselineAtStart)) {
          const key = scopeAtStart ? studentDraftKey(scopeAtStart)! : `unscoped:${user.id}:${attemptId}`;
          const accountId = scopeAtStart?.accountId ?? user.id;
          const current = unconfirmedImagesByAccount.get(accountId)?.[key];
          updateUnconfirmedImage(accountId, key, {
            title: titleAtStart, images: { ...(current?.images ?? {}), [questionId]: images }, issue,
          });
        }
        return;
      }
      const appliedLifecycle = lifecycleRef.current;
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
      if (appliedLifecycle !== lifecycleRef.current) return;
      setImageDraftStored(issue === null && hasPendingImageDraft(next, imageBaselineRef.current));
      setLocalImagesRestored(false);
      if (submission?.attemptId === attemptId) {
        submission.latest = next;
        submission.issue = issue;
        updateUnconfirmedImages(submission);
      }
    })();
    pendingImageWorkRef.current.push(operation);
    setPendingImageWorkCount(pendingImageWorkRef.current.length);
    if (identityAtStart) {
      const pending = imageWorkByIdentityRef.current.get(identityAtStart) ?? new Set<Promise<void>>();
      pending.add(operation);
      imageWorkByIdentityRef.current.set(identityAtStart, pending);
    }
    void operation.finally(() => {
      pendingImageWorkRef.current = pendingImageWorkRef.current.filter((item) => item !== operation);
      setPendingImageWorkCount(pendingImageWorkRef.current.length);
      if (selectionKey && imageSelectionRef.current.get(selectionKey) === selection) imageSelectionRef.current.delete(selectionKey);
      if (identityAtStart) {
        const pending = imageWorkByIdentityRef.current.get(identityAtStart);
        pending?.delete(operation);
        if (!pending?.size) imageWorkByIdentityRef.current.delete(identityAtStart);
      }
    });
    return operation;
  }, [onMessage, user.id]);

  async function persistImages(current: Record<string, StudentAnswerImage[]>, sent: Record<string, StudentAnswerImage[]> = {}): Promise<ImageDraftIssue> {
    const lifecycle = lifecycleRef.current;
    const scope = imageScopeRef.current;
    if (!scope) { setImageDraftIssue("unavailable"); return "unavailable"; }
    const baseline = imageBaselineRef.current;
    const conflicts = Object.keys(imageConflictsRef.current);
    const hasAnyImages = Object.keys(current).length > 0 || Object.keys(baseline).length > 0 ||
      Object.keys(sent).length > 0 || conflicts.length > 0;
    if (!hasAnyImages) { setImageDraftIssue(null); return null; }
    const issue = await persistStudentImageDraft(scope, current, baseline, sent, conflicts);
    if (lifecycle === lifecycleRef.current) setImageDraftIssue(issue);
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
    if ((localSave.scope && (!textScopeRef.current || studentDraftKey(textScopeRef.current) !== studentDraftKey(localSave.scope))) ||
        (!localSave.scope && textScopeRef.current)) return;
    const issue = localSave.scope ? acknowledgeStudentTextDraft(localSave.scope, localSave.sent) : "unavailable";
    textBaselineRef.current = { ...textBaselineRef.current, ...localSave.sent };
    textSentRef.current = {};
    setTextDraftIssue(issue);
    if (Object.entries(answersRef.current).every(([id, value]) => (textBaselineRef.current[id] ?? "") === value)) setLocalTextRestored(false);
  }

  function beginImageSave(sourceQuestions: StudentQuestionRecord[], sourceImages: Record<string, StudentAnswerImage[]>) {
    const sent: Record<string, StudentAnswerImage[]> = {};
    for (const question of sourceQuestions) {
      const id = question.question_id;
      const images = sourceImages[id] ?? [];
      const baseline = imageBaselineRef.current[id] ?? [];
      if (images.length || baseline.length || !sameImages(images, baseline)) sent[id] = images.slice();
    }
    imageSentRef.current = sent;
    return { scope: imageScopeRef.current, sent };
  }

  async function confirmImageSave(localSave: ReturnType<typeof beginImageSave>): Promise<ImageDraftIssue> {
    if ((localSave.scope && (!imageScopeRef.current || studentDraftKey(imageScopeRef.current) !== studentDraftKey(localSave.scope))) ||
        (!localSave.scope && imageScopeRef.current)) return "unavailable";
    imageBaselineRef.current = { ...imageBaselineRef.current, ...localSave.sent };
    imageSentRef.current = {};
    const lifecycle = lifecycleRef.current;
    const issue = localSave.scope ? await acknowledgeStudentImageDraft(localSave.scope, localSave.sent) : "unavailable";
    if (lifecycle !== lifecycleRef.current) return issue;
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
    if (activeIdentityRef.current && pendingImageWorkRef.current.length) {
      for (const id of Object.keys(imageConflictsRef.current)) {
        imageSelectionRef.current.set(JSON.stringify([activeIdentityRef.current, id]), ++imageSelectionSequenceRef.current);
      }
    }
    const next = { ...imageAnswersRef.current, ...imageConflictsRef.current };
    imageAnswersRef.current = next;
    setImageAnswers(next);
    imageConflictsRef.current = {};
    setImageConflicts({});
    answerRevisionRef.current += 1;
    setSaveStatus("dirty");
    const lifecycle = lifecycleRef.current;
    void persistImages(next, imageSentRef.current).then((issue) => {
      if (lifecycle !== lifecycleRef.current) return;
      setImageDraftStored(issue === null && hasPendingImageDraft(next, imageBaselineRef.current));
    });
  }

  function questionsNeedingSave(
    sourceQuestions: StudentQuestionRecord[], sourceAnswers: Record<string, string>,
    sourceImages: Record<string, StudentAnswerImage[]>,
  ): StudentQuestionRecord[] {
    return sourceQuestions.filter(({ question_id: id }) => {
      const answer = sourceAnswers[id] ?? "";
      const pendingText = textSentRef.current[id];
      const pendingImages = imageSentRef.current[id];
      return Object.prototype.hasOwnProperty.call(textConflictsRef.current, id) ||
        Object.prototype.hasOwnProperty.call(imageConflictsRef.current, id) ||
        answer !== (textBaselineRef.current[id] ?? "") ||
        (pendingText !== undefined && answer !== pendingText) ||
        !sameImages(sourceImages[id], imageBaselineRef.current[id]) ||
        (pendingImages !== undefined && !sameImages(sourceImages[id], pendingImages));
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

  async function saveActiveDraft(showError = true) {
    const attempt = activeAttemptRef.current;
    if (!attempt || draftSaveInFlightRef.current || submitInFlightRef.current) return;
    const lifecycle = lifecycleRef.current;
    const identity = activeIdentityRef.current;
    const isCurrent = () => lifecycle === lifecycleRef.current && activeAttemptRef.current?.id === attempt.id;
    const markUncertain = () => {
      if (!identity) return;
      uncertainSaveScopesRef.current.add(identity);
      if (activeIdentityRef.current === identity && activeAttemptRef.current?.status === "in_progress") {
        forceFullSaveRef.current = true;
        answerRevisionRef.current += 1;
        setSaveStatus("dirty");
      }
    };
    let requestStarted = false;
    draftSaveInFlightRef.current = true;
    try {
      await Promise.all([...pendingImageWorkRef.current]);
      if (!isCurrent() || submitInFlightRef.current) return;
      const sourceQuestions = questionsRef.current;
      const sourceAnswers = { ...answersRef.current };
      const sourceImages = cloneImages(imageAnswersRef.current);
      const revision = answerRevisionRef.current;
      const dirty = questionsNeedingSave(sourceQuestions, sourceAnswers, sourceImages);
      const hasBaseline = Object.keys(textBaselineRef.current).length > 0 || Object.keys(imageBaselineRef.current).length > 0;
      const forced = forceFullSaveRef.current;
      const questionsToSend = forced ? sourceQuestions : dirty.length ? dirty : hasBaseline ? [] : sourceQuestions;
      if (!questionsToSend.length) {
        setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
        return;
      }
      const localSave = beginTextSave(questionsToSend, sourceAnswers);
      const localImageSave = beginImageSave(questionsToSend, sourceImages);
      setSaveStatus("saving");
      await persistImages(sourceImages, localImageSave.sent);
      if (!isCurrent() || submitInFlightRef.current) return;
      requestStarted = true;
      await saveStudentAnswers(attempt.id, buildAnswerPayload(questionsToSend, sourceAnswers, sourceImages));
      if (!isCurrent()) { markUncertain(); return; }
      if (submitInFlightRef.current) return;
      confirmTextSave(localSave);
      await confirmImageSave(localImageSave);
      if (isCurrent() && !submitInFlightRef.current) {
        if (forced && answerRevisionRef.current === revision) {
          forceFullSaveRef.current = false;
          if (identity) uncertainSaveScopesRef.current.delete(identity);
        }
        setSaveStatus(answerRevisionRef.current === revision ? "saved" : "dirty");
      }
    } catch (error) {
      if (requestStarted && !isCurrent()) markUncertain();
      if (isCurrent() && !submitInFlightRef.current) {
        setSaveStatus("error");
        if (showError) onMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (lifecycle === lifecycleRef.current) draftSaveInFlightRef.current = false;
    }
  }

  async function submitActiveAttempt() {
    const initialAttempt = activeAttemptRef.current;
    if (!initialAttempt || submitInFlightRef.current) return;
    const lifecycle = lifecycleRef.current;
    const isCurrent = () => lifecycle === lifecycleRef.current && activeAttemptRef.current?.id === initialAttempt.id;
    submitInFlightRef.current = true;
    setSubmitting(true);
    onMessage(null);
    try {
      while (pendingImageWorkRef.current.length) await Promise.all([...pendingImageWorkRef.current]);
      const attempt = activeAttemptRef.current;
      if (!attempt || !isCurrent()) return;
      const sourceQuestions = questionsRef.current;
      const submittedText = { ...answersRef.current };
      const submittedImages = cloneImages(imageAnswersRef.current);
      const submittedConflicts = { ...textConflictsRef.current };
      const submittedImageConflicts = { ...imageConflictsRef.current };
      const payload = buildAnswerPayload(sourceQuestions, submittedText, submittedImages);
      const submittedScope = textScopeRef.current;
      const localImageSave = beginImageSave(sourceQuestions, submittedImages);
      await persistImages(submittedImages, localImageSave.sent);
      if (!isCurrent()) return;
      const result = await submitStudentAttempt(attempt.id, { time_spent_seconds: elapsedSeconds(), answers: payload });
      while (isCurrent() && pendingImageWorkRef.current.length) await Promise.all([...pendingImageWorkRef.current]);
      const accepted = result.attempt.submitted_answers_accepted === true;
      const latestImages = isCurrent() ? cloneImages(imageAnswersRef.current) : submittedImages;
      const latestImagesWithConflicts = { ...latestImages, ...submittedImageConflicts };
      const imageSnapshot: ImageSubmissionSnapshot = {
        attemptId: attempt.id, title: attempt.title, scope: localImageSave.scope,
        submitted: submittedImages, latest: latestImagesWithConflicts, accepted, issue: null,
      };
      if (isCurrent()) imageSubmissionRef.current = imageSnapshot;
      let retained = false;
      let imageIssue: ImageDraftIssue = "unavailable";
      if (localImageSave.scope) {
        imageIssue = accepted
          ? isCurrent() ? await confirmImageSave(localImageSave) : await acknowledgeStudentImageDraft(localImageSave.scope, localImageSave.sent)
          : await retainUnconfirmedStudentImageDraft(localImageSave.scope, submittedImages, latestImagesWithConflicts);
      }
      imageSnapshot.issue = imageIssue;
      if (isCurrent()) {
        imageSnapshot.latest = { ...cloneImages(imageAnswersRef.current), ...submittedImageConflicts };
      }
      if (Object.keys(unconfirmedImageValues(imageSnapshot)).length) retained = true;
      updateUnconfirmedImages(imageSnapshot);
      const latestText = isCurrent() && textScopeRef.current && submittedScope && studentDraftKey(textScopeRef.current) === studentDraftKey(submittedScope)
        ? { ...answersRef.current } : submittedText;
      if (submittedScope) {
        const issue = accepted
          ? acknowledgeStudentTextDraft(submittedScope, Object.fromEntries(Object.entries(submittedText).filter(([id]) => !Object.prototype.hasOwnProperty.call(submittedConflicts, id))))
          : retainUnconfirmedStudentText(submittedScope, submittedText);
        const unsent = accepted
          ? Object.fromEntries(Object.entries(latestText).filter(([id, value]) => value !== submittedText[id]))
          : latestText;
        const pending = { ...pendingStudentTextDraft(submittedScope), ...unsent, ...submittedConflicts };
        const key = studentDraftKey(submittedScope)!;
        retained = retained || Object.keys(pending).length > 0;
        updateUnconfirmedText(submittedScope.accountId, key, Object.keys(pending).length
          ? { title: attempt.title, answers: pending, issue }
          : null);
      } else {
        const latest = isCurrent() ? { ...answersRef.current } : submittedText;
        const unsent = accepted
          ? Object.fromEntries(Object.entries(latest).filter(([id, value]) => value !== submittedText[id]))
          : latest;
        retained = retained || Object.keys(unsent).length > 0;
        const key = `unscoped:${user.id}:${attempt.id}`;
        updateUnconfirmedText(user.id, key, Object.keys(unsent).length
          ? { title: attempt.title, answers: unsent, issue: "unavailable" }
          : null);
      }
      if (!isCurrent()) return;
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
      activeIdentityRef.current = null;
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
      if (isCurrent()) onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (lifecycle === lifecycleRef.current) {
        setSubmitting(false);
        submitInFlightRef.current = false;
      }
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
    const hasUnconfirmedDataWithoutStorage = Object.values(unconfirmedTexts).some((entry) => entry.issue !== null) ||
      Object.values(unconfirmedImages).some((entry) => entry.issue !== null);
    const activeDraftAtRisk = activeAttempt?.status === "in_progress" &&
      (saveStatus === "dirty" || saveStatus === "saving" || saveStatus === "error") &&
      (textDraftIssue !== null || imageDraftIssue !== null);
    unsafeExitRef.current = pendingImageWorkCount > 0 || activeDraftAtRisk || hasUnconfirmedDataWithoutStorage;
  }, [activeAttempt?.id, activeAttempt?.status, saveStatus, textDraftIssue, imageDraftIssue, unconfirmedTexts, unconfirmedImages, pendingImageWorkCount]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      saveAttemptBestEffort();
      if (!unsafeExitRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    const onPageHide = () => { saveAttemptBestEffort(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      if (saveStatus !== "dirty" || draftSaveInFlightRef.current || submitInFlightRef.current || pendingImageWorkRef.current.length) return;
      void saveActiveDraft(false);
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttempt?.id, activeAttempt?.status, saveStatus]);

  const currentUnconfirmedTexts = Object.fromEntries(Object.entries(unconfirmedTexts)
    .filter(([key]) => belongsToAccount(key, user.id)));
  const currentUnconfirmedImages = Object.fromEntries(Object.entries(unconfirmedImages)
    .filter(([key]) => belongsToAccount(key, user.id)));
  return {
    activeAttempt: accountStateMatches ? activeAttempt : null,
    questions: accountStateMatches ? questions : [],
    answers: accountStateMatches ? answers : {},
    imageAnswers: accountStateMatches ? imageAnswers : {},
    remainingSeconds: accountStateMatches ? remainingSeconds : null,
    saveStatus: accountStateMatches ? saveStatus : "saved",
    answeredCount: accountStateMatches ? answeredCount : 0,
    submitReviewOpen: accountStateMatches && submitReviewOpen,
    setSubmitReviewOpen,
    submitting: accountStateMatches && submitting,
    textConflicts: accountStateMatches ? textConflicts : {},
    textDraftIssue: accountStateMatches ? textDraftIssue : null,
    localTextRestored: accountStateMatches && localTextRestored,
    imageDraftIssue: accountStateMatches ? imageDraftIssue : null,
    imageDraftStored: accountStateMatches && imageDraftStored,
    localImagesRestored: accountStateMatches && localImagesRestored,
    imageConflicts: accountStateMatches ? imageConflicts : {},
    unconfirmedTexts: currentUnconfirmedTexts, unconfirmedImages: currentUnconfirmedImages,
    open, setAnswer, setQuestionImages, recoverConflictingText, recoverConflictingImages, saveActiveDraft,
    submitActiveAttempt,
    onFileDialogOpen: useCallback(() => { filePickerActiveRef.current = true; }, []),
    onFileDialogClose: useCallback(() => { window.setTimeout(() => { filePickerActiveRef.current = false; }, 0); }, []),
  };
}

export type StudentExamController = ReturnType<typeof useStudentExam>;
