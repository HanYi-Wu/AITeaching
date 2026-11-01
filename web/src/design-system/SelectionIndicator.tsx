import { useLayoutEffect, useRef, type RefObject } from "react";

/** A persistent surface follows the selected control without moving its text. */
export function SelectionIndicator({ rootRef, selector, className = "" }: {
  rootRef: RefObject<HTMLElement>;
  selector: string;
  className?: string;
}) {
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    // The child's layout effect can run before its parent's ref is attached.
    const root = rootRef.current ?? indicator?.parentElement;
    if (!root || !indicator) return;
    let observed: HTMLElement | null = null;
    let previousHostWidth = 0;
    let previousHostHeight = 0;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    function update() {
      const selected = root!.querySelector<HTMLElement>(selector);
      indicator!.hidden = !selected;
      if (!selected) { delete root!.dataset.indicatorReady; return; }
      const host = root!.getBoundingClientRect();
      const bounds = selected.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        indicator!.hidden = true;
        delete root!.dataset.indicatorReady;
        return;
      }
      // Follow container resizing immediately so the outline cannot lag outside it.
      const resizing = previousHostWidth && (Math.abs(previousHostWidth - host.width) > 0.5 || Math.abs(previousHostHeight - host.height) > 0.5);
      indicator!.style.transition = resizing ? "none" : "";
      previousHostWidth = host.width;
      previousHostHeight = host.height;
      indicator!.style.width = `${bounds.width}px`;
      indicator!.style.height = `${bounds.height}px`;
      indicator!.style.transform = `translate3d(${bounds.left - host.left - root!.clientLeft + root!.scrollLeft}px, ${bounds.top - host.top - root!.clientTop + root!.scrollTop}px, 0)`;
      if (!indicator!.dataset.ready) {
        indicator!.getBoundingClientRect();
        indicator!.dataset.ready = "true";
      }
      root!.dataset.indicatorReady = "true";
      if (resize && observed !== selected) {
        if (observed) resize.unobserve(observed);
        observed = selected;
        resize.observe(selected);
      }
    }
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-state", "aria-selected", "aria-current"] });
    resize?.observe(root);
    update();
    return () => {
      observer.disconnect();
      resize?.disconnect();
      delete root.dataset.indicatorReady;
    };
  }, [rootRef, selector]);
  return <span ref={indicatorRef} className={`or-selection-indicator ${className}`} aria-hidden="true" />;
}
