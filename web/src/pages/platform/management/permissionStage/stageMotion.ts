/* 权限星图的动效基础：临界阻尼弹簧与按需静止检测。 */

export type Spring = { v: number; dv: number };

export const springOf = (v: number): Spring => ({ v, dv: 0 });

/** 临界阻尼弹簧：把 state.v 推向 target，k 越大越硬（约 85 ≈ 0.38 秒丝滑落定）。 */
export function stepSpring(state: Spring, target: number, dt: number, k = 85) {
  const damping = 2 * Math.sqrt(k);
  state.dv += (-k * (state.v - target) - damping * state.dv) * dt;
  state.v += state.dv * dt;
  if (Math.abs(state.v - target) < 0.08 && Math.abs(state.dv) < 0.08) {
    state.v = target;
    state.dv = 0;
  }
  return state.v;
}

export function isSpringSettled(state: Spring, target: number, eps = 0.1) {
  return Math.abs(state.v - target) <= eps && Math.abs(state.dv) <= eps;
}

export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function requestFrame(callback: (now: number) => void): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(performance.now()), 16) as unknown as number;
}

export function cancelFrame(handle: number) {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}
