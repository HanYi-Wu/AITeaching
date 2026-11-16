import { describe, expect, it } from "vitest";
import type { TimerAudioCue } from "./classroomAudio";
import {
  clampTimerUnit,
  computeRemainingSeconds,
  formatTimerHms,
  getDisplaySeconds,
  hmsToTotalSeconds,
  resolveTimerCue,
  stepTimerUnit,
  totalSecondsToHms,
} from "./timerEngine";

describe("timerEngine", () => {
  it("clamps and wraps hours/minutes/seconds units like the desktop reference spinner", () => {
    expect(clampTimerUnit("12", 59)).toBe(12);
    expect(clampTimerUnit(88, 59)).toBe(59);
    expect(clampTimerUnit(-3, 59)).toBe(0);
    expect(clampTimerUnit("bad", 59, 5)).toBe(5);

    expect(stepTimerUnit(0, -1, 59)).toBe(59);
    expect(stepTimerUnit(59, 1, 59)).toBe(0);
    expect(stepTimerUnit(99, 1, 99)).toBe(0);
    expect(stepTimerUnit(0, -1, 99)).toBe(99);
    expect(stepTimerUnit(14, 1, 59)).toBe(15);
  });

  it("converts and formats HMS durations accurately", () => {
    expect(hmsToTotalSeconds(1, 2, 3)).toBe(3723);
    expect(totalSecondsToHms(3723)).toEqual({ hours: 1, minutes: 2, seconds: 3 });
    expect(formatTimerHms(3723)).toBe("01:02:03");
    expect(formatTimerHms(0)).toBe("00:00:00");
    expect(formatTimerHms(-5)).toBe("00:00:00");
    expect(getDisplaySeconds(0.1, "running")).toBe(1);
    expect(getDisplaySeconds(1.2, "finished")).toBe(0);
    expect(computeRemainingSeconds(10500, 8000)).toBe(2.5);
  });

  it("triggers 30s, 3-2-1s, and finish audio cues once without duplicates", () => {
    const fired = new Set<TimerAudioCue>();

    // For a 60s countdown: 30s warning fires once, 3/2/1 countdown fires once each, finish fires once
    expect(resolveTimerCue(45, 60, fired)).toBeNull();
    expect(resolveTimerCue(30, 60, fired)).toBe("warning30");
    expect(resolveTimerCue(30, 60, fired)).toBeNull();
    expect(resolveTimerCue(10, 60, fired)).toBeNull();
    expect(resolveTimerCue(3, 60, fired)).toBe("countdown3");
    expect(resolveTimerCue(3, 60, fired)).toBeNull();
    expect(resolveTimerCue(2, 60, fired)).toBe("countdown2");
    expect(resolveTimerCue(1, 60, fired)).toBe("countdown1");
    expect(resolveTimerCue(0, 60, fired)).toBe("finish");
    expect(resolveTimerCue(0, 60, fired)).toBeNull();
  });

  it("skips 30s warning when initial duration is <= 30s", () => {
    const fired = new Set<TimerAudioCue>();
    expect(resolveTimerCue(20, 20, fired)).toBeNull();
    expect(resolveTimerCue(3, 20, fired)).toBe("countdown3");
    expect(resolveTimerCue(2, 20, fired)).toBe("countdown2");
    expect(resolveTimerCue(1, 20, fired)).toBe("countdown1");
    expect(resolveTimerCue(0, 20, fired)).toBe("finish");
  });
});
