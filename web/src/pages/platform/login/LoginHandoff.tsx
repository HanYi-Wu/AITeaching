import { useLayoutEffect } from "react";
import "./LoginHandoff.css";

const DESKTOP_ENTER_TOTAL_MS = 825;
const MOBILE_ENTER_TOTAL_MS = 580;
const DESKTOP_EXIT_TOTAL_MS = 640;
const MOBILE_EXIT_TOTAL_MS = 520;

export function LoginHandoff({
  direction = "enter",
  onFinished,
}: {
  direction?: "enter" | "exit";
  onFinished: () => void;
}) {
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinished();
      return;
    }

    const mobile = window.matchMedia("(max-width: 899.98px)").matches;
    const duration =
      direction === "exit"
        ? mobile
          ? MOBILE_EXIT_TOTAL_MS
          : DESKTOP_EXIT_TOTAL_MS
        : mobile
          ? MOBILE_ENTER_TOTAL_MS
          : DESKTOP_ENTER_TOTAL_MS;
    const timerId = window.setTimeout(onFinished, duration);
    return () => window.clearTimeout(timerId);
  }, [direction, onFinished]);

  return (
    <div className="or-login-handoff" data-direction={direction} aria-hidden="true">
      <div className="or-login-handoff-grain" />
    </div>
  );
}
