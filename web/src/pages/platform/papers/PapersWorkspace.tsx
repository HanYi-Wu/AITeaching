import analysisPrintCss from "./analysisPrint.css?raw";
import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Download,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { apiDownloadBlob, apiGet } from "../../../api/client";
import { ContentTags } from "../../../components/ContentTags";
import {
  analyzePlatformPaper,
  completePaperAttemptGrading,
  downloadPaperAnalysisReport,
  downloadOfflineAnswerUploader,
  downloadOfflineScanImage,
  gradePaperAnswer,
  getAccountProfile,
  analyzePaperFolder,
  createContentFolder,
  listContentFolders,
  listTaggedItems,
  movePaperToFolder,
  updateContentFolder,
  listTeacherClassStudents,
  listPaperSubmissions,
  listPlatformPaperPublications,
  listPlatformPapers,
  listTeacherAssignedClasses,
  publishPlatformPaper,
  revokePlatformPaperPublication,
  suggestAiGradesForAttempt,
  updatePlatformPaperPublication,
  updatePlatformPaperDeliveryMode,
  uploadPaperScores,
  type PaperPublicationRecord,
  type PaperSubmissionMode,
  type PaperSubmissionRecord,
  type PlatformPaperAnalysis,
  type PlatformPaperRecord,
  type TeacherClassRecord,
  type TeacherClassStudentRecord,
  type ContentFolder,
  type ContentTag,
} from "../../../platform/auth";
import { PlatformPaperAnalysisCharts } from "../AnalysisCharts";
import { GettingStartedChecklist } from "../GettingStartedChecklist";
import {
  applyGradingSuggestions,
  getGradingDraft,
  gradingFeedbackForSave,
  markGradingDraftSaved,
  parseGradingScore,
  reconcileGradingDrafts,
  restoreGradingDraft,
  updateGradingDraft,
  type GradingDraftSource,
  type GradingDrafts,
} from "./gradingModel";
import { usePaperGrading } from "./usePaperGrading";
import { PaperListSidebar } from "./PaperListSidebar";
import { PaperClassPublishPanel } from "./PaperClassPublishPanel";
import { PaperPublishingSidebar } from "./PaperPublishingSidebar";
import GradingQuestionCard from "./GradingQuestionCard";
import { GradingWorkspace } from "./GradingWorkspace";
import { PaperSubmissionDetail } from "./PaperSubmissionDetail";
import {
  readGradingDraft,
  writeGradingDraft,
  type GradingDraftStorageScope,
} from "./gradingDraftStorage";
import {
  type PaperQuery,
  type PageMeta,
  mergeMeta,
  htmlEscape,
  downloadBlob,
  gradingStatusLabel,
  formatStudentAnswer,
} from "./paperHelpers";

type Props = {
  openTarget?: { paperId: string; attemptId: string; title: string } | null;
  onOpenTargetConsumed?: () => void;
  onOpenAnalysis?: (examId: string) => void;
  onOpenBank?: () => void;
  onOpenTemplates?: () => void;
  onOpenCompose?: () => void;
  onError?: (message: string | null) => void;
  assignStudent?: { classId: string; studentId: string; name: string } | null;
  onAssignStudentConsumed?: () => void;
};

type AcceptedAiSuggestion = {
  attemptId: string;
  questionId: string;
  status?: string;
  suggestedScore?: number | null;
  feedback?: string | null;
  fields: Array<"score" | "feedback">;
};

export function PapersWorkspace({ openTarget, onOpenTargetConsumed, onOpenAnalysis, onOpenBank, onOpenTemplates, onOpenCompose, onError, assignStudent, onAssignStudentConsumed }: Props) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const [papers, setPapers] = useState<PlatformPaperRecord[]>([]);
  const [paperMeta, setPaperMeta] = useState<PageMeta>({ total: 0, page: 1, pageSize: 10, totalPages: 1 });
  const [paperQuery, setPaperQuery] = useState<PaperQuery>({
    q: "",
    deliveryMode: "all",
    status: "all",
    page: 1,
    pageSize: 10,
  });
  const [classes, setClasses] = useState<TeacherClassRecord[]>([]);
  const [publications, setPublications] = useState<PaperPublicationRecord[]>([]);
  const [submissions, setSubmissions] = useState<PaperSubmissionRecord[]>([]);
  const [selectedGradingAttemptId, setSelectedGradingAttemptId] = useState("");
  const [submissionMode, setSubmissionMode] = useState<PaperSubmissionMode>("online");
  const [maxScreenSwitches, setMaxScreenSwitches] = useState(0);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(0);
  const [publishStartAt, setPublishStartAt] = useState("");
  const [publishEndAt, setPublishEndAt] = useState("");
  const [paperDetailView, setPaperDetailView] = useState<"manage" | "grading">("manage");
  const [gradingDraftState, setGradingDraftState] = useState<{ ownerKey: string; drafts: GradingDrafts }>({ ownerKey: "", drafts: {} });
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [taggedItems, setTaggedItems] = useState<Record<string, ContentTag[]>>({});
  const [browserFolderId, setBrowserFolderId] = useState<string | null>(null);
  const [publishFolderId, setPublishFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [recipientScope, setRecipientScope] = useState<"class" | "student">("class");
  const [classStudents, setClassStudents] = useState<TeacherClassStudentRecord[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [folderAnalysis, setFolderAnalysis] = useState<Awaited<ReturnType<typeof analyzePaperFolder>> | null>(null);
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PlatformPaperAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanImageUrls, setScanImageUrls] = useState<Record<string, string>>({});
  const scanObjectUrlsRef = useRef<string[]>([]);
  const publicationRequestIdRef = useRef(0);
  const submissionRequestIdRef = useRef(0);
  const [gradingAccountId, setGradingAccountId] = useState<string | null>(null);
  const [gradingProjectId, setGradingProjectId] = useState<string | null>(null);
  const [gradingDraftStorageWarning, setGradingDraftStorageWarning] = useState<{ ownerKey: string; visible: boolean }>({ ownerKey: "", visible: false });
  const gradingDraftSourceVersionsRef = useRef(new Map<string, string | null>());
  const restoredGradingDraftKeysRef = useRef(new Set<string>());
  const pendingGradingDraftRestoreKeysRef = useRef(new Set<string>());

  function setGradingDrafts(update: GradingDrafts | ((current: GradingDrafts) => GradingDrafts)) {
    setGradingDraftState((current) => {
      if (gradingDraftOwnerRef.current !== gradingOwnerKey) return current;
      const existing = current.ownerKey === gradingOwnerKey ? current.drafts : {};
      const drafts = typeof update === "function" ? update(existing) : update;
      return { ownerKey: gradingOwnerKey, drafts };
    });
  }

  const clearScanObjectUrls = useCallback(() => {
    scanObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    scanObjectUrlsRef.current = [];
    setScanImageUrls({});
  }, []);

  useEffect(() => {
    return () => scanObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    void getAccountProfile()
      .then(({ profile }) => {
        const subjects = profile.subjects ?? [];
        setGradingAccountId(profile.id || null);
        setTeacherSubjects(subjects);
        setSelectedSubject((current) => current || (subjects.length === 1 ? subjects[0] : ""));
      })
      .catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    void apiGet<{ bound?: boolean; root?: string | null; project_id?: string | null }>("/api/project/info")
      .then((info) => {
        if (!active) return;
        const projectId = info.bound
          ? (info.project_id || info.root || "").trim().replace(/\\/g, "/").replace(/\/+$/, "")
          : "";
        setGradingProjectId(projectId || null);
      })
      .catch(() => { if (active) setGradingProjectId(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void listContentFolders("paper").then((result) => setFolders(result.folders)).catch(reportError);
    void listTaggedItems("paper").then((result) => setTaggedItems(result.items)).catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recipientScope !== "student" || selectedClassIds.length !== 1) { setClassStudents([]); return; }
    let active = true;
    void listTeacherClassStudents(selectedClassIds[0]).then((result) => { if (active) setClassStudents(result.students); }).catch(reportError);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientScope, selectedClassIds.join(",")]);

  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.paper_id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );
  const gradingOwnerKey = [gradingAccountId ?? "account-unavailable", gradingProjectId ?? "project-unavailable", selectedPaper?.paper_id ?? selectedPaperId].join("/");
  const gradingDraftOwnerRef = useRef(gradingOwnerKey);
  if (gradingDraftOwnerRef.current !== gradingOwnerKey) {
    gradingDraftOwnerRef.current = gradingOwnerKey;
    gradingDraftSourceVersionsRef.current.clear();
    restoredGradingDraftKeysRef.current.clear();
    pendingGradingDraftRestoreKeysRef.current.clear();
  }
  const gradingDrafts = gradingDraftState.ownerKey === gradingOwnerKey ? gradingDraftState.drafts : {};
  const gradingRequests = usePaperGrading(gradingOwnerKey);
  const gradingStorageScope = gradingAccountId && gradingProjectId && selectedPaper
    ? { accountId: gradingAccountId, projectId: gradingProjectId, paperId: selectedPaper.paper_id }
    : null;

  useEffect(() => {
    if (!gradingStorageScope) return;
    const restoreEntries: Array<{
      key: string;
      storageKey: string;
      source: GradingDraftSource;
      record: NonNullable<ReturnType<typeof readGradingDraft>["draft"]>;
    }> = [];
    submissions.forEach((submission) => submission.answers.forEach((answer) => {
      const key = gradeKey(submission.attempt_id, answer.question_id);
      const storageScope = gradingDraftStorageScope(gradingStorageScope, submission.attempt_id, answer.question_id);
      const storageKey = `${gradingOwnerKey}/${submission.attempt_id}/${answer.question_id}`;
      if (restoredGradingDraftKeysRef.current.has(storageKey)) return;
      restoredGradingDraftKeysRef.current.add(storageKey);
      const result = readGradingDraft(storageScope);
      if (result.status === "corrupted" || result.status === "unavailable") setGradingDraftStorageWarning({ ownerKey: gradingOwnerKey, visible: true });
      if (!result.draft) return;
      if (!gradingDraftSourceVersionsRef.current.has(key)) {
        gradingDraftSourceVersionsRef.current.set(key, result.draft.sourceVersion);
      }
      pendingGradingDraftRestoreKeysRef.current.add(storageKey);
      restoreEntries.push({ key, storageKey, source: toGradingDraftSource(answer), record: result.draft });
    }));
    if (restoreEntries.length > 0) {
      setGradingDrafts((current) => {
        const next = { ...current };
        restoreEntries.forEach(({ key, source, record }) => {
          next[key] = restoreGradingDraft(
            getGradingDraft(current, key, source),
            record,
          );
        });
        return next;
      });
    }
  }, [gradingStorageScope?.accountId, gradingStorageScope?.projectId, gradingStorageScope?.paperId, gradingOwnerKey, submissions]);

  useEffect(() => {
    if (!gradingStorageScope) return;
    submissions.forEach((submission) => submission.answers.forEach((answer) => {
      const key = gradeKey(submission.attempt_id, answer.question_id);
      const storageKey = `${gradingOwnerKey}/${submission.attempt_id}/${answer.question_id}`;
      if (pendingGradingDraftRestoreKeysRef.current.has(storageKey)) {
        pendingGradingDraftRestoreKeysRef.current.delete(storageKey);
        return;
      }
      const draft = gradingDrafts[key];
      if (!draft) return;
      if (!draft.score.dirty && !draft.feedback.dirty) {
        gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
      } else if (!gradingDraftSourceVersionsRef.current.has(key)) {
        gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
      }
      const ok = writeGradingDraft(
        gradingDraftStorageScope(gradingStorageScope, submission.attempt_id, answer.question_id),
        draft,
        gradingDraftSourceVersionsRef.current.get(key) ?? null,
      );
      if (!ok) setGradingDraftStorageWarning({ ownerKey: gradingOwnerKey, visible: true });
    }));
  }, [gradingDrafts, gradingStorageScope?.accountId, gradingStorageScope?.projectId, gradingStorageScope?.paperId, submissions]);
  const activePublishedClassIds = useMemo(() => {
    const ids = new Set<string>();
    publications
      .filter((publication) => publication.status !== "revoked" && publication.recipient_scope !== "student")
      .forEach((publication) => {
        publication.class_ids.forEach((classId) => ids.add(classId));
      });
    return ids;
  }, [publications]);

  function reportError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    onError?.(text);
    setMessage(text);
  }

  async function loadPublications(paperId: string) {
    const requestId = ++publicationRequestIdRef.current;
    try {
      const data = await listPlatformPaperPublications(paperId);
      if (publicationRequestIdRef.current === requestId) setPublications(data.publications);
    } catch (e) {
      if (publicationRequestIdRef.current === requestId) reportError(e);
    }
  }

  async function refresh() {
    setLoading(true);
    onError?.(null);
    setMessage(null);
    try {
      const [paperData, classData] = await Promise.all([
        listPlatformPapers({
          q: paperQuery.q,
          deliveryMode: paperQuery.deliveryMode,
          status: paperQuery.status,
          page: paperQuery.page,
          pageSize: paperQuery.pageSize,
          folderId: browserFolderId,
        }),
        listTeacherAssignedClasses(),
      ]);
      setPapers(paperData.papers);
      setPaperMeta(mergeMeta(paperData, paperQuery, paperData.papers.length));
      setClasses(classData.classes);
      const nextPaperId =
        selectedPaperId && paperData.papers.some((paper) => paper.paper_id === selectedPaperId)
          ? selectedPaperId
          : paperData.papers[0]?.paper_id ?? "";
      setSelectedPaperId(nextPaperId);
      if (nextPaperId) {
        await loadPublications(nextPaperId);
      } else {
        setPublications([]);
      }
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperQuery.q, paperQuery.deliveryMode, paperQuery.status, paperQuery.page, paperQuery.pageSize, browserFolderId]);

  useEffect(() => {
    if (!openTarget) return;
    setPaperQuery((current) => ({ ...current, q: openTarget.title, deliveryMode: "all", status: "all", page: 1 }));
  }, [openTarget?.paperId]);

  useEffect(() => {
    if (!openTarget || !papers.some((paper) => paper.paper_id === openTarget.paperId)) return;
    setSelectedPaperId(openTarget.paperId);
    setPaperDetailView("grading");
  }, [openTarget?.paperId, papers]);

  useEffect(() => {
    submissionRequestIdRef.current += 1;
    setBusy((current) => current?.startsWith("grade:") || current?.startsWith("ai-grade:") || current?.startsWith("submissions:") ? null : current);
    if (selectedPaperId) {
      void loadPublications(selectedPaperId);
    } else {
      setPublications([]);
    }
    setSubmissions([]);
    setSelectedGradingAttemptId("");
    setGradingDrafts({});
    clearScanObjectUrls();
    setSelectedClassIds(assignStudent && selectedPaperId ? [assignStudent.classId] : []);
    setPublishFolderId("");
    setSelectedStudentIds(assignStudent && selectedPaperId ? [assignStudent.studentId] : []);
    if (assignStudent && selectedPaperId) { setRecipientScope("student"); onAssignStudentConsumed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPaperId, clearScanObjectUrls]);

  async function setDeliveryMode(paper: PlatformPaperRecord, mode: PlatformPaperRecord["delivery_mode"]) {
    setBusy(`mode:${paper.paper_id}`);
    setMessage(null);
    try {
      const updated = await updatePlatformPaperDeliveryMode(paper.paper_id, mode);
      setPapers((current) =>
        current.map((item) => (item.paper_id === paper.paper_id ? { ...item, delivery_mode: updated.paper.delivery_mode } : item)),
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function toggleClass(classId: string) {
    if (recipientScope === "class" && activePublishedClassIds.has(classId)) {
      return;
    }
    if (recipientScope === "student") {
      setSelectedClassIds([classId]);
      setSelectedStudentIds([]);
      return;
    }
    setSelectedClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  async function publishSelectedPaper() {
    if (!selectedPaper) return;
    if (selectedPaper.question_count <= 0) {
      setMessage("试卷至少需要包含 1 道题后才能发布。");
      return;
    }
    if (selectedClassIds.length === 0) {
      setMessage("请选择要发布的班级。");
      return;
    }
    if (!publishFolderId) { setMessage("请选择试卷文件夹或归类文件夹。"); return; }
    if (recipientScope === "student" && selectedStudentIds.length === 0) { setMessage("请选择接收练习的学生。"); return; }
    if (recipientScope === "student" && folders.find((folder) => folder.id === publishFolderId)?.kind !== "paper") {
      setMessage("指定学生发布须选择试卷文件夹。"); return;
    }
    if (teacherSubjects.length > 1 && !selectedSubject) {
      setMessage("你设置了多个学科，请选择本次发布所用学科。");
      return;
    }
    setBusy(`publish:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await publishPlatformPaper(selectedPaper.paper_id, {
        class_ids: selectedClassIds,
        student_ids: recipientScope === "student" ? selectedStudentIds : [],
        folder_id: publishFolderId,
        title: selectedPaper.title,
        start_at: publishStartAt ? new Date(publishStartAt).toISOString() : null,
        end_at: publishEndAt ? new Date(publishEndAt).toISOString() : null,
        submission_mode: submissionMode,
        max_screen_switches: maxScreenSwitches,
        time_limit_minutes: timeLimitMinutes > 0 ? timeLimitMinutes : null,
        subject: selectedSubject || teacherSubjects[0] || selectedPaper.subject,
      });
      setPapers((current) =>
        current.map((item) =>
          item.paper_id === selectedPaper.paper_id
            ? {
                ...item,
                delivery_mode: "online",
                status: "published",
                publication_count: item.publication_count + 1,
                published_class_count: item.published_class_count + selectedClassIds.length,
              }
            : item,
        ),
      );
      setSelectedClassIds([]);
      setSelectedStudentIds([]);
      setMessage("已发布");
      await loadPublications(selectedPaper.paper_id);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function revokePublication(publication: PaperPublicationRecord) {
    if (!selectedPaper) return;
    setBusy(`revoke:${publication.id}`);
    setMessage(null);
    try {
      await revokePlatformPaperPublication(selectedPaper.paper_id, publication.id);
      await refresh();
      setMessage("已撤回发布");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function togglePublicationPause(publication: PaperPublicationRecord) {
    if (!selectedPaper) return;
    const nextStatus = publication.status === "paused" ? "published" : "paused";
    setBusy(`pause:${publication.id}`);
    setMessage(null);
    try {
      await updatePlatformPaperPublication(selectedPaper.paper_id, publication.id, { status: nextStatus });
      await loadPublications(selectedPaper.paper_id);
      setMessage(nextStatus === "paused" ? "已暂停收取提交" : "已恢复收取提交");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function downloadScoreTemplate() {
    if (!selectedPaper) return;
    try {
      const { blob, filename } = await apiDownloadBlob(`/api/exams/${encodeURIComponent(selectedPaper.exam_id)}/score-template`);
      downloadBlob(blob, filename || "成绩模板.csv");
    } catch (error) {
      reportError(error);
    }
  }

  async function uploadScores(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedPaper) return;
    setBusy(`scores:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await uploadPaperScores(selectedPaper.exam_id, file);
      setMessage("成绩已上传");
      await refresh();
    } catch (e) {
      reportError(e);
    } finally {
      event.target.value = "";
      setBusy(null);
    }
  }

  async function loadSelectedAnalysis(publicationId?: string, classId?: string) {
    if (!selectedPaper) return;
    setBusy(`analysis:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      const result = await analyzePlatformPaper(selectedPaper.paper_id, publicationId, classId);
      setAnalysis(result.analysis);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function downloadSelectedReport(format: "xlsx" | "pdf") {
    if (!selectedPaper) return;
    setBusy(`report:${format}:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      const blob = await downloadPaperAnalysisReport(selectedPaper.paper_id, format, analysis?.publication_id ?? undefined, analysis?.class_id ?? undefined);
      downloadBlob(blob, `${selectedPaper.title || selectedPaper.exam_id}-analysis-report.${format}`);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function downloadAnalysisReport() {
    void downloadSelectedReport("xlsx");
  }

  async function printAnalysisReport() {
    if (Date.now() >= 0) {
      await downloadSelectedReport("pdf");
      return;
    }
    if (!analysis) return;
    const rows = analysis.students
      .map(
        (student) =>
          `<tr><td>${htmlEscape(student.display_name)}</td><td>${htmlEscape(student.student_no || "")}</td><td>${htmlEscape(student.status)}</td><td>${htmlEscape(student.score_percent ?? "")}</td><td>${htmlEscape(student.screen_switch_count)}</td></tr>`,
      )
      .join("");
    const modules = (analysis.modules ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.label || item.module_id)}</td><td>${htmlEscape(item.question_count)}</td><td>${htmlEscape(item.answered_count)}</td><td>${htmlEscape(item.average_score_percent ?? "")}</td><td>${htmlEscape(item.risk_level ?? "")}</td></tr>`,
      )
      .join("");
    const classes = (analysis.classes ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.class_name)}</td><td>${htmlEscape(item.student_count)}</td><td>${htmlEscape(item.completion_rate)}%</td><td>${htmlEscape(item.average_score ?? "")}</td><td>${htmlEscape(item.screen_switch_count)}</td></tr>`,
      )
      .join("");
    const questions = (analysis.questions ?? [])
      .map(
        (item) =>
          `<tr><td>${htmlEscape(item.header || item.question_id)}</td><td>${htmlEscape(item.section_id || "")}</td><td>${htmlEscape(item.answered_count)}</td><td>${htmlEscape(item.accuracy_rate ?? "")}</td><td>${htmlEscape(item.average_score_percent ?? "")}</td><td>${htmlEscape(item.risk_level ?? "")}</td></tr>`,
      )
      .join("");
    const popup = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>${htmlEscape(analysis.paper.title)} Analysis</title>
      <style>${analysisPrintCss}</style></head><body>
      <h1>${htmlEscape(analysis.paper.title)}</h1>
      <p>${htmlEscape(analysis.paper.subject || "")} ${htmlEscape(analysis.paper.exam_id || "")}</p>
      <div class="grid">
        <div class="metric">完成率<br/><strong>${analysis.summary.completion_rate}%</strong></div>
        <div class="metric">平均分<br/><strong>${analysis.summary.average_score ?? "-"}</strong></div>
        <div class="metric">切屏<br/><strong>${analysis.proctoring.screen_switch_count}</strong></div>
        <div class="metric">超限<br/><strong>${analysis.proctoring.exceeded_student_count ?? analysis.proctoring.flagged_student_count}</strong></div>
      </div>
      <h2>模块报告</h2>
      <table><thead><tr><th>模块</th><th>题数</th><th>作答</th><th>得分率</th><th>风险</th></tr></thead><tbody>${modules}</tbody></table>
      <h2>班级报表</h2>
      <table><thead><tr><th>班级</th><th>人数</th><th>完成率</th><th>平均分</th><th>切屏</th></tr></thead><tbody>${classes}</tbody></table>
      <h2>题目报表</h2>
      <table><thead><tr><th>题目</th><th>模块</th><th>作答</th><th>正确率</th><th>得分率</th><th>风险</th></tr></thead><tbody>${questions}</tbody></table>
      <h2>学生分析</h2>
      <table><thead><tr><th>学生</th><th>学号</th><th>状态</th><th>得分率</th><th>切屏</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function loadSelectedSubmissions() {
    if (!selectedPaper) return;
    const requestId = ++submissionRequestIdRef.current;
    const gradingRefresh = gradingRequests.beginRefresh();
    clearScanObjectUrls();
    setBusy(`submissions:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      const result = await listPaperSubmissions(selectedPaper.paper_id);
      if (submissionRequestIdRef.current === requestId && gradingRequests.isCurrentRefresh(gradingRefresh)) {
        const sources = result.submissions.flatMap((submission) =>
          submission.answers.map((answer) => ({
            key: gradeKey(submission.attempt_id, answer.question_id),
            source: toGradingDraftSource(answer),
          })),
        );
        const refreshableFields = new Map<string, { score: boolean; feedback: boolean }>();
        sources.forEach(({ key }) => {
          refreshableFields.set(key, {
            score: gradingRequests.acceptRefreshField(gradingRefresh, key, "score"),
            feedback: gradingRequests.acceptRefreshField(gradingRefresh, key, "feedback"),
          });
        });
        setSubmissions((current) => reconcileSubmissionSnapshot(current, result.submissions, refreshableFields));
        setGradingDrafts((current) => reconcileGradingDrafts(
          current,
          sources,
          (key, field) => refreshableFields.get(key)?.[field] ?? true,
        ));
        setSelectedGradingAttemptId((current) => {
          if (result.submissions.some((item) => item.attempt_id === current)) return current;
          return (
            result.submissions.find((item) => item.status === "submitted" && item.answers.length > 0)?.attempt_id ??
            result.submissions[0]?.attempt_id ??
            ""
          );
        });
      }
    } catch (e) {
      if (submissionRequestIdRef.current === requestId && gradingRequests.isCurrentRefresh(gradingRefresh)) reportError(e);
    } finally {
      if (submissionRequestIdRef.current === requestId && gradingRequests.isCurrentRefresh(gradingRefresh)) {
        setBusy((current) => current === `submissions:${selectedPaper.paper_id}` ? null : current);
      }
    }
  }

  useEffect(() => {
    if (!openTarget || selectedPaperId !== openTarget.paperId) return;
    setSelectedGradingAttemptId(openTarget.attemptId);
    void loadSelectedSubmissions().finally(() => onOpenTargetConsumed?.());
    // This navigation runs once after the target paper is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget?.paperId, selectedPaperId]);

  function gradeKey(attemptId: string, questionId: string) {
    return `${attemptId}:${questionId}`;
  }

  async function saveGrade(submission: PaperSubmissionRecord, questionId: string) {
    if (!selectedPaper) return;
    const key = gradeKey(submission.attempt_id, questionId);
    const answer = submission.answers.find((item) => item.question_id === questionId);
    const source = answer ? toGradingDraftSource(answer) : {};
    const draft = getGradingDraft(gradingDrafts, key, source);
    const score = parseGradingScore(draft.score.value);
    if (score === null) {
      setMessage("请输入有效分数。");
      return;
    }
    const feedback = gradingFeedbackForSave(draft.feedback);
    const currentVersion = answer?.grading_version ?? null;
    const sourceVersion = gradingDraftSourceVersionsRef.current.has(key)
      ? gradingDraftSourceVersionsRef.current.get(key) ?? null
      : currentVersion;
    const versionChanged = gradingDraftSourceVersionsRef.current.has(key) && sourceVersion !== currentVersion;
    if (versionChanged && !window.confirm("服务器批改版本已变化。本地分数或评语基于较早版本，继续保存将以当前服务器版本为准覆盖相应内容，是否继续？")) {
      setMessage("已取消保存；本地批改草稿仍保留，请核对服务器内容后再试。");
      return;
    }
    const confirmedVersion = versionChanged ? answer?.grading_version : undefined;
    const gradingSave = gradingRequests.beginSave(key);
    setBusy(`grade:${key}`);
    setMessage(null);
    try {
      const payload = {
        score,
        feedback,
        is_correct: null,
      };
      const queuedSave = await gradingRequests.enqueueSave(gradingSave, async () => {
        const latestSourceVersion = gradingDraftSourceVersionsRef.current.get(key);
        const queueAdvancedVersion = latestSourceVersion !== undefined && latestSourceVersion !== sourceVersion && latestSourceVersion !== null
          ? latestSourceVersion
          : undefined;
        const expectedVersion = queueAdvancedVersion ?? confirmedVersion ?? latestSourceVersion ?? currentVersion ?? undefined;
        const result = expectedVersion
          ? await gradePaperAnswer(selectedPaper.paper_id, submission.attempt_id, questionId, payload, expectedVersion)
          : await gradePaperAnswer(selectedPaper.paper_id, submission.attempt_id, questionId, payload);
        if (gradingRequests.isCurrentScope(gradingSave.scopeVersion)) {
          gradingDraftSourceVersionsRef.current.set(key, result.answer.grading_version ?? expectedVersion ?? null);
        }
        return result;
      });
      if (!queuedSave.started) return;
      const result = queuedSave.value;
      const accepted = gradingRequests.acceptSave(gradingSave);
      if (!accepted.current) return;
      setSubmissions((current) =>
        current.map((item) =>
          item.attempt_id === submission.attempt_id
            ? {
                ...item,
                answers: item.answers.map((answer) =>
                  answer.question_id === questionId ? { ...answer, ...result.answer } : answer,
                ),
              }
            : item,
        ),
      );
      setGradingDrafts((current) => ({
        ...current,
        [key]: markGradingDraftSaved(
          current[key] ?? draft,
          {
            score: String(result.answer.score ?? score),
            feedback: result.answer.feedback ?? feedback ?? "",
          },
          (Object.keys(accepted.fields) as Array<keyof typeof accepted.fields>).filter((field) => accepted.fields[field]),
        ),
      }));
      await loadSelectedSubmissions();
      if (gradingRequests.isCurrentSave(gradingSave)) setMessage(gradingSaveMessage(accepted.fields));
    } catch (e) {
      gradingRequests.finishSave(gradingSave);
      if (gradingRequests.isCurrentSave(gradingSave)) reportError(e);
    } finally {
      if (gradingRequests.isCurrentSave(gradingSave)) setBusy((current) => current === `grade:${key}` ? null : current);
    }
  }

  async function completeGrading(submission: PaperSubmissionRecord) {
    if (!selectedPaper) return;
    if (!submission.submitted_at && !["submitted", "completed"].includes(submission.status)) {
      setMessage("该学生尚未提交答卷，提交后才能发布批改结果。");
      return;
    }
    setBusy(`complete:${submission.attempt_id}`);
    setMessage(null);
    try {
      await completePaperAttemptGrading(selectedPaper.paper_id, submission.attempt_id);
      await Promise.all([loadSelectedSubmissions(), refresh()]);
      setMessage(`已完成 ${submission.student_name || submission.student_no || "该学生"} 的批改并向学生发布成绩。`);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  }

  async function suggestSubmissionGrades(submission: PaperSubmissionRecord) {
    if (!selectedPaper) return;
    const pendingQuestionIds = submission.answers
      .filter((answer) => (answer.grading_status || "pending") === "pending")
      .map((answer) => answer.question_id);
    if (pendingQuestionIds.length === 0) {
      setMessage("该答卷没有待预批改题目。");
      return;
    }
    const questionIds = pendingQuestionIds.slice(0, 50);
    const gradingAiRequest = gradingRequests.beginAiRequest(questionIds.map((id) => gradeKey(submission.attempt_id, id)));
    setBusy(`ai-grade:${submission.attempt_id}`);
    setMessage(null);
    try {
      const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
      let filteredSuggestionFieldCount = 0;
      let fullyFilteredSuggestionCount = 0;
      const acceptedSuggestions: AcceptedAiSuggestion[] = result.suggestions.flatMap((suggestion) => {
        const key = gradeKey(submission.attempt_id, suggestion.question_id);
        const offeredFields = [
          ...(suggestion.suggested_score != null ? ["score" as const] : []),
          ...(suggestion.feedback ? ["feedback" as const] : []),
        ];
        if (offeredFields.length === 0) return [];
        const fields = gradingRequests.isCurrentAiRequest(gradingAiRequest, key)
          ? gradingRequests.acceptAiFields(gradingAiRequest, key, offeredFields)
          : [];
        filteredSuggestionFieldCount += offeredFields.length - fields.length;
        if (fields.length === 0) fullyFilteredSuggestionCount += 1;
        return fields.length > 0
          ? [{
              attemptId: submission.attempt_id,
              questionId: suggestion.question_id,
              status: suggestion.status,
              suggestedScore: suggestion.suggested_score,
              feedback: suggestion.feedback,
              fields,
            }]
          : [];
      });
      const suggestions = new Map(acceptedSuggestions.map((item) => [item.questionId, item]));
      setSubmissions((current) =>
        current.map((item) =>
          item.attempt_id === submission.attempt_id
            ? {
                ...item,
                answers: item.answers.map((answer) => {
                  const suggestion = suggestions.get(answer.question_id);
                  return suggestion
                    ? {
                        ...answer,
                        grading_status: suggestion.status || "needs_review",
                        ...(suggestion.fields.includes("score") ? { ai_suggested_score: suggestion.suggestedScore ?? null } : {}),
                        ...(suggestion.fields.includes("feedback") ? { ai_feedback: suggestion.feedback ?? null } : {}),
                      }
                    : answer;
                }),
              }
            : item,
        ),
      );
      setGradingDrafts((current) => applyGradingSuggestions(current, acceptedSuggestions.map((suggestion) => ({
        key: gradeKey(suggestion.attemptId, suggestion.questionId),
        score: suggestion.fields.includes("score") ? suggestion.suggestedScore : null,
        feedback: suggestion.fields.includes("feedback") ? suggestion.feedback : null,
      }))));
      const generatedCount = acceptedSuggestions.filter((item) => item.status === "needs_review" || !item.status).length;
      const retryableCount = acceptedSuggestions.filter((item) => item.status === "pending").length;
      const remainingCount = Math.max(0, pendingQuestionIds.length - questionIds.length);
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        const filteredNotice = filteredSuggestionFieldCount > 0 ? `；忽略了 ${filteredSuggestionFieldCount} 个过期字段` : "";
        const message = acceptedSuggestions.length === 0 && fullyFilteredSuggestionCount > 0
          ? "AI 预批改结果已过期，当前分数和评语未被覆盖；请重新发起预批改。"
          : generatedCount > 0
            ? `已生成 ${generatedCount} 条 AI 预批改建议${filteredNotice}；${retryableCount + remainingCount} 题仍待处理，请教师复核后保存。`
            : `本次未生成有效 AI 建议${filteredNotice}，${retryableCount + remainingCount} 题仍保持待处理，可检查模型/OCR 后重试。`;
        setMessage(message);
      }
    } catch (e) {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) reportError(e);
    } finally {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        setBusy((current) => current === `ai-grade:${submission.attempt_id}` ? null : current);
      }
    }
  }

  async function suggestLoadedPendingGrades() {
    if (!selectedPaper) return;
    const candidates = submissions
      .filter(
        (submission) =>
          submission.status === "submitted" &&
          submission.answers.some((answer) => (answer.grading_status || "pending") === "pending"),
      )
      .slice(0, 10);
    if (candidates.length === 0) {
      setMessage("当前已加载答卷中没有待预批改内容。");
      return;
    }
    let remainingQuestionBudget = 50;
    const batchPlan = candidates
      .map((submission) => {
        const questionIds = submission.answers
          .filter((answer) => (answer.grading_status || "pending") === "pending")
          .map((answer) => answer.question_id)
          .slice(0, remainingQuestionBudget);
        remainingQuestionBudget -= questionIds.length;
        return { submission, questionIds };
      })
      .filter((item) => item.questionIds.length > 0);
    const plannedQuestionCount = batchPlan.reduce((total, item) => total + item.questionIds.length, 0);
    if (!window.confirm(`将为 ${batchPlan.length} 份答卷的 ${plannedQuestionCount} 道题生成 AI 建议（本次最多 50 题），是否继续？`)) return;
    const gradingAiRequest = gradingRequests.beginAiRequest(batchPlan.flatMap(({ submission, questionIds }) =>
      questionIds.map((questionId) => gradeKey(submission.attempt_id, questionId)),
    ));
    setBusy("ai-grade:batch");
    setMessage(null);
    const completed: Array<{
      attemptId: string;
      suggestions: Array<{ question_id: string; suggested_score?: number | null; feedback?: string | null; status: string }>;
    }> = [];
    let failed = 0;
    let filteredSuggestionFieldCount = 0;
    let fullyFilteredSuggestionCount = 0;
    try {
      for (const { submission, questionIds } of batchPlan) {
        if (!gradingRequests.isCurrentAiBatch(gradingAiRequest)) break;
        try {
          const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
          completed.push({ attemptId: submission.attempt_id, suggestions: result.suggestions });
        } catch {
          failed += 1;
        }
      }
      const acceptedSuggestions: AcceptedAiSuggestion[] = completed.flatMap(({ attemptId, suggestions }) =>
        suggestions.flatMap((suggestion) => {
          const key = gradeKey(attemptId, suggestion.question_id);
          const offeredFields = [
            ...(suggestion.suggested_score != null ? ["score" as const] : []),
            ...(suggestion.feedback ? ["feedback" as const] : []),
          ];
          if (offeredFields.length === 0) return [];
          const fields = gradingRequests.isCurrentAiRequest(gradingAiRequest, key)
            ? gradingRequests.acceptAiFields(gradingAiRequest, key, offeredFields)
            : [];
          filteredSuggestionFieldCount += offeredFields.length - fields.length;
          if (fields.length === 0) fullyFilteredSuggestionCount += 1;
          return fields.length > 0
            ? [{
                attemptId,
                questionId: suggestion.question_id,
                status: suggestion.status,
                suggestedScore: suggestion.suggested_score,
                feedback: suggestion.feedback,
                fields,
              }]
            : [];
        }),
      );
      const byAttempt = new Map<string, Map<string, AcceptedAiSuggestion>>();
      acceptedSuggestions.forEach((suggestion) => {
        const byQuestion = byAttempt.get(suggestion.attemptId) ?? new Map<string, AcceptedAiSuggestion>();
        byQuestion.set(suggestion.questionId, suggestion);
        byAttempt.set(suggestion.attemptId, byQuestion);
      });
      setSubmissions((current) =>
        current.map((submission) => {
          const suggestions = byAttempt.get(submission.attempt_id);
          if (!suggestions) return submission;
          return {
            ...submission,
            answers: submission.answers.map((answer) => {
              const suggestion = suggestions.get(answer.question_id);
              return suggestion
                ? {
                    ...answer,
                    grading_status: suggestion.status || "needs_review",
                    ...(suggestion.fields.includes("score") ? { ai_suggested_score: suggestion.suggestedScore ?? null } : {}),
                    ...(suggestion.fields.includes("feedback") ? { ai_feedback: suggestion.feedback ?? null } : {}),
                  }
                : answer;
            }),
          };
        }),
      );
      setGradingDrafts((current) => applyGradingSuggestions(current, acceptedSuggestions.map((suggestion) => ({
        key: gradeKey(suggestion.attemptId, suggestion.questionId),
        score: suggestion.fields.includes("score") ? suggestion.suggestedScore : null,
        feedback: suggestion.fields.includes("feedback") ? suggestion.feedback : null,
      }))));
      const generatedCount = acceptedSuggestions.filter((suggestion) => suggestion.status === "needs_review" || !suggestion.status).length;
      const retryableCount = acceptedSuggestions.filter((suggestion) => suggestion.status === "pending").length;
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        const filteredNotice = filteredSuggestionFieldCount > 0 ? `，忽略 ${filteredSuggestionFieldCount} 个过期字段` : "";
        const message = acceptedSuggestions.length === 0 && fullyFilteredSuggestionCount > 0
          ? `AI 批量预批改结果已过期，当前批改内容未被覆盖${failed ? `，${failed} 份处理失败` : ""}。`
          : `AI 批量预批改完成：生成 ${generatedCount} 条建议，${retryableCount} 题可重试${filteredNotice}${failed ? `，${failed} 份处理失败` : ""}。请教师逐题复核。`;
        setMessage(message);
      }
    } finally {
      if (gradingRequests.isCurrentAiOperation(gradingAiRequest)) {
        setBusy((current) => current === "ai-grade:batch" ? null : current);
      }
    }
  }

  async function downloadOfflineUploader() {
    setBusy("offline-uploader");
    setMessage(null);
    try {
      const blob = await downloadOfflineAnswerUploader();
      downloadBlob(blob, "OriginReach-Offline-Answer-Uploader.exe");
      setMessage("线下答卷采集器已下载。当前程序未做商业代码签名，Windows 可能提示“未知发布者”；请确认文件来自本系统后再运行。");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function loadOfflineScanImage(submission: PaperSubmissionRecord, pageIndex: number) {
    if (!selectedPaper) return;
    const key = `${submission.attempt_id}:${pageIndex}`;
    if (scanImageUrls[key]) return;
    setBusy(`scan:${key}`);
    try {
      const blob = await downloadOfflineScanImage(selectedPaper.paper_id, submission.attempt_id, pageIndex);
      const url = URL.createObjectURL(blob);
      scanObjectUrlsRef.current.push(url);
      setScanImageUrls((current) => ({ ...current, [key]: url }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function updatePaperQuery(patch: Partial<PaperQuery>) {
    setPaperQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }

  const modeBusy = selectedPaper ? busy === `mode:${selectedPaper.paper_id}` : false;
  const publishBusy = selectedPaper ? busy === `publish:${selectedPaper.paper_id}` : false;
  const scoresBusy = selectedPaper ? busy === `scores:${selectedPaper.paper_id}` : false;
  const analysisBusy = selectedPaper ? busy === `analysis:${selectedPaper.paper_id}` : false;
  const submissionsBusy = selectedPaper ? busy === `submissions:${selectedPaper.paper_id}` : false;
  const selectedGradingSubmission =
    submissions.find((submission) => submission.attempt_id === selectedGradingAttemptId) ?? submissions[0] ?? null;
  const canPublish =
    Boolean(selectedPaper) && !publishBusy && Number(selectedPaper?.question_count || 0) > 0 && selectedClassIds.length > 0 && Boolean(publishFolderId) && (recipientScope === "class" || selectedStudentIds.length > 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50 text-slate-950">
      <header className="flex shrink-0 flex-col items-stretch gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">试卷管理</h1>
            <p className="text-sm text-slate-500">线上发布、线下成绩和分析入口</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="paper-download-offline-uploader"
            onClick={() => void downloadOfflineUploader()}
            disabled={busy === "offline-uploader"}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {busy === "offline-uploader" ? "准备下载..." : "下载线下答卷采集器"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,390px)_minmax(0,1fr)] overflow-hidden">
        <PaperListSidebar
          papers={papers}
          selectedPaper={selectedPaper}
          loading={loading}
          query={paperQuery}
          meta={paperMeta}
          folders={folders}
          selectedFolderId={browserFolderId}
          taggedItems={taggedItems}
          onSelectFolder={(id) => { setBrowserFolderId(id); setPaperQuery((query) => ({ ...query, page: 1 })); }}
          onFolderCreated={(folder) => setFolders((current) => [...current, folder])}
          onFolderUpdated={(folder) => setFolders((current) => current.map((item) => item.id === folder.id ? folder : item))}
          onFolderDeleted={(result) => { setFolders(result.folders); setFolderAnalysis(null); if (publishFolderId && !result.folders.some((folder) => folder.id === publishFolderId)) setPublishFolderId(""); }}
          onDropItem={(id, folderId) => void movePaperToFolder(id, folderId).then(() => refresh()).catch(reportError)}
          onError={reportError}
          onAnalyzeFolder={(folderId) => void analyzePaperFolder(folderId).then(setFolderAnalysis).catch(reportError)}
          onSearchChange={(q) => updatePaperQuery({ q })}
          onDeliveryModeChange={(deliveryMode) => updatePaperQuery({ deliveryMode })}
          onStatusChange={(status) => updatePaperQuery({ status })}
          onSelectPaper={(paper) => { setSelectedPaperId(paper.paper_id); setAnalysis(null); }}
          onPage={(page) => updatePaperQuery({ page })}
          onPageSize={(pageSize) => updatePaperQuery({ pageSize })}
        />

        <main className="min-h-0 overflow-auto p-6">
          {selectedPaper ? (
            <div className="mx-auto flex max-w-6xl flex-col gap-5">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{selectedPaper.subject}</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950">{selectedPaper.title}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><ContentTags scope="paper" itemId={selectedPaper.paper_id} onError={(error) => reportError(error)} onChange={() => void listTaggedItems("paper").then((result) => setTaggedItems(result.items))} /><label>归类 <select aria-label="试卷所在文件夹" disabled={selectedPaper.publication_count > 0} title={selectedPaper.publication_count > 0 ? "已有发布记录，请在左侧移动整个文件夹，以保留答卷和统计关系" : undefined} className="rounded border px-2 py-1" value={selectedPaper.folder_id ?? ""} onChange={(event) => void movePaperToFolder(selectedPaper.paper_id, event.target.value).then(() => refresh()).catch(reportError)}>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label></div>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
                      <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.question_count} 题</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.section_count} 个题组</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.submitted_student_count ?? 0} 份已提交</span>
                      <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                        {selectedPaper.published_student_count ?? selectedPaper.graded_student_count ?? 0} 份批改并发布
                      </span>
                      {selectedPaper.score_batch_count > 0 ? <span className="rounded-md bg-slate-100 px-2 py-1">{selectedPaper.score_batch_count} 批线下成绩</span> : null}
                      {selectedPaper.status === "published" ? (
                        <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-700">已发布</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={() => { setPaperDetailView("grading"); void loadSelectedSubmissions(); }} className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100">查看提交与批改{(selectedPaper.submitted_student_count ?? 0) > 0 ? `（${selectedPaper.submitted_student_count}）` : ""}</button>
                  <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-1">
                    <button
                      type="button"
                      data-testid="paper-mode-offline"
                      disabled={modeBusy || selectedPaper.delivery_mode === "offline"}
                      onClick={() => void setDeliveryMode(selectedPaper, "offline")}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        selectedPaper.delivery_mode === "offline"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      } disabled:opacity-70`}
                    >
                      设为线下
                    </button>
                    <button
                      type="button"
                      data-testid="paper-mode-online"
                      disabled={modeBusy || selectedPaper.delivery_mode === "online"}
                      onClick={() => void setDeliveryMode(selectedPaper, "online")}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        selectedPaper.delivery_mode === "online"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      } disabled:opacity-70`}
                    >
                      设为线上
                    </button>
                  </div>
                  </div>
                </div>
              </section>

              <div className="inline-flex w-fit rounded-md border border-slate-300 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  data-testid="paper-tab-manage"
                  onClick={() => setPaperDetailView("manage")}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    paperDetailView === "manage" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  试卷管理
                </button>
                <button
                  type="button"
                  data-testid="paper-tab-grading"
                  onClick={() => {
                    setPaperDetailView("grading");
                    void loadSelectedSubmissions();
                  }}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    paperDetailView === "grading" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  提交批改{(selectedPaper.submitted_student_count ?? 0) > 0 ? `（${selectedPaper.submitted_student_count}）` : ""}
                </button>
              </div>

              {paperDetailView === "manage" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <PaperPublishingSidebar
                  publishPanel={
                    <PaperClassPublishPanel
                      selectedPaper={selectedPaper}
                      folders={folders}
                      publishFolderId={publishFolderId}
                      newFolderName={newFolderName}
                      recipientScope={recipientScope}
                      selectedClassIds={selectedClassIds}
                      selectedStudentIds={selectedStudentIds}
                      studentSearch={studentSearch}
                      classStudents={classStudents}
                      teacherSubjects={teacherSubjects}
                      selectedSubject={selectedSubject}
                      classes={classes}
                      alreadyPublishedClassIds={activePublishedClassIds}
                      submissionMode={submissionMode}
                      maxScreenSwitches={maxScreenSwitches}
                      publishStartAt={publishStartAt}
                      publishEndAt={publishEndAt}
                      timeLimitMinutes={timeLimitMinutes}
                      canPublish={canPublish}
                      onRecipientScopeChange={(scope) => {
                        setRecipientScope(scope);
                        if (scope === "class") setSelectedStudentIds([]);
                        else setSelectedClassIds([]);
                      }}
                      onFolderChange={setPublishFolderId}
                      onConvertFolder={() => void updateContentFolder(publishFolderId, { kind: "paper" }).then(({ folder }) => setFolders((current) => current.map((item) => item.id === folder.id ? folder : item))).catch(reportError)}
                      onNewFolderNameChange={setNewFolderName}
                      onCreateFolder={() => {
                        const parent = folders.find((folder) => folder.id === publishFolderId && folder.kind === "category") ?? folders.find((folder) => folder.kind === "category" && !folder.parent_id);
                        void createContentFolder({ scope: "paper", name: newFolderName.trim(), kind: recipientScope === "student" ? "paper" : "category", parent_id: recipientScope === "student" ? parent?.id : (parent?.id ?? null) }).then(({ folder }) => {
                          setFolders((current) => [...current, folder]);
                          setPublishFolderId(folder.id);
                          setNewFolderName("");
                        }).catch(reportError);
                      }}
                      onSubjectChange={setSelectedSubject}
                      onToggleClass={toggleClass}
                      onStudentSearchChange={setStudentSearch}
                      onToggleStudent={(studentId) => setSelectedStudentIds((ids) => ids.includes(studentId) ? ids.filter((id) => id !== studentId) : [...ids, studentId])}
                      onSubmissionModeChange={setSubmissionMode}
                      onMaxScreenSwitchesChange={setMaxScreenSwitches}
                      onPublishStartAtChange={setPublishStartAt}
                      onPublishEndAtChange={setPublishEndAt}
                      onTimeLimitMinutesChange={setTimeLimitMinutes}
                      onPublish={() => void publishSelectedPaper()}
                    />
                  }
                  publications={publications}
                  clock={clock}
                  busy={busy}
                  onTogglePause={togglePublicationPause}
                  onRevoke={revokePublication}
                />
                <aside className="space-y-4">
                  <Panel title="线下成绩" icon={<Upload className="h-5 w-5 text-slate-600" />}>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void downloadScoreTemplate()}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        下载成绩模板
                      </button>
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        {scoresBusy ? "上传中..." : "上传成绩"}
                        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => void uploadScores(event)} />
                      </label>
                    </div>
                  </Panel>

                  <Panel title="分析" icon={<BarChart3 className="h-5 w-5 text-slate-600" />}>
                    <button
                      type="button"
                      data-testid="paper-load-analysis"
                      disabled={analysisBusy}
                      onClick={() => void loadSelectedAnalysis()}
                      className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {analysisBusy ? "加载中..." : "查看分析摘要"}
                    </button>
                    {analysis ? <p className="mt-3 text-xs text-emerald-700">分析已在大窗口中打开</p> : null}
                    <button
                      type="button"
                      onClick={() => onOpenAnalysis?.(selectedPaper.exam_id)}
                      className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      打开分析
                    </button>
                  </Panel>
                </aside>
              </div>
              ) : (
                <GradingWorkspace
                  submissions={submissions}
                  selectedSubmission={selectedGradingSubmission}
                  batchBusy={busy === "ai-grade:batch"}
                  submissionsBusy={submissionsBusy}
                  storageWarning={gradingDraftStorageWarning.ownerKey === gradingOwnerKey && gradingDraftStorageWarning.visible}
                  onBatch={() => void suggestLoadedPendingGrades()}
                  onReload={() => void loadSelectedSubmissions()}
                  onSelectSubmission={setSelectedGradingAttemptId}
                >
                  {selectedGradingSubmission ? (
                    <PaperSubmissionDetail
                      key={selectedGradingSubmission.attempt_id}
                      submission={selectedGradingSubmission}
                      busy={busy}
                      scanImageUrls={scanImageUrls}
                      onSuggest={() => void suggestSubmissionGrades(selectedGradingSubmission)}
                      onLoadScan={(pageIndex) => void loadOfflineScanImage(selectedGradingSubmission, pageIndex)}
                      onComplete={() => void completeGrading(selectedGradingSubmission)}
                    >
                      {selectedGradingSubmission.answers.map((answer) => {
                        const key = gradeKey(selectedGradingSubmission.attempt_id, answer.question_id);
                        const source = toGradingDraftSource(answer);
                        const draft = getGradingDraft(gradingDrafts, key, source);
                        const sourceVersion = gradingDraftSourceVersionsRef.current.get(key);
                        const versionChanged = gradingDraftSourceVersionsRef.current.has(key) && sourceVersion !== (answer.grading_version ?? null);
                        return (
                          <GradingQuestionCard
                            key={answer.question_id}
                            answer={answer}
                            scoreValue={draft.score.value}
                            feedbackValue={draft.feedback.value}
                            statusLabel={gradingStatusLabel(answer.grading_status)}
                            studentAnswerText={formatStudentAnswer(answer.answer)}
                            saving={busy === "grade:" + key}
                            versionChanged={versionChanged && (draft.score.dirty || draft.feedback.dirty)}
                            onScoreChange={(changedValue) => {
                              gradingRequests.beginEdit(key, "score");
                              if (!gradingDraftSourceVersionsRef.current.has(key)) gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
                              setGradingDrafts((current) => updateGradingDraft(current, key, source, "score", changedValue));
                            }}
                            onFeedbackChange={(changedValue) => {
                              gradingRequests.beginEdit(key, "feedback");
                              if (!gradingDraftSourceVersionsRef.current.has(key)) gradingDraftSourceVersionsRef.current.set(key, answer.grading_version ?? null);
                              setGradingDrafts((current) => updateGradingDraft(current, key, source, "feedback", changedValue));
                            }}
                            onSave={() => void saveGrade(selectedGradingSubmission, answer.question_id)}
                          />
                        );
                      })}
                    </PaperSubmissionDetail>
                  ) : null}
                </GradingWorkspace>
              )}
              {message ? (
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                  {message}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-start justify-center overflow-auto p-6">
              {loading ? <p className="py-16 text-sm text-slate-500">正在加载试卷...</p> : (
                <div className="w-full max-w-5xl space-y-4">
                  <GettingStartedChecklist
                    description="准备题目和模板后即可组卷、预览并发布到班级"
                    steps={[
                      { label: "准备题目", complete: false, actionLabel: "去创建题目", onAction: onOpenBank },
                      { label: "准备试卷模板", complete: false, actionLabel: "去创建模板", onAction: onOpenTemplates },
                      { label: "生成第一份试卷", complete: false, actionLabel: "开始组卷", onAction: onOpenCompose },
                    ]}
                  />
                  <p className="text-center text-sm text-slate-500">当前还没有试卷，可从上面的任一步开始。</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      {analysis ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="试卷分析">
          <section className="flex h-[85vh] w-[85vw] min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{analysis.paper.title} · 试卷分析</h2>
                <p className="mt-1 text-sm text-slate-500">完成情况、题目表现、模块掌握和考试行为数据</p>
              </div>
              <button type="button" aria-label="关闭试卷分析" onClick={() => setAnalysis(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <div className="mb-4 flex flex-wrap gap-2">
                <button type="button" data-testid="paper-export-report-xlsx" onClick={downloadAnalysisReport} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">导出 Excel</button>
                <button type="button" data-testid="paper-export-report-pdf" onClick={() => void printAnalysisReport()} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">导出 PDF</button>
              </div>
              {(analysis.publications?.length ?? 0) > 0 && <label className="block text-sm">发布批次
                <select aria-label="分析发布批次" disabled={busy !== null} value={analysis.publication_id ?? ""} className="ml-3 max-w-full rounded border p-2"
                  onChange={(e) => void loadSelectedAnalysis(e.target.value)}>
                  {analysis.publications?.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.created_at} · {item.id.slice(0, 8)}</option>)}
                </select>
              </label>}
              {(analysis.available_classes?.length ?? 0) > 0 && <label className="ml-3 block text-sm">分析班级
                <select aria-label="分析班级" disabled={busy !== null} value={analysis.class_id ?? ""} className="ml-3 max-w-full rounded border p-2"
                  onChange={(e) => void loadSelectedAnalysis(analysis.publication_id ?? undefined, e.target.value || undefined)}>
                  <option value="">全部班级</option>
                  {analysis.available_classes?.map((item) => <option key={item.id} value={item.id}>{item.name}{item.grade && !item.name.includes(item.grade) ? ` · ${item.grade}` : ""}</option>)}
                </select>
              </label>}
              <PlatformPaperAnalysisCharts analysis={analysis} />
            </div>
          </section>
        </div>
      ) : null}
      {folderAnalysis ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="文件夹分析"><section className="flex h-[85vh] w-[85vw] flex-col overflow-hidden rounded-xl bg-white shadow-xl"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">{folderAnalysis.folder.name} · 文件夹分析</h2><p className="text-xs text-slate-500">仅统计实际收到该练习的学生；不计入班级统考平均分。</p></div><button type="button" aria-label="关闭文件夹分析" onClick={() => setFolderAnalysis(null)}><X className="h-5 w-5" /></button></header><div className="overflow-auto p-5"><div className="mb-4 grid gap-2 text-sm sm:grid-cols-5">{[["接收人数", folderAnalysis.summary.assigned_count], ["已提交", folderAnalysis.summary.submitted_count], ["已批改", folderAnalysis.summary.graded_count], ["发布批次", folderAnalysis.summary.publication_count], ["平均得分率", folderAnalysis.summary.average_score_percent == null ? "暂无" : `${folderAnalysis.summary.average_score_percent}%`]].map(([label, value]) => <div key={label} className="rounded border bg-slate-50 p-3"><div className="text-slate-500">{label}</div><b>{value}</b></div>)}</div><div className="space-y-1 text-sm">{folderAnalysis.attempts.map((attempt, index) => <div key={index} className="flex flex-wrap justify-between gap-2 rounded border p-2"><span>{attempt.display_name} · {attempt.student_no}</span><span>{attempt.title} · {attempt.status} · {attempt.score == null ? "未发布成绩" : `${attempt.score}/${attempt.max_score ?? "—"}`}</span></div>)}</div></div></section></div> : null}
    </div>
  );
}

function toGradingDraftSource(answer: PaperSubmissionRecord["answers"][number]): GradingDraftSource {
  return {
    score: answer.score,
    aiSuggestedScore: answer.ai_suggested_score,
    feedback: answer.feedback,
    aiFeedback: answer.ai_feedback,
  };
}

function gradingDraftStorageScope(
  owner: { accountId: string; projectId: string; paperId: string },
  attemptId: string,
  questionId: string,
): GradingDraftStorageScope {
  return { ...owner, attemptId, questionId };
}

function reconcileSubmissionSnapshot(
  current: PaperSubmissionRecord[],
  incoming: PaperSubmissionRecord[],
  refreshableFields: Map<string, { score: boolean; feedback: boolean }>,
): PaperSubmissionRecord[] {
  const currentByAttempt = new Map(current.map((submission) => [submission.attempt_id, submission]));
  return incoming.map((submission) => {
    const existing = currentByAttempt.get(submission.attempt_id);
    if (!existing) return submission;
    const existingAnswers = new Map(existing.answers.map((answer) => [answer.question_id, answer]));
    return {
      ...submission,
      answers: submission.answers.map((answer) => {
        const previous = existingAnswers.get(answer.question_id);
        const refreshable = refreshableFields.get(`${submission.attempt_id}:${answer.question_id}`);
        if (!previous || !refreshable) return answer;
        return {
          ...answer,
          ...(refreshable.score ? {} : { score: previous.score, ai_suggested_score: previous.ai_suggested_score }),
          ...(refreshable.feedback ? {} : { feedback: previous.feedback, ai_feedback: previous.ai_feedback }),
          ...(!refreshable.score || !refreshable.feedback ? { grading_status: previous.grading_status } : {}),
        };
      }),
    };
  });
}

function gradingSaveMessage(fields: Record<"score" | "feedback", boolean>): string {
  if (fields.score && fields.feedback) return "已保存批改结果";
  if (!fields.score && !fields.feedback) return "已保存发出时的分数和评语；当前有更新的分数和评语未保存。";
  if (!fields.score) return "已保存发出时的评语；当前有更新的分数未保存。";
  return "已保存发出时的分数；当前有更新的评语未保存。";
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}
