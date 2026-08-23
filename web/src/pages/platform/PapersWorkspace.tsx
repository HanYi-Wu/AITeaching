import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  FileImage,
  History,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { resolveApiUrl } from "../../api/client";
import { KatexText } from "../../components/KatexText";
import {
  analyzePlatformPaper,
  completePaperAttemptGrading,
  downloadPaperAnalysisReport,
  downloadOfflineAnswerUploader,
  downloadOfflineScanImage,
  gradePaperAnswer,
  getAccountProfile,
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
} from "../../platform/auth";
import { PlatformPaperAnalysisCharts } from "./AnalysisCharts";
import { GettingStartedChecklist } from "./GettingStartedChecklist";

type Props = {
  onOpenAnalysis?: (examId: string) => void;
  onOpenBank?: () => void;
  onOpenTemplates?: () => void;
  onOpenCompose?: () => void;
  onError?: (message: string | null) => void;
};

type PaperQuery = {
  q: string;
  deliveryMode: "all" | "offline" | "online";
  status: string;
  page: number;
  pageSize: number;
};

type PageMeta = { total: number; page: number; pageSize: number; totalPages: number };

function deliveryLabel(mode: PlatformPaperRecord["delivery_mode"]): string {
  return mode === "online" ? "线上" : "线下";
}

function mergePaper(existing: PlatformPaperRecord, patch: PlatformPaperRecord): PlatformPaperRecord {
  return {
    ...existing,
    ...patch,
    question_count: patch.question_count ?? existing.question_count,
    section_count: patch.section_count ?? existing.section_count,
    score_batch_count: patch.score_batch_count ?? existing.score_batch_count,
    publication_count: patch.publication_count ?? existing.publication_count,
    published_class_count: patch.published_class_count ?? existing.published_class_count,
  };
}

function mergeMeta(
  data: { total?: number; page?: number; page_size?: number; total_pages?: number },
  fallback: PaperQuery,
  itemCount: number,
): PageMeta {
  const pageSize = Number(data.page_size ?? fallback.pageSize);
  const total = Number(data.total ?? itemCount);
  return {
    total,
    page: Number(data.page ?? fallback.page),
    pageSize,
    totalPages: Number(data.total_pages ?? Math.max(1, Math.ceil(total / pageSize))),
  };
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function publicationStatusLabel(status: string): string {
  if (status === "published") return "发布中";
  if (status === "paused") return "已暂停";
  if (status === "closed") return "已关闭";
  if (status === "revoked") return "已撤回";
  return "草稿";
}

function formatStudentAnswer(value: unknown): string {
  if (value == null) return "未作答";
  if (typeof value === "string") return value.trim() || "未作答";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function PapersWorkspace({ onOpenAnalysis, onOpenBank, onOpenTemplates, onOpenCompose, onError }: Props) {
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
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, string>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
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
        setTeacherSubjects(subjects);
        setSelectedSubject((current) => current || (subjects.length === 1 ? subjects[0] : ""));
      })
      .catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.paper_id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );
  const activePublishedClassIds = useMemo(() => {
    const ids = new Set<string>();
    publications
      .filter((publication) => publication.status !== "revoked")
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
  }, [paperQuery.q, paperQuery.deliveryMode, paperQuery.status, paperQuery.page, paperQuery.pageSize]);

  useEffect(() => {
    submissionRequestIdRef.current += 1;
    if (selectedPaperId) {
      void loadPublications(selectedPaperId);
    } else {
      setPublications([]);
    }
    setSubmissions([]);
    setSelectedGradingAttemptId("");
    setGradeDrafts({});
    setFeedbackDrafts({});
    clearScanObjectUrls();
    setSelectedClassIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPaperId, clearScanObjectUrls]);

  async function setDeliveryMode(paper: PlatformPaperRecord, mode: PlatformPaperRecord["delivery_mode"]) {
    setBusy(`mode:${paper.paper_id}`);
    setMessage(null);
    try {
      const updated = await updatePlatformPaperDeliveryMode(paper.paper_id, mode);
      setPapers((current) =>
        current.map((item) => (item.paper_id === paper.paper_id ? mergePaper(item, updated.paper) : item)),
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function toggleClass(classId: string) {
    if (activePublishedClassIds.has(classId)) {
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
    if (teacherSubjects.length > 1 && !selectedSubject) {
      setMessage("你设置了多个学科，请选择本次发布所用学科。");
      return;
    }
    setBusy(`publish:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      await publishPlatformPaper(selectedPaper.paper_id, {
        class_ids: selectedClassIds,
        title: selectedPaper.title,
        start_at: publishStartAt || null,
        end_at: publishEndAt || null,
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
    const url = await resolveApiUrl(`/api/exams/${encodeURIComponent(selectedPaper.exam_id)}/score-template`);
    window.open(url, "_blank", "noopener,noreferrer");
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

  async function loadSelectedAnalysis() {
    if (!selectedPaper) return;
    setBusy(`analysis:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      const result = await analyzePlatformPaper(selectedPaper.paper_id);
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
      const blob = await downloadPaperAnalysisReport(selectedPaper.paper_id, format);
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
      <style>
        body{font-family:Arial,sans-serif;margin:32px;color:#0f172a}
        h1,h2{margin:0 0 12px}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
        .metric{border:1px solid #e2e8f0;padding:12px;border-radius:8px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{border:1px solid #e2e8f0;padding:8px;text-align:left;font-size:12px}
        th{background:#f8fafc}
      </style></head><body>
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
    clearScanObjectUrls();
    setBusy(`submissions:${selectedPaper.paper_id}`);
    setMessage(null);
    try {
      const result = await listPaperSubmissions(selectedPaper.paper_id);
      if (submissionRequestIdRef.current === requestId) {
        setSubmissions(result.submissions);
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
      if (submissionRequestIdRef.current === requestId) reportError(e);
    } finally {
      setBusy(null);
    }
  }

  function gradeKey(attemptId: string, questionId: string) {
    return `${attemptId}:${questionId}`;
  }

  async function saveGrade(submission: PaperSubmissionRecord, questionId: string) {
    if (!selectedPaper) return;
    const key = gradeKey(submission.attempt_id, questionId);
    const answer = submission.answers.find((item) => item.question_id === questionId);
    const rawScore = gradeDrafts[key] ?? String(answer?.score ?? answer?.ai_suggested_score ?? "");
    const score = Number(rawScore);
    if (!rawScore.trim() || !Number.isFinite(score)) {
      setMessage("请输入有效分数。");
      return;
    }
    const feedback = feedbackDrafts[key] ?? null;
    setBusy(`grade:${key}`);
    setMessage(null);
    try {
      const result = await gradePaperAnswer(selectedPaper.paper_id, submission.attempt_id, questionId, {
        score,
        feedback,
        is_correct: null,
      });
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
      setGradeDrafts((current) => ({ ...current, [key]: String(result.answer.score ?? "") }));
      await loadSelectedSubmissions();
      setMessage("已保存批改结果");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function completeGrading(submission: PaperSubmissionRecord) {
    if (!selectedPaper) return;
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
    setBusy(`ai-grade:${submission.attempt_id}`);
    setMessage(null);
    try {
      const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
      const suggestions = new Map(result.suggestions.map((item) => [item.question_id, item]));
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
                        ai_suggested_score: suggestion.suggested_score ?? null,
                        ai_feedback: suggestion.feedback ?? null,
                      }
                    : answer;
                }),
              }
            : item,
        ),
      );
      setGradeDrafts((current) => {
        const next = { ...current };
        result.suggestions.forEach((suggestion) => {
          if (suggestion.suggested_score != null) {
            next[gradeKey(submission.attempt_id, suggestion.question_id)] = String(suggestion.suggested_score);
          }
        });
        return next;
      });
      setFeedbackDrafts((current) => {
        const next = { ...current };
        result.suggestions.forEach((suggestion) => {
          if (suggestion.feedback) {
            next[gradeKey(submission.attempt_id, suggestion.question_id)] = suggestion.feedback;
          }
        });
        return next;
      });
      const generatedCount = result.suggestions.filter((item) => item.status === "needs_review" || !item.status).length;
      const retryableCount = result.suggestions.length - generatedCount;
      const remainingCount = Math.max(0, pendingQuestionIds.length - questionIds.length);
      setMessage(
        generatedCount > 0
          ? `已生成 ${generatedCount} 条 AI 预批改建议；${retryableCount + remainingCount} 题仍待处理，请教师复核后保存。`
          : `本次未生成有效 AI 建议，${retryableCount + remainingCount} 题仍保持待处理，可检查模型/OCR 后重试。`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
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
    setBusy("ai-grade:batch");
    setMessage(null);
    const completed: Array<{
      attemptId: string;
      suggestions: Array<{ question_id: string; suggested_score?: number | null; feedback?: string | null; status: string }>;
    }> = [];
    let failed = 0;
    try {
      for (const { submission, questionIds } of batchPlan) {
        try {
          const result = await suggestAiGradesForAttempt(selectedPaper.paper_id, submission.attempt_id, questionIds);
          completed.push({ attemptId: submission.attempt_id, suggestions: result.suggestions });
        } catch {
          failed += 1;
        }
      }
      const byAttempt = new Map(completed.map((item) => [item.attemptId, new Map(item.suggestions.map((s) => [s.question_id, s]))]));
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
                    ai_suggested_score: suggestion.suggested_score ?? null,
                    ai_feedback: suggestion.feedback ?? null,
                  }
                : answer;
            }),
          };
        }),
      );
      setGradeDrafts((current) => {
        const next = { ...current };
        completed.forEach(({ attemptId, suggestions }) =>
          suggestions.forEach((suggestion) => {
            if (suggestion.suggested_score != null) next[gradeKey(attemptId, suggestion.question_id)] = String(suggestion.suggested_score);
          }),
        );
        return next;
      });
      setFeedbackDrafts((current) => {
        const next = { ...current };
        completed.forEach(({ attemptId, suggestions }) =>
          suggestions.forEach((suggestion) => {
            if (suggestion.feedback) next[gradeKey(attemptId, suggestion.question_id)] = suggestion.feedback;
          }),
        );
        return next;
      });
      const generatedCount = completed.reduce(
        (total, item) => total + item.suggestions.filter((suggestion) => suggestion.status === "needs_review" || !suggestion.status).length,
        0,
      );
      const retryableCount = completed.reduce(
        (total, item) => total + item.suggestions.filter((suggestion) => suggestion.status === "pending").length,
        0,
      );
      setMessage(`AI 批量预批改完成：生成 ${generatedCount} 条建议，${retryableCount} 题可重试${failed ? `，${failed} 份处理失败` : ""}。请教师逐题复核。`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadOfflineUploader() {
    setBusy("offline-uploader");
    setMessage(null);
    try {
      const blob = await downloadOfflineAnswerUploader();
      downloadBlob(blob, "EducationHelper-Offline-Answer-Uploader.exe");
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
    Boolean(selectedPaper) && !publishBusy && Number(selectedPaper?.question_count || 0) > 0 && selectedClassIds.length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50 text-slate-950">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">试卷管理</h1>
            <p className="text-sm text-slate-500">线上发布、线下成绩和分析入口</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="paper-download-offline-uploader"
            onClick={() => void downloadOfflineUploader()}
            disabled={busy === "offline-uploader"}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {busy === "offline-uploader" ? "准备下载..." : "下载线下答卷采集器"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,390px)_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-white p-3">
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-2 text-sm"
                placeholder="搜索试卷"
                value={paperQuery.q}
                onChange={(event) => updatePaperQuery({ q: event.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={paperQuery.deliveryMode}
                onChange={(event) => updatePaperQuery({ deliveryMode: event.target.value as PaperQuery["deliveryMode"] })}
              >
                <option value="all">全部</option>
                <option value="online">线上</option>
                <option value="offline">线下</option>
              </select>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={paperQuery.status}
                onChange={(event) => updatePaperQuery({ status: event.target.value })}
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
              </select>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={paperQuery.pageSize}
                onChange={(event) => updatePaperQuery({ pageSize: Number(event.target.value) })}
              >
                <option value={10}>10 条</option>
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {papers.map((paper) => (
              <button
                key={paper.paper_id}
                type="button"
                onClick={() => {
                  setSelectedPaperId(paper.paper_id);
                  setAnalysis(null);
                }}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedPaper?.paper_id === paper.paper_id
                    ? "border-slate-900 bg-slate-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">
                    {paper.title}
                    {paper.subject ? ` · ${paper.subject}` : ""}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      paper.delivery_mode === "online"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {deliveryLabel(paper.delivery_mode)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{paper.subject}</span>
                  <span>{paper.question_count} 题</span>
                  <span>{paper.submitted_student_count ?? 0} 份已提交</span>
                  <span>{paper.published_student_count ?? paper.graded_student_count ?? 0} 份批改并发布</span>
                  {paper.score_batch_count > 0 ? <span>{paper.score_batch_count} 批线下成绩</span> : null}
                  <span>{paper.publication_count} 次发布</span>
                </div>
              </button>
            ))}
            {!loading && papers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                暂无已导出的试卷
              </div>
            ) : null}
          </div>
          <Pager meta={paperMeta} onPage={(page) => updatePaperQuery({ page })} />
        </aside>

        <main className="min-h-0 overflow-auto p-6">
          {selectedPaper ? (
            <div className="mx-auto flex max-w-6xl flex-col gap-5">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{selectedPaper.subject}</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950">{selectedPaper.title}</h2>
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
                  提交批改
                </button>
              </div>

              {paperDetailView === "manage" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="space-y-5">
                  <Panel title="发布班级" icon={<Wifi className="h-5 w-5 text-slate-600" />}>
                    <label className="mb-4 block text-sm font-medium text-slate-700">
                      发布学科
                      <select
                        data-testid="paper-publish-subject"
                        value={selectedSubject || (teacherSubjects.length === 1 ? teacherSubjects[0] : "")}
                        onChange={(event) => setSelectedSubject(event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        {teacherSubjects.length > 1 ? <option value="">请选择学科</option> : null}
                        {teacherSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                        {teacherSubjects.length === 0 ? <option value={selectedPaper.subject}>{selectedPaper.subject || "通用"}</option> : null}
                      </select>
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {classes.map((klass) => {
                        const alreadyPublished = activePublishedClassIds.has(klass.id);
                        return (
                        <label
                          key={klass.id}
                          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                            alreadyPublished
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                              : "cursor-pointer border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <input
                            data-testid={`paper-class-${klass.id}`}
                            type="checkbox"
                            disabled={alreadyPublished}
                            checked={selectedClassIds.includes(klass.id)}
                            onChange={() => toggleClass(klass.id)}
                            className="h-4 w-4"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{klass.name}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {alreadyPublished
                                ? "已发布到该班"
                                : [klass.grade, klass.subject ?? klass.subject_hint].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </label>
                        );
                      })}
                      {classes.length === 0 ? (
                        <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                          暂无可发布班级
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {[
                        ["online", "网页答题"],
                        ["image_manual", "图片人工批改"],
                        ["image_ai", "图片 OCR+AI"],
                      ].map(([mode, label]) => (
                        <label
                          key={mode}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                            submissionMode === mode ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <input
                            data-testid={`paper-submission-${mode.replace("_", "-")}`}
                            type="radio"
                            name="paper-submission-mode"
                            value={mode}
                            checked={submissionMode === mode}
                            onChange={() => setSubmissionMode(mode as PaperSubmissionMode)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <label className="mt-4 block text-sm font-medium text-slate-700">
                      允许切屏次数
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={maxScreenSwitches}
                        onChange={(event) => setMaxScreenSwitches(Math.max(0, Number(event.target.value || 0)))}
                        className="mt-1 w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
                      />
                    </label>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <label className="block text-sm font-medium text-slate-700">
                        开始时间
                        <input
                          type="datetime-local"
                          value={publishStartAt}
                          onChange={(event) => setPublishStartAt(event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        结束时间
                        <input
                          type="datetime-local"
                          value={publishEndAt}
                          onChange={(event) => setPublishEndAt(event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        做题时长（分钟）
                        <input
                          data-testid="paper-time-limit"
                          type="number"
                          min={0}
                          max={1440}
                          value={timeLimitMinutes}
                          onChange={(event) => setTimeLimitMinutes(Math.max(0, Number(event.target.value || 0)))}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700"
                        />
                      </label>
                    </div>
                    {selectedPaper.question_count <= 0 ? (
                      <p className="mt-3 text-sm text-amber-700">试卷至少需要包含 1 道题后才能发布。</p>
                    ) : null}
                    {selectedClassIds.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">请选择至少一个未发布过的班级。</p>
                    ) : null}
                    <button
                      type="button"
                      data-testid="paper-publish"
                      disabled={!canPublish}
                      onClick={() => void publishSelectedPaper()}
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      发布到班级
                    </button>
                  </Panel>

                  <Panel title="发布记录" icon={<History className="h-5 w-5 text-slate-600" />}>
                    <div className="overflow-x-auto">
                      <table className="min-w-[860px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                          <tr>
                            <th className="px-3 py-2">标题</th>
                            <th className="px-3 py-2">班级</th>
                            <th className="px-3 py-2">进度</th>
                            <th className="px-3 py-2">允许切屏</th>
                            <th className="px-3 py-2">时间</th>
                            <th className="px-3 py-2">状态</th>
                            <th className="px-3 py-2 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {publications.map((publication) => (
                            <tr key={publication.id} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-medium">{publication.title}</td>
                              <td className="px-3 py-2 text-slate-600">
                                {(publication.class_names || []).join("、") || "-"}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {publication.submitted_count ?? 0}/{publication.attempt_count ?? 0}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{publication.max_screen_switches ?? 0} 次</td>
                              <td className="px-3 py-2 text-xs text-slate-600">
                                <div>{publication.start_at || "未设置"} - {publication.end_at || "未设置"}</div>
                                <div>限时 {publication.time_limit_minutes ? `${publication.time_limit_minutes} 分钟` : "不限"}</div>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs ${
                                    publication.status === "published"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : publication.status === "revoked"
                                        ? "bg-slate-100 text-slate-600"
                                        : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {publicationStatusLabel(publication.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  title={publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                                  aria-label={publication.status === "paused" ? "恢复收取提交" : "暂停收取提交"}
                                  disabled={
                                    busy === `pause:${publication.id}` ||
                                    publication.status === "revoked" ||
                                    publication.status === "closed"
                                  }
                                  onClick={() => void togglePublicationPause(publication)}
                                  className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  {publication.status === "paused" ? (
                                    <PlayCircle className="h-4 w-4" />
                                  ) : (
                                    <PauseCircle className="h-4 w-4" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  title="撤回发布"
                                  aria-label="撤回发布"
                                  disabled={busy === `revoke:${publication.id}` || publication.status === "revoked"}
                                  onClick={() => void revokePublication(publication)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {publications.length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        暂无发布记录
                      </p>
                    ) : null}
                  </Panel>

                </section>

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
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-950">线上提交批改</h3>
                      <p className="mt-1 text-sm text-slate-500">图片提交在这里审核，最终分数以教师保存为准。</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="paper-ai-grade-batch"
                        disabled={busy === "ai-grade:batch" || submissions.length === 0}
                        onClick={() => void suggestLoadedPendingGrades()}
                        className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {busy === "ai-grade:batch" ? "AI 批量处理中..." : "AI 批量预批改"}
                      </button>
                      <button
                        type="button"
                        data-testid="paper-load-submissions"
                        disabled={submissionsBusy}
                        onClick={() => void loadSelectedSubmissions()}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <RefreshCw className="h-4 w-4" />
                        {submissionsBusy ? "加载中..." : "刷新提交"}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {submissions.length > 0 ? (
                      <label className="block rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">
                        选择学生答卷
                        <select
                          data-testid="paper-grading-student-select"
                          value={selectedGradingSubmission?.attempt_id ?? ""}
                          onChange={(event) => setSelectedGradingAttemptId(event.target.value)}
                          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          {submissions.map((submission) => (
                            <option key={submission.attempt_id} value={submission.attempt_id}>
                              {[submission.student_no, submission.student_name, submission.status].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedGradingSubmission ? [selectedGradingSubmission].map((submission) => (
                      <article key={submission.attempt_id} className="rounded-lg border border-slate-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-950">{submission.student_name || submission.student_no}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {[submission.student_no, submission.status, submission.submitted_at].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              data-testid={`paper-ai-grade-${submission.attempt_id}`}
                              disabled={
                                busy === `ai-grade:${submission.attempt_id}` ||
                                submission.status !== "submitted" ||
                                !submission.answers.some((answer) => (answer.grading_status || "pending") === "pending")
                              }
                              onClick={() => void suggestSubmissionGrades(submission)}
                              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                            >
                              {busy === `ai-grade:${submission.attempt_id}` ? "AI 处理中..." : "AI 预批改"}
                            </button>
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              {submission.score ?? "-"} / {submission.max_score ?? "-"}
                            </span>
                          </div>
                        </div>
                        {submission.scan_images && submission.scan_images.length > 0 ? (
                          <div className="mt-4">
                            <p className="mb-2 text-xs font-semibold text-slate-600">线下答卷原图（{submission.scan_images.length} 页）</p>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {submission.scan_images.map((image, index) => (
                                <div
                                  key={`${submission.attempt_id}:scan:${index}`}
                                  className="overflow-hidden rounded-md border border-slate-200 bg-white"
                                >
                                  {scanImageUrls[`${submission.attempt_id}:${image.page_index}`] ? (
                                    <a href={scanImageUrls[`${submission.attempt_id}:${image.page_index}`]} target="_blank" rel="noreferrer">
                                      <img src={scanImageUrls[`${submission.attempt_id}:${image.page_index}`]} alt={`答卷第 ${index + 1} 页`} className="aspect-[4/3] w-full object-contain" />
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void loadOfflineScanImage(submission, image.page_index)}
                                      disabled={busy === `scan:${submission.attempt_id}:${image.page_index}`}
                                      className="flex aspect-[4/3] w-full items-center justify-center bg-slate-50 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                                    >
                                      {busy === `scan:${submission.attempt_id}:${image.page_index}` ? "正在加载..." : `加载第 ${index + 1} 页`}
                                    </button>
                                  )}
                                  <p className="truncate border-t border-slate-100 px-2 py-1 text-xs text-slate-500">第 {index + 1} 页 · {image.name}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-4 space-y-4">
                          {submission.answers.map((answer) => {
                            const key = gradeKey(submission.attempt_id, answer.question_id);
                            const value = gradeDrafts[key] ?? String(answer.score ?? answer.ai_suggested_score ?? "");
                            const feedback = feedbackDrafts[key] ?? answer.feedback ?? answer.ai_feedback ?? "";
                            return (
                              <div key={answer.question_id} className="rounded-md bg-slate-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <span className="font-medium">{answer.header || answer.question_id}</span>
                                  <span className="text-xs text-slate-500">
                                    本题 {answer.score_per_item ?? "-"} 分 · {answer.grading_status || "pending"}
                                  </span>
                                </div>
                                {answer.content ? <KatexText text={answer.content} className="mt-2 whitespace-pre-wrap text-sm text-slate-700" /> : null}
                                {answer.options && Object.keys(answer.options).length > 0 ? (
                                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                    {Object.entries(answer.options).map(([optionKey, optionText]) => (
                                      <div key={optionKey} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                                        <span className="mr-1 font-semibold">{optionKey}.</span>
                                        <KatexText text={optionText} className="inline" />
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-3 rounded-md border border-blue-100 bg-white p-3">
                                  <p className="text-xs font-semibold text-blue-700">学生作答</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">
                                    {formatStudentAnswer(answer.answer)}
                                  </p>
                                </div>
                                {answer.images && answer.images.length > 0 ? (
                                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {answer.images.map((image, index) => (
                                      <a
                                        key={`${answer.question_id}:${image.name}:${index}`}
                                        href={image.data_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="group block overflow-hidden rounded-md border border-slate-200 bg-white"
                                      >
                                        <img
                                          data-testid={`paper-answer-image-${answer.question_id}`}
                                          src={image.data_url}
                                          alt={image.name || "学生提交图片"}
                                          className="aspect-[4/3] w-full object-contain bg-white"
                                        />
                                        <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1 text-xs text-slate-500">
                                          <FileImage className="h-3.5 w-3.5" />
                                          <span className="truncate">{image.name || `image-${index + 1}`}</span>
                                        </div>
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
                                  <input
                                    data-testid={`paper-grade-${answer.question_id}`}
                                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    value={value}
                                    placeholder="分数"
                                    onChange={(event) =>
                                      setGradeDrafts((current) => ({ ...current, [key]: event.target.value }))
                                    }
                                  />
                                  <input
                                    data-testid={`paper-feedback-${answer.question_id}`}
                                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    value={feedback}
                                    placeholder="批改反馈"
                                    onChange={(event) =>
                                      setFeedbackDrafts((current) => ({ ...current, [key]: event.target.value }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    data-testid={`paper-save-grade-${answer.question_id}`}
                                    disabled={busy === `grade:${key}`}
                                    onClick={() => void saveGrade(submission, answer.question_id)}
                                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                  >
                                    保存
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
                          {submission.grading_completed_at ? (
                            <span className="text-sm font-medium text-emerald-700">成绩已发布给学生</span>
                          ) : (
                            <span className="text-xs text-slate-500">所有题目保存分数后，完成整卷批改才会向学生展示成绩。</span>
                          )}
                          <button
                            type="button"
                            data-testid={`paper-complete-grading-${submission.attempt_id}`}
                            disabled={busy === `complete:${submission.attempt_id}`}
                            onClick={() => void completeGrading(submission)}
                            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {busy === `complete:${submission.attempt_id}` ? "正在发布..." : "完成批改并发布成绩"}
                          </button>
                        </div>
                      </article>
                    )) : null}
                    {submissions.length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                        暂无已加载提交
                      </p>
                    ) : null}
                  </div>
                </section>
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
              <PlatformPaperAnalysisCharts analysis={analysis} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
      <span>
        第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
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
