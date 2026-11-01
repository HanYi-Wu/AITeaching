import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/utils";

export type PillVariant = "default" | "primary" | "tonal" | "success" | "warning" | "error" | "outline";
export type PillSize = "sm" | "md";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  size?: PillSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  text?: ReactNode;
  clickable?: boolean;
}

/**
 * Capsule / Pill component with guaranteed horizontal and vertical text centering.
 * Even if leading or trailing icons are present, the text remains geometrically centered.
 */
export const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  {
    className,
    variant = "default",
    size = "md",
    icon,
    iconRight,
    leadingIcon,
    trailingIcon,
    text,
    clickable = false,
    children,
    ...props
  },
  ref,
) {
  const left = icon ?? leadingIcon;
  const right = iconRight ?? trailingIcon;
  const label = text ?? children;

  const variantClass = {
    default: "bg-[var(--or-block)] text-[var(--or-text)]",
    primary: "bg-[var(--or-primary)] text-[var(--or-on-primary)]",
    tonal: "bg-[var(--or-primary-container)] text-[var(--or-on-container)]",
    success: "bg-[var(--or-success-container)] text-[var(--or-on-success)]",
    warning: "bg-[var(--or-warning-container)] text-[var(--or-on-warning)]",
    error: "bg-[var(--or-error-container)] text-[var(--or-on-error)]",
    outline: "border border-[var(--or-outline)] bg-transparent text-[var(--or-text)]",
  }[variant];

  const sizeClass = {
    sm: "min-h-7 px-2.5 text-sm gap-1.5",
    md: "h-7 px-3 text-sm gap-2",
  }[size];

  // If one side has an icon and the other does not, we add an invisible symmetric balancer
  // to maintain geometric centering of the label!
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);

  return (
    <span
      ref={ref}
      className={cn(
        "or-pill inline-flex items-center justify-center rounded-full font-medium leading-none select-none transition-colors",
        clickable && "cursor-pointer hover:brightness-95 active:brightness-90",
        variantClass,
        sizeClass,
        className,
      )}
      {...props}
    >
      {hasLeft ? (
        <span className="shrink-0 inline-flex items-center justify-center">{left}</span>
      ) : hasRight ? (
        <span className="shrink-0 inline-flex items-center justify-center opacity-0 pointer-events-none" aria-hidden="true">
          {right}
        </span>
      ) : null}

      <span className="truncate text-center flex-1">{label}</span>

      {hasRight ? (
        <span className="shrink-0 inline-flex items-center justify-center">{right}</span>
      ) : hasLeft ? (
        <span className="shrink-0 inline-flex items-center justify-center opacity-0 pointer-events-none" aria-hidden="true">
          {left}
        </span>
      ) : null}
    </span>
  );
});
