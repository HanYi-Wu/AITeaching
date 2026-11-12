import { useLayoutEffect, useRef, type RefObject } from "react";

type Measurement = () => (() => void);
const resizeMeasurements = new Map<Element, Set<Measurement>>();
let sharedResizeObserver: ResizeObserver | null = null;
const pendingMeasurements = new Set<Measurement>();
let measurementFrame: number | null = null;

function commitMeasurements(measurements: Iterable<Measurement>) {
  // Read all bars before writing any, including bars that share a resize batch.
  const commits = Array.from(measurements, (read) => read());
  commits.forEach((commit) => commit());
}

function observeMeasurement(target: Element, measure: Measurement): () => void {
  if (!sharedResizeObserver) {
    const observer = new ResizeObserver((entries) => {
      if (sharedResizeObserver !== observer) return;
      const measurements = new Set<Measurement>();
      entries.forEach(({ target: resized }) => resizeMeasurements.get(resized)?.forEach((read) => measurements.add(read)));
      // ResizeObserver runs after the browser's layout. Do not move these
      // reads into rAF, where a newly committed workspace can still be dirty.
      commitMeasurements(measurements);
    });
    sharedResizeObserver = observer;
  }
  let measurements = resizeMeasurements.get(target);
  if (!measurements) {
    measurements = new Set();
    resizeMeasurements.set(target, measurements);
    sharedResizeObserver.observe(target);
  }
  measurements.add(measure);
  return () => {
    const current = resizeMeasurements.get(target);
    current?.delete(measure);
    if (current?.size === 0) {
      resizeMeasurements.delete(target);
      sharedResizeObserver?.unobserve(target);
    }
    if (resizeMeasurements.size === 0) {
      sharedResizeObserver?.disconnect();
      sharedResizeObserver = null;
    }
  };
}

function scheduleMeasurement(measure: Measurement) {
  pendingMeasurements.add(measure);
  if (measurementFrame !== null) return;
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = null;
    const measurements = Array.from(pendingMeasurements);
    pendingMeasurements.clear();
    commitMeasurements(measurements);
  });
}

function cancelMeasurement(measure: Measurement) {
  pendingMeasurements.delete(measure);
  if (pendingMeasurements.size === 0 && measurementFrame !== null) {
    cancelAnimationFrame(measurementFrame);
    measurementFrame = null;
  }
}

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
    let active = true;
    let observed: HTMLElement | null = null;
    let stopObservingSelected: (() => void) | undefined;
    let previousHostWidth = 0;
    let previousHostHeight = 0;
    let readyFrame: number | null = null;
    const canObserveResize = typeof ResizeObserver !== "undefined";
    const hideIndicator = () => {
      indicator.hidden = true;
      delete root.dataset.indicatorReady;
    };
    const update = () => {
      if (!active) return;
      observed = root.querySelector<HTMLElement>(selector);
      stopObservingSelected?.();
      stopObservingSelected = undefined;
      if (!observed) {
        hideIndicator();
      } else if (canObserveResize) {
        // Re-observing also covers a selection mutation that changes position
        // without changing the selected control's size. It reads no geometry.
        stopObservingSelected = observeMeasurement(observed, measure);
      } else {
        scheduleMeasurement(measure);
      }
    };
    function measure(): () => void {
      if (!active) return () => {};
      const selected = observed;
      if (!selected) return () => { if (active) hideIndicator(); };
      const host = root!.getBoundingClientRect();
      const bounds = selected.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        return () => { if (active) hideIndicator(); };
      }
      const transform = `translate3d(${bounds.left - host.left - root!.clientLeft + root!.scrollLeft}px, ${bounds.top - host.top - root!.clientTop + root!.scrollTop}px, 0)`;
      // Container resizing snaps to the measured bounds instead of sliding.
      const resizing = previousHostWidth && (Math.abs(previousHostWidth - host.width) > 0.5 || Math.abs(previousHostHeight - host.height) > 0.5);
      const width = `${bounds.width}px`;
      const height = `${bounds.height}px`;
      return () => {
        if (!active) return;
        indicator!.hidden = false;
        const transition = resizing ? "none" : "";
        if (indicator!.style.transition !== transition) indicator!.style.transition = transition;
        previousHostWidth = host.width;
        previousHostHeight = host.height;
        if (indicator!.style.width !== width) indicator!.style.width = width;
        if (indicator!.style.height !== height) indicator!.style.height = height;
        if (indicator!.style.transform !== transform) indicator!.style.transform = transform;
        if (!indicator!.dataset.ready && readyFrame === null) {
          readyFrame = requestAnimationFrame(() => {
            if (active) indicator!.dataset.ready = "true";
            readyFrame = null;
          });
        }
        if (root!.dataset.indicatorReady !== "true") root!.dataset.indicatorReady = "true";
      };
    }
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-state", "aria-selected", "aria-current"] });
    const stopObservingRoot = canObserveResize ? observeMeasurement(root, measure) : undefined;
    update();
    return () => {
      active = false;
      cancelMeasurement(measure);
      observer.disconnect();
      stopObservingSelected?.();
      stopObservingRoot?.();
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
      delete root.dataset.indicatorReady;
    };
  }, [rootRef, selector]);
  return <span ref={indicatorRef} className={`or-selection-indicator ${className}`} aria-hidden="true" />;
}
