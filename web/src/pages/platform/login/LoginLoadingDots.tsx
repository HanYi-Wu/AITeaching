import { useEffect, useRef, useState } from "react";
import {
  computeLoginLoadingGeometry,
  getLoginLoadingOffset,
  LOGIN_LOADING_DOTS,
} from "./loginLoadingGeometry";
import "./LoginLoadingDots.css";

function getReducedMotionPreference(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotionPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function LoginLoadingDots({ active }: { active: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const centerRef = useRef<SVGCircleElement | null>(null);
  const satelliteRef = useRef<SVGCircleElement | null>(null);
  const bridgeRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    const center = centerRef.current;
    const satellite = satelliteRef.current;
    const bridge = bridgeRef.current;
    if (!center || !satellite || !bridge) return;

    const resetGeometry = () => {
      center.setAttribute("cx", "0");
      center.setAttribute("r", String(LOGIN_LOADING_DOTS.centerRadius));
      satellite.setAttribute("cx", "0");
      satellite.setAttribute("r", "0");
      bridge.setAttribute("d", "");
    };

    if (!active || prefersReducedMotion) {
      resetGeometry();
      return;
    }

    let frameId = 0;
    let startTime: number | null = null;

    const renderFrame = (now: number) => {
      if (startTime === null) startTime = now;
      const geometry = computeLoginLoadingGeometry(getLoginLoadingOffset(now - startTime));
      center.setAttribute("cx", geometry.centerOffsetX.toFixed(2));
      center.setAttribute("r", geometry.centerRadius.toFixed(2));
      satellite.setAttribute("cx", String(Math.round(geometry.satelliteOffsetX * 1000) / 1000));
      satellite.setAttribute("r", String(geometry.satelliteRadius));
      bridge.setAttribute("d", geometry.bridgePath ?? "");
      frameId = window.requestAnimationFrame(renderFrame);
    };

    resetGeometry();
    frameId = window.requestAnimationFrame(renderFrame);

    return () => window.cancelAnimationFrame(frameId);
  }, [active, prefersReducedMotion]);

  const rootClassName = [
    "login-loading-dots",
    active ? "is-active" : "",
    prefersReducedMotion ? "is-reduced-motion" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={rootClassName} aria-hidden="true">
      <svg
        className="login-loading-dots__svg"
        width={LOGIN_LOADING_DOTS.stageWidth}
        height={LOGIN_LOADING_DOTS.stageHeight}
        viewBox={`0 0 ${LOGIN_LOADING_DOTS.stageWidth} ${LOGIN_LOADING_DOTS.stageHeight}`}
        focusable="false"
      >
        <g
          className="login-loading-dots__shapes"
          transform={`translate(${LOGIN_LOADING_DOTS.centerX} ${LOGIN_LOADING_DOTS.centerY})`}
          fill="currentColor"
        >
          <circle ref={centerRef} cx="0" cy="0" r={LOGIN_LOADING_DOTS.centerRadius} />
          <path ref={bridgeRef} d="" />
          <circle
            ref={satelliteRef}
            className="login-loading-dots__animated-satellite"
            cx="0"
            cy="0"
            r={LOGIN_LOADING_DOTS.satelliteRadius}
          />
          <circle
            className="login-loading-dots__static-satellite"
            cx={-LOGIN_LOADING_DOTS.travelAmplitude}
            cy="0"
            r={LOGIN_LOADING_DOTS.satelliteRadius}
          />
          <circle
            className="login-loading-dots__static-satellite"
            cx={LOGIN_LOADING_DOTS.travelAmplitude}
            cy="0"
            r={LOGIN_LOADING_DOTS.satelliteRadius}
          />
        </g>
      </svg>
    </span>
  );
}
