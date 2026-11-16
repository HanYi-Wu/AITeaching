import { useCallback, useEffect, useState } from "react";
import { Shuffle, Timer, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useAgentActions } from "../../contexts/AgentContext";
import { G52Pill } from "../../ui-redesign/g52/G52UIComponents";
import { ClassroomTimerTool, type TimerStatusSummary } from "./ClassroomTimerTool";
import { RollCallTool } from "./RollCallTool";

export type ClassroomToolTab = "rollCall" | "timer";

export interface ClassroomToolsWorkspaceProps {
  active?: boolean;
  initialTool?: ClassroomToolTab;
  onError?: (msg: string | null) => void;
}

const INITIAL_TIMER_SUMMARY: TimerStatusSummary = {
  status: "stopped",
  remainingSeconds: 300,
  formattedTime: "00:05:00",
};

export function ClassroomToolsWorkspace({
  active = true,
  initialTool = "rollCall",
  onError,
}: ClassroomToolsWorkspaceProps) {
  const { t } = useTranslation(["tools", "common"]);
  const { setPageContext } = useAgentActions();
  const [toolTab, setToolTab] = useState<ClassroomToolTab>(initialTool);
  const [timerSummary, setTimerSummary] = useState<TimerStatusSummary>(INITIAL_TIMER_SUMMARY);

  const handleTimerStatusChange = useCallback((summary: TimerStatusSummary) => {
    setTimerSummary((prev) =>
      prev.status === summary.status &&
      prev.remainingSeconds === summary.remainingSeconds &&
      prev.formattedTime === summary.formattedTime
        ? prev
        : summary,
    );
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const activeToolLabel =
      toolTab === "rollCall" ? t("tools:tabs.rollCall") : t("tools:tabs.timer");
    const timerStateNote =
      timerSummary.status === "stopped"
        ? ""
        : ` (${t(`tools:timer.status.${timerSummary.status}`)}: ${timerSummary.formattedTime})`;

    setPageContext({
      current_page: "tools",
      summary: `${t("tools:title")} · ${activeToolLabel}${timerStateNote}`,
    });
    return () => setPageContext(null);
  }, [active, setPageContext, t, timerSummary.formattedTime, timerSummary.status, toolTab]);

  useEffect(() => {
    onError?.(null);
  }, [onError, toolTab]);

  const timerPillVariant: "primary" | "warning" | "error" =
    timerSummary.status === "finished"
      ? "error"
      : timerSummary.status === "running"
        ? "primary"
        : "warning";

  const timerPillLabel =
    timerSummary.status === "running"
      ? t("tools:badges.timerRunning", { time: timerSummary.formattedTime })
      : timerSummary.status === "paused"
        ? t("tools:badges.timerPaused", { time: timerSummary.formattedTime })
        : timerSummary.status === "finished"
          ? t("tools:badges.timerFinished")
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--or-page)] text-[var(--or-text)]">
      <header className="shrink-0 border-b border-[var(--or-outline)] bg-[var(--or-card)] px-5 py-3.5 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--or-primary-container)] text-[var(--or-on-container)]">
              <Wrench className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-bold text-[var(--or-text)] md:text-lg">
                  {t("tools:title")}
                </h1>
                {timerPillLabel && (
                  <G52Pill variant={timerPillVariant} className="tabular-nums">
                    {timerPillLabel}
                  </G52Pill>
                )}
              </div>
              <p className="truncate text-xs text-[var(--or-muted)] md:text-sm">
                {t("tools:subtitle")}
              </p>
            </div>
          </div>

          <Tabs
            value={toolTab}
            onValueChange={(value) => setToolTab(value as ClassroomToolTab)}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-2 sm:w-auto" aria-label={t("tools:title")}>
              <TabsTrigger value="rollCall" className="gap-1.5 px-4">
                <Shuffle className="h-4 w-4" aria-hidden="true" />
                <span>{t("tools:tabs.rollCall")}</span>
              </TabsTrigger>
              <TabsTrigger value="timer" className="gap-1.5 px-4">
                <Timer className="h-4 w-4" aria-hidden="true" />
                <span>{t("tools:tabs.timer")}</span>
                {timerSummary.status === "running" && (
                  <span
                    className="ml-0.5 inline-block h-2 w-2 rounded-full bg-[var(--or-primary)]"
                    aria-hidden="true"
                  />
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-7 flex">
        <div className="m-auto w-full max-w-7xl">
          {/* Keep both panels mounted so a running timer or picked pool persists across tool tab switches */}
          <div className={toolTab !== "rollCall" ? "hidden" : undefined} aria-hidden={toolTab !== "rollCall"}>
            <RollCallTool active={active && toolTab === "rollCall"} />
          </div>
          <div className={toolTab !== "timer" ? "hidden" : undefined} aria-hidden={toolTab !== "timer"}>
            <ClassroomTimerTool
              active={active && toolTab === "timer"}
              onStatusChange={handleTimerStatusChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
