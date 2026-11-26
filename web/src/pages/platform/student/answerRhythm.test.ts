import { expect, it } from "vitest";
import { createAnswerRhythm } from "./answerRhythm";

it("aggregates distinct changed questions after a pause and only reports counts", () => {
  const rhythm = createAnswerRhythm();
  expect(rhythm.change("private-first-id", 0)).toBeNull();
  rhythm.note("paste", 48_000);
  expect(rhythm.change("q1", 50_000)).toBeNull();
  expect(rhythm.change("q1", 52_000)).toBeNull();
  expect(rhythm.change("q2", 54_000)).toBeNull();
  expect(rhythm.change("q3", 57_000)).toEqual({ idle_seconds: 50, burst_seconds: 7, changed_questions: 3, context_signal: "paste" });
});

it("does not mistake a reconnect, one question, or spread-out editing for a burst", () => {
  const rhythm = createAnswerRhythm();
  rhythm.change("q0", 0);
  rhythm.reset();
  [50_000, 52_000, 54_000].forEach((time, i) => expect(rhythm.change(`q${i}`, time)).toBeNull());
  [108_000, 114_000, 122_000].forEach((time, i) => expect(rhythm.change(`q${i}`, time)).toBeNull());
});
