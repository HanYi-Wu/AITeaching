import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { scheduleWorkspaceWork } from "../lib/workspaceWorkScheduler";

const useCommittedEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type DeferredMountProps = {
  children: ReactNode;
  /** Content shown until the first intersection. Keep this small and reserve enough height to avoid a jump. */
  fallback?: ReactNode;
  /** How far before the viewport the content should be prepared. */
  rootMargin?: string;
  /** Supply a known scroll root to avoid discovering it by reading ancestor styles. */
  scrollRootRef?: RefObject<HTMLElement | null>;
  /** Force eager rendering for content that must be available immediately. */
  disabled?: boolean;
  className?: string;
};

function canObserveIntersections(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
}

function scrollRoot(host: HTMLElement): HTMLElement | null {
  for (let parent = host.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(window.getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/**
 * Mounts expensive content once it approaches the viewport.
 *
 * The content intentionally stays mounted after the first intersection. This is
 * important for forms and editable cards: scrolling away must not discard local
 * component state. Browsers without IntersectionObserver (and test environments)
 * fall back to eager rendering so the feature remains fully usable.
 */
export function DeferredMount({
  children,
  fallback = null,
  rootMargin = "600px 0px",
  scrollRootRef,
  disabled = false,
  className,
}: DeferredMountProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(() => disabled || !canObserveIntersections());
  const cancelScheduledMountRef = useRef<(() => void) | null>(null);

  useCommittedEffect(() => {
    if (disabled) cancelScheduledMountRef.current?.();
  }, [disabled]);

  useCommittedEffect(() => () => {
    cancelScheduledMountRef.current?.();
    cancelScheduledMountRef.current = null;
  }, []);

  useEffect(() => {
    if (mounted) return;
    if (disabled) { setMounted(true); return; }

    const host = hostRef.current;
    if (!host || !canObserveIntersections()) {
      setMounted(true);
      return;
    }

    let observing = true;
    let requestedMount = false;
    let pendingMountController: AbortController | null = null;
    let stopObserving = () => {};
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (!observing || requestedMount || !entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return;
        requestedMount = true;
        stopObserving();

        const controller = new AbortController();
        cancelScheduledMountRef.current = scheduleWorkspaceWork(
          () => startTransition(() => setMounted(true)),
          { signal: controller.signal },
        );
        pendingMountController = controller;
      },
      { root: scrollRootRef ? scrollRootRef.current : scrollRoot(host), rootMargin, threshold: 0 },
    );
    stopObserving = () => {
      if (!observing) return;
      observing = false;
      observer.disconnect();
    };
    observer.observe(host);

    return () => {
      stopObserving();
      pendingMountController?.abort();
      cancelScheduledMountRef.current = null;
    };
  }, [disabled, mounted, rootMargin, scrollRootRef]);

  return (
    <div ref={hostRef} className={className} aria-busy={!(mounted || disabled) || undefined}>
      {mounted || disabled ? children : fallback}
    </div>
  );
}

