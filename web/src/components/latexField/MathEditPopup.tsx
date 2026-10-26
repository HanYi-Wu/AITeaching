import { useEffect, useRef } from "react";
import { createMathLiveBridge, type MathLiveBridgeInstance } from "./mathLiveBridge";

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
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open || !hostRef.current) return;
    const bridge = createMathLiveBridge({
      host: hostRef.current,
      initialLatex,
      onConfirm: (latex) => onConfirmRef.current(latex),
      onCancel: () => onCancelRef.current(),
    });
    bridgeRef.current = bridge;

    return () => {
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, [open, initialLatex]);

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
            onClick={() => {
              const latex = bridgeRef.current?.getCanonicalLatex() ?? "";
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
