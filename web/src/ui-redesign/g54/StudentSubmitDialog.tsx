import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatCountdown } from "../../pages/platform/student/useStudentExam";

interface StudentSubmitDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  answeredCount: number;
  questionCount: number;
  remainingSeconds: number | null;
  saveStatus: "saved" | "dirty" | "saving" | "error" | "restored";
}

export function StudentSubmitDialog({
  open,
  onClose,
  onConfirm,
  submitting,
  answeredCount,
  questionCount,
  remainingSeconds,
  saveStatus,
}: StudentSubmitDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const unansweredCount = Math.max(0, questionCount - answeredCount);
  const draftStatusText =
    saveStatus === "dirty"
      ? "有未保存修改，将随提交一并保存"
      : saveStatus === "saving"
        ? "草稿正在保存，提交时会携带最新答案"
        : saveStatus === "error"
          ? "草稿保存失败，但提交时会携带当前答案"
          : saveStatus === "restored"
            ? "草稿已恢复，可安全提交"
            : "草稿已保存，可安全提交";

  const requestClose = () => {
    if (!submitting) onClose();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="or-g54-dialog-backdrop" />
        <Dialog.Content
          className="or-g54-dialog text-[var(--or-text)] outline-none"
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-xl font-semibold tracking-tight text-[var(--or-text)]">
            提交前确认
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-[var(--or-muted)]">
            提交后不能撤回，请核对答题进度。
          </Dialog.Description>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="or-g54-status-success rounded-2xl p-4">
              <p className="text-xs font-medium">答题进度</p>
              <p className="mt-1 text-lg font-semibold">已答 {answeredCount} 题</p>
            </div>
            <div
              className={`rounded-2xl border p-4 ${
                unansweredCount > 0
                  ? "or-g54-status-warning"
                  : "border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)]"
              }`}
            >
              <p
                className={`text-xs font-medium ${
                  unansweredCount > 0 ? "text-or-on-warning" : "text-[var(--or-muted)]"
                }`}
              >
                需要检查
              </p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  unansweredCount > 0 ? "text-or-on-warning" : "text-[var(--or-text)]"
                }`}
              >
                未答 {unansweredCount} 题
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 rounded-2xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_40%,transparent)] p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--or-muted)]">草稿状态</dt>
              <dd className="text-right font-medium text-[var(--or-text)]">{draftStatusText}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--or-muted)]">剩余时间</dt>
              <dd className="font-mono font-medium text-[var(--or-text)]">
                {formatCountdown(remainingSeconds)}
              </dd>
            </div>
          </dl>

          {unansweredCount > 0 ? (
            <p className="mt-4 text-sm font-medium text-or-warning">
              还有未答题，建议返回检查后再提交。
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={requestClose}
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-2.5 text-sm font-semibold text-[var(--or-muted)] hover:bg-[var(--or-page)] disabled:opacity-50 transition-colors"
            >
              继续检查
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (submitting) return;
                onClose();
                onConfirm();
              }}
              className="w-full sm:w-auto min-h-[44px] rounded-xl bg-[var(--or-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--or-on-primary)] hover:bg-[var(--or-primary)] disabled:opacity-60 transition-colors"
            >
              确认提交
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
