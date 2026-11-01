import { useEffect, useLayoutEffect, useRef, useState } from "react";

function matchesMinWidth(minWidth: number): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(`(min-width: ${minWidth}px)`).matches ?? window.innerWidth >= minWidth;
}

export function useCollapsedPanelInert(collapsed: boolean, minWidth: number) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [matchesBreakpoint, setMatchesBreakpoint] = useState(() => matchesMinWidth(minWidth));

  useEffect(() => {
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${minWidth}px)`)
      : null;
    const update = () => setMatchesBreakpoint(media?.matches ?? window.innerWidth >= minWidth);
    update();

    if (media?.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    if (media?.addListener) {
      media.addListener(update);
      return () => media.removeListener(update);
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [minWidth]);

  useLayoutEffect(() => {
    if (panelRef.current) {
      const inert = collapsed && matchesBreakpoint;
      panelRef.current.inert = inert;
      panelRef.current.toggleAttribute("inert", inert);
    }
  }, [collapsed, matchesBreakpoint]);

  return panelRef;
}
