import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Boxes, Cpu, Info, LayoutGrid } from "lucide-react";
import welcomeLogo from "../../assets/welcome-logo.png";
import { ExtensionsPanel } from "../../components/ExtensionsPanel";
import { ModelConfigPane } from "../../components/welcome/ModelConfigPane";
import { cn } from "../../lib/utils";
import { IntroPane } from "./IntroPane";
import { ProjectPane } from "./ProjectPane";
import "../../ui-redesign/g55/g55.css";

type WelcomeTab = "intro" | "project" | "model" | "extensions";

const tabs: { id: WelcomeTab; icon: typeof Info; labelKey: string }[] = [
  { id: "intro", icon: Info, labelKey: "sidebarIntro" },
  { id: "project", icon: LayoutGrid, labelKey: "sidebarProject" },
  { id: "model", icon: Cpu, labelKey: "sidebarModel" },
  { id: "extensions", icon: Boxes, labelKey: "sidebarExtensions" },
];

type Props = {
  onProjectReady: () => void;
  onError: (msg: string | null) => void;
};

export function WelcomePage({ onProjectReady, onError }: Props) {
  const { t } = useTranslation(["welcome", "app"]);
  const [tab, setTab] = useState<WelcomeTab>("intro");
  const tabButtonRefs = useRef(new Map<WelcomeTab, HTMLButtonElement>());

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: WelcomeTab) {
    const currentIndex = tabs.findIndex((item) => item.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    setTab(nextTab);
    tabButtonRefs.current.get(nextTab)?.focus();
  }

  return (
    <div className="or-g55-page relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col md:flex-row bg-[var(--or-primary)] text-[var(--or-on-primary)]">
      {/* Navigation Sidebar following FlClash specs with mobile horizontal tab adaptation */}
      <aside className="flex w-full md:w-64 md:max-w-[min(100%,280px)] shrink-0 flex-col border-b md:border-b-0 md:border-r border-[var(--or-primary)] bg-slate-950/60 p-3 md:p-4">
        <div className="mb-2 md:mb-6 flex items-center md:items-start justify-between md:justify-start gap-3 md:flex-col border-b-0 md:border-b border-[var(--or-primary)] pb-0 md:pb-4">
          <div className="flex max-h-8 md:max-h-none max-w-[8rem] md:max-w-[10rem] items-center justify-center rounded-xl p-1">
            <img src={welcomeLogo} alt="" className="h-6 md:h-auto w-auto md:w-full object-contain object-center" aria-hidden />
          </div>
          <p className="text-xs md:text-sm font-semibold tracking-tight text-[var(--or-text)]">{t("welcome:brand")}</p>
        </div>

        <nav
          className="flex flex-row md:flex-col overflow-x-auto or-g55-no-scrollbar gap-1.5 py-1 md:py-0"
          role="tablist"
          aria-label={t("welcome:title")}
        >
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                id={`welcome-tab-${item.id}`}
                role="tab"
                aria-selected={active}
                aria-controls="welcome-tabpanel"
                tabIndex={active ? 0 : -1}
                ref={(element) => {
                  if (element) tabButtonRefs.current.set(item.id, element);
                  else tabButtonRefs.current.delete(item.id);
                }}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, item.id)}
                className={cn(
                  "relative flex h-9 md:h-10 shrink-0 md:shrink items-center gap-2 md:gap-3 rounded-[10px] px-3 text-left text-sm md:text-[15px] font-medium transition-colors",
                  active
                    ? "bg-[color-mix(in_srgb,var(--or-primary)_90%,transparent)] text-white shadow-sm"
                    : "text-[var(--or-muted)] hover:bg-[color-mix(in_srgb,var(--or-primary)_50%,transparent)] hover:text-[var(--or-text)]",
                )}
              >
                {active && (
                  <span
                    className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-t bg-or-primary md:bottom-3 md:top-3 md:left-0 md:right-auto md:h-auto md:w-[3px] md:rounded-r"
                    aria-hidden="true"
                  />
                )}
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-or-primary" : "opacity-80")} strokeWidth={1.75} />
                <span className="truncate">{t(`welcome:${item.labelKey}` as const)}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto hidden md:flex items-center gap-2 border-t border-[var(--or-primary)] pt-4 text-xs text-[var(--or-muted)]">
          <BookOpen className="h-4 w-4 shrink-0 text-[var(--or-muted)]" />
          <span>{t("welcome:hint2")}</span>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--or-primary)_90%,transparent)]">
        <header className="shrink-0 border-b border-[var(--or-primary)] px-4 py-4 md:px-8 md:py-6">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">{t("welcome:title")}</h1>
          <p className="mt-1 md:mt-1.5 max-w-2xl text-xs md:text-[14px] text-[var(--or-muted)]">{t("welcome:subtitle")}</p>
        </header>

        <div
          id="welcome-tabpanel"
          role="tabpanel"
          aria-labelledby={`welcome-tab-${tab}`}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-8 md:py-6 or-g55-safe-bottom"
        >
          {tab === "intro" && <IntroPane />}
          {tab === "project" && <ProjectPane onProjectReady={onProjectReady} onError={onError} />}
          {tab === "model" && <ModelConfigPane onError={onError} />}
          {tab === "extensions" && (
            <div className="max-h-full max-w-2xl overflow-auto rounded-2xl border border-[var(--or-primary)] bg-slate-950/80 p-4 md:p-5 text-[var(--or-text)] shadow-lg">
              <ExtensionsPanel onError={onError} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
