import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredMount } from "./DeferredMount";

class MockIntersectionObserver {
  static latest: MockIntersectionObserver | null = null;

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();
  private readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.latest = this;
  }

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  MockIntersectionObserver.latest = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
});

function installIdleCallbacks() {
  let nextId = 0;
  const callbacks = new Map<number, IdleRequestCallback>();
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancelIdleCallback = vi.fn((id: number) => callbacks.delete(id));
  Object.assign(window, { requestIdleCallback, cancelIdleCallback });
  return { callbacks, requestIdleCallback, cancelIdleCallback };
}

describe("DeferredMount", () => {
  it("falls back to eager rendering when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    render(
      <DeferredMount fallback={<span>placeholder</span>}>
        <span>expensive content</span>
      </DeferredMount>,
    );

    expect(screen.getByText("expensive content")).toBeInTheDocument();
    expect(screen.queryByText("placeholder")).not.toBeInTheDocument();
  });

  it("mounts once near the viewport and keeps content mounted afterwards", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    render(
      <DeferredMount fallback={<span>placeholder</span>}>
        <input aria-label="editable content" defaultValue="draft" />
      </DeferredMount>,
    );

    expect(screen.getByText("placeholder")).toBeInTheDocument();
    expect(screen.queryByLabelText("editable content")).not.toBeInTheDocument();
    await waitFor(() => expect(MockIntersectionObserver.latest?.observe).toHaveBeenCalledTimes(1));

    act(() => MockIntersectionObserver.latest?.trigger(false));
    expect(screen.getByText("placeholder")).toBeInTheDocument();

    act(() => MockIntersectionObserver.latest?.trigger(true));
    await waitFor(() => expect(screen.getByLabelText("editable content")).toHaveValue("draft"));
    expect(MockIntersectionObserver.latest?.disconnect).toHaveBeenCalledTimes(1);

    // A later non-intersection must not unmount an already active editor.
    act(() => MockIntersectionObserver.latest?.trigger(false));
    expect(screen.getByLabelText("editable content")).toBeInTheDocument();
  });

  it("preloads relative to a nested scrolling pane", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const view = render(<div data-testid="scroll-pane" style={{ overflowY: "auto" }}><DeferredMount><span>details</span></DeferredMount></div>);
    expect(MockIntersectionObserver.latest?.options?.root).toBe(view.getByTestId("scroll-pane"));
    expect(MockIntersectionObserver.latest?.options?.rootMargin).toBe("600px 0px");
  });

  it("uses an explicit scroll root without reading ancestor styles", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const root = document.createElement("main");
    const getComputedStyle = vi.spyOn(window, "getComputedStyle");

    render(<DeferredMount scrollRootRef={{ current: root }}><span>details</span></DeferredMount>);

    await waitFor(() => expect(MockIntersectionObserver.latest?.observe).toHaveBeenCalledTimes(1));
    expect(MockIntersectionObserver.latest?.options?.root).toBe(root);
    expect(getComputedStyle).not.toHaveBeenCalled();
  });

  it("honors switching to eager rendering and preserves the mounted content", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const view = render(<DeferredMount fallback="waiting"><input aria-label="draft" defaultValue="saved locally" /></DeferredMount>);
    expect(screen.queryByLabelText("draft")).not.toBeInTheDocument();
    view.rerender(<DeferredMount disabled fallback="waiting"><input aria-label="draft" defaultValue="saved locally" /></DeferredMount>);
    const input = screen.getByLabelText("draft");
    view.rerender(<DeferredMount fallback="waiting"><input aria-label="draft" defaultValue="saved locally" /></DeferredMount>);
    expect(screen.getByLabelText("draft")).toBe(input);
  });

  it("forces content on immediately and cancels a queued mount when disabled", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const idle = installIdleCallbacks();
    const view = render(<DeferredMount fallback="waiting"><span>details</span></DeferredMount>);
    await waitFor(() => expect(MockIntersectionObserver.latest?.observe).toHaveBeenCalledTimes(1));

    act(() => MockIntersectionObserver.latest?.trigger(true));
    expect(idle.requestIdleCallback).toHaveBeenCalledTimes(1);
    view.rerender(<DeferredMount disabled fallback="waiting"><span>details</span></DeferredMount>);
    expect(screen.getByText("details")).toBeInTheDocument();
    expect(idle.cancelIdleCallback).toHaveBeenCalledTimes(1);
  });

  it("cancels an intersected mount when the host unmounts before its idle turn", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const idle = installIdleCallbacks();
    const view = render(<DeferredMount fallback="waiting"><span>details</span></DeferredMount>);
    await waitFor(() => expect(MockIntersectionObserver.latest?.observe).toHaveBeenCalledTimes(1));

    act(() => MockIntersectionObserver.latest?.trigger(true));
    expect(idle.callbacks.size).toBe(1);
    view.unmount();
    expect(idle.cancelIdleCallback).toHaveBeenCalledTimes(1);
    expect(idle.callbacks.size).toBe(0);
  });
});

