import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, GitBranch, Layers, LineChart } from "lucide-react";
import "../../ui-redesign/g55/g55.css";

export function IntroPane() {
  const { t } = useTranslation("welcome");
  const steps = [
    { icon: GitBranch, title: t("intro.step1Title"), desc: t("intro.step1Desc") },
    { icon: BookOpen, title: t("intro.step2Title"), desc: t("intro.step2Desc") },
    { icon: Layers, title: t("intro.step3Title"), desc: t("intro.step3Desc") },
    { icon: LineChart, title: t("intro.step4Title"), desc: t("intro.step4Desc") },
  ];

  return (
    <div className="max-w-2xl space-y-6 text-[var(--or-text)]">
      <p className="text-[15px] leading-relaxed text-[var(--or-muted)]">{t("intro.lead")}</p>
      <ol className="space-y-3.5">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="or-g55-static-card flex items-center gap-4 rounded-xl border border-[var(--or-primary)] bg-slate-950/60 p-4"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-or-primary/20 text-or-primary">
              <s.icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="or-g55-pill bg-[var(--or-primary)] text-xs font-medium text-[var(--or-muted)]">
                  {t("intro.stepLabel", { n: i + 1 })}
                </span>
                <h3 className="text-[15px] font-semibold text-white">{s.title}</h3>
              </div>
              <p className="mt-1 text-sm text-[var(--or-muted)]">{s.desc}</p>
            </div>
            {i < steps.length - 1 ? (
              <ArrowRight className="ml-auto hidden h-4 w-4 shrink-0 text-[var(--or-muted)] md:block" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-[var(--or-muted)]">{t("intro.footer")}</p>
    </div>
  );
}
