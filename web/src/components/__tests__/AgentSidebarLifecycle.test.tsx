import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgentSidebar } from "../AgentSidebar";
import { AgentProvider, useAgentSidebar } from "../../contexts/AgentContext";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import type { ReactNode } from "react";
import type { AgentWindowDragProps } from "../AgentChatPanel";

const mocks = vi.hoisted(() => ({ chatRender: vi.fn() }));
vi.mock("../AgentChatPanel", async () => {
  const { useEffect } = await import("react");
  return {
    AgentChatPanel: ({ onRequestCollapse, onReady, windowControls, windowDrag }: {
      onRequestCollapse: () => void; onReady?: () => void; windowControls?: ReactNode; windowDrag?: AgentWindowDragProps;
    }) => {
      useEffect(() => { onReady?.(); }, [onReady]);
      mocks.chatRender();
      return <div><div {...windowDrag}>{windowControls}<button data-assistant-close onClick={onRequestCollapse}>收起聊天</button></div><textarea aria-label="聊天草稿" defaultValue="" /></div>;
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

it("opens a movable, non-modal desktop dialog without disabling the workspace", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("main");
  host.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 740);
  const workspaceClick = vi.fn();
  function Workspace() {
    const { setSidebarOpen } = useAgentSidebar();
    return <><button onClick={() => setSidebarOpen(true)}>打开助手</button><button onClick={workspaceClick}>下一题</button>
      <AgentSidebar mode="overlay" overlayHost={host} /></>;
  }
  render(<TestI18nProvider><AgentProvider><Workspace /></AgentProvider></TestI18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "打开助手" }));
  const panel = screen.getByRole("dialog");
  expect(panel).not.toHaveAttribute("aria-modal");
  panel.getBoundingClientRect = () => new DOMRect(550, 30, 420, 620);
  const titleBar = screen.getByRole("group", { name: /智能体窗口标题栏/ });
  expect(screen.queryByRole("button", { name: /移动 AI 助手/ })).not.toBeInTheDocument();
  fireEvent.keyDown(titleBar, { key: "ArrowLeft" });
  expect(panel.style.left).toBe("526px");
  const press = { button: 0, pointerId: 1, clientX: 600, clientY: 52 };
  const release = { ...press, clientX: 500, clientY: 85 };
  fireEvent.pointerDown(titleBar, press);
  fireEvent.pointerMove(titleBar, release);
  fireEvent.pointerUp(titleBar, release);
  expect(panel.style.left).toBe("450px");
  fireEvent.pointerDown(panel.querySelector("[data-assistant-close]")!, press);
  fireEvent.pointerMove(titleBar, { ...press, clientX: 490 });
  fireEvent.pointerUp(titleBar, { ...press, clientX: 490 });
  expect(panel.style.left).toBe("450px");
  fireEvent.pointerDown(titleBar, press);
  fireEvent.pointerMove(titleBar, { ...press, clientX: -8, clientY: 180 });
  expect(panel.style.transform).toBe("translateX(-105%)");
  expect(document.querySelector(".or-assistant-edge-tab")).toHaveStyle({ top: "158px" });
  expect(panel).not.toHaveAttribute("inert");
  fireEvent.pointerMove(titleBar, press);
  expect(panel.style.transform).toBe("");
  expect(document.querySelector(".or-assistant-edge-tab")).toBeNull();
  fireEvent.pointerMove(titleBar, { ...press, clientX: -8, clientY: 180 });
  fireEvent.pointerUp(titleBar, { ...press, clientX: -8, clientY: 180 });
  const edgeTab = screen.getByRole("button", { name: "展开智能体" });
  expect(panel).toHaveAttribute("inert");
  expect(edgeTab).toHaveAttribute("data-proximate", "false");
  fireEvent.pointerMove(window, { ...press, clientX: 40, clientY: 180 });
  expect(edgeTab).toHaveAttribute("data-proximate", "true");
  fireEvent.pointerMove(window, { ...press, clientX: 180, clientY: 180 });
  expect(edgeTab).toHaveAttribute("data-proximate", "false");
  fireEvent.click(edgeTab);
  expect(panel.style.transform).toBe("");
  fireEvent.keyDown(titleBar, { key: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  expect(workspaceClick).toHaveBeenCalledOnce();
  const panelWidth = parseFloat(panel.style.width);
  panel.getBoundingClientRect = () => new DOMRect(window.innerWidth - panelWidth - 40, 55, panelWidth, 620);
  fireEvent.keyDown(titleBar, { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: "隐藏到右侧" }));
  expect(panel).toHaveAttribute("inert");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开智能体" }));
  expect(screen.getByRole("dialog")).toBe(panel);
  expect(panel).not.toHaveAttribute("inert");
});
