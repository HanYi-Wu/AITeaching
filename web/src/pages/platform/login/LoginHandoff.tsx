import { useLayoutEffect, useRef } from "react";
import {
  getLoginDoorOffsets,
  getLoginDoorPartingDistance,
  LOGIN_DOOR_CRACK_DISTANCE,
} from "./loginMotionGeometry";
import "./LoginHandoff.css";

const DESKTOP_OPEN_DURATION = 580;
const MOBILE_OPEN_DURATION = 480;

export function LoginHandoff({ onFinished }: { onFinished: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mobilePathRef = useRef<SVGPathElement>(null);
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinished();
      return;
    }

    const desktop = window.matchMedia("(min-width: 900px)").matches;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) {
      onFinished();
      return;
    }

    const canvasHeight = height * 390 / width;
    const duration = desktop ? DESKTOP_OPEN_DURATION : MOBILE_OPEN_DURATION;
    const setDistance = (distance: number, trimAlpha: number) => {
      const { x, y } = getLoginDoorOffsets(distance);
      const blackTransform = `translate(${(-x).toFixed(2)}, ${(-y).toFixed(2)})`;
      const whiteTransform = `translate(${x.toFixed(2)}, ${y.toFixed(2)})`;
      svg.querySelector("[data-handoff-black-door]")?.setAttribute("transform", blackTransform);
      svg.querySelector("[data-handoff-black-shadow]")?.setAttribute("transform", blackTransform);
      svg.querySelector("[data-handoff-white-door]")?.setAttribute("transform", whiteTransform);
      svg.querySelector("[data-handoff-white-shadow]")?.setAttribute("transform", whiteTransform);
      const opacity = String(Number(Math.max(0, Math.min(1, trimAlpha)).toFixed(3)));
      svg.querySelector("[data-handoff-black-shadow-poly]")?.setAttribute("opacity", opacity);
      svg.querySelector("[data-handoff-white-shadow-poly]")?.setAttribute("opacity", opacity);
      svg.querySelector("[data-handoff-black-edge]")?.setAttribute("opacity", opacity);
      svg.querySelector("[data-handoff-white-edge]")?.setAttribute("opacity", opacity);
      host.dataset.partDist = distance.toFixed(1);
    };

    if (desktop) {
      svg.setAttribute("viewBox", "0 0 1000 1000");
      svg.dataset.device = "desktop";
      host.dataset.device = "desktop";
      setDistance(LOGIN_DOOR_CRACK_DISTANCE, 1);
    } else {
      svg.setAttribute("viewBox", `0 0 390 ${canvasHeight}`);
      svg.dataset.device = "mobile";
      host.dataset.device = "mobile";
      host.dataset.curtain = "covering";
      const drawMobile = (progress: number) => {
        const eased = 1 - Math.pow(1 - progress, 4);
        const offset = (canvasHeight + 40) * (1 - eased) - 380 * eased;
        if (66 + offset <= 60 && host.dataset.curtain) {
          delete host.dataset.curtain;
        }
        mobilePathRef.current?.setAttribute(
          "d",
          `M 0 -1000 H 390 V ${66 + offset} Q 185 ${330 + offset * 1.08} 0 ${176 + offset} Z`,
        );
      };
      drawMobile(0);
      host.dataset.ready = "true";
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        drawMobile(progress);
        if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
        else {
          frameRef.current = null;
          onFinished();
        }
      };
      frameRef.current = window.requestAnimationFrame(tick);
      return () => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      };
    }

    host.dataset.ready = "true";
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const distance = getLoginDoorPartingDistance(progress);
      const trimAlpha = progress > 0.85 ? Math.max(0, (1 - progress) / 0.15) : 1;
      setDistance(distance, trimAlpha);
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
      else {
        frameRef.current = null;
        onFinished();
      }
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [onFinished]);

  return (
    <div ref={hostRef} className="or-login-handoff" aria-hidden="true">
      <div className="or-login-handoff-top" />
      <svg ref={svgRef} preserveAspectRatio="none">
        <defs>
          <linearGradient id="orHandoffBlackCastShadow" gradientUnits="userSpaceOnUse" x1="500" y1="500" x2="580.7" y2="514.5">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.38" />
            <stop offset="42%" stopColor="#000000" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="orHandoffWhiteCastShadow" gradientUnits="userSpaceOnUse" x1="500" y1="500" x2="425.2" y2="486.5">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.28" />
            <stop offset="42%" stopColor="#000000" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g data-handoff-white-shadow="true">
          <polygon
            data-handoff-white-shadow-poly="true"
            points="587.2,-413.5 662,-400 338,1400 263.2,1386.5"
            fill="url(#orHandoffWhiteCastShadow)"
            opacity="0"
          />
        </g>
        <g data-handoff-black-shadow="true">
          <polygon
            data-handoff-black-shadow-poly="true"
            points="662,-400 742.7,-385.5 418.7,1414.5 338,1400"
            fill="url(#orHandoffBlackCastShadow)"
            opacity="0"
          />
        </g>
        <g data-handoff-white-door="true">
          <polygon points="662,-400 2100,-400 2100,1400 338,1400" fill="#ffffff" />
          <line data-handoff-white-edge="true" x1="662" y1="-400" x2="338" y2="1400" stroke="var(--or-login-accent-color, #000000)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" opacity="0" />
        </g>
        <g data-handoff-black-door="true">
          <polygon points="-1100,-400 662.8,-400 338.8,1400 -1100,1400" fill="var(--or-login-accent-color, #000000)" />
          <line data-handoff-black-edge="true" x1="662.5" y1="-400" x2="338.5" y2="1400" stroke="var(--or-login-accent-ink, #ffffff)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" opacity="0" />
        </g>
        <path ref={mobilePathRef} />
      </svg>
    </div>
  );
}
