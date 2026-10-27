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
      <div className="w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            {isNew ? "插入公式" : "编辑公式"}
          </span>
          <span className="text-[10px] text-slate-400">Enter 确认 · Esc 取消</span>
        </div>
        <div ref={hostRef} className="min-h-[40px]" />
        {!bridgeReady ? (
          <p className="mt-1 text-[11px] text-slate-500" role={loadFailed ? "alert" : "status"}>
            {loadFailed ? "公式编辑器加载失败，请关闭后重试。" : "正在加载公式编辑器…"}
          </p>
        ) : null}
        <div className="mt-2.5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
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
