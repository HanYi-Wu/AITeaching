import { Loader2 } from "lucide-react";
import "../../ui-redesign/g55/g55.css";

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
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-[var(--or-text)] " />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="text-or-primary transition-[stroke-dasharray] duration-300"
        />
      </svg>
      {refreshing ? (
        <Loader2
          className="pointer-events-none absolute h-2.5 w-2.5 animate-spin text-or-primary"
          strokeWidth={2}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
