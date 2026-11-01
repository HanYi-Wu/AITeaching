import React from "react";
import "./g52-design-tokens.css";

export interface G52StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  valueClassName?: string;
  className?: string;
  testId?: string;
}

/**
 * G52StatCard: Strictly static metric card.
 * Adheres to FlClash design: NO hover lift, NO cursor pointer, clean typography.
 */
export function G52StatCard({
  label,
  value,
  hint,
  icon,
  valueClassName = "text-[var(--or-text)]",
  className = "",
  testId,
}: G52StatCardProps) {
  return (
    <div
      data-testid={testId}
      className={`or-g52-stat-card flex flex-col justify-between ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--or-muted)]">{label}</span>
        {icon && <span className="text-[var(--or-muted)] shrink-0">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tracking-tight ${valueClassName}`}>
          {value}
        </span>
        {hint && <span className="text-xs text-[var(--or-muted)]">{hint}</span>}
      </div>
    </div>
  );
}

export interface G52PillProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "warning" | "error" | "neutral";
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * G52Pill: Capsule pill with strictly centered vertical & horizontal text alignment.
 */
export function G52Pill({
  children,
  variant = "neutral",
  className = "",
  title,
  style,
}: G52PillProps) {
  const variantClass = {
    primary: "or-g52-pill-primary",
    success: "or-g52-pill-success",
    warning: "or-g52-pill-warning",
    error: "or-g52-pill-error",
    neutral: "or-g52-pill-neutral",
  }[variant];

  return (
    <span
      className={`or-g52-pill ${variantClass} ${className}`}
      title={title}
      style={style}
    >
      {children}
    </span>
  );
}
