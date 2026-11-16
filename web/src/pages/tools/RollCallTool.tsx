import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Clock,
  RotateCcw,
  Shuffle,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Select as AppSelect } from "../../components/ui/select";
import { G52Pill } from "../../ui-redesign/g52/G52UIComponents";
import "../../ui-redesign/g53/g53.css";
import { clearPendingAudioCues, playRollCallCue } from "./classroomAudio";
import {
  buildRangeCandidates,
  clampRangeNumber,
  DEFAULT_RANGE_END,
  DEFAULT_RANGE_START,
  getAvailableCandidates,
  MAX_RANGE_VALUE,
  MIN_RANGE_VALUE,
  parseCustomCandidates,
  pickRandomCandidates,
  ROLL_CALL_ANIMATION_FRAMES,
  ROLL_CALL_FRAME_MS,
  ROLL_CALL_MAX_DRAW_COUNT,
  type RollCallCandidate,
  type RollCallHistoryEntry,
  type RollCallSourceMode,
} from "./rollCallEngine";

export interface RollCallToolProps {
  active?: boolean;
}

interface SettledResult {
  picked: RollCallCandidate[];
  source: RollCallSourceMode;
}

const SOURCE_MODES: readonly RollCallSourceMode[] = ["range", "custom"];
const DRAW_COUNT_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 8, 10];
const INTERACTIVE_KEY_EXCLUDE_SELECTOR =
  "input, textarea, select, button, a, [role='button'], [role='tab'], [role='combobox'], [role='option'], [role='listbox'], [role='menuitem'], [role='dialog']";

function formatTimeHms(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function filterOutSourcePrefix(ids: ReadonlySet<string>, prefix: string): Set<string> {
  const next = new Set<string>();
  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      next.add(id);
    }
  }
  return next;
}

function isRangeSpanEqual(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return (
    Math.min(aStart, aEnd) === Math.min(bStart, bEnd) &&
    Math.max(aStart, aEnd) === Math.max(bStart, bEnd)
  );
}

/**
 * Interactive classroom roll-call tool supporting number ranges and custom rosters.
 */
export function RollCallTool({ active = true }: RollCallToolProps) {
  const { t } = useTranslation("tools");

  const rangeStartId = useId();
  const rangeEndId = useId();
  const customTextareaId = useId();
  const drawCountSelectId = useId();

  const [source, setSource] = useState<RollCallSourceMode>("range");

  // Range source state
  const [rangeStart, setRangeStart] = useState<number>(DEFAULT_RANGE_START);
  const [rangeEnd, setRangeEnd] = useState<number>(DEFAULT_RANGE_END);
  const [rangeStartInput, setRangeStartInput] = useState<string>(String(DEFAULT_RANGE_START));
  const [rangeEndInput, setRangeEndInput] = useState<string>(String(DEFAULT_RANGE_END));

  // Custom source state
  const [customText, setCustomText] = useState<string>("");

  // Draw config & session state
  const [drawCount, setDrawCount] = useState<number>(1);
  const [noRepeat, setNoRepeat] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<RollCallHistoryEntry[]>([]);
  const [isRolling, setIsRolling] = useState<boolean>(false);
  const [rollingPreview, setRollingPreview] = useState<RollCallCandidate[]>([]);
  const [settledResult, setSettledResult] = useState<SettledResult | null>(null);

  const mountedRef = useRef<boolean>(true);
  const rollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const clearRollTimer = useCallback(() => {
    if (rollTimerRef.current !== null) {
      clearTimeout(rollTimerRef.current);
      rollTimerRef.current = null;
    }
  }, []);

  const cancelRoll = useCallback(() => {
    clearRollTimer();
    clearPendingAudioCues();
    setIsRolling(false);
    setRollingPreview([]);
  }, [clearRollTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRollTimer();
      clearPendingAudioCues();
    };
  }, [clearRollTimer]);

  const rangeCandidates = useMemo(
    () => buildRangeCandidates(rangeStart, rangeEnd),
    [rangeStart, rangeEnd],
  );
  const customCandidates = useMemo(
    () => parseCustomCandidates(customText),
    [customText],
  );

  const candidates = useMemo(
    () => (source === "range" ? rangeCandidates : customCandidates),
    [source, rangeCandidates, customCandidates],
  );

  const available = useMemo(
    () => getAvailableCandidates(candidates, pickedIds, noRepeat),
    [candidates, pickedIds, noRepeat],
  );

  const applyRangeValues = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (isRangeSpanEqual(rangeStart, rangeEnd, nextStart, nextEnd)) {
        setRangeStart(nextStart);
        setRangeEnd(nextEnd);
        return;
      }
      cancelRoll();
      setRangeStart(nextStart);
      setRangeEnd(nextEnd);
      setPickedIds((prev) => filterOutSourcePrefix(prev, "range:"));
      setSettledResult((prev) => (prev?.source === "range" ? null : prev));
    },
    [cancelRoll, rangeEnd, rangeStart],
  );

  const handleRangeInputChange = (field: "start" | "end", raw: string) => {
    if (field === "start") {
      setRangeStartInput(raw);
    } else {
      setRangeEndInput(raw);
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed < MIN_RANGE_VALUE || parsed > MAX_RANGE_VALUE) {
      return;
    }
    if (field === "start") {
      applyRangeValues(parsed, rangeEnd);
    } else {
      applyRangeValues(rangeStart, parsed);
    }
  };

  const commitRangeInputs = useCallback(() => {
    const nextStart = clampRangeNumber(rangeStartInput, rangeStart);
    const nextEnd = clampRangeNumber(rangeEndInput, rangeEnd);
    setRangeStartInput(String(nextStart));
    setRangeEndInput(String(nextEnd));
    applyRangeValues(nextStart, nextEnd);
  }, [applyRangeValues, rangeEnd, rangeEndInput, rangeStart, rangeStartInput]);

  const handleSourceChange = (nextSource: RollCallSourceMode) => {
    if (nextSource === source) {
      return;
    }
    cancelRoll();
    setSource(nextSource);
    setSettledResult(null);
  };

  const handleCustomTextChange = (nextText: string) => {
    cancelRoll();
    setCustomText(nextText);
    const nextCandidates = parseCustomCandidates(nextText);
    const validCustomIds = new Set(nextCandidates.map((item) => item.id));
    setPickedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (!id.startsWith("custom:") || validCustomIds.has(id)) {
          next.add(id);
        }
      }
      return next;
    });
    setSettledResult((prev) => (prev?.source === "custom" ? null : prev));
  };

  const handleStartDraw = useCallback(() => {
    if (isRolling || available.length === 0) {
      return;
    }

    clearRollTimer();

    const snapshotAvailable = [...available];
    const effectiveCount = Math.min(drawCount, snapshotAvailable.length);
    const previewPool = snapshotAvailable.length > 0 ? snapshotAvailable : [...candidates];
    const snapshotSource = source;

    setIsRolling(true);
    setSettledResult(null);

    const runStep = (frame: number) => {
      if (!mountedRef.current) {
        return;
      }

      if (frame >= ROLL_CALL_ANIMATION_FRAMES) {
        const winners = pickRandomCandidates(snapshotAvailable, effectiveCount);
        rollTimerRef.current = null;
        setIsRolling(false);
        setRollingPreview([]);
        setSettledResult({
          picked: winners,
          source: snapshotSource,
        });
        setPickedIds((prev) => {
          const next = new Set(prev);
          for (const item of winners) {
            next.add(item.id);
          }
          return next;
        });
        setHistory((prev) => {
          const nextRound = prev.length === 0 ? 1 : prev[0].round + 1;
          return [
            {
              round: nextRound,
              picked: winners,
              timestamp: Date.now(),
              source: snapshotSource,
            },
            ...prev,
          ];
        });
        playRollCallCue("finish", !soundEnabledRef.current);
        return;
      }

      setRollingPreview(pickRandomCandidates(previewPool, effectiveCount));
      playRollCallCue("tick", !soundEnabledRef.current);
      rollTimerRef.current = setTimeout(() => {
        runStep(frame + 1);
      }, ROLL_CALL_FRAME_MS);
    };

    runStep(0);
  }, [available, candidates, clearRollTimer, drawCount, isRolling, source]);

  const handleResetPool = useCallback(() => {
    cancelRoll();
    setPickedIds(new Set());
    setSettledResult(null);
  }, [cancelRoll]);

  const handleClearHistory = () => {
    setHistory([]);
  };

  const startDrawRef = useRef(handleStartDraw);
  startDrawRef.current = handleStartDraw;

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const isSpace = event.key === " " || event.code === "Space";
      const isEnter = event.key === "Enter";
      if (!isSpace && !isEnter) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable || target.closest("[contenteditable='true']")) {
          return;
        }
        if (target.closest(INTERACTIVE_KEY_EXCLUDE_SELECTOR)) {
          return;
        }
      }
      if (isSpace) {
        event.preventDefault();
      }
      startDrawRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + SOURCE_MODES.length) % SOURCE_MODES.length;
    handleSourceChange(SOURCE_MODES[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const warningMessage =
    candidates.length === 0
      ? t("tools:rollCall.emptyPoolWarning")
      : noRepeat && candidates.length > 0 && available.length === 0
        ? t("tools:rollCall.exhaustedWarning")
        : null;

  const remainingPillVariant =
    candidates.length === 0
      ? "neutral"
      : noRepeat && available.length === 0
        ? "warning"
        : "primary";

  const currentPicked = settledResult?.picked ?? [];
  const primaryActionLabel = isRolling
    ? t("tools:rollCall.rolling")
    : currentPicked.length > 0
      ? t("tools:rollCall.redraw")
      : t("tools:rollCall.startDraw");

  const singleResultHint = useMemo(() => {
    if (!settledResult || settledResult.picked.length !== 1) {
      return null;
    }
    const item = settledResult.picked[0];
    if (settledResult.source === "range") {
      return t("tools:rollCall.resultHintNumber", { label: item.label });
    }
    return t("tools:rollCall.resultHintCustom");
  }, [settledResult, t]);

  const rangeUnitText = t("tools:rollCall.rangeUnit");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)] gap-5 items-stretch">
      {/* Left Focal Column */}
      <section className="or-g53-card rounded-2xl p-6 sm:p-7 flex flex-col gap-5">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: "var(--or-primary-container)",
                color: "var(--or-on-container)",
              }}
              aria-hidden="true"
            >
              <Shuffle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--or-text)]">
                {t("tools:rollCall.title")}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <G52Pill variant={remainingPillVariant}>
              {t("tools:rollCall.remainingBadge", {
                remaining: available.length,
                total: candidates.length,
              })}
            </G52Pill>
            <button
              type="button"
              className="or-g53-icon-btn"
              onClick={() => setSoundEnabled((prev) => !prev)}
              aria-pressed={soundEnabled}
              aria-label={t("tools:rollCall.soundEnabled")}
              title={t("tools:rollCall.soundEnabled")}
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <VolumeX className="h-4 w-4 text-[var(--or-muted)]" aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {/* Source Mode Switcher */}
        <div
          role="tablist"
          aria-label={t("tools:rollCall.sourceLabel")}
          className="or-g53-tablist"
        >
          {SOURCE_MODES.map((mode, idx) => (
            <button
              key={mode}
              ref={(node) => {
                tabRefs.current[idx] = node;
              }}
              type="button"
              role="tab"
              aria-selected={source === mode}
              onClick={() => handleSourceChange(mode)}
              onKeyDown={(event) => handleTabKeyDown(event, idx)}
              className="or-g53-tab"
            >
              {t(`tools:rollCall.sources.${mode}`)}
            </button>
          ))}
        </div>

        {/* Source Configuration Block */}
        <div className="bg-[var(--or-block)] rounded-2xl p-4 sm:p-5 border border-[var(--or-outline)]">
          {source === "range" ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label
                htmlFor={rangeStartId}
                className="text-sm sm:text-base font-medium text-[var(--or-text)]"
              >
                {t("tools:rollCall.rangeFrom")}
              </label>
              <input
                id={rangeStartId}
                type="number"
                min={MIN_RANGE_VALUE}
                max={MAX_RANGE_VALUE}
                inputMode="numeric"
                value={rangeStartInput}
                onChange={(event) => handleRangeInputChange("start", event.target.value)}
                onBlur={commitRangeInputs}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRangeInputs();
                  }
                }}
                aria-label={t("tools:rollCall.rangeFrom")}
                className="or-g53-input w-28 text-center text-base font-semibold tabular-nums"
              />
              <label
                htmlFor={rangeEndId}
                className="text-sm sm:text-base font-medium text-[var(--or-text)]"
              >
                {t("tools:rollCall.rangeTo")}
              </label>
              <input
                id={rangeEndId}
                type="number"
                min={MIN_RANGE_VALUE}
                max={MAX_RANGE_VALUE}
                inputMode="numeric"
                value={rangeEndInput}
                onChange={(event) => handleRangeInputChange("end", event.target.value)}
                onBlur={commitRangeInputs}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRangeInputs();
                  }
                }}
                aria-label={t("tools:rollCall.rangeTo")}
                className="or-g53-input w-28 text-center text-base font-semibold tabular-nums"
              />
              {rangeUnitText ? (
                <span className="text-sm sm:text-base text-[var(--or-muted)]">{rangeUnitText}</span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor={customTextareaId}
                  className="text-sm font-medium text-[var(--or-text)]"
                >
                  {t("tools:rollCall.customLabel")}
                </label>
                <span className="text-xs font-medium text-[var(--or-muted)] shrink-0">
                  {t("tools:rollCall.customCount", { count: customCandidates.length })}
                </span>
              </div>
              <textarea
                id={customTextareaId}
                value={customText}
                onChange={(event) => handleCustomTextChange(event.target.value)}
                placeholder={t("tools:rollCall.customPlaceholder")}
                className="or-g53-input w-full min-h-[104px] resize-y"
              />
            </div>
          )}
        </div>

        {/* Focal Display Stage */}
        <div
          aria-live="polite"
          aria-busy={isRolling}
          className={`flex-1 rounded-3xl border p-8 min-h-[240px] sm:min-h-[290px] flex flex-col items-center justify-center text-center transition-colors ${
            isRolling
              ? "border-[var(--or-primary)]"
              : currentPicked.length > 0
                ? "bg-[var(--or-block)]"
                : "border-dashed border-[var(--or-outline)] bg-[var(--or-block)]"
          }`}
          style={
            isRolling
              ? {
                  backgroundColor:
                    "color-mix(in srgb, var(--or-primary-container) 55%, var(--or-block))",
                  boxShadow:
                    "0 0 0 3px color-mix(in srgb, var(--or-primary) 22%, transparent)",
                }
              : currentPicked.length > 0
                ? {
                    borderColor:
                      "color-mix(in srgb, var(--or-primary) 42%, var(--or-outline))",
                  }
                : undefined
          }
        >
          {isRolling ? (
            <div className="w-full flex flex-col items-center justify-center gap-3">
              <span className="text-sm font-semibold tracking-wide text-[var(--or-on-container)]">
                {t("tools:rollCall.rolling")}
              </span>
              {rollingPreview.length <= 1 ? (
                <div className="flex flex-col items-center gap-1 motion-safe:animate-pulse">
                  <span className="text-5xl sm:text-7xl font-extrabold tracking-tight text-[var(--or-primary)] break-all">
                    {rollingPreview[0]?.label ?? t("tools:rollCall.placeholder")}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-xl motion-safe:animate-pulse">
                  {rollingPreview.map((item, idx) => (
                    <div
                      key={`${item.id}-${idx}`}
                      className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-card)] px-3.5 py-3 flex flex-col items-center justify-center"
                    >
                      <span className="text-xl font-bold text-[var(--or-primary)] break-all">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : currentPicked.length === 1 ? (
            <div className="flex flex-col items-center gap-3">
              <span className="text-5xl sm:text-7xl font-extrabold tracking-tight text-[var(--or-text)] break-all">
                {currentPicked[0].label}
              </span>
              {singleResultHint ? (
                <span className="or-g53-pill or-g53-pill-neutral text-xs sm:text-sm py-1 px-3">
                  {singleResultHint}
                </span>
              ) : null}
            </div>
          ) : currentPicked.length > 1 ? (
            <div className="w-full flex flex-col items-center gap-3.5">
              <p className="text-sm sm:text-base font-semibold text-[var(--or-on-container)]">
                {t("tools:rollCall.multiResultTitle", { count: currentPicked.length })}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl">
                {currentPicked.map((item) => (
                  <div
                    key={item.id}
                    className="or-g53-accent-surface rounded-xl px-4 py-3 flex flex-col items-center justify-center text-center"
                  >
                    <span className="text-xl font-bold text-[var(--or-text)] break-all">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <span className="text-6xl sm:text-7xl font-bold tracking-tight text-[var(--or-muted)] opacity-60 select-none">
                {t("tools:rollCall.placeholder")}
              </span>
            </div>
          )}
        </div>

        {/* Inline Warning Banner */}
        {warningMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="or-g53-warning-surface rounded-xl px-4 py-2.5 text-sm flex items-center gap-2.5"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{warningMessage}</span>
          </div>
        ) : null}

        {/* Bottom Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label
                htmlFor={drawCountSelectId}
                className="text-sm sm:text-base font-medium text-[var(--or-text)] whitespace-nowrap"
              >
                {t("tools:rollCall.drawCountLabel")}
              </label>
              <AppSelect
                id={drawCountSelectId}
                aria-label={t("tools:rollCall.drawCountLabel")}
                className="min-w-[100px]"
                value={drawCount}
                onValueChange={(value) => {
                  const parsed = Number.parseInt(value, 10);
                  if (Number.isFinite(parsed) && parsed >= 1) {
                    setDrawCount(Math.min(ROLL_CALL_MAX_DRAW_COUNT, parsed));
                  }
                }}
              >
                {DRAW_COUNT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {t("tools:rollCall.drawCountOption", { count })}
                  </option>
                ))}
              </AppSelect>
            </div>

            <label
              className="inline-flex items-center gap-2 text-sm sm:text-base text-[var(--or-text)] cursor-pointer select-none"
              title={t("tools:rollCall.noRepeatHint")}
            >
              <input
                type="checkbox"
                checked={noRepeat}
                onChange={(event) => setNoRepeat(event.target.checked)}
                className="h-4 w-4 rounded accent-[var(--or-primary)] cursor-pointer"
              />
              <span className="font-medium">{t("tools:rollCall.noRepeat")}</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleResetPool}
              className="or-g53-btn-tonal px-5 py-2.5 text-sm sm:text-base"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("tools:rollCall.resetPool")}
            </button>
            <button
              type="button"
              onClick={handleStartDraw}
              disabled={isRolling || available.length === 0}
              className="or-g53-btn-primary px-6 py-2.5 text-sm sm:text-base"
            >
              <Shuffle className="h-4 w-4" aria-hidden="true" />
              {primaryActionLabel}
            </button>
          </div>
        </div>
      </section>

      {/* Right History Panel */}
      <aside className="or-g53-card rounded-2xl p-6 sm:p-7 flex flex-col gap-4 min-h-[300px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-[var(--or-text)] truncate">
              {t("tools:rollCall.historyTitle")}
            </h3>
            <G52Pill variant="neutral">
              {t("tools:rollCall.pickedBadge", { count: pickedIds.size })}
            </G52Pill>
          </div>
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={history.length === 0}
            className="or-g53-btn-tonal text-xs sm:text-sm px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("tools:rollCall.historyClear")}
          </button>
        </div>

        {history.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--or-outline)] bg-[var(--or-block)] p-6 text-center">
            <Clock className="h-7 w-7 text-[var(--or-muted)] mb-2 opacity-70" aria-hidden="true" />
            <p className="text-sm sm:text-base text-[var(--or-muted)]">
              {t("tools:rollCall.historyEmpty")}
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1">
            {history.map((entry) => (
              <div
                key={`${entry.round}-${entry.timestamp}`}
                className="rounded-xl border border-[var(--or-outline)] bg-[var(--or-block)] p-3.5 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-[var(--or-muted)]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--or-text)]">
                      {t("tools:rollCall.historyRound", { round: entry.round })}
                    </span>
                    <span className="or-g53-pill or-g53-pill-neutral text-xs py-0.5 px-2">
                      {t(`tools:rollCall.sources.${entry.source}`)}
                    </span>
                  </div>
                  <time
                    dateTime={new Date(entry.timestamp).toISOString()}
                    className="tabular-nums"
                  >
                    {formatTimeHms(entry.timestamp)}
                  </time>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.picked.map((candidate) => (
                    <span
                      key={candidate.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-2.5 py-1 text-xs sm:text-sm font-semibold text-[var(--or-text)]"
                    >
                      <span>{candidate.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
