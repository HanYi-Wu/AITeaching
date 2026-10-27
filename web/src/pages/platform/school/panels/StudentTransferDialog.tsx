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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="转班确认"
        className="w-full max-w-xl rounded-xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">学生转班</h2>
            <p className="mt-1 text-sm text-slate-600">
              {student.display_name} · {student.student_no}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭转班对话框"
            disabled={saving}
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取当前班级和考试记录…
            </p>
          ) : null}
          {error ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p>{error}</p>
              {!preview ? (
                <button
                  type="button"
                  className="mt-2 font-semibold underline"
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
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-xs font-medium text-slate-500">当前班级</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {preview.current_classes.length
                      ? preview.current_classes.map((item) => classLabel(item.name, item.grade)).join("、")
                      : "未指定班级"}
                  </p>
                </div>
                <ArrowRightLeft className="hidden h-5 w-5 text-slate-400 sm:block" aria-hidden="true" />
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">目标班级</span>
                  <select
                    aria-label="目标班级"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={targetClassId}
                    onChange={(event) => setTargetClassId(event.target.value)}
                    disabled={loading || saving || preview.available_classes.length === 0}
                  >
                    <option value="">请选择目标班级</option>
                    {preview.available_classes.map((item) => (
                      <option key={item.id} value={item.id}>{classLabel(item.name, item.grade)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {preview.available_classes.length === 0 ? (
                <p className="text-sm text-slate-600">当前学校暂无可转入的班级。</p>
              ) : null}
              <p className="text-sm text-slate-700">
                转班后会保留 {preview.attempt_count} 份考试记录及其作答和成绩。
              </p>
              {preview.legacy_attempt_count > 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                  有 {preview.legacy_attempt_count} 份旧考试记录没有冻结的原始班级快照。转班会保留这些记录目前可见的班级关联，不会推断未知的更早历史。
                </p>
              ) : null}
              <p className="text-sm text-slate-600">
                请核对上述当前归属与目标班级。确认后将移除该学生的其他当前班级关联。
              </p>
              {selectedClass ? (
                <p className="font-medium text-slate-800">
                  {preview.current_classes.length
                    ? preview.current_classes.map((item) => item.name).join("、")
                    : "未指定班级"}
                  {" → "}{selectedClass.name}
                </p>
              ) : null}
            </>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            {completed ? (
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={onClose}
              >
                关闭
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={onClose}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
