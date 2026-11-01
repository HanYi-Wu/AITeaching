import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function ToolBar({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  if (left == null && right == null) {
    return null;
  }

  return (
    <div
      className={cn(
        "or-toolbar flex min-h-12 sm:min-h-14 shrink-0 flex-col items-stretch gap-2 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{left ?? null}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:shrink-0 sm:justify-end">{right ?? null}</div>
    </div>
  );
}
