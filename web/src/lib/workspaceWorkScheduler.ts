import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type ScheduleOptions = {
  signal?: AbortSignal;
};

type ScheduledJob = {
  callback: () => void;
  signal?: AbortSignal;
  active: boolean;
  cancel: () => void;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const queuedJobs: ScheduledJob[] = [];
const trackedAnimations = new Set<Animation>();
const relevantTransitionProperties = new Set(["transform", "width", "height"]);
const unreadyScope = Symbol("unready workspace scope");
const useCommittedEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

let idleHandle: number | null = null;
let idleHandleKind: "idle" | "timeout" | null = null;
let frameHandle: number | null = null;
let scheduledRunVersion = 0;
let runningJob = false;
let pumping = false;
let needsFrameBeforeNextJob = false;

/**
 * Queues one non-critical unit of workspace work. Jobs wait for tracked workspace
 * animations and are then run one at a time in idle periods. Each callback gets a
 * separate idle turn, allowing the browser to paint and process input between jobs.
 */
export function scheduleWorkspaceWork(callback: () => void, options: ScheduleOptions = {}): () => void {
  const job: ScheduledJob = {
    callback,
    signal: options.signal,
    active: true,
    cancel: () => {},
  };

  const cancel = () => {
    if (!job.active) return;
    job.active = false;
    job.signal?.removeEventListener("abort", cancel);
    requestPump();
  };
  job.cancel = cancel;

  if (options.signal?.aborted) {
    job.active = false;
    return cancel;
  }

  options.signal?.addEventListener("abort", cancel, { once: true });
  queuedJobs.push(job);
  requestPump();
  return cancel;
}

/**
 * Makes a finite WAAPI animation block queued background work until it settles.
 * Calling the returned function only stops tracking; it does not cancel the animation.
 */
export function trackWorkspaceAnimation(animation: Animation | null): () => void {
  if (!animation || animation.playState === "idle" || animation.playState === "finished" || !hasFiniteTimeline(animation)) return () => {};
  return trackAnimation(animation);
}

function hasFiniteTimeline(animation: Animation): boolean {
  const effect = animation.effect;
  if (!effect) return true;
  try {
    return Number.isFinite(effect.getTiming().iterations)
      && Number.isFinite(effect.getComputedTiming().endTime);
  } catch {
    return false;
  }
}

function trackAnimation(animation: Animation): () => void {
  if (animation.playState === "idle" || animation.playState === "finished") return () => {};
  if (trackedAnimations.has(animation)) return () => {};

  trackedAnimations.add(animation);
  let settled = false;
  const untrack = () => {
    if (settled) return;
    settled = true;
    trackedAnimations.delete(animation);
    requestPump();
  };

  try {
    void animation.finished.then(untrack, untrack);
  } catch {
    // Older or mocked Animation implementations may not expose a usable promise.
    // Their corresponding CSS animation events still keep this queue informed.
  }

  requestPump();
  return untrack;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isRelevantWorkspaceAnimation(animation: Animation): boolean {
  if (animation.playState === "idle" || animation.playState === "finished") return false;

  const effect = animation.effect;
  if (!effect || typeof effect.getTiming !== "function" || typeof effect.getComputedTiming !== "function") return false;

  const timing = effect.getTiming();
  const computedTiming = effect.getComputedTiming();
  if (!Number.isFinite(timing.iterations) || !Number.isFinite(computedTiming.endTime)) return false;

  const cssAnimation = animation as Animation & { animationName?: string };
  if (cssAnimation.animationName === "or-workspace-reveal") return true;

  const cssTransition = animation as Animation & { transitionProperty?: string };
  if (!relevantTransitionProperties.has(cssTransition.transitionProperty ?? "")) return false;

  const target = (effect as KeyframeEffect).target;
  return isElement(target) && Boolean(target.closest(".or-selection-indicator"));
}

function isElement(value: EventTarget | null): value is Element {
  return value !== null && "nodeType" in value && value.nodeType === 1 && "closest" in value;
}

function refreshCssAnimations(): void {
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") return;

  let animations: Animation[];
  try {
    animations = document.getAnimations();
  } catch {
    return;
  }
  for (const animation of animations) {
    if (isRelevantWorkspaceAnimation(animation)) trackAnimation(animation);
  }
}

function eventMatchesWorkspaceAnimation(event: Event): boolean {
  if (event.type.startsWith("animation")) {
    return (event as AnimationEvent).animationName === "or-workspace-reveal";
  }

  if (!event.type.startsWith("transition") || !isElement(event.target)) return false;
  const target = event.target;
  if (!target.closest(".or-selection-indicator")) return false;
  return relevantTransitionProperties.has((event as TransitionEvent).propertyName);
}

function observeEventTargetAnimations(event: Event): void {
  if (!isElement(event.target) || typeof event.target.getAnimations !== "function") return;
  for (const animation of event.target.getAnimations()) {
    if (isRelevantWorkspaceAnimation(animation)) trackAnimation(animation);
  }
}

function handleWorkspaceAnimationEvent(event: Event): void {
  if (!eventMatchesWorkspaceAnimation(event)) return;
  if (event.type.endsWith("start") || event.type.endsWith("run")) observeEventTargetAnimations(event);
  requestPump();
}

let cssAnimationListenersInstalled = false;
function installCssAnimationListeners(): void {
  if (cssAnimationListenersInstalled || typeof document === "undefined") return;
  cssAnimationListenersInstalled = true;
  document.addEventListener("animationstart", handleWorkspaceAnimationEvent, true);
  document.addEventListener("animationend", handleWorkspaceAnimationEvent, true);
  document.addEventListener("animationcancel", handleWorkspaceAnimationEvent, true);
  document.addEventListener("transitionrun", handleWorkspaceAnimationEvent, true);
  document.addEventListener("transitionend", handleWorkspaceAnimationEvent, true);
  document.addEventListener("transitioncancel", handleWorkspaceAnimationEvent, true);
}

function removeCssAnimationListeners(): void {
  if (!cssAnimationListenersInstalled || typeof document === "undefined") return;
  cssAnimationListenersInstalled = false;
  document.removeEventListener("animationstart", handleWorkspaceAnimationEvent, true);
  document.removeEventListener("animationend", handleWorkspaceAnimationEvent, true);
  document.removeEventListener("animationcancel", handleWorkspaceAnimationEvent, true);
  document.removeEventListener("transitionrun", handleWorkspaceAnimationEvent, true);
  document.removeEventListener("transitionend", handleWorkspaceAnimationEvent, true);
  document.removeEventListener("transitioncancel", handleWorkspaceAnimationEvent, true);
}

function hasBlockingAnimation(): boolean {
  if (prefersReducedMotion()) return false;

  for (const animation of trackedAnimations) {
    if (animation.playState === "idle" || animation.playState === "finished") {
      trackedAnimations.delete(animation);
    }
  }
  return trackedAnimations.size > 0;
}

function cancelScheduledRun(): void {
  scheduledRunVersion += 1;
  if (idleHandle !== null) {
    const handle = idleHandle;
    const kind = idleHandleKind;
    idleHandle = null;
    idleHandleKind = null;

    if (kind === "idle" && typeof window !== "undefined") {
      const idleWindow = window as IdleWindow;
      idleWindow.cancelIdleCallback?.(handle);
    } else if (kind === "timeout") {
      globalThis.clearTimeout(handle);
    }
  }

  if (frameHandle !== null) {
    const handle = frameHandle;
    frameHandle = null;
    if (typeof window !== "undefined") window.cancelAnimationFrame?.(handle);
  }
}

function pruneCanceledJobs(): void {
  while (queuedJobs[0] && !queuedJobs[0].active) queuedJobs.shift();
}

function clearQueueIfIdle(): void {
  pruneCanceledJobs();
  if (queuedJobs.length > 0 || runningJob) return;
  needsFrameBeforeNextJob = false;
  cancelScheduledRun();
  removeCssAnimationListeners();
}

function scheduleNextRun(): void {
  if (idleHandle !== null || frameHandle !== null || runningJob) return;

  const version = scheduledRunVersion;
  const idleWindow = typeof window === "undefined" ? null : window as IdleWindow;
  const hasIdleCallback = typeof idleWindow?.requestIdleCallback === "function";
  const run = () => {
    if (version !== scheduledRunVersion) return;
    idleHandle = null;
    idleHandleKind = null;
    runOneJob();
  };
  const scheduleIdleTurn = () => {
    if (version !== scheduledRunVersion) return;
    if (hasIdleCallback && idleWindow) {
      idleHandleKind = "idle";
      idleHandle = idleWindow.requestIdleCallback!(run, { timeout: 250 });
      return;
    }

    // Without idle callbacks, a timer task follows the frame gate where
    // available. If neither API exists, use one frame-sized yield as fallback.
    idleHandleKind = "timeout";
    idleHandle = globalThis.setTimeout(run, idleWindow?.requestAnimationFrame ? 0 : 16) as unknown as number;
  };
  const frameRequired = needsFrameBeforeNextJob || !hasIdleCallback;
  needsFrameBeforeNextJob = false;

  if (frameRequired && idleWindow?.requestAnimationFrame) {
    frameHandle = idleWindow.requestAnimationFrame(() => {
      if (version !== scheduledRunVersion) return;
      frameHandle = null;
      // The frame callback only schedules the work. Actual work starts later
      // from requestIdleCallback (or a timer in environments without it).
      scheduleIdleTurn();
    });
    return;
  }

  if (frameRequired && hasIdleCallback) {
    // Some non-browser hosts provide idle callbacks but no animation frames.
    idleHandleKind = "timeout";
    idleHandle = globalThis.setTimeout(() => {
      if (version !== scheduledRunVersion) return;
      idleHandle = null;
      idleHandleKind = null;
      scheduleIdleTurn();
    }, 16) as unknown as number;
    return;
  }

  scheduleIdleTurn();
}

function runOneJob(): void {
  if (runningJob) return;
  installCssAnimationListeners();
  // This fallback scan happens only at an idle turn, never in React effects or
  // other scheduling hot paths. Start/run events cover animations begun later.
  refreshCssAnimations();
  pruneCanceledJobs();

  if (queuedJobs.length === 0) {
    clearQueueIfIdle();
    return;
  }
  if (hasBlockingAnimation()) {
    return;
  }

  const job = queuedJobs.shift();
  if (!job) return;
  job.active = false;
  job.signal?.removeEventListener("abort", job.cancel);
  runningJob = true;
  try {
    job.callback();
  } finally {
    runningJob = false;
    needsFrameBeforeNextJob = true;
    requestPump();
  }
}

function requestPump(): void {
  if (pumping) return;
  pumping = true;
  try {
    pruneCanceledJobs();
    if (queuedJobs.length === 0) {
      clearQueueIfIdle();
      return;
    }

    installCssAnimationListeners();
    if (hasBlockingAnimation()) {
      cancelScheduledRun();
      return;
    }
    scheduleNextRun();
  } finally {
    pumping = false;
  }
}

type WorkspaceTransitionScheduler = {
  ready: boolean;
  schedule: (callback: () => void) => () => void;
};

/**
 * Provides a ready marker and scoped scheduler for deferred workspace stages.
 * Changing scopeKey cancels every pending callback from the previous scope.
 */
export function useAfterWorkspaceTransition(scopeKey?: unknown): WorkspaceTransitionScheduler {
  const scopeGeneration = useMemo(() => ({}), [scopeKey]);
  const [readyGeneration, setReadyGeneration] = useState<object | typeof unreadyScope>(unreadyScope);
  const scopeRef = useRef<{ controller: AbortController } | null>(null);

  useCommittedEffect(() => {
    const controller = new AbortController();
    const scope = { controller };
    scopeRef.current = scope;
    scheduleWorkspaceWork(() => setReadyGeneration(scopeGeneration), { signal: controller.signal });

    return () => {
      controller.abort();
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [scopeGeneration]);

  const schedule = useCallback((callback: () => void) => {
    const scope = scopeRef.current;
    if (!scope) return () => {};
    return scheduleWorkspaceWork(callback, { signal: scope.controller.signal });
  }, []);

  return { ready: readyGeneration === scopeGeneration, schedule };
}
