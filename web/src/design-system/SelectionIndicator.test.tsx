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

afterEach(() => vi.restoreAllMocks());

it("initializes inside a newly mounted parent and moves the same complete surface between controls", async () => {
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
  expect(root).toHaveAttribute("data-indicator-ready", "true");
  expect(indicator).toHaveStyle({ width: "90px", height: "40px", transform: "translate3d(6px, 4px, 0)" });

  view.rerender(<Harness selected="second" />);
  await waitFor(() => expect(indicator).toHaveStyle({ width: "124px", height: "40px", transform: "translate3d(96px, 4px, 0)" }));
  expect(root.querySelector(".or-selection-indicator")).toBe(indicator);
  expect(indicator.hidden).toBe(false);
});
