type Cue = "visibility" | "paste";
type ReviewSignal = { idle_seconds: number; burst_seconds: number; changed_questions: number; context_signal: Cue | "none" };

/** In-memory aggregation only. No answer text, per-keystroke log, or offline replay. */
export function createAnswerRhythm() {
  let last: number | null = null;
  let burst: { start: number; idle: number; questions: Set<string> } | null = null;
  let cue: { kind: Cue; at: number } | null = null;
  return {
    reset() { last = null; burst = null; cue = null; },
    note(kind: Cue, now: number) { cue = { kind, at: now }; },
    change(id: string, now: number): ReviewSignal | null {
      const paused = last === null ? 0 : now - last;
      last = now;
      if (paused >= 45_000 && paused <= 600_000) burst = { start: now, idle: paused, questions: new Set() };
      if (!burst || now < burst.start || now - burst.start > 12_000) { burst = null; return null; }
      burst.questions.add(id);
      if (burst.questions.size < 3) return null;
      const result: ReviewSignal = { idle_seconds: Math.floor(burst.idle / 1000), burst_seconds: Math.floor((now - burst.start) / 1000),
        changed_questions: burst.questions.size, context_signal: cue && cue.at >= burst.start - 12_000 && cue.at <= now ? cue.kind : "none" };
      burst = null;
      cue = null;
      return result;
    },
  };
}
