import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLoginMotion } from "./useLoginMotion";

type MediaMock = {
  matches: boolean;
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => void;
};

function setupMedia(initialMobile = false, initialReduced = false) {
  const mobileListeners = new Set<(event: MediaQueryListEvent) => void>();
  const motionListeners = new Set<(event: MediaQueryListEvent) => void>();
  const mobileMedia: MediaMock = {
    matches: initialMobile,
    addEventListener: (_type, listener) => mobileListeners.add(listener),
    removeEventListener: (_type, listener) => mobileListeners.delete(listener),
  };
  const motionMedia: MediaMock = {
    matches: initialReduced,
    addEventListener: (_type, listener) => motionListeners.add(listener),
    removeEventListener: (_type, listener) => motionListeners.delete(listener),
  };
  const matchMedia = (query: string) => (query.startsWith("(prefers-reduced-motion") ? motionMedia : mobileMedia) as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    mobileMedia,
    motionMedia,
    setMobile(matches: boolean) {
      mobileMedia.matches = matches;
      for (const listener of mobileListeners) listener({ matches } as MediaQueryListEvent);
    },
    setReduced(matches: boolean) {
      motionMedia.matches = matches;
      for (const listener of motionListeners) listener({ matches } as MediaQueryListEvent);
    },
  };
}

function setupAnimationFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => callbacks.delete(id));
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  return {
    callbacks,
    requestAnimationFrame,
    cancelAnimationFrame,
    frame(now: number) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    },
  };
}

describe("useLoginMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts the desktop login ready without a delayed splash", async () => {
    vi.useFakeTimers();
    setupMedia();
    setupAnimationFrames();

    const { result } = renderHook(() => useLoginMotion());
    expect(result.current.phase).toBe("ready");

    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(result.current.phase).toBe("ready");
  });

  it("renders the ready phase on the first commit when motion is allowed", () => {
    setupMedia(false, false);
    setupAnimationFrames();
    const renderedPhases: string[] = [];

    const { result } = renderHook(() => {
      const motion = useLoginMotion();
      renderedPhases.push(motion.phase);
      return motion;
    });

    expect(renderedPhases[0]).toBe("ready");
    expect(result.current.phase).toBe("ready");
  });

  it("starts ready for reduced motion and falls back to ready if motion setup is unavailable", () => {
    setupMedia(false, true);
    setupAnimationFrames();
    const reducedPhases: string[] = [];
    const reduced = renderHook(() => {
      const motion = useLoginMotion();
      reducedPhases.push(motion.phase);
      return motion;
    });
    expect(reducedPhases[0]).toBe("ready");
    expect(reduced.result.current.phase).toBe("ready");
    reduced.unmount();

    vi.stubGlobal("matchMedia", () => { throw new Error("media query unavailable"); });
    const failedSetup = renderHook(() => useLoginMotion());
    expect(failedSetup.result.current.phase).toBe("ready");
    failedSetup.unmount();

    setupMedia(false, false);
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const noAnimationFrame = renderHook(() => useLoginMotion());
    expect(noAnimationFrame.result.current.phase).toBe("ready");
  });

  it("uses a short response hold before the reference card fade and resolves after it", async () => {
    vi.useFakeTimers();
    const media = setupMedia();
    setupAnimationFrames();

    const { result } = renderHook(() => useLoginMotion());
    let handoff!: Promise<void>;
    let completed = false;
    act(() => {
      const startedAt = result.current.beginSubmitting();
      handoff = result.current.finish(startedAt);
      void handoff.then(() => { completed = true; });
    });

    act(() => media.setMobile(true));
    expect(result.current.phase).toBe("ready");

    await act(async () => vi.advanceTimersByTimeAsync(84));
    expect(result.current.phase).toBe("ready");
    expect(completed).toBe(false);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.phase).toBe("leaving");
    expect(completed).toBe(false);

    await act(async () => vi.advanceTimersByTimeAsync(339));
    expect(completed).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await handoff;
    });
    expect(completed).toBe(true);
  });

  it("keeps the static login ready when reduced motion is enabled", async () => {
    vi.useFakeTimers();
    const media = setupMedia();
    const frames = setupAnimationFrames();

    const { result } = renderHook(() => useLoginMotion());
    expect(result.current.phase).toBe("ready");
    await act(async () => vi.advanceTimersByTimeAsync(1220));
    expect(frames.callbacks.size).toBe(0);

    act(() => media.setReduced(true));
    expect(frames.callbacks.size).toBe(0);
    expect(result.current.phase).toBe("ready");

    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.phase).toBe("ready");
  });
});
