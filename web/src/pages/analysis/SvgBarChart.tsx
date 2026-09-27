import { AlertTriangle } from "lucide-react";

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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">{title}</h4>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}
          fontSize="11"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {/* X axis */}
          <line x1={PAD} y1={H - PAD + 4} x2={W - PAD} y2={H - PAD + 4} stroke="#cbd5e1" strokeWidth={1} />
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
                  rx={2}
                />
                <text
                  x={bx + barW / 2}
                  y={H - PAD + 16}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="9"
                >
                  {d.label.length > 6 ? d.label.slice(0, 6) + "…" : d.label}
                </text>
                {bh > 14 && (
                  <text x={bx + barW / 2} y={barY + 10} textAnchor="middle" fill="white" fontSize="9">
                    {formatVal(d.value)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {warning && (
        <p className="mt-2 text-xs text-amber-600">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {warning}
        </p>
      )}
    </div>
  );
}
