import { AlertTriangle } from "lucide-react";
import "../../ui-redesign/g52/g52-design-tokens.css";

// ---------------------------------------------------------------------------
// SVG Bar Chart (browser-native, zero deps)
// ---------------------------------------------------------------------------

export function SvgBarChart({
  data,
  title,
  colorFn,
  maxVal = 1,
  formatVal,
  warning,
}: {
  data: { label: string; value: number; warning?: boolean }[];
  title: string;
  colorFn: (v: number, warning?: boolean) => string;
  maxVal?: number;
  formatVal: (v: number) => string;
  warning?: string;
}) {
  if (!data.length) return null;
  const W = 600, H = 200, PAD = 40;
  const chartW = W - PAD * 2;
  const barW = Math.max(4, (chartW / data.length) - 4);

  return (
    <div className="or-g52-surface-card p-5">
      <h4 className="mb-3.5 text-sm font-semibold text-[var(--or-text)] tracking-tight">{title}</h4>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}
          fontSize="11"
          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        >
          {/* Subtle grid and X axis */}
          <line
            x1={PAD}
            y1={H - PAD + 4}
            x2={W - PAD}
            y2={H - PAD + 4}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          {data.map((d, i) => {
            const bx = PAD + i * (chartW / data.length) + 2;
            const bh = (d.value / maxVal) * (H - PAD * 2 - 20);
            const barY = H - PAD + 4 - bh;
            return (
              <g key={i}>
                <rect
                  x={bx}
                  y={barY}
                  width={barW}
                  height={Math.max(2, bh)}
                  fill={colorFn(d.value, d.warning)}
                  rx={3}
                />
                <text
                  x={bx + barW / 2}
                  y={H - PAD + 18}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="10"
                  fontWeight="500"
                >
                  {d.label.length > 6 ? d.label.slice(0, 6) + "…" : d.label}
                </text>
                {bh > 16 && (
                  <text
                    x={bx + barW / 2}
                    y={barY + 11}
                    textAnchor="middle"
                    fill="white"
                    fontSize="9.5"
                    fontWeight="600"
                  >
                    {formatVal(d.value)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {warning && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--or-warning)_80%,transparent)] bg-[color-mix(in_srgb,var(--or-warning-container)_70%,transparent)] px-3 py-2 text-xs text-[var(--or-on-warning)]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--or-on-warning)]" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}
