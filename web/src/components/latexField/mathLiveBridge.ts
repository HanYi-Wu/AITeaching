import { MathfieldElement } from "mathlive";
import "mathlive";
import "mathlive/fonts.css";

import { canonicalizeLatex } from "../../lib/latexCanon";
import { isImeComposingKeyboardEvent } from "../../lib/ime";

export type MathLiveBridgeOptions = {
  host: HTMLElement | null;
  initialLatex?: string;
  className?: string;
  onConfirm?: (canonicalLatex: string) => void;
  onCancel?: () => void;
  onLatexChange?: (rawLatex: string) => void;
  autoFocus?: boolean;
};

export type MathLiveBridgeInstance = {
  getElement: () => MathfieldElement | null;
  getValue: () => string;
  getCanonicalLatex: () => string;
  setValue: (latex: string) => void;
  focus: () => void;
  destroy: () => void;
};

export const DEFAULT_MATH_POPUP_CLASS =
  "w-full min-h-[40px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-base text-slate-900 outline-none focus:ring-2 focus:ring-blue-400";

export const DEFAULT_MATH_MODAL_CLASS =
  "w-full min-h-[52px] rounded-md border border-slate-300 bg-white px-2 py-2 text-base text-slate-900";

export function createMathLiveBridge(options: MathLiveBridgeOptions): MathLiveBridgeInstance {
  const {
    host,
    initialLatex = "",
    className = DEFAULT_MATH_POPUP_CLASS,
    onConfirm,
    onCancel,
    onLatexChange,
    autoFocus = true,
  } = options;

  if (!host) {
    return {
      getElement: () => null,
      getValue: () => "",
      getCanonicalLatex: () => "",
      setValue: () => {},
      focus: () => {},
      destroy: () => {},
    };
  }

  let mf: MathfieldElement | null = new MathfieldElement();
  mf.className = className;
  host.innerHTML = "";
  host.appendChild(mf);

  const readRawLatex = (): string => {
    if (!mf) return "";
    try {
      return (mf.getValue("latex") ?? "").trim();
    } catch {
      return "";
    }
  };

  const readCanonicalLatex = (): string => {
    const raw = readRawLatex();
    return canonicalizeLatex(raw);
  };

  if (initialLatex) {
    try {
      mf.setValue(initialLatex);
    } catch {
      // safe fallback in test environments
    }
  }

  if (autoFocus) {
    window.requestAnimationFrame(() => {
      try {
        mf?.focus();
      } catch {
        // ignore if focus is unsupported
      }
    });
  }

  const handleKeyDown = (e: globalThis.KeyboardEvent) => {
    if (isImeComposingKeyboardEvent(e)) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onConfirm?.(readCanonicalLatex());
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  };

  const handleInput = () => {
    if (onLatexChange) {
      onLatexChange(readRawLatex());
    }
  };

  mf.addEventListener("keydown", handleKeyDown);
  if (onLatexChange) {
    mf.addEventListener("input", handleInput);
  }

  return {
    getElement: () => mf,
    getValue: readRawLatex,
    getCanonicalLatex: readCanonicalLatex,
    setValue: (latex: string) => {
      if (!mf) return;
      try {
        mf.setValue(latex);
      } catch {
        // safe fallback
      }
    },
    focus: () => {
      try {
        mf?.focus();
      } catch {
        // safe fallback
      }
    },
    destroy: () => {
      if (!mf) return;
      mf.removeEventListener("keydown", handleKeyDown);
      if (onLatexChange) {
        mf.removeEventListener("input", handleInput);
      }
      mf = null;
      if (host) {
        host.innerHTML = "";
      }
    },
  };
}
