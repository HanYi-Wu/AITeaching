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
import { useAgentActions } from "../../contexts/AgentContext";
import { dispatchExamsChanged } from "../../lib/examEvents";

interface UseAnalysisDiagnosisOptions {
  selectedExamId: string | null;
  selectedBatchId: string | null;
  scopeKey: string;
  scopeReady: boolean;
  tab: string;
  loadExams: () => Promise<void>;
  onOpenExamInCompose?: (examId: string) => void;
  setImportError: (err: string | null) => void;
}

export function useAnalysisDiagnosis({
  selectedExamId,
  selectedBatchId,
  scopeKey,
  scopeReady,
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
  const remediationRequestIdRef = useRef(0);
  const remediationPreviewScopeRef = useRef<string | null>(null);
  useEffect(() => () => {
    diagnosisRequestIdRef.current++;
    remediationRequestIdRef.current++;
    remediationPreviewScopeRef.current = null;
  }, []);
  const currentScopeKey = JSON.stringify([scopeKey, selectedExamId, selectedBatchId]);
  const currentScopeKeyRef = useRef(currentScopeKey);
  currentScopeKeyRef.current = currentScopeKey;
  const scopeReadyRef = useRef(scopeReady);
  scopeReadyRef.current = scopeReady;
  const { requestAgentPrefill } = useAgentActions();

  const loadDiagnosis = useCallback(async (examId: string, batchId: string) => {
    const requestScopeKey = JSON.stringify([scopeKey, examId, batchId]);
    if (!scopeReady || currentScopeKeyRef.current !== requestScopeKey) return;
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
      if (diagnosisRequestIdRef.current === requestId &&
          scopeReadyRef.current &&
          currentScopeKeyRef.current === requestScopeKey) {
        setDiagKd(kd);
        setDiagHeat(hm);
        setDiagSug(sg);
        setRemediationPreview(rp);
        remediationPreviewScopeRef.current = requestScopeKey;
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
      if (diagnosisRequestIdRef.current === requestId &&
          scopeReadyRef.current &&
          currentScopeKeyRef.current === requestScopeKey) {
        console.error("loadDiagnosis failed", e);
      }
    } finally {
      if (diagnosisRequestIdRef.current === requestId &&
          scopeReadyRef.current &&
          currentScopeKeyRef.current === requestScopeKey) {
        setDiagLoading(false);
      }
    }
  }, [scopeKey, scopeReady]);

  const invalidateDiagnosis = useCallback(() => {
    diagnosisRequestIdRef.current += 1;
    remediationRequestIdRef.current += 1;
    remediationPreviewScopeRef.current = null;
    setDiagLoading(false);
    setDiagKd(null);
    setDiagHeat(null);
    setDiagSug(null);
    setDiagStudents([]);
    setDiagStudentPick("");
    setRemediationPreview(null);
    setRemediationResult(null);
    setRemediationBusy(false);
  }, []);

  useEffect(() => {
    if (!scopeReady) {
      invalidateDiagnosis();
      return;
    }
    if (tab !== "diagnosis" || !selectedExamId || !selectedBatchId) {
      return;
    }
    void loadDiagnosis(selectedExamId, selectedBatchId);
  }, [tab, selectedExamId, selectedBatchId, scopeKey, scopeReady, loadDiagnosis, invalidateDiagnosis]);

  const handleCreateRemediationDraft = useCallback(async () => {
    if (!scopeReady || !selectedExamId || !selectedBatchId) return;
    const requestScopeKey = JSON.stringify([scopeKey, selectedExamId, selectedBatchId]);
    if (currentScopeKeyRef.current !== requestScopeKey) return;
    const requestId = ++remediationRequestIdRef.current;
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
      if (remediationRequestIdRef.current !== requestId ||
          !scopeReadyRef.current ||
          currentScopeKeyRef.current !== requestScopeKey) return;
      setRemediationResult(res);
      await loadExams();
      if (remediationRequestIdRef.current !== requestId ||
          !scopeReadyRef.current ||
          currentScopeKeyRef.current !== requestScopeKey) return;
      dispatchExamsChanged({ examId: res.exam_id });
      onOpenExamInCompose?.(res.exam_id);
    } catch (e) {
      if (remediationRequestIdRef.current === requestId &&
          scopeReadyRef.current &&
          currentScopeKeyRef.current === requestScopeKey) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (remediationRequestIdRef.current === requestId &&
          scopeReadyRef.current &&
          currentScopeKeyRef.current === requestScopeKey) {
        setRemediationBusy(false);
      }
    }
  }, [selectedExamId, selectedBatchId, scopeKey, scopeReady, loadExams, onOpenExamInCompose, setImportError]);

  const handleAiAssistRemediation = useCallback(() => {
    if (!scopeReady || remediationPreviewScopeRef.current !== currentScopeKeyRef.current) return;
    const prompt = remediationPreview?.ai_assist_payload?.prompt;
    if (!prompt) return;
    requestAgentPrefill(prompt, { newChat: true });
  }, [remediationPreview, requestAgentPrefill, scopeReady]);

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
