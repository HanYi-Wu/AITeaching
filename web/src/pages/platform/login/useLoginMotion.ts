import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  easeOutQuart,
  easeOutQuint,
  getLoginDoorOffsets,
  LOGIN_DOOR_CRACK_DISTANCE,
} from "./loginMotionGeometry";

export type LoginMotionPhase = "splash" | "brand-exit" | "revealing" | "ready" | "leaving";

type MotionMode = "disabled" | "mobile" | "desktop";

function initialMotionPhase(): LoginMotionPhase {
  if (
    typeof window === "undefined"
    || typeof window.matchMedia !== "function"
    || typeof window.requestAnimationFrame !== "function"
    || typeof window.cancelAnimationFrame !== "function"
  ) {
    return "ready";
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "ready" : "splash";
  } catch {
    return "ready";
  }
}

type DesktopDoorNodes = {
  blackDoor: SVGGElement | null;
  blackShadow: SVGGElement | null;
  whiteDoor: SVGGElement | null;
  whiteShadow: SVGGElement | null;
  blackShadowPoly: SVGPolygonElement | null;
  whiteShadowPoly: SVGPolygonElement | null;
  blackEdgeTrim: SVGLineElement | null;
  whiteEdgeTrim: SVGLineElement | null;
  laserUp: SVGLineElement | null;
  laserDown: SVGLineElement | null;
};

const MOBILE_REST = { right: 66, control: 330, left: 176 };
const MOBILE_MARGIN = 28;
const DESKTOP_OPENING_COVER = 620;
const DESKTOP_SPLIT_DELAY = 1620;
const MOBILE_HANDOFF_DELAY = 340;

function mobileCanopyPath(height: number, progress: number, shapeScale: number): string {
  const full = height + MOBILE_MARGIN;
  const lerp = (from: number, to: number) => from + (to - from) * progress;
  const right = lerp(full, MOBILE_REST.right * shapeScale);
  const control = lerp(full, MOBILE_REST.control * shapeScale);
  const left = lerp(full, MOBILE_REST.left * shapeScale);
  const format = (value: number) => String(Number(value.toFixed(2)));
  return `M0 0 L390 0 L390 ${format(right)} Q185 ${format(control)} 0 ${format(left)} Z`;
}

export function useLoginMotion() {
  const [phase, setPhase] = useState<LoginMotionPhase>(initialMotionPhase);
  const [sceneHeight, setSceneHeight] = useState(844);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const mobilePathRef = useRef<SVGPathElement | null>(null);
  const desktopSvgRef = useRef<SVGSVGElement | null>(null);
  const desktopNodesRef = useRef<DesktopDoorNodes | null>(null);
  const phaseRef = useRef<LoginMotionPhase>(phase);
  const modeRef = useRef<MotionMode>("disabled");
  const sceneHeightRef = useRef(844);
  const shapeScaleRef = useRef(1);
  const mobileProgressRef = useRef(1);
  const submitStartedAtRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const timersRef = useRef(new Set<number>());
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const finishResolverRef = useRef<(() => void) | null>(null);

  const changePhase = useCallback((next: LoginMotionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
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

  const cacheDesktopNodes = useCallback(() => {
    const svg = desktopSvgRef.current;
    desktopNodesRef.current = svg ? {
      blackDoor: svg.querySelector<SVGGElement>("[data-pc-black-door]"),
      blackShadow: svg.querySelector<SVGGElement>("[data-pc-black-shadow]"),
      whiteDoor: svg.querySelector<SVGGElement>("[data-pc-white-door]"),
      whiteShadow: svg.querySelector<SVGGElement>("[data-pc-white-shadow]"),
      blackShadowPoly: svg.querySelector<SVGPolygonElement>("[data-pc-black-shadow-poly]"),
      whiteShadowPoly: svg.querySelector<SVGPolygonElement>("[data-pc-white-shadow-poly]"),
      blackEdgeTrim: svg.querySelector<SVGLineElement>("[data-pc-black-edge-trim]"),
      whiteEdgeTrim: svg.querySelector<SVGLineElement>("[data-pc-white-edge-trim]"),
      laserUp: svg.querySelector<SVGLineElement>("[data-pc-laser-up]"),
      laserDown: svg.querySelector<SVGLineElement>("[data-pc-laser-down]"),
    } : null;
  }, []);

  const setOpeningCover = useCallback((coverX: number) => {
    const nodes = desktopNodesRef.current;
    const transform = `translate(${coverX.toFixed(2)}, 0)`;
    nodes?.blackDoor?.setAttribute("transform", transform);
    nodes?.blackShadow?.setAttribute("transform", transform);
    nodes?.whiteDoor?.setAttribute("transform", "translate(0, 0)");
    nodes?.whiteShadow?.setAttribute("transform", "translate(0, 0)");
  }, []);

  const setPartingDistance = useCallback((distance: number, trimAlpha: number) => {
    const nodes = desktopNodesRef.current;
    const { x, y } = getLoginDoorOffsets(distance);
    const blackTransform = `translate(${(-x).toFixed(2)}, ${(-y).toFixed(2)})`;
    const whiteTransform = `translate(${x.toFixed(2)}, ${y.toFixed(2)})`;
    nodes?.blackDoor?.setAttribute("transform", blackTransform);
    nodes?.blackShadow?.setAttribute("transform", blackTransform);
    nodes?.whiteDoor?.setAttribute("transform", whiteTransform);
    nodes?.whiteShadow?.setAttribute("transform", whiteTransform);
    sceneRef.current?.setAttribute("data-part-dist", distance.toFixed(1));

    const opacity = Math.max(0, Math.min(1, trimAlpha)).toFixed(3);
    nodes?.blackShadowPoly?.setAttribute("opacity", opacity);
    nodes?.whiteShadowPoly?.setAttribute("opacity", opacity);
    nodes?.blackEdgeTrim?.setAttribute("opacity", opacity);
    nodes?.whiteEdgeTrim?.setAttribute("opacity", opacity);
  }, []);

  const setSeamLaser = useCallback((progress: number, alpha: number) => {
    const nodes = desktopNodesRef.current;
    const upX = 500 + (590 - 500) * progress;
    const upY = 500 + (0 - 500) * progress;
    const downX = 500 + (410 - 500) * progress;
    const downY = 500 + (1000 - 500) * progress;
    nodes?.laserUp?.setAttribute("x2", upX.toFixed(1));
    nodes?.laserUp?.setAttribute("y2", upY.toFixed(1));
    nodes?.laserDown?.setAttribute("x2", downX.toFixed(1));
    nodes?.laserDown?.setAttribute("y2", downY.toFixed(1));
    const opacity = alpha.toFixed(3);
    nodes?.laserUp?.setAttribute("opacity", opacity);
    nodes?.laserDown?.setAttribute("opacity", opacity);
  }, []);

  const resetDesktopDoors = useCallback(() => {
    setPartingDistance(0, 0);
    setSeamLaser(0, 0);
  }, [setPartingDistance, setSeamLaser]);

  const animateMobile = useCallback((from: number, to: number, duration: number, onDone?: () => void) => {
    cancelFrame();
    const startedAt = performance.now();
    const frame = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / duration);
      const progress = from + (to - from) * easeOutQuint(linear);
      mobileProgressRef.current = progress;
      mobilePathRef.current?.setAttribute("d", mobileCanopyPath(sceneHeightRef.current, progress, shapeScaleRef.current));
      if (linear < 1) {
        frameRef.current = window.requestAnimationFrame(frame);
      } else {
        frameRef.current = null;
        onDone?.();
      }
    };
    frameRef.current = window.requestAnimationFrame(frame);
  }, [cancelFrame]);

  const animateOpeningCover = useCallback((from: number, duration: number) => {
    cancelFrame();
    const startedAt = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setOpeningCover(from * (1 - easeOutQuint(progress)));
      if (progress < 1) frameRef.current = window.requestAnimationFrame(frame);
      else frameRef.current = null;
    };
    frameRef.current = window.requestAnimationFrame(frame);
  }, [cancelFrame, setOpeningCover]);

  const animateDesktopSubmitCrack = useCallback(() => {
    changePhase("leaving");
    const startedAt = performance.now();
    const frame = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed <= 220) {
        const laserProgress = Math.min(1, elapsed / 190);
        setSeamLaser(easeOutQuart(laserProgress), Math.min(1, laserProgress * 1.4));
        setPartingDistance(0, 0);
      } else if (elapsed <= 370) {
        const crackProgress = Math.min(1, (elapsed - 220) / 95);
        const crackDistance = crackProgress < 0.7
          ? (crackProgress / 0.7) * 14.5
          : 14.5 - ((crackProgress - 0.7) / 0.3) * 1.5;
        setSeamLaser(1, Math.max(0, 1 - (elapsed - 220) / 110));
        setPartingDistance(crackDistance, 1);
      } else {
        setSeamLaser(1, 0);
        setPartingDistance(LOGIN_DOOR_CRACK_DISTANCE, 1);
        frameRef.current = null;
        finishResolverRef.current?.();
        return;
      }
      frameRef.current = window.requestAnimationFrame(frame);
    };
    frameRef.current = window.requestAnimationFrame(frame);
  }, [changePhase, setPartingDistance, setSeamLaser]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const readHeight = () => {
      const bounds = scene?.getBoundingClientRect();
      const measuredHeight = bounds?.height ?? 0;
      const measuredWidth = bounds?.width ?? 0;
      const pixelHeight = measuredHeight || window.innerHeight || 844;
      const pixelWidth = measuredWidth || window.innerWidth || 390;
      const nextHeight = Math.max(1, Math.ceil(pixelHeight * 390 / pixelWidth));
      shapeScaleRef.current = Math.min(1, 520 / pixelWidth);
      sceneHeightRef.current = nextHeight;
      setSceneHeight((current) => current === nextHeight ? current : nextHeight);
      if (phaseRef.current !== "leaving" && frameRef.current === null) {
        mobilePathRef.current?.setAttribute("d", mobileCanopyPath(nextHeight, mobileProgressRef.current, shapeScaleRef.current));
      }
    };

    const onResize = () => readHeight();
    window.addEventListener("resize", onResize);
    let observer: ResizeObserver | null = null;
    const cleanupMeasurements = () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
    const restoreStaticPaths = () => {
      mobileProgressRef.current = 1;
      mobilePathRef.current?.setAttribute("d", mobileCanopyPath(sceneHeightRef.current, 1, shapeScaleRef.current));
      resetDesktopDoors();
      setOpeningCover(0);
    };
    const showUsableLogin = () => {
      modeRef.current = "disabled";
      restoreStaticPaths();
      changePhase("ready");
    };

    try {
      observer = typeof ResizeObserver === "undefined" || !scene
        ? null
        : new ResizeObserver(readHeight);
      if (scene) observer?.observe(scene);
      readHeight();
      cacheDesktopNodes();
    } catch {
      showUsableLogin();
      return cleanupMeasurements;
    }

    if (
      typeof window.matchMedia !== "function"
      || typeof window.requestAnimationFrame !== "function"
      || typeof window.cancelAnimationFrame !== "function"
    ) {
      showUsableLogin();
      return cleanupMeasurements;
    }

    let motionMedia: MediaQueryList;
    let mobileMedia: MediaQueryList;
    try {
      motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
      mobileMedia = window.matchMedia("(max-width: 899.98px)");
    } catch {
      showUsableLogin();
      return cleanupMeasurements;
    }
    const resetToRest = (nextMode: MotionMode) => {
      if (phaseRef.current === "leaving" || finishPromiseRef.current) return;
      cancelTimers();
      cancelFrame();
      modeRef.current = motionMedia.matches ? "disabled" : nextMode;
      restoreStaticPaths();
      changePhase("ready");
    };
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      resetToRest(event.matches ? "mobile" : "desktop");
    };
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      cancelTimers();
      cancelFrame();
      modeRef.current = event.matches ? "disabled" : (mobileMedia.matches ? "mobile" : "desktop");
      restoreStaticPaths();
      if (finishPromiseRef.current) {
        changePhase("leaving");
        finishResolverRef.current?.();
      } else {
        changePhase("ready");
      }
    };

    motionMedia.addEventListener?.("change", onMotionPreferenceChange);
    mobileMedia.addEventListener?.("change", onBreakpointChange);

    try {
      if (motionMedia.matches) {
        modeRef.current = "disabled";
        restoreStaticPaths();
        changePhase("ready");
      } else if (mobileMedia.matches) {
        modeRef.current = "mobile";
        mobileProgressRef.current = 0;
        mobilePathRef.current?.setAttribute("d", mobileCanopyPath(sceneHeightRef.current, 0, shapeScaleRef.current));
        changePhase("splash");
        later(() => changePhase("brand-exit"), 1750);
        later(() => {
          changePhase("revealing");
          animateMobile(0, 1, 700);
        }, 2120);
        later(() => changePhase("ready"), 3420);
      } else {
        modeRef.current = "desktop";
        resetDesktopDoors();
        setOpeningCover(DESKTOP_OPENING_COVER);
        changePhase("splash");
        later(() => changePhase("brand-exit"), 1400);
        later(() => animateOpeningCover(DESKTOP_OPENING_COVER, 740), 1700);
        later(() => changePhase("revealing"), 2040);
        later(() => changePhase("ready"), 2860);
      }
    } catch {
      cancelTimers();
      cancelFrame();
      showUsableLogin();
    }

    return () => {
      cancelTimers();
      cancelFrame();
      if (finishPromiseRef.current) finishResolverRef.current?.();
      cleanupMeasurements();
      mobileMedia.removeEventListener?.("change", onBreakpointChange);
      motionMedia.removeEventListener?.("change", onMotionPreferenceChange);
      desktopNodesRef.current = null;
    };
  }, [
    animateMobile,
    animateOpeningCover,
    cacheDesktopNodes,
    cancelFrame,
    cancelTimers,
    changePhase,
    later,
    resetDesktopDoors,
    setOpeningCover,
  ]);

  const beginSubmitting = useCallback(() => {
    const startedAt = performance.now();
    submitStartedAtRef.current = startedAt;
    return startedAt;
  }, []);

  const cancelSubmitting = useCallback(() => {
    submitStartedAtRef.current = null;
    cancelTimers();
    cancelFrame();
    mobileProgressRef.current = 1;
    mobilePathRef.current?.setAttribute("d", mobileCanopyPath(sceneHeightRef.current, 1, shapeScaleRef.current));
    resetDesktopDoors();
    changePhase("ready");
    finishResolverRef.current?.();
  }, [cancelFrame, cancelTimers, changePhase, resetDesktopDoors]);

  const finish = useCallback((submittedAt?: number): Promise<void> => {
    if (finishPromiseRef.current) return finishPromiseRef.current;
    cancelTimers();
    cancelFrame();

    if (modeRef.current === "disabled") {
      changePhase("leaving");
      return Promise.resolve();
    }

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

    const startedAt = submittedAt ?? submitStartedAtRef.current ?? performance.now();
    const minimumWait = modeRef.current === "desktop" ? DESKTOP_SPLIT_DELAY : MOBILE_HANDOFF_DELAY;
    const remaining = Math.max(0, minimumWait - (performance.now() - startedAt));
    later(() => {
      if (modeRef.current === "mobile") {
        changePhase("leaving");
        animateMobile(mobileProgressRef.current, 0, 540, () => finishResolverRef.current?.());
      } else {
        animateDesktopSubmitCrack();
      }
    }, remaining);
    return promise;
  }, [animateDesktopSubmitCrack, animateMobile, cancelFrame, cancelTimers, changePhase, later]);

  return {
    phase,
    sceneRef,
    mobilePathRef,
    desktopSvgRef,
    sceneHeight,
    beginSubmitting,
    cancelSubmitting,
    finish,
  };
}
