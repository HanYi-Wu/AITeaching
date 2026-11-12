import { useRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SelectionIndicator } from "./SelectionIndicator";

function Harness({ selected }: { selected: "first" | "second" }) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} data-testid="navigation">
      <SelectionIndicator rootRef={rootRef} selector={'[data-state="active"]'} />
      <button data-state={selected === "first" ? "active" : "inactive"}>First</button>
      <button data-state={selected === "second" ? "active" : "inactive"}>Second</button>
    </div>
  );
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function installResizeObserver() {
  const instances: TestResizeObserver[] = [];
  class TestResizeObserver {
    targets = new Set<Element>();
    observe = vi.fn((target: Element) => { this.targets.add(target); });
    unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
    disconnect = vi.fn(() => { this.targets.clear(); });
    constructor(readonly callback: ResizeObserverCallback) { instances.push(this); }
    deliver(targets = [...this.targets]) {
      this.callback(targets.map((target) => ({ target }) as ResizeObserverEntry), this as unknown as ResizeObserver);
    }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  return instances;
}

it("initializes inside a newly mounted parent and moves the same complete surface between controls", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  vi.spyOn(HTMLElement.prototype, "clientLeft", "get").mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, "clientTop", "get").mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [x, y, width, height] = this.tagName === "BUTTON"
      ? this.textContent === "First" ? [107, 55, 90, 40] : [197, 55, 124, 40]
      : [100, 50, 228, 50];
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) };
  });
  const view = render(<Harness selected="first" />);
  const root = view.getByTestId("navigation");
  const indicator = root.querySelector<HTMLSpanElement>(".or-selection-indicator")!;
  await waitFor(() => expect(root).toHaveAttribute("data-indicator-ready", "true"));
  expect(indicator).toHaveStyle({ width: "90px", height: "40px", transform: "translate3d(6px, 4px, 0)" });

  view.rerender(<Harness selected="second" />);
  await waitFor(() => expect(indicator).toHaveStyle({ width: "124px", height: "40px", transform: "translate3d(96px, 4px, 0)" }));
  expect(root.querySelector(".or-selection-indicator")).toBe(indicator);
  expect(indicator.hidden).toBe(false);
});

it("batches geometry reads across tab bars before writing either indicator", async () => {
  const observers = installResizeObserver();
  const writtenBeforeRead: boolean[] = [];
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    writtenBeforeRead.push(Array.from(document.querySelectorAll<HTMLElement>(".or-selection-indicator")).some((element) => element.style.width !== ""));
    const width = this.tagName === "BUTTON" ? 90 : 228;
    return { x: 0, y: 0, left: 0, top: 0, width, height: 40, right: width, bottom: 40, toJSON: () => ({}) };
  });
  const view = render(<><Harness selected="first" /><Harness selected="second" /></>);
  // React's layout effects must not force geometry while the new page is dirty.
  expect(measure).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(measure).not.toHaveBeenCalled();
  expect(observers).toHaveLength(1);
  observers[0].deliver();
  expect(view.container.querySelectorAll('[data-indicator-ready="true"]')).toHaveLength(2);
  expect(writtenBeforeRead).toEqual([false, false, false, false]);
  expect(Array.from(view.container.querySelectorAll<HTMLElement>(".or-selection-indicator")).every((element) => element.style.width === "90px")).toBe(true);
});

it("ignores resize notifications delivered after the tab bar unmounts", async () => {
  const observers = installResizeObserver();
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  const view = render(<Harness selected="first" />);
  const targets = [...observers[0].targets];
  view.unmount();
  observers[0].deliver(targets);
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  expect(measure).not.toHaveBeenCalled();
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
});

it("waits for post-layout delivery when a newly selected control has the same size", async () => {
  const observers = installResizeObserver();
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const left = this.textContent === "Second" ? 90 : 0;
    return { x: left, y: 0, left, top: 0, width: 90, height: 40, right: left + 90, bottom: 40, toJSON: () => ({}) };
  });
  const view = render(<Harness selected="first" />);
  const indicator = view.container.querySelector<HTMLElement>(".or-selection-indicator")!;
  const resize = observers[0];
  resize.deliver();
  expect(indicator.style.transform).toBe("translate3d(0px, 0px, 0)");
  measure.mockClear();

  view.rerender(<Harness selected="second" />);
  await waitFor(() => expect(resize.targets.has(view.getByText("Second"))).toBe(true));
  expect(resize.targets.has(view.getByText("First"))).toBe(false);
  expect(measure).not.toHaveBeenCalled();
  resize.deliver([view.getByText("Second")]);
  expect(indicator.style.transform).toBe("translate3d(90px, 0px, 0)");
});
