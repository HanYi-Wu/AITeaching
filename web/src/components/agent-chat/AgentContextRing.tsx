import { Loader2 } from "lucide-react";

export interface AgentContextRingProps {
  used: number | null;
  limit: number | null;
  refreshing: boolean;
  title: string;
  ariaLabel: string;
}

export function AgentContextRing({
  used,
  limit,
  refreshing,
  title,
  ariaLabel,
}: AgentContextRingProps) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const u = used ?? 0;
  const frac = limit != null && limit > 0 ? Math.min(1, Math.max(0, u / limit)) : 0;
  const dash = c * frac;

  return (
    <div
      className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
      title={title}
      role="img"
      aria-label={ariaLabel}
    >
      <svg className="h-[18px] w-[18px] -rotate-90" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(226 232 240)" strokeWidth={2} />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgb(139 92 246)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="transition-[stroke-dasharray] duration-300"
        />
      </svg>
      {refreshing ? (
        <Loader2
          className="pointer-events-none absolute h-2 w-2 animate-spin text-violet-500"
          strokeWidth={1.5}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
