import { useEffect, useState } from "react";

type AnalysisNumberProps = {
  value: number | null | undefined;
  suffix?: string;
  animationKey?: string | number;
  className?: string;
};

function displayValue(value: number | null | undefined, suffix: string): string {
  return value == null || !Number.isFinite(Number(value)) ? "-" : `${value}${suffix}`;
}

function decimalPlaces(value: number): number {
  const text = String(value).toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const places = coefficient.includes(".") ? coefficient.length - coefficient.indexOf(".") - 1 : 0;
  const exponent = Number(exponentText || 0);
  return Math.max(0, Math.min(8, places - exponent));
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A count-up label that keeps its exact final value and respects reduced motion. */
export function AnalysisNumber({ value, suffix = "", animationKey = 0, className = "" }: AnalysisNumberProps) {
  const finalValue = displayValue(value, suffix);
  const [visibleValue, setVisibleValue] = useState(finalValue);

  useEffect(() => {
    if (value == null || !Number.isFinite(Number(value)) || reducedMotion()) {
      setVisibleValue(finalValue);
      return;
    }

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setVisibleValue(finalValue);
      return;
    }

    let frameId = 0;
    let startTimestamp: number | null = null;
    const precision = decimalPlaces(value);
    const update = (timestamp: number) => {
      if (startTimestamp === null) startTimestamp = timestamp;
      const progress = Math.min(1, (timestamp - startTimestamp) / 680);
      const eased = progress === 1 ? 1 : 1 - Math.pow(1 - progress, 4);
      const current = value * eased;
      const formatted = precision === 0 ? String(Math.round(current)) : current.toFixed(precision);
      setVisibleValue(`${formatted}${suffix}`);
      if (progress < 1) frameId = window.requestAnimationFrame(update);
      else setVisibleValue(finalValue);
    };

    frameId = window.requestAnimationFrame(update);
    return () => {
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frameId);
    };
  }, [value, suffix, animationKey, finalValue]);

  return (
    <span
      className={`analysis-number tabular-nums ${className}`}
      aria-label={finalValue}
      aria-live="off"
      data-final-value={finalValue}
    >
      {visibleValue}
    </span>
  );
}
