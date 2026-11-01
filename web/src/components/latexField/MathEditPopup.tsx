import { useEffect, useRef, useState } from "react";
import type { MathLiveBridgeInstance } from "./mathLiveBridge";

export type MathEditPopupProps = {
  open: boolean;
  isNew: boolean;
  position: { top: number; left: number };
  initialLatex: string;
  onConfirm: (canonicalLatex: string) => void;
  onCancel: () => void;
};

export function MathEditPopup({
  open,
  isNew,
  position,
  initialLatex,
  onConfirm,
  onCancel,
}: MathEditPopupProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<MathLiveBridgeInstance | null>(null);
  const bridgeLatexRef = useRef<string | null>(null);
  const [bridgeVersion, setBridgeVersion] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open || !hostRef.current) return;
    let cancelled = false;
    bridgeLatexRef.current = null;
    setLoadFailed(false);
    void import("./mathLiveBridge")
      .then(({ createMathLiveBridge }) => {
        const host = hostRef.current;
        if (cancelled || !host) return;
        const bridge = createMathLiveBridge({
          host,
          initialLatex,
          onConfirm: (latex) => onConfirmRef.current(latex),
          onCancel: () => onCancelRef.current(),
        });
        bridgeRef.current = bridge;
        bridgeLatexRef.current = initialLatex;
        setBridgeVersion((version) => version + 1);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
      bridgeLatexRef.current = null;
    };
  }, [open, initialLatex]);

  const bridgeReady = bridgeVersion > 0 && bridgeLatexRef.current === initialLatex && bridgeRef.current !== null;

  if (!open) return null;

  return (
    <div
      id="lrt-math-popup"
      className="fixed z-50"
      style={{ top: position.top, left: position.left }}
    >
      <div className="or-dialog w-84 max-w-[calc(100vw-1rem)] rounded-2xl border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] p-3.5 shadow-2xl ring-1 ring-black/5 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
          <span className="text-sm font-semibold text-[var(--or-text)]">
            {isNew ? "插入公式" : "编辑公式"}
          </span>
          <span className="text-[13px] text-[var(--or-muted)]">Enter 确认 · Esc 取消</span>
        </div>
        <div ref={hostRef} className="min-h-[40px]" />
        {!bridgeReady ? (
          <p className="mt-1 text-[13px] text-[var(--or-muted)]" role={loadFailed ? "alert" : "status"}>
            {loadFailed ? "公式编辑器加载失败，请关闭后重试。" : "正在加载公式编辑器…"}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="or-button or-pill inline-flex items-center justify-center rounded-full border border-[var(--or-outline)] bg-[var(--or-card)] px-4 py-1.5 text-sm font-medium text-[var(--or-muted)] hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="or-button or-button-primary or-pill inline-flex items-center justify-center rounded-full bg-[var(--or-primary)] px-4 py-1.5 text-sm font-medium text-[var(--or-on-primary)] shadow-sm hover:bg-[var(--or-primary)] active:bg-slate-950 transition-colors disabled:opacity-40"
            disabled={!bridgeReady}
            onClick={() => {
              const bridge = bridgeRef.current;
              if (!bridgeReady || !bridge) return;
              const latex = bridge.getCanonicalLatex();
              onConfirm(latex);
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
