import { StrictMode } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleWorkspaceWork, trackWorkspaceAnimation, useAfterWorkspaceTransition } from "./workspaceWorkScheduler";

type IdleTask = {
  id: number;
  callback: IdleRequestCallback;
};
type FrameTask = {
  id: number;
  callback: FrameRequestCallback;
};

let nextIdleId = 0;
let idleTasks: IdleTask[] = [];
let nextFrameId = 0;
let frameTasks: FrameTask[] = [];

function installIdleQueue() {
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const id = ++nextIdleId;
    idleTasks.push({ id, callback });
    return id;
  });
  const cancelIdleCallback = vi.fn((id: number) => {
    idleTasks = idleTasks.filter((task) => task.id !== id);
  });
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrameId;
    frameTasks.push({ id, callback });
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => {
    frameTasks = frameTasks.filter((task) => task.id !== id);
  });
  Object.assign(window, { requestIdleCallback, cancelIdleCallback, requestAnimationFrame, cancelAnimationFrame });
  return { requestIdleCallback, cancelIdleCallback, requestAnimationFrame, cancelAnimationFrame };
}

async function flushOneIdleTask() {
  const task = idleTasks.shift();
  if (!task) throw new Error("Expected an idle task to be scheduled");
  await act(async () => {
    task.callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    await Promise.resolve();
  });
}

async function flushOneFrame() {
  const task = frameTasks.shift();
  if (!task) throw new Error("Expected a frame callback to be scheduled");
  await act(async () => {
    task.callback(0);
    await Promise.resolve();
  });
}

function makeAnimation() {
  let settle!: () => void;
  let playState: AnimationPlayState = "running";
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const animation = {
    get playState() { return playState; },
    finished,
  } as unknown as Animation;

  return {
    animation,
    finish() {
      playState = "finished";
      settle();
    },
  };
}

function makeCssRevealAnimation(target: HTMLElement) {
  let settle!: () => void;
  let playState: AnimationPlayState = "running";
  let active = false;
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const animation = {
    get playState() { return playState; },
    finished,
    animationName: "or-workspace-reveal",
    setActive(value: boolean) { active = value; },
    isActive() { return active; },
    effect: {
      target,
      getTiming: () => ({ iterations: 1 }),
      getComputedTiming: () => ({ endTime: 220 }),
    },
  } as unknown as Animation;

  return {
    animation,
    finish() {
      playState = "finished";
      active = false;
      settle();
    },
  };
}

beforeEach(() => {
  nextIdleId = 0;
  idleTasks = [];
  nextFrameId = 0;
  frameTasks = [];
  installIdleQueue();
});

afterEach(() => {
  idleTasks = [];
  frameTasks = [];
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
  Reflect.deleteProperty(window, "requestAnimationFrame");
  Reflect.deleteProperty(window, "cancelAnimationFrame");
  Reflect.deleteProperty(document, "getAnimations");
  vi.restoreAllMocks();
});

describe("workspace work scheduler", () => {
  it("runs one FIFO job per idle turn", async () => {
    const calls: number[] = [];
    scheduleWorkspaceWork(() => calls.push(1));
    scheduleWorkspaceWork(() => calls.push(2));

    expect(calls).toEqual([]);
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(calls).toEqual([1]);
    expect(frameTasks).toHaveLength(1);
    expect(idleTasks).toHaveLength(0);
    await flushOneFrame();
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(calls).toEqual([1, 2]);
    expect(idleTasks).toHaveLength(0);
  });

  it("waits for a tracked animation before starting the idle queue", async () => {
    const { animation, finish } = makeAnimation();
    const stopTracking = trackWorkspaceAnimation(animation);
    const callback = vi.fn();
    scheduleWorkspaceWork(callback);

    expect(idleTasks).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();

    finish();
    await act(async () => { await Promise.resolve(); });
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(callback).toHaveBeenCalledTimes(1);
    stopTracking();
  });

  it("catches the finite workspace reveal animation when it starts after scheduling", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const { animation, finish } = makeCssRevealAnimation(target);
    const cssAnimation = animation as Animation & { setActive: (value: boolean) => void; isActive: () => boolean };
    const getDocumentAnimations = vi.fn(() => cssAnimation.isActive() ? [animation] : []);
    const getTargetAnimations = vi.fn(() => cssAnimation.isActive() ? [animation] : []);
    Object.defineProperty(document, "getAnimations", { configurable: true, value: getDocumentAnimations });
    Object.assign(target, { getAnimations: getTargetAnimations });
    const callback = vi.fn();
    scheduleWorkspaceWork(callback);

    expect(getDocumentAnimations).not.toHaveBeenCalled();
    expect(idleTasks).toHaveLength(1);
    cssAnimation.setActive(true);
    const event = new Event("animationstart", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: "or-workspace-reveal" });
    target.dispatchEvent(event);
    expect(idleTasks).toHaveLength(0);
    expect(getTargetAnimations).toHaveBeenCalledTimes(1);
    expect(getDocumentAnimations).not.toHaveBeenCalled();

    finish();
    await act(async () => { await Promise.resolve(); });
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(getDocumentAnimations).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    target.remove();
  });

  it("does not block on an unrelated infinite loading animation", async () => {
    const spinner = {
      playState: "running",
      animationName: "spinner-spin",
      effect: {
        getTiming: () => ({ iterations: Number.POSITIVE_INFINITY }),
        getComputedTiming: () => ({ endTime: Number.POSITIVE_INFINITY }),
      },
    } as unknown as Animation;
    Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [spinner] });
    const callback = vi.fn();
    scheduleWorkspaceWork(callback);

    await flushOneIdleTask();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("removes canceled jobs and aborts callbacks from a replaced scope", async () => {
    const oldCallback = vi.fn();
    const newCallback = vi.fn();
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useAfterWorkspaceTransition(scopeKey),
      { initialProps: { scopeKey: "first" } },
    );

    result.current.schedule(oldCallback);
    expect(result.current.ready).toBe(false);

    rerender({ scopeKey: "second" });
    expect(result.current.ready).toBe(false);
    result.current.schedule(newCallback);

    await flushOneIdleTask(); // New scope's ready marker.
    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();
    expect(frameTasks).toHaveLength(1);
    await flushOneFrame();
    await flushOneIdleTask();
    expect(newCallback).toHaveBeenCalledTimes(1);
  });

  it("respects AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const canceled = vi.fn();
    const retained = vi.fn();
    scheduleWorkspaceWork(canceled, { signal: controller.signal });
    scheduleWorkspaceWork(retained);

    controller.abort();
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(canceled).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledTimes(1);
  });

  it("uses a frame and a later timer task when requestIdleCallback is unavailable", async () => {
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
    const callback = vi.fn();
    scheduleWorkspaceWork(callback);

    expect(callback).not.toHaveBeenCalled();
    expect(frameTasks).toHaveLength(1);
    await flushOneFrame();
    expect(callback).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a tracked animation when reduced motion is enabled", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    const { animation } = makeAnimation();
    const stopTracking = trackWorkspaceAnimation(animation);
    const callback = vi.fn();
    scheduleWorkspaceWork(callback);

    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(callback).toHaveBeenCalledTimes(1);
    stopTracking();
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("creates a new readiness generation when a scope returns to an earlier key", async () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useAfterWorkspaceTransition(scopeKey),
      { initialProps: { scopeKey: "A" } },
    );
    await flushOneIdleTask();
    expect(result.current.ready).toBe(true);

    rerender({ scopeKey: "B" });
    expect(result.current.ready).toBe(false);
    rerender({ scopeKey: "A" });
    expect(result.current.ready).toBe(false);
    await flushOneIdleTask();
    expect(result.current.ready).toBe(true);
  });

  it("keeps readiness correct through StrictMode effect setup and cleanup", async () => {
    const states: boolean[] = [];
    function Probe() {
      const scheduler = useAfterWorkspaceTransition("strict-scope");
      states.push(scheduler.ready);
      return null;
    }

    render(<StrictMode><Probe /></StrictMode>);
    expect(idleTasks).toHaveLength(1);
    await flushOneIdleTask();
    expect(states.at(-1)).toBe(true);
  });
});
