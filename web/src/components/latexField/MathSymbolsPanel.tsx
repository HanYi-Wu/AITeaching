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
        className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="常用符号"
      >
        α β π ▾
      </button>
      {open && (
        <div
          id="lrt-symbols-dropdown"
          className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          {SYMBOL_GROUPS.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {group.symbols.map((sym) => (
                  <button
                    key={sym.latex}
                    type="button"
                    className="rounded px-1.5 py-0.5 text-sm hover:bg-blue-50 hover:text-blue-700"
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
