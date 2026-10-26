import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiAnalysisDiagnosisHeatmap,
  apiAnalysisDiagnosisKnowledge,
  apiAnalysisDiagnosisStudent,
  apiAnalysisDiagnosisSuggestions,
  apiAnalysisRemediationDraftPreview,
  apiAnalysisCreateRemediationDraft,
  type AnalysisRemediationDraftPreviewResponse,
  type AnalysisRemediationDraftResponse,
} from "../../api/client";
import { useAgentContext } from "../../contexts/AgentContext";
import { dispatchExamsChanged } from "../../lib/examEvents";

interface UseAnalysisDiagnosisOptions {
  selectedExamId: string | null;
  selectedBatchId: string | null;
  tab: string;
  loadExams: () => Promise<void>;
  onOpenExamInCompose?: (examId: string) => void;
  setImportError: (err: string | null) => void;
}

export function useAnalysisDiagnosis({
  selectedExamId,
  selectedBatchId,
  tab,
  loadExams,
  onOpenExamInCompose,
  setImportError,
}: UseAnalysisDiagnosisOptions) {
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagKd, setDiagKd] = useState<any | null>(null);
  const [diagHeat, setDiagHeat] = useState<any | null>(null);
  const [diagSug, setDiagSug] = useState<any | null>(null);
  const [diagStudents, setDiagStudents] = useState<any[]>([]);
  const [diagStudentPick, setDiagStudentPick] = useState<string>("");
  const [remediationBusy, setRemediationBusy] = useState(false);
  const [remediationPreview, setRemediationPreview] = useState<AnalysisRemediationDraftPreviewResponse | null>(null);
  const [remediationResult, setRemediationResult] = useState<AnalysisRemediationDraftResponse | null>(null);

  const diagnosisRequestIdRef = useRef(0);
  const { requestAgentPrefill } = useAgentContext();

  const loadDiagnosis = useCallback(async (examId: string, batchId: string) => {
    const requestId = ++diagnosisRequestIdRef.current;
    setDiagLoading(true);
    setDiagKd(null);
    setDiagHeat(null);
    setDiagSug(null);
    setDiagStudents([]);
    setRemediationPreview(null);
    setRemediationResult(null);
    try {
      const [kd, hm, sg, st, rp] = await Promise.all([
        apiAnalysisDiagnosisKnowledge(examId, batchId),
        apiAnalysisDiagnosisHeatmap(examId, batchId),
        apiAnalysisDiagnosisSuggestions(examId, batchId),
        apiAnalysisDiagnosisStudent(examId, batchId),
        apiAnalysisRemediationDraftPreview(examId, batchId, {
          weak_limit: 5,
          practice_per_node: 4,
          exclude_source_exam_questions: true,
        }),
      ]);
      if (diagnosisRequestIdRef.current === requestId) {
        setDiagKd(kd);
        setDiagHeat(hm);
        setDiagSug(sg);
        setRemediationPreview(rp);
        const studs = st.students ?? [];
        setDiagStudents(studs);
        setDiagStudentPick((prev) => {
          if (!studs.length) return "";
          const ids = studs.map((s: { student_id?: string }) => String(s.student_id ?? ""));
          if (prev && ids.includes(prev)) return prev;
          return ids[0] ?? "";
        });
      }
    } catch (e) {
      console.error("loadDiagnosis failed", e);
    } finally {
      if (diagnosisRequestIdRef.current === requestId) {
        setDiagLoading(false);
      }
    }
  }, []);

  const invalidateDiagnosis = useCallback(() => {
    diagnosisRequestIdRef.current += 1;
    setDiagLoading(false);
    setDiagKd(null);
    setDiagHeat(null);
    setDiagSug(null);
    setDiagStudents([]);
    setDiagStudentPick("");
    setRemediationPreview(null);
    setRemediationResult(null);
  }, []);

  useEffect(() => {
    if (tab !== "diagnosis" || !selectedExamId || !selectedBatchId) {
      return;
    }
    void loadDiagnosis(selectedExamId, selectedBatchId);
  }, [tab, selectedExamId, selectedBatchId, loadDiagnosis]);

  const handleCreateRemediationDraft = useCallback(async () => {
    if (!selectedExamId || !selectedBatchId) return;
    setRemediationBusy(true);
    setImportError(null);
    setRemediationResult(null);
    try {
      const res = await apiAnalysisCreateRemediationDraft({
        exam_id: selectedExamId,
        batch_id: selectedBatchId,
        weak_limit: 5,
        practice_per_node: 4,
        exclude_source_exam_questions: true,
      });
      setRemediationResult(res);
      await loadExams();
      dispatchExamsChanged({ examId: res.exam_id });
      onOpenExamInCompose?.(res.exam_id);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemediationBusy(false);
    }
  }, [selectedExamId, selectedBatchId, loadExams, onOpenExamInCompose, setImportError]);

  const handleAiAssistRemediation = useCallback(() => {
    const prompt = remediationPreview?.ai_assist_payload?.prompt;
    if (!prompt) return;
    requestAgentPrefill(prompt, { newChat: true });
  }, [remediationPreview, requestAgentPrefill]);

  return {
    diagLoading,
    diagKd,
    diagHeat,
    diagSug,
    diagStudents,
    diagStudentPick,
    setDiagStudentPick,
    remediationBusy,
    remediationPreview,
    remediationResult,
    loadDiagnosis,
    invalidateDiagnosis,
    handleCreateRemediationDraft,
    handleAiAssistRemediation,
  };
}
