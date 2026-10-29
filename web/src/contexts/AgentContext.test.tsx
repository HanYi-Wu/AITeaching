import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentProvider, useAgentContext } from "./AgentContext";
import { setupTestI18n, TestI18nProvider } from "../test/i18nTestUtils";

function AgentContextProbe() {
  const context = useAgentContext();
  return (
    <>
      <div data-testid="page-context">{context.pageContext?.summary ?? "no-page-context"}</div>
      <div data-testid="prefill-context">{context.prefillRequest?.message ?? "no-prefill"}</div>
    </>
  );
}

describe("AgentContext reset", () => {
  beforeAll(async () => { await setupTestI18n("zh"); });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("clears page context, prefill requests, and background notices", () => {
    vi.useFakeTimers();
    let context!: ReturnType<typeof useAgentContext>;
    function CaptureContext() {
      context = useAgentContext();
      return <AgentContextProbe />;
    }
    render(
      <TestI18nProvider>
        <AgentProvider><CaptureContext /></AgentProvider>
      </TestI18nProvider>,
    );

    act(() => {
      context.setPageContext({ current_page: "graph", summary: "旧项目内容" });
      context.requestAgentPrefill("旧项目预填");
      context.notifyAgentBackground("旧项目提示", "warning");
    });
    expect(screen.getByTestId("page-context")).toHaveTextContent("旧项目内容");
    expect(screen.getByTestId("prefill-context")).toHaveTextContent("旧项目预填");
    expect(screen.getByText("旧项目提示")).toBeInTheDocument();

    act(() => context.resetAgentContext?.());
    expect(screen.getByTestId("page-context")).toHaveTextContent("no-page-context");
    expect(screen.getByTestId("prefill-context")).toHaveTextContent("no-prefill");
    expect(screen.queryByText("旧项目提示")).not.toBeInTheDocument();
  });
});
