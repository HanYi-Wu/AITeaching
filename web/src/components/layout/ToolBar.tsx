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
        "flex min-h-14 shrink-0 flex-col items-stretch gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-900/[0.02] sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:py-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{left ?? null}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:shrink-0 sm:justify-end">{right ?? null}</div>
    </div>
  );
}
