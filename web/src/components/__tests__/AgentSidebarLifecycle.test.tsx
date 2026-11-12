import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgentSidebar } from "../AgentSidebar";
import { AgentProvider, useAgentSidebar } from "../../contexts/AgentContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";

const mocks = vi.hoisted(() => ({ chatRender: vi.fn() }));
vi.mock("../AgentChatPanel", async () => {
  const { useEffect } = await import("react");
  return {
    AgentChatPanel: ({ onRequestCollapse, onReady }: { onRequestCollapse: () => void; onReady?: () => void }) => {
      useEffect(() => { onReady?.(); }, [onReady]);
      mocks.chatRender();
      return <div><button data-assistant-close onClick={onRequestCollapse}>收起聊天</button><textarea aria-label="聊天草稿" defaultValue="" /></div>;
    },
  };
});

beforeAll(async () => { await setupTestI18n("zh"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("paints a closable mobile shell before chat loads and preserves a draft when reopened", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  let controls!: ReturnType<typeof useAgentSidebar>;
  function OpenButton() {
    controls = useAgentSidebar();
    return <button onClick={() => controls.setSidebarOpen(true)}>打开助手</button>;
  }
  render(<TestI18nProvider><AgentProvider><OpenButton /><AgentSidebar mode="dock" /></AgentProvider></TestI18nProvider>);
  const opener = screen.getByRole("button", { name: "打开助手" });
  opener.focus();
  act(() => controls.setSidebarOpen(true));
  const drawer = screen.getByRole("dialog");
  const loadingClose = drawer.querySelector<HTMLElement>("[data-assistant-close]")!;
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(loadingClose).toHaveFocus();
  expect(mocks.chatRender).not.toHaveBeenCalled();

  fireEvent.click(loadingClose);
  expect(opener).toHaveFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(mocks.chatRender).not.toHaveBeenCalled();

  act(() => controls.setSidebarOpen(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  vi.useRealTimers();
  const draft = await screen.findByRole("textbox", { name: "聊天草稿" });
  expect(screen.getByRole("button", { name: "收起聊天" })).toHaveFocus();
  fireEvent.change(draft, { target: { value: "还没发送的草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "收起聊天" }));
  fireEvent.click(opener);
  expect(screen.getByRole("textbox", { name: "聊天草稿" })).toBe(draft);
  expect(draft).toHaveValue("还没发送的草稿");
});
