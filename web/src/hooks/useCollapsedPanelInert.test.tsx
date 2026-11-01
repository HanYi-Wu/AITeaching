import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCollapsedPanelInert } from "./useCollapsedPanelInert";

type MockQuery = {
  matches: boolean;
  listeners: Set<EventListenerOrEventListenerObject>;
};

function mockMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const queries = new Map<string, { media: MediaQueryList; state: MockQuery }>();
  const matchMedia = vi.fn((query: string) => {
    const existing = queries.get(query);
    if (existing) return existing.media;

    const state: MockQuery = {
      matches: width >= Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0),
      listeners: new Set(),
    };
    const media = {
      media: query,
      get matches() {
        return state.matches;
      },
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => state.listeners.add(listener),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => state.listeners.delete(listener),
      addListener: (listener: EventListener) => state.listeners.add(listener),
      removeListener: (listener: EventListener) => state.listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    queries.set(query, { media, state });
    return media;
  });
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });

  return {
    matchMedia,
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const { media, state } of queries.values()) {
        state.matches = width >= Number(media.media.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
        const event = { matches: state.matches, media: media.media } as MediaQueryListEvent;
        for (const listener of state.listeners) {
          if (typeof listener === "function") listener.call(media, event);
          else listener.handleEvent(event);
        }
      }
    },
    restore() {
      if (originalDescriptor) Object.defineProperty(window, "matchMedia", originalDescriptor);
      else Reflect.deleteProperty(window, "matchMedia");
    },
  };
}

function PanelHarness({ collapsed, minWidth }: { collapsed: boolean; minWidth: number }) {
  const panelRef = useCollapsedPanelInert(collapsed, minWidth);
  return (
    <div ref={panelRef} data-testid="collapsed-panel">
      <button type="button">Panel action</button>
    </div>
  );
}

describe("useCollapsedPanelInert", () => {
  it.each([768, 1024])("inerts a collapsed panel only at or above its %i px breakpoint", (minWidth) => {
    const viewport = mockMatchMedia(minWidth + 100);
    try {
      const { rerender } = render(<PanelHarness collapsed minWidth={minWidth} />);
      const panel = screen.getByTestId("collapsed-panel");

      expect(viewport.matchMedia).toHaveBeenCalledWith(`(min-width: ${minWidth}px)`);
      expect(panel).toHaveAttribute("inert");

      rerender(<PanelHarness collapsed={false} minWidth={minWidth} />);
      expect(panel).not.toHaveAttribute("inert");

      rerender(<PanelHarness collapsed minWidth={minWidth} />);
      expect(panel).toHaveAttribute("inert");

      act(() => viewport.setWidth(minWidth - 1));
      expect(panel).not.toHaveAttribute("inert");

      act(() => viewport.setWidth(minWidth + 1));
      expect(panel).toHaveAttribute("inert");
    } finally {
      viewport.restore();
    }
  });
});
