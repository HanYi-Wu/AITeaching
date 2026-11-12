import { CheckCircle2, Circle } from "lucide-react";
import "../../ui-redesign/g55/g55.css";

export type GettingStartedStep = {
  label: string;
  complete: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

type Props = {
  description?: string;
  steps: GettingStartedStep[];
};

export function GettingStartedChecklist({ description, steps }: Props) {
  const completedCount = steps.filter((step) => step.complete).length;

  return (
    <section className="or-g55-card rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 shadow-sm   sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--or-text)] ">首次使用清单</h2>
          {description ? <p className="mt-1 text-sm text-[var(--or-muted)] ">{description}</p> : null}
        </div>
        <span className="or-g55-pill bg-or-primary-container text-xs font-semibold text-or-on-container">
          {completedCount}/{steps.length} 已完成
        </span>
      </div>
      <ol className="mt-5 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="or-g55-static-card flex min-h-[5.5rem] items-start gap-3 rounded-xl border border-[var(--or-outline)] bg-[color-mix(in_srgb,var(--or-page)_70%,transparent)] p-3.5  "
          >
            {step.complete ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-or-success" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--or-muted)] " aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--or-text)] ">
                {index + 1}. {step.label}
              </p>
              {step.complete ? (
                <p className="mt-1.5 text-xs font-medium text-or-success">已完成</p>
              ) : step.actionLabel && step.onAction ? (
                <button
                  type="button"
                  onClick={step.onAction}
                  className="mt-2 inline-flex items-center text-xs font-semibold text-or-primary transition hover:text-or-primary"
                >
                  {step.actionLabel}
                </button>
              ) : (
                <p className="mt-1.5 text-xs text-[var(--or-muted)] ">待完成</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
