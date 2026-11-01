import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, LoaderCircle, X } from "lucide-react";

import {
  getStudentClassTransfer,
  transferStudentClass,
  type StudentClassTransferPreview,
  type StudentClassTransferResult,
  type StudentRecord,
} from "../../../../platform/auth";
import { PlatformRequestError } from "../../../../platform/platformRequest";
import "../../../../ui-redesign/g53/g53.css";
import { Select as AppSelect } from "../../../../components/ui/select";

type Props = {
  student: StudentRecord;
  scopeKey: string;
  onClose: () => void;
  onTransferred: (
    result: StudentClassTransferResult,
    isCurrent: () => boolean,
  ) => Promise<void> | void;
};

function classLabel(name: string, grade?: string | null): string {
  return grade ? `${name}（${grade}）` : name;
}

export function StudentTransferDialog({ student, scopeKey, onClose, onTransferred }: Props) {
  const requestSeqRef = useRef(0);
  const currentScopeRef = useRef(scopeKey);
  const currentStudentIdRef = useRef(student.id);
  currentScopeRef.current = scopeKey;
  currentStudentIdRef.current = student.id;

  const [preview, setPreview] = useState<StudentClassTransferPreview | null>(null);
  const [targetClassId, setTargetClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const isCurrentRequest = useCallback((seq: number, requestScope: string, studentId: string) => (
    requestSeqRef.current === seq
      && currentScopeRef.current === requestScope
      && currentStudentIdRef.current === studentId
  ), []);

  const loadPreview = useCallback((message?: string) => {
    const requestScope = scopeKey;
    const studentId = student.id;
    const seq = ++requestSeqRef.current;
    setPreview(null);
    setTargetClassId("");
    setError(message ?? null);
    setLoading(true);
    void getStudentClassTransfer(studentId)
      .then((data) => {
        if (isCurrentRequest(seq, requestScope, studentId)) setPreview(data);
      })
      .catch((reason: unknown) => {
        if (!isCurrentRequest(seq, requestScope, studentId)) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (isCurrentRequest(seq, requestScope, studentId)) setLoading(false);
      });
  }, [isCurrentRequest, scopeKey, student.id]);

  useEffect(() => {
    loadPreview();
    return () => {
      requestSeqRef.current += 1;
    };
  }, [loadPreview]);

  async function confirmTransfer() {
    if (!preview || !targetClassId || saving || completed) return;
    const target = preview.available_classes.find((item) => item.id === targetClassId);
    if (!target) return;

    const requestScope = scopeKey;
    const studentId = student.id;
    const seq = ++requestSeqRef.current;
    setSaving(true);
    setError(null);
    try {
      const result = await transferStudentClass(studentId, {
        target_class_id: targetClassId,
        expected_class_ids: preview.current_classes.map((item) => item.id),
      });
      if (!isCurrentRequest(seq, requestScope, studentId)) return;
      let completionCallbackFailed = false;
      try {
        await onTransferred(result, () => isCurrentRequest(seq, requestScope, studentId));
      } catch {
        if (isCurrentRequest(seq, requestScope, studentId)) {
          setError("转班已完成，但学生或班级列表刷新失败，请刷新。");
          setCompleted(true);
          completionCallbackFailed = true;
        }
      }
      if (!isCurrentRequest(seq, requestScope, studentId)) return;
      if (!completionCallbackFailed) onClose();
    } catch (reason) {
      if (!isCurrentRequest(seq, requestScope, studentId)) return;
      if (reason instanceof PlatformRequestError && reason.status === 409) {
        setSaving(false);
        loadPreview("班级信息已变化，已刷新转班预览。请核对最新信息后再次确认。");
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (isCurrentRequest(seq, requestScope, studentId)) setSaving(false);
    }
  }

  const selectedClass = preview?.available_classes.find((item) => item.id === targetClassId);
  const isUnchanged = Boolean(
    preview
      && preview.current_classes.length === 1
      && preview.current_classes[0].id === targetClassId,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-3 sm:p-4 transition-opacity">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="转班确认"
        className="or-g53-dialog w-full max-w-xl shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-or-outline bg-or-block/50 px-4 sm:px-6 py-3.5 sm:py-4">
          <div>
            <h2 className="text-lg font-semibold text-or-text">学生转班</h2>
            <p className="mt-0.5 text-sm font-medium text-or-muted">
              {student.display_name} · <span className="font-mono">{student.student_no}</span>
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭转班对话框"
            disabled={saving}
            onClick={onClose}
            className="or-g53-icon-btn disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-6">
          {loading ? (
            <p className="flex items-center gap-2.5 text-sm font-medium text-or-muted" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin text-or-primary" /> 正在读取当前班级和考试记录…
            </p>
          ) : null}
          {error ? (
            <div className="or-g53-error-surface rounded-xl p-3.5 text-sm" role="alert">
              <p>{error}</p>
              {!preview ? (
                <button
                  type="button"
                  className="mt-2 font-semibold text-or-on-error underline hover:no-underline"
                  onClick={() => loadPreview()}
                  disabled={loading}
                >
                  重新加载预览
                </button>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <>
              <div className="grid gap-3.5 rounded-2xl border border-or-outline bg-or-block/80 p-3.5 sm:p-4 grid-cols-1 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-xs font-medium text-or-muted">当前班级</p>
                  <p className="mt-1 text-sm font-semibold text-or-text">
                    {preview.current_classes.length
                      ? preview.current_classes.map((item) => classLabel(item.name, item.grade)).join("、")
                      : "未指定班级"}
                  </p>
                </div>
                <div className="hidden sm:flex sm:items-center sm:justify-center">
                  <ArrowRightLeft className="h-4 w-4 text-or-muted" aria-hidden="true" />
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-or-muted">目标班级</span>
                  <AppSelect
                    aria-label="目标班级"
                    className="or-g53-select mt-1 w-full text-sm"
                    value={targetClassId}
                    onValueChange={(value) => setTargetClassId(value)}
                    disabled={loading || saving || preview.available_classes.length === 0}
                  >
                    <option value="">请选择目标班级</option>
                    {preview.available_classes.map((item) => (
                      <option key={item.id} value={item.id}>{classLabel(item.name, item.grade)}</option>
                    ))}
                  </AppSelect>
                </label>
              </div>
              {preview.available_classes.length === 0 ? (
                <p className="text-sm text-or-muted">当前学校暂无可转入的班级。</p>
              ) : null}
              <p className="text-sm font-medium text-or-text">
                转班后会保留 {preview.attempt_count} 份考试记录及其作答和成绩。
              </p>
              {preview.legacy_attempt_count > 0 ? (
                <p className="or-g53-warning-surface rounded-xl p-3.5 text-sm leading-6">
                  有 {preview.legacy_attempt_count} 份旧考试记录没有冻结的原始班级快照。转班会保留这些记录目前可见的班级关联，不会推断未知的更早历史。
                </p>
              ) : null}
              <p className="text-sm text-or-muted">
                请核对上述当前归属与目标班级。确认后将移除该学生的其他当前班级关联。
              </p>
              {selectedClass ? (
                <div className="or-g53-accent-surface rounded-xl p-3 font-medium text-sm">
                  {preview.current_classes.length
                    ? preview.current_classes.map((item) => item.name).join("、")
                    : "未指定班级"}
                  {" → "}{selectedClass.name}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-or-outline pt-4">
            {completed ? (
              <button
                type="button"
                className="or-g53-btn-tonal w-full sm:w-auto px-5 py-2 text-sm"
                onClick={onClose}
              >
                关闭
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="or-g53-btn-tonal w-full sm:w-auto px-4 py-2 text-sm disabled:opacity-50"
                  onClick={onClose}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="or-g53-btn-primary w-full sm:w-auto px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void confirmTransfer()}
                  disabled={!preview || !targetClassId || !selectedClass || isUnchanged || loading || saving}
                >
                  {saving ? "正在转班…" : "确认转班"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
