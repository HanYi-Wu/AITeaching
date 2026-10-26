import { useEffect, useRef } from "react";

import {
  createMathLiveBridge,
  DEFAULT_MATH_MODAL_CLASS,
  type MathLiveBridgeInstance,
} from "./latexField/mathLiveBridge";
import { isImeComposingKeyboardEvent } from "../lib/ime";

type MathInsertOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** Wrapped snippet e.g. `$\\frac12$` */
  onConfirm: (latexWrapped: string) => void;
};

/**
 * Modal with MathLive editor; confirms with inline-math wrapped LaTeX for KaTeX `$...$`.
 */
export function MathInsertOverlay({ open, onClose, onConfirm }: MathInsertOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<MathLiveBridgeInstance | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    if (!open) {
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const bridge = createMathLiveBridge({
      host,
      className: DEFAULT_MATH_MODAL_CLASS,
      onConfirm: (latex) => {
        if (!latex) return;
        onConfirmRef.current(`$${latex}$`);
        onCloseRef.current();
      },
      onCancel: () => onCloseRef.current(),
    });
    bridgeRef.current = bridge;

    return () => {
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function tryConfirm() {
    const bridge = bridgeRef.current;
    if (!bridge) {
      return;
    }
    const latex = bridge.getCanonicalLatex();
    if (!latex) {
      return;
    }
    onConfirm(`$${latex}$`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="math-insert-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (isImeComposingKeyboardEvent(e)) return;
        if (hostRef.current?.contains(e.target as Node)) return;
        if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="math-insert-title" className="text-sm font-semibold text-slate-800">
          插入公式
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          在下方编辑，确认后将作为行内公式（$...$）插入到光标处。
        </p>
        <div ref={hostRef} className="mt-3 min-h-[52px]" />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            onClick={tryConfirm}
          >
            插入
          </button>
        </div>
      </div>
    </div>
  );
}
