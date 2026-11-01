import { ReactNode } from "react";
import "./g51Styles.css";

export type PillVariant = "primary" | "neutral" | "success" | "warning";

export function G51Pill({
  children,
  variant = "neutral",
  className = "",
}: {
  children: ReactNode;
  variant?: PillVariant;
  className?: string;
}) {
  const variantClass = {
    primary: "or-g51-pill-primary",
    neutral: "or-g51-pill-neutral",
    success: "or-g51-pill-success",
    warning: "or-g51-pill-warning",
  }[variant];

  return (
    <span className={`or-g51-pill ${variantClass} ${className}`}>
      {children}
    </span>
  );
}

export function G51Panel({
  title,
  icon,
  children,
  className = "",
  actions,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`or-g51-surface p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon}
          <h3 className="text-base font-semibold text-[var(--or-text)]">{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function G51EmptyState({
  message,
  className = "",
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_60%,transparent)] p-6 text-center text-sm font-medium text-[var(--or-muted)] ${className}`}
    >
      {message}
    </div>
  );
}
