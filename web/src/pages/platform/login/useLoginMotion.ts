import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type LoginMotionPhase = "ready" | "leaving";

type MotionMode = "disabled" | "mobile" | "desktop";

const MOBILE_REST = { right: 66, control: 330, left: 176 };
const MIN_SUBMIT_FEEDBACK_MS = 85;
const DESKTOP_CARD_EXIT_MS = 340;
const MOBILE_CARD_EXIT_MS = 280;

function mobileCanopyPath(shapeScale: number): string {
  const format = (value: number) => String(Number(value.toFixed(2)));
  return `M0 0 L390 0 L390 ${format(MOBILE_REST.right * shapeScale)} Q185 ${format(MOBILE_REST.control * shapeScale)} 0 ${format(MOBILE_REST.left * shapeScale)} Z`;
}

export function useLoginMotion() {
  const [phase, setPhase] = useState<LoginMotionPhase>("ready");
  const [sceneHeight, setSceneHeight] = useState(844);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const mobilePathRef = useRef<SVGPathElement | null>(null);
  const phaseRef = useRef<LoginMotionPhase>(phase);
  const modeRef = useRef<MotionMode>("disabled");
  const shapeScaleRef = useRef(1);
  const submitStartedAtRef = useRef<number | null>(null);
  const timersRef = useRef(new Set<number>());
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const finishResolverRef = useRef<(() => void) | null>(null);

  const changePhase = useCallback((next: LoginMotionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const cancelTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const finishPending = useCallback(() => {
    const resolve = finishResolverRef.current;
    finishResolverRef.current = null;
    finishPromiseRef.current = null;
    submitStartedAtRef.current = null;
    resolve?.();
  }, []);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const setStaticCanopy = () => {
      mobilePathRef.current?.setAttribute(
        "d",
        mobileCanopyPath(shapeScaleRef.current),
      );
    };
    const readSize = () => {
      const bounds = scene?.getBoundingClientRect();
      const pixelHeight = bounds?.height || window.innerHeight || 844;
      const pixelWidth = bounds?.width || window.innerWidth || 390;
      const nextHeight = Math.max(1, Math.ceil(pixelHeight * 390 / pixelWidth));
      shapeScaleRef.current = Math.min(1, 520 / pixelWidth);
      setSceneHeight((current) => current === nextHeight ? current : nextHeight);
      if (phaseRef.current !== "leaving" && !finishPromiseRef.current) setStaticCanopy();
    };

    readSize();
    window.addEventListener("resize", readSize);
    const observer = typeof ResizeObserver === "undefined" || !scene
      ? null
      : new ResizeObserver(readSize);
    if (scene) observer?.observe(scene);

    const resetMode = () => {
      let motionMedia: MediaQueryList;
      let mobileMedia: MediaQueryList;
      try {
        if (typeof window.matchMedia !== "function") throw new Error("media query unavailable");
        motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
        mobileMedia = window.matchMedia("(max-width: 899.98px)");
      } catch {
        modeRef.current = "disabled";
        setStaticCanopy();
        return () => {};
      }

      const updateMode = () => {
        modeRef.current = motionMedia.matches
          ? "disabled"
          : mobileMedia.matches ? "mobile" : "desktop";
        if (phaseRef.current !== "leaving" && !finishPromiseRef.current) setStaticCanopy();
        if (motionMedia.matches && finishPromiseRef.current) {
          cancelTimers();
          changePhase("leaving");
          finishPending();
        }
      };
      const onBreakpointChange = () => {
        if (phaseRef.current === "leaving" || finishPromiseRef.current) return;
        updateMode();
      };
      const onMotionPreferenceChange = () => updateMode();

      updateMode();
      mobileMedia.addEventListener?.("change", onBreakpointChange);
      motionMedia.addEventListener?.("change", onMotionPreferenceChange);
      return () => {
        mobileMedia.removeEventListener?.("change", onBreakpointChange);
        motionMedia.removeEventListener?.("change", onMotionPreferenceChange);
      };
    };

    const cleanupMode = resetMode();
    return () => {
      cancelTimers();
      finishPending();
      observer?.disconnect();
      window.removeEventListener("resize", readSize);
      cleanupMode();
    };
  }, [cancelTimers, changePhase, finishPending]);

  const beginSubmitting = useCallback(() => {
    const startedAt = performance.now();
    submitStartedAtRef.current = startedAt;
    return startedAt;
  }, []);

  const cancelSubmitting = useCallback(() => {
    cancelTimers();
    submitStartedAtRef.current = null;
    finishPending();
    changePhase("ready");
  }, [cancelTimers, changePhase, finishPending]);

  const finish = useCallback((submittedAt?: number, onLeaving?: () => void): Promise<void> => {
    if (finishPromiseRef.current) return finishPromiseRef.current;

    const mode = modeRef.current;
    if (mode === "disabled") {
      changePhase("leaving");
      submitStartedAtRef.current = null;
      return Promise.resolve();
    }

    const duration = mode === "mobile" ? MOBILE_CARD_EXIT_MS : DESKTOP_CARD_EXIT_MS;
    const startedAt = submittedAt ?? submitStartedAtRef.current ?? performance.now();
    const feedbackWait = Math.max(0, MIN_SUBMIT_FEEDBACK_MS - (performance.now() - startedAt));
    let resolveFinish!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFinish = resolve;
    });
    finishPromiseRef.current = promise;
    finishResolverRef.current = () => {
      finishResolverRef.current = null;
      finishPromiseRef.current = null;
      submitStartedAtRef.current = null;
      resolveFinish();
    };

    later(() => {
      onLeaving?.();
      changePhase("leaving");
      later(finishPending, duration);
    }, feedbackWait);
    return promise;
  }, [changePhase, finishPending, later]);

  return {
    phase,
    sceneRef,
    mobilePathRef,
    sceneHeight,
    beginSubmitting,
    cancelSubmitting,
    finish,
  };
}
