import { useEffect, useRef, useState } from "react";

export type SymbolItem = { label: string; latex: string };

export type SymbolGroup = {
  label: string;
  symbols: SymbolItem[];
};

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    label: "希腊字母",
    symbols: [
      { label: "α", latex: "\\alpha" },
      { label: "β", latex: "\\beta" },
      { label: "γ", latex: "\\gamma" },
      { label: "δ", latex: "\\delta" },
      { label: "θ", latex: "\\theta" },
      { label: "λ", latex: "\\lambda" },
      { label: "μ", latex: "\\mu" },
      { label: "π", latex: "\\pi" },
      { label: "σ", latex: "\\sigma" },
      { label: "ω", latex: "\\omega" },
    ],
  },
  {
    label: "运算符",
    symbols: [
      { label: "±", latex: "\\pm" },
      { label: "×", latex: "\\times" },
      { label: "÷", latex: "\\div" },
      { label: "≤", latex: "\\leq" },
      { label: "≥", latex: "\\geq" },
      { label: "≠", latex: "\\neq" },
      { label: "≈", latex: "\\approx" },
      { label: "∞", latex: "\\infty" },
    ],
  },
  {
    label: "常用",
    symbols: [
      { label: "∑", latex: "\\sum" },
      { label: "∏", latex: "\\prod" },
      { label: "∫", latex: "\\int" },
      { label: "∂", latex: "\\partial" },
      { label: "→", latex: "\\rightarrow" },
      { label: "⇒", latex: "\\Rightarrow" },
      { label: "∈", latex: "\\in" },
      { label: "∀", latex: "\\forall" },
    ],
  },
];

export type MathSymbolsDropdownProps = {
  disabled?: boolean;
  onSelectSymbol: (latex: string) => void;
};

export function MathSymbolsDropdown({
  disabled = false,
  onSelectSymbol,
}: MathSymbolsDropdownProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        const dropdown = document.getElementById("lrt-symbols-dropdown");
        if (dropdown && !dropdown.contains(e.target as Node)) {
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="or-button or-pill or-g48-pill-dropdown rounded-full border border-[color-mix(in_srgb,var(--or-outline)_90%,transparent)] bg-[var(--or-card)] px-3 py-1 text-sm font-medium text-[var(--or-muted)] shadow-xs hover:bg-[var(--or-page)] active:bg-[var(--or-block)] transition-colors disabled:opacity-40"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="常用符号"
      >
        <span aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="text-center">α β π</span>
        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none text-[var(--or-muted)]">▾</span>
      </button>
      {open && (
        <div
          id="lrt-symbols-dropdown"
          className="or-dialog fixed inset-x-3 top-auto z-40 mt-1.5 w-auto max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 shadow-xl ring-1 ring-black/5 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:w-64"
        >
          {SYMBOL_GROUPS.map((group) => (
            <div key={group.label} className="mb-2.5 last:mb-0">
              <p className="mb-1 text-[13px] font-semibold tracking-wider text-[var(--or-muted)]">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1">
                {group.symbols.map((sym) => (
                  <button
                    key={sym.latex}
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-[var(--or-muted)] hover:bg-[var(--or-block)] hover:text-[var(--or-text)] active:bg-[var(--or-inset)] transition-colors"
                    title={sym.latex}
                    onClick={() => {
                      onSelectSymbol(sym.latex);
                      setOpen(false);
                    }}
                  >
                    {sym.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
