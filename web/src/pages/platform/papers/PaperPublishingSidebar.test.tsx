import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PaperPublicationRecord } from "../../../platform/auth";
import { PaperPublishingSidebar } from "./PaperPublishingSidebar";

// Contract: the old implementation gave every publication badge its own 1s
// interval and clock state. Preserve its 1s start/end labels and external clock
// control, while checking once per sidebar and rendering only changed badges.
const probe = vi.hoisted(() => ({ badgeRenders: 0 }));

vi.mock("../../../ui-redesign/g51/PaperUiComponents", () => ({
  G51Pill: ({ children, variant }: { children: string; variant: string }) => {
    probe.badgeRenders += 1;
    return <span data-testid="publication-window-badge" data-variant={variant}>{children}</span>;
  },
  G51EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  G51Panel: ({ title, children }: { title: string; children: ReactNode }) => (
    <section><h2>{title}</h2>{children}</section>
  ),
}));

const baseTime = Date.parse("2026-11-02T03:00:00.000Z");

function publication(id: string, overrides: Partial<PaperPublicationRecord> = {}): PaperPublicationRecord {
  return {
    id,
    paper_id: `paper-${id}`,
    title: `试卷 ${id}`,
    status: "published",
    class_ids: [],
    ...overrides,
  };
}

function renderSidebar(publications: PaperPublicationRecord[], clock?: number) {
  return render(
    <PaperPublishingSidebar
      publishPanel={<div>发布面板</div>}
      publications={publications}
      clock={clock}
      busy={null}
      onTogglePause={vi.fn()}
      onRevoke={vi.fn()}
    />,
  );
}

describe("PaperPublishingSidebar publication window clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    probe.badgeRenders = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses one 1s timer and rerenders only a badge when its exact start boundary is reached", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const current = [
      publication("starts", { start_at: new Date(baseTime + 1000).toISOString() }),
      publication("ends-later", { end_at: new Date(baseTime + 60_000).toISOString() }),
      publication("paused", { status: "paused", start_at: new Date(baseTime + 1000).toISOString() }),
      publication("no-window"),
      publication("invalid-window", { start_at: "not-a-date", end_at: "also-invalid" }),
    ];

    const view = renderSidebar(current);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.getAllByTestId("publication-window-badge").map((badge) => badge.textContent)).toEqual([
      "未开始",
      "进行中",
      "已暂停",
      "进行中",
      "进行中",
    ]);
    expect(probe.badgeRenders).toBe(5);

    act(() => { vi.advanceTimersByTime(999); });
    expect(probe.badgeRenders).toBe(5);
    act(() => { vi.advanceTimersByTime(1); });

    expect(screen.getAllByTestId("publication-window-badge").find((badge) => badge.textContent === "进行中")).toBeInTheDocument();
    expect(probe.badgeRenders).toBe(6);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the external clock authoritative with exact start and end boundaries and no internal timer", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const timed = publication("external", {
      start_at: new Date(baseTime + 1000).toISOString(),
      end_at: new Date(baseTime + 2000).toISOString(),
    });
    const view = renderSidebar([timed], baseTime);
    const badge = screen.getByTestId("publication-window-badge");
    expect(badge).toHaveTextContent("未开始");
    expect(setIntervalSpy).not.toHaveBeenCalled();

    view.rerender(
      <PaperPublishingSidebar
        publishPanel={<div>发布面板</div>}
        publications={[{ ...timed, start_at: new Date(baseTime - 1000).toISOString() }]}
        clock={baseTime + 1000}
        busy={null}
        onTogglePause={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("进行中");

    view.rerender(
      <PaperPublishingSidebar
        publishPanel={<div>发布面板</div>}
        publications={[timed]}
        clock={baseTime + 2000}
        busy={null}
        onTogglePause={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("已结束");
    // Preserve the existing visual mapping for this label.
    expect(screen.getByTestId("publication-window-badge")).toHaveAttribute("data-variant", "warning");
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("resynchronizes after forward/backward system clock changes and releases interval/listeners", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const timed = publication("jump", {
      start_at: new Date(baseTime + 60 * 60_000).toISOString(),
      end_at: new Date(baseTime + 2 * 60 * 60_000).toISOString(),
    });
    const view = renderSidebar([timed]);
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("未开始");
    expect(vi.getTimerCount()).toBe(1);

    vi.setSystemTime(baseTime + 2 * 60 * 60_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("已结束");

    vi.setSystemTime(baseTime);
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("未开始");

    const paused = { ...timed, status: "paused" };
    view.rerender(
      <PaperPublishingSidebar
        publishPanel={<div>发布面板</div>}
        publications={[paused]}
        busy={null}
        onTogglePause={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByTestId("publication-window-badge")).toHaveTextContent("已暂停");
    expect(vi.getTimerCount()).toBe(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["focus", "pageshow"]));
    expect(removeDocumentListener.mock.calls.map(([type]) => type)).toContain("visibilitychange");
  });
});
