export type TimerAudioCue =
  | "warning30"
  | "countdown3"
  | "countdown2"
  | "countdown1"
  | "finish";

export type RollCallAudioCue = "tick" | "finish";

interface ToneStep {
  freqHz: number;
  durationMs: number;
  delayMs?: number;
  volume?: number;
  wave?: OscillatorType;
}

type AudioContextCtor = typeof AudioContext;

let sharedAudioContext: AudioContext | null = null;
const scheduledTimeouts = new Set<ReturnType<typeof setTimeout>>();

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function ensureAudioContext(): AudioContext | null {
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) {
    return null;
  }
  try {
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      sharedAudioContext = new Ctor();
    }
    if (sharedAudioContext.state === "suspended") {
      void sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function triggerSingleTone(step: ToneStep): void {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }
  try {
    const now = ctx.currentTime;
    const durationSec = Math.max(0.02, step.durationMs / 1000);
    const volume = Math.min(0.4, Math.max(0.01, step.volume ?? 0.14));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = step.wave ?? "sine";
    osc.frequency.setValueAtTime(step.freqHz, now);

    // Smooth short attack/release envelope avoids speaker clicks
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.015, durationSec * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  } catch {
    // Web Audio API can fail silently under strict autoplay policies or headless environments
  }
}

export function clearPendingAudioCues(): void {
  for (const timer of scheduledTimeouts) {
    clearTimeout(timer);
  }
  scheduledTimeouts.clear();
}

export function playToneSequence(steps: readonly ToneStep[]): () => void {
  const handles: Array<ReturnType<typeof setTimeout>> = [];
  for (const step of steps) {
    const delay = Math.max(0, step.delayMs ?? 0);
    if (delay === 0) {
      triggerSingleTone(step);
      continue;
    }
    const handle = setTimeout(() => {
      scheduledTimeouts.delete(handle);
      triggerSingleTone(step);
    }, delay);
    scheduledTimeouts.add(handle);
    handles.push(handle);
  }
  return () => {
    for (const handle of handles) {
      clearTimeout(handle);
      scheduledTimeouts.delete(handle);
    }
  };
}

export function playTimerCue(cue: TimerAudioCue, muted = false): () => void {
  if (muted) {
    return () => {};
  }
  switch (cue) {
    case "warning30":
      return playToneSequence([{ freqHz: 600, durationMs: 300, volume: 0.15 }]);
    case "countdown3":
    case "countdown2":
    case "countdown1":
      return playToneSequence([{ freqHz: 880, durationMs: 150, volume: 0.14 }]);
    case "finish":
      return playToneSequence([
        { freqHz: 1000, durationMs: 400, delayMs: 0, volume: 0.18 },
        { freqHz: 1000, durationMs: 400, delayMs: 500, volume: 0.18 },
        { freqHz: 1000, durationMs: 400, delayMs: 1000, volume: 0.18 },
      ]);
  }
}

export function playRollCallCue(cue: RollCallAudioCue, muted = false): void {
  if (muted) {
    return;
  }
  if (cue === "tick") {
    playToneSequence([{ freqHz: 520, durationMs: 35, volume: 0.05, wave: "triangle" }]);
    return;
  }
  playToneSequence([
    { freqHz: 660, durationMs: 110, delayMs: 0, volume: 0.12 },
    { freqHz: 880, durationMs: 170, delayMs: 95, volume: 0.14 },
  ]);
}
