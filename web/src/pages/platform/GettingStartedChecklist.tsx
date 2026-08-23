import { CheckCircle2, Circle } from "lucide-react";

export type GettingStartedStep = {
  label: string;
  complete: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

type Props = {
  description: string;
  steps: GettingStartedStep[];
};

export function GettingStartedChecklist({ description, steps }: Props) {
  return (
    <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">首次使用清单</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 shadow-sm">
          {steps.filter((step) => step.complete).length}/{steps.length} 已完成
        </span>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-h-20 items-start gap-3 rounded-lg border border-white bg-white/90 p-3">
            {step.complete ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{index + 1}. {step.label}</p>
              {step.complete ? (
                <p className="mt-1 text-xs font-medium text-emerald-700">已完成</p>
              ) : step.actionLabel && step.onAction ? (
                <button type="button" onClick={step.onAction} className="mt-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900">
                  {step.actionLabel}
                </button>
              ) : (
                <p className="mt-1 text-xs text-slate-500">待完成</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
