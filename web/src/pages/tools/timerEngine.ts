import type { TimerAudioCue } from "./classroomAudio";

export type TimerStatus = "stopped" | "running" | "paused" | "finished";

export interface TimerPreset {
  id: string;
  minutes: number;
}

export const TIMER_MAX_HOURS = 99;
export const TIMER_MAX_MINUTES = 59;
export const TIMER_MAX_SECONDS = 59;

export const DEFAULT_TIMER_HOURS = 0;
export const DEFAULT_TIMER_MINUTES = 5;
export const DEFAULT_TIMER_SECONDS = 0;

export const CLASSROOM_TIMER_PRESETS: readonly TimerPreset[] = [
  { id: "preset-1m", minutes: 1 },
  { id: "preset-3m", minutes: 3 },
  { id: "preset-5m", minutes: 5 },
  { id: "preset-10m", minutes: 10 },
  { id: "preset-15m", minutes: 15 },
  { id: "preset-45m", minutes: 45 },
];

export function clampTimerUnit(value: number | string, max: number, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const truncated = Math.trunc(parsed);
  return Math.min(max, Math.max(0, truncated));
}

export function stepTimerUnit(current: number, delta: 1 | -1, max: number): number {
  const next = Math.trunc(current) + delta;
  if (next > max) {
    return 0;
  }
  if (next < 0) {
    return max;
  }
  return next;
}

export function hmsToTotalSeconds(hours: number, minutes: number, seconds: number): number {
  const h = clampTimerUnit(hours, TIMER_MAX_HOURS, 0);
  const m = clampTimerUnit(minutes, TIMER_MAX_MINUTES, 0);
  const s = clampTimerUnit(seconds, TIMER_MAX_SECONDS, 0);
  return h * 3600 + m * 60 + s;
}

export function totalSecondsToHms(totalSeconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.min(TIMER_MAX_HOURS, Math.floor(safe / 3600));
  const rem = safe - hours * 3600;
  const minutes = Math.floor(rem / 60);
  const seconds = rem % 60;
  return { hours, minutes, seconds };
}

export function formatTimerHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getDisplaySeconds(remainingSeconds: number, status: TimerStatus): number {
  if (status === "finished") {
    return 0;
  }
  return Math.max(0, Math.ceil(remainingSeconds));
}

export function computeRemainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, (deadlineMs - nowMs) / 1000);
}

/**
 * Resolves the single highest-priority audio cue that should trigger for `displaySeconds`
 * while preventing duplicate replays across animation frames or skipped thresholds across tab sleeps.
 */
export function resolveTimerCue(
  displaySeconds: number,
  initialDurationSeconds: number,
  firedCues: Set<TimerAudioCue>,
): TimerAudioCue | null {
  if (displaySeconds <= 0) {
    if (!firedCues.has("finish")) {
      firedCues.add("finish");
      return "finish";
    }
    return null;
  }

  if (displaySeconds === 1 && !firedCues.has("countdown1")) {
    firedCues.add("warning30");
    firedCues.add("countdown3");
    firedCues.add("countdown2");
    firedCues.add("countdown1");
    return "countdown1";
  }

  if (displaySeconds === 2 && !firedCues.has("countdown2")) {
    firedCues.add("warning30");
    firedCues.add("countdown3");
    firedCues.add("countdown2");
    return "countdown2";
  }

  if (displaySeconds === 3 && !firedCues.has("countdown3")) {
    firedCues.add("warning30");
    firedCues.add("countdown3");
    return "countdown3";
  }

  if (
    initialDurationSeconds > 30 &&
    displaySeconds <= 30 &&
    displaySeconds > 3 &&
    !firedCues.has("warning30")
  ) {
    firedCues.add("warning30");
    return "warning30";
  }

  return null;
}
