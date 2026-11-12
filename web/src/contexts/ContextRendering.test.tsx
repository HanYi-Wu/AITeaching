import { act, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { AgentProvider, useAgentActions, useAgentContext, useAgentSidebar } from "./AgentContext";
import { ToolBarProvider, useToolBar, useToolBarActions } from "./ToolBarContext";
import { setupTestI18n, TestI18nProvider } from "../test/i18nTestUtils";

beforeAll(async () => { await setupTestI18n("zh"); });

it("updates assistant context without re-rendering the navigation or context publishers", () => {
  const publisherRender = vi.fn();
  const navigationRender = vi.fn();
  let actions!: ReturnType<typeof useAgentActions>;
  function Publisher() {
    publisherRender();
    actions = useAgentActions();
    return null;
  }
  function Navigation() {
    navigationRender();
    const { sidebarOpen } = useAgentSidebar();
    return <span data-testid="sidebar-state">{String(sidebarOpen)}</span>;
  }
  function Chat() {
    const { pageContext, prefillRequest } = useAgentContext();
    return <span data-testid="chat-context">{pageContext?.summary}:{prefillRequest?.message}</span>;
  }
  render(<TestI18nProvider><AgentProvider><Publisher /><Navigation /><Chat /></AgentProvider></TestI18nProvider>);
  const initialPublisherRenders = publisherRender.mock.calls.length;
  const initialNavigationRenders = navigationRender.mock.calls.length;

  act(() => actions.setPageContext({ current_page: "graph", summary: "节点 A" }));
  expect(screen.getByTestId("chat-context")).toHaveTextContent("节点 A");
  expect(publisherRender).toHaveBeenCalledTimes(initialPublisherRenders);
  expect(navigationRender).toHaveBeenCalledTimes(initialNavigationRenders);

  act(() => actions.requestAgentPrefill("分析节点"));
  expect(screen.getByTestId("sidebar-state")).toHaveTextContent("true");
  expect(screen.getByTestId("chat-context")).toHaveTextContent("分析节点");
  expect(publisherRender).toHaveBeenCalledTimes(initialPublisherRenders);
  expect(navigationRender).toHaveBeenCalledTimes(initialNavigationRenders + 1);
});

it("updates a toolbar without rendering its editor again", () => {
  const editorRender = vi.fn();
  let actions!: ReturnType<typeof useToolBarActions>;
  function Editor() {
    editorRender();
    actions = useToolBarActions();
    return <input aria-label="草稿" defaultValue="未保存的内容" />;
  }
  function Toolbar() {
    const { left, right } = useToolBar();
    return <div data-testid="toolbar">{left}{right}</div>;
  }
  render(<ToolBarProvider><Editor /><Toolbar /></ToolBarProvider>);
  const input = screen.getByRole("textbox", { name: "草稿" });
  act(() => actions.setToolBar({ left: <span>已选 10 题</span>, right: <button>发布</button> }));
  expect(screen.getByTestId("toolbar")).toHaveTextContent("已选 10 题发布");
  expect(editorRender).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "草稿" })).toBe(input);
  expect(input).toHaveValue("未保存的内容");
  act(() => actions.clearToolBar());
  expect(screen.getByTestId("toolbar")).toBeEmptyDOMElement();
  expect(editorRender).toHaveBeenCalledOnce();
});
