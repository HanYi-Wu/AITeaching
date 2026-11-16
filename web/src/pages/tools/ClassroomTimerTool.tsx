import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Volume2,
  VolumeX,
} from "lucide-react";
import "../../ui-redesign/g53/g53.css";
import { playTimerCue, type TimerAudioCue } from "./classroomAudio";
import {
  CLASSROOM_TIMER_PRESETS,
  DEFAULT_TIMER_HOURS,
  DEFAULT_TIMER_MINUTES,
  DEFAULT_TIMER_SECONDS,
  TIMER_MAX_HOURS,
  TIMER_MAX_MINUTES,
  TIMER_MAX_SECONDS,
  clampTimerUnit,
  computeRemainingSeconds,
  formatTimerHms,
  getDisplaySeconds,
  hmsToTotalSeconds,
  resolveTimerCue,
  stepTimerUnit,
  totalSecondsToHms,
  type TimerStatus,
} from "./timerEngine";

export interface TimerStatusSummary {
  status: TimerStatus;
  remainingSeconds: number;
  formattedTime: string;
}

export interface ClassroomTimerToolProps {
  active?: boolean;
  onStatusChange?: (summary: TimerStatusSummary) => void;
}

type TimeUnitKey = "hours" | "minutes" | "seconds";

interface EditingUnitDraft {
  unit: TimeUnitKey;
  draft: string;
}

function padTwoDigits(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

/**
 * Classroom countdown timer tool with wall-clock synchronization, 30s/3-2-1s/finish
 * audio cues, editable HMS spinners, quick presets, and distraction-free focus view.
 */
export function ClassroomTimerTool({ active = true, onStatusChange }: ClassroomTimerToolProps) {
  const { t } = useTranslation("tools");

  const initialSeconds = hmsToTotalSeconds(
    DEFAULT_TIMER_HOURS,
    DEFAULT_TIMER_MINUTES,
    DEFAULT_TIMER_SECONDS,
  );

  const [hours, setHours] = useState<number>(DEFAULT_TIMER_HOURS);
  const [minutes, setMinutes] = useState<number>(DEFAULT_TIMER_MINUTES);
  const [seconds, setSeconds] = useState<number>(DEFAULT_TIMER_SECONDS);
  const [status, setStatus] = useState<TimerStatus>("stopped");
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialSeconds);
  const [muted, setMuted] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [zeroDurationWarning, setZeroDurationWarning] = useState<boolean>(false);
  const [editingUnit, setEditingUnit] = useState<EditingUnitDraft | null>(null);

  const deadlineMsRef = useRef<number>(0);
  const firedCuesRef = useRef<Set<TimerAudioCue>>(new Set());
  const finishAudioCancelRef = useRef<(() => void) | null>(null);
  const activeDurationRef = useRef<number>(initialSeconds);
  const mutedRef = useRef<boolean>(muted);
  const lastReportedRef = useRef<TimerStatusSummary | null>(null);

  mutedRef.current = muted;

  const configuredSeconds = useMemo(
    () => hmsToTotalSeconds(hours, minutes, seconds),
    [hours, minutes, seconds],
  );

  const isEditingLocked = status === "running" || status === "paused";
  const displaySeconds = getDisplaySeconds(remainingSeconds, status);
  const formattedTime = formatTimerHms(displaySeconds);

  const cancelFinishAudio = useCallback(() => {
    finishAudioCancelRef.current?.();
    finishAudioCancelRef.current = null;
  }, []);

  // Automatically clear zero-duration alert once user configures > 0 seconds.
  useEffect(() => {
    if (configuredSeconds > 0 && zeroDurationWarning) {
      setZeroDurationWarning(false);
    }
  }, [configuredSeconds, zeroDurationWarning]);

  // Exit focus overlay if parent switches away from this tool tab.
  useEffect(() => {
    if (!active && focusMode) {
      setFocusMode(false);
    }
  }, [active, focusMode]);

  // Clean up any scheduled finish chime sequence on unmount.
  useEffect(() => {
    return () => {
      cancelFinishAudio();
    };
  }, [cancelFinishAudio]);

  // Wall-clock interval continues running regardless of `active` tab visibility.
  useEffect(() => {
    if (status !== "running") {
      return;
    }

    let lastCueCheckedSeconds = -1;

    const tick = () => {
      const nextRemaining = computeRemainingSeconds(deadlineMsRef.current, Date.now());
      const nextDisplay = Math.max(0, Math.ceil(nextRemaining));

      if (nextDisplay !== lastCueCheckedSeconds) {
        lastCueCheckedSeconds = nextDisplay;
        const cue = resolveTimerCue(nextDisplay, activeDurationRef.current, firedCuesRef.current);
        if (cue) {
          const cancel = playTimerCue(cue, mutedRef.current);
          if (cue === "finish") {
            finishAudioCancelRef.current = cancel;
          }
        }
      }

      if (nextRemaining <= 0) {
        window.clearInterval(intervalId);
        setRemainingSeconds(0);
        setStatus("finished");
        return;
      }

      setRemainingSeconds(nextRemaining);
    };

    const intervalId = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [status]);

  // Notify parent when status, displayed integer seconds, or formatted clock changes.
  useEffect(() => {
    if (!onStatusChange) {
      return;
    }
    const prev = lastReportedRef.current;
    if (
      prev &&
      prev.status === status &&
      prev.remainingSeconds === displaySeconds &&
      prev.formattedTime === formattedTime
    ) {
      return;
    }
    const summary: TimerStatusSummary = {
      status,
      remainingSeconds: displaySeconds,
      formattedTime,
    };
    lastReportedRef.current = summary;
    onStatusChange(summary);
  }, [onStatusChange, status, displaySeconds, formattedTime]);

  const commitConfiguredHms = useCallback(
    (nextHours: number, nextMinutes: number, nextSeconds: number) => {
      cancelFinishAudio();
      firedCuesRef.current.clear();
      deadlineMsRef.current = 0;

      const nextTotal = hmsToTotalSeconds(nextHours, nextMinutes, nextSeconds);
      activeDurationRef.current = nextTotal;
      setHours(nextHours);
      setMinutes(nextMinutes);
      setSeconds(nextSeconds);
      setRemainingSeconds(nextTotal);
      setStatus((prev) => (prev === "finished" ? "stopped" : prev));
    },
    [cancelFinishAudio],
  );

  const startFreshCountdown = useCallback(() => {
    const totalSeconds = hmsToTotalSeconds(hours, minutes, seconds);
    if (totalSeconds <= 0) {
      setZeroDurationWarning(true);
      return;
    }

    setZeroDurationWarning(false);
    setEditingUnit(null);
    cancelFinishAudio();
    firedCuesRef.current = new Set();
    activeDurationRef.current = totalSeconds;
    deadlineMsRef.current = Date.now() + totalSeconds * 1000;
    setRemainingSeconds(totalSeconds);
    setStatus("running");
  }, [cancelFinishAudio, hours, minutes, seconds]);

  const handlePause = useCallback(() => {
    const exactRemaining = computeRemainingSeconds(deadlineMsRef.current, Date.now());
    if (exactRemaining <= 0) {
      const cue = resolveTimerCue(0, activeDurationRef.current, firedCuesRef.current);
      if (cue) {
        const cancel = playTimerCue(cue, mutedRef.current);
        if (cue === "finish") {
          finishAudioCancelRef.current = cancel;
        }
      }
      setRemainingSeconds(0);
      setStatus("finished");
      return;
    }
    setRemainingSeconds(exactRemaining);
    setStatus("paused");
  }, []);

  const handleResume = useCallback(() => {
    const resumeSeconds = Math.max(0, remainingSeconds);
    if (resumeSeconds <= 0) {
      startFreshCountdown();
      return;
    }
    setZeroDurationWarning(false);
    deadlineMsRef.current = Date.now() + resumeSeconds * 1000;
    setStatus("running");
  }, [remainingSeconds, startFreshCountdown]);

  const handlePrimaryAction = useCallback(() => {
    if (status === "running") {
      handlePause();
      return;
    }
    if (status === "paused") {
      handleResume();
      return;
    }
    startFreshCountdown();
  }, [handlePause, handleResume, startFreshCountdown, status]);

  const handleReset = useCallback(() => {
    cancelFinishAudio();
    firedCuesRef.current.clear();
    deadlineMsRef.current = 0;
    setEditingUnit(null);
    setZeroDurationWarning(false);

    const nextTotal = hmsToTotalSeconds(hours, minutes, seconds);
    activeDurationRef.current = nextTotal;
    setRemainingSeconds(nextTotal);
    setStatus("stopped");
  }, [cancelFinishAudio, hours, minutes, seconds]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (next) {
        cancelFinishAudio();
      }
      return next;
    });
  }, [cancelFinishAudio]);

  const applySingleUnit = useCallback(
    (unit: TimeUnitKey, nextValue: number) => {
      if (isEditingLocked) {
        return;
      }
      const nextH = unit === "hours" ? nextValue : hours;
      const nextM = unit === "minutes" ? nextValue : minutes;
      const nextS = unit === "seconds" ? nextValue : seconds;
      commitConfiguredHms(nextH, nextM, nextS);
    },
    [commitConfiguredHms, hours, isEditingLocked, minutes, seconds],
  );

  const handleStepUnit = useCallback(
    (unit: TimeUnitKey, delta: 1 | -1, max: number) => {
      if (isEditingLocked) {
        return;
      }
      const current = unit === "hours" ? hours : unit === "minutes" ? minutes : seconds;
      const nextValue = stepTimerUnit(current, delta, max);
      applySingleUnit(unit, nextValue);
      if (editingUnit?.unit === unit) {
        setEditingUnit({ unit, draft: padTwoDigits(nextValue) });
      }
    },
    [applySingleUnit, editingUnit, hours, isEditingLocked, minutes, seconds],
  );

  const handleUnitInputChange = useCallback(
    (unit: TimeUnitKey, max: number, rawValue: string) => {
      if (isEditingLocked) {
        return;
      }
      const digitsOnly = rawValue.replace(/\D/g, "");
      setEditingUnit({ unit, draft: digitsOnly });
      const liveValue = digitsOnly === "" ? 0 : clampTimerUnit(digitsOnly, max, 0);
      applySingleUnit(unit, liveValue);
    },
    [applySingleUnit, isEditingLocked],
  );

  const handleUnitInputBlur = useCallback(
    (unit: TimeUnitKey, max: number) => {
      if (editingUnit?.unit === unit) {
        const current = unit === "hours" ? hours : unit === "minutes" ? minutes : seconds;
        const clamped =
          editingUnit.draft.trim() === ""
            ? 0
            : clampTimerUnit(editingUnit.draft, max, current);
        applySingleUnit(unit, clamped);
      }
      setEditingUnit((prev) => (prev?.unit === unit ? null : prev));
    },
    [applySingleUnit, editingUnit, hours, minutes, seconds],
  );

  const handlePresetClick = useCallback(
    (presetMinutes: number) => {
      if (isEditingLocked) {
        return;
      }
      setEditingUnit(null);
      const next = totalSecondsToHms(presetMinutes * 60);
      commitConfiguredHms(next.hours, next.minutes, next.seconds);
    },
    [commitConfiguredHms, isEditingLocked],
  );

  // Keep latest handlers in a ref so the keyboard listener doesn't rebind on 100ms ticks.
  const shortcutRef = useRef({
    focusMode,
    handlePrimaryAction,
    handleReset,
  });
  shortcutRef.current = {
    focusMode,
    handlePrimaryAction,
    handleReset,
  };

  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && shortcutRef.current.focusMode) {
        event.preventDefault();
        setFocusMode(false);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        target.closest("input, textarea, select, button, [role='combobox'], [contenteditable='true']")
      ) {
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        shortcutRef.current.handlePrimaryAction();
        return;
      }

      if (event.code === "KeyR" || event.key === "r" || event.key === "R") {
        event.preventDefault();
        shortcutRef.current.handleReset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);

  const progressInitialDuration =
    status === "running" || status === "paused" ? activeDurationRef.current : configuredSeconds;
  const progressPercent =
    progressInitialDuration > 0
      ? Math.max(0, Math.min(100, (remainingSeconds / progressInitialDuration) * 100))
      : 0;

  const isCriticalClock =
    displaySeconds <= 3 && (status === "running" || status === "finished");
  const isWarningClock = !isCriticalClock && displaySeconds <= 30 && status === "running";

  const clockColorClass = isCriticalClock
    ? "text-[var(--or-error)]"
    : isWarningClock
      ? "text-[var(--or-warning)]"
      : "text-[var(--or-text)]";

  const progressBarFillClass =
    status === "finished" || isCriticalClock
      ? "bg-[var(--or-error)]"
      : isWarningClock
        ? "bg-[var(--or-warning)]"
        : "bg-[var(--or-primary)]";

  const primaryCtaConfig = (() => {
    switch (status) {
      case "running":
        return { icon: Pause, label: t("tools:timer.actions.pause") };
      case "paused":
        return { icon: Play, label: t("tools:timer.actions.resume") };
      case "finished":
        return { icon: RotateCcw, label: t("tools:timer.actions.restart") };
      default:
        return { icon: Play, label: t("tools:timer.actions.start") };
    }
  })();

  const PrimaryIcon = primaryCtaConfig.icon;

  const unitConfigs: ReadonlyArray<{
    key: TimeUnitKey;
    value: number;
    max: number;
    shortLabel: string;
    accessibleLabel: string;
  }> = [
    {
      key: "hours",
      value: hours,
      max: TIMER_MAX_HOURS,
      shortLabel: t("tools:timer.hours"),
      accessibleLabel: t("tools:timer.hoursLabel"),
    },
    {
      key: "minutes",
      value: minutes,
      max: TIMER_MAX_MINUTES,
      shortLabel: t("tools:timer.minutes"),
      accessibleLabel: t("tools:timer.minutesLabel"),
    },
    {
      key: "seconds",
      value: seconds,
      max: TIMER_MAX_SECONDS,
      shortLabel: t("tools:timer.seconds"),
      accessibleLabel: t("tools:timer.secondsLabel"),
    },
  ];

  const heroTimerCard = (
    <section
      className={`or-g53-card rounded-2xl flex flex-col justify-between gap-6 ${
        focusMode ? "w-full max-w-5xl p-8 sm:p-12 shadow-2xl" : "p-6 sm:p-8"
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--or-primary-container)] text-[var(--or-on-container)]">
            <Timer className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--or-text)] leading-tight">
              {t("tools:timer.title")}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-pressed={muted}
            className="or-g53-btn-tonal text-xs sm:text-sm py-2 px-3.5"
          >
            {muted ? (
              <VolumeX className="h-4 w-4 text-[var(--or-muted)]" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4 text-[var(--or-primary)]" aria-hidden="true" />
            )}
            <span>{muted ? t("tools:timer.sound.off") : t("tools:timer.sound.on")}</span>
          </button>

          <button
            type="button"
            onClick={() => setFocusMode((prev) => !prev)}
            aria-pressed={focusMode}
            className="or-g53-btn-tonal text-xs sm:text-sm py-2 px-3.5"
          >
            {focusMode ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {focusMode
                ? t("tools:timer.actions.focusExit")
                : t("tools:timer.actions.focusEnter")}
            </span>
          </button>
        </div>
      </div>

      {/* Center focal time readout stage */}
      <div
        className={`flex-1 rounded-3xl bg-[var(--or-block)] border border-[var(--or-outline)] px-8 flex flex-col items-center justify-center gap-6 ${
          focusMode ? "py-16 sm:py-20 min-h-[340px]" : "py-12 sm:py-16 min-h-[260px] sm:min-h-[320px]"
        }`}
      >
        <div
          aria-live="off"
          className={`font-bold tabular-nums tracking-[0.06em] leading-none select-none transition-colors ${
            focusMode
              ? "text-[clamp(4.25rem,12vw,8.5rem)]"
              : "text-[clamp(3.75rem,9vw,6.75rem)]"
          } ${clockColorClass}`}
        >
          {formattedTime}
        </div>

        {/* Remaining progress bar */}
        <div
          role="progressbar"
          aria-label={t("tools:timer.title")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
          className="w-full max-w-xl h-2.5 rounded-full bg-[var(--or-block-strong,var(--or-inset))] overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-150 ease-linear ${progressBarFillClass}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {status === "finished" && (
          <div
            role="status"
            className="or-g53-error-surface rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2"
          >
            <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("tools:timer.warnings.finishedBanner")}</span>
          </div>
        )}

        {status !== "finished" && zeroDurationWarning && (
          <div
            role="alert"
            className="or-g53-warning-surface rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("tools:timer.warnings.zeroDuration")}</span>
          </div>
        )}
      </div>

      {/* Primary Action Row */}
      <div className="flex flex-wrap items-center justify-center gap-3.5">
        <button
          type="button"
          onClick={handlePrimaryAction}
          className="or-g53-btn-primary px-7 py-3.5 text-base sm:text-lg rounded-2xl"
        >
          <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
          <span>{primaryCtaConfig.label}</span>
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="or-g53-btn-tonal px-6 py-3.5 text-base sm:text-lg rounded-2xl"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          <span>{t("tools:timer.actions.reset")}</span>
        </button>
      </div>
    </section>
  );

  if (focusMode) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("tools:timer.title")}
        className="fixed inset-0 z-50 bg-[var(--or-page)] backdrop-blur-md p-4 sm:p-6 flex items-center justify-center overflow-y-auto"
        style={{ backgroundColor: "color-mix(in srgb, var(--or-page) 94%, transparent)" }}
      >
        {heroTimerCard}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)] gap-5 items-stretch">
      {heroTimerCard}

      {/* Right settings & presets panel */}
      <aside className="or-g53-card rounded-2xl p-6 sm:p-8 flex flex-col justify-center gap-6">
        <div className="flex flex-col gap-6">
          {/* Section 1: Duration Spinners */}
          <div className="space-y-3.5">
            <h3 className="text-sm sm:text-base font-semibold text-[var(--or-text)]">
              {t("tools:timer.fromLabel")}
            </h3>

            <div className="grid grid-cols-3 gap-3">
              {unitConfigs.map((unit) => {
                const inputDisplay =
                  editingUnit?.unit === unit.key ? editingUnit.draft : padTwoDigits(unit.value);

                return (
                  <div
                    key={unit.key}
                    className="flex flex-col items-center gap-2.5 rounded-2xl bg-[var(--or-block)] border border-[var(--or-outline)] p-3.5 sm:p-4"
                  >
                    <button
                      type="button"
                      disabled={isEditingLocked}
                      onClick={() => handleStepUnit(unit.key, 1, unit.max)}
                      aria-label={t("tools:timer.increase", { unit: unit.accessibleLabel })}
                      className="or-g53-icon-btn disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </button>

                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      disabled={isEditingLocked}
                      aria-label={unit.accessibleLabel}
                      value={inputDisplay}
                      onFocus={(event) => {
                        setEditingUnit({ unit: unit.key, draft: padTwoDigits(unit.value) });
                        event.currentTarget.select();
                      }}
                      onChange={(event) =>
                        handleUnitInputChange(unit.key, unit.max, event.currentTarget.value)
                      }
                      onBlur={() => handleUnitInputBlur(unit.key, unit.max)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          handleStepUnit(unit.key, 1, unit.max);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          handleStepUnit(unit.key, -1, unit.max);
                        } else if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      className="or-g53-input w-full text-center font-mono text-2xl sm:text-3xl font-bold tabular-nums px-1 py-2.5 focus:border-[var(--or-focus)] disabled:opacity-60 disabled:cursor-not-allowed"
                    />

                    <button
                      type="button"
                      disabled={isEditingLocked}
                      onClick={() => handleStepUnit(unit.key, -1, unit.max)}
                      aria-label={t("tools:timer.decrease", { unit: unit.accessibleLabel })}
                      className="or-g53-icon-btn disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </button>

                    <span className="text-xs sm:text-sm font-medium text-[var(--or-muted)]">
                      {unit.shortLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Quick Presets */}
          <div className="space-y-3.5">
            <h3 className="text-sm sm:text-base font-semibold text-[var(--or-text)]">
              {t("tools:timer.presetsLabel")}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CLASSROOM_TIMER_PRESETS.map((preset) => {
                const isSelected = configuredSeconds === preset.minutes * 60;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isEditingLocked}
                    aria-pressed={isSelected}
                    onClick={() => handlePresetClick(preset.minutes)}
                    className={`rounded-full border px-4 py-2.5 text-sm sm:text-base font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                      isSelected
                        ? "border-[var(--or-primary)] bg-[var(--or-primary-container)] text-[var(--or-on-container)] font-semibold"
                        : "border-[var(--or-outline)] bg-[var(--or-card)] text-[var(--or-text)] hover:bg-[var(--or-block)]"
                    }`}
                  >
                    {t("tools:timer.presetMinutes", { count: preset.minutes })}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
