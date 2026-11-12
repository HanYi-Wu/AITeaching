import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { AgentChatPanel } from "../AgentChatPanel";

const { messageRowRender, streamValue } = vi.hoisted(() => ({
  messageRowRender: vi.fn(),
  streamValue: {
    sessionId: null,
    setSessionId: vi.fn(),
    sessionIdRef: { current: null },
    conversationEpochRef: { current: 0 },
    lines: [{ kind: "assistant", key: "existing-line", text: "历史回答" }],
    setLines: vi.fn(),
    busy: false,
    setBusy: vi.fn(),
    taskSteps: null,
    setTaskSteps: vi.fn(),
    thinkingText: null,
    contextTokensEst: null,
    contextLimit: null,
    contextMeterRefreshing: false,
    currentFocus: null,
    runStream: vi.fn(),
    confirm: vi.fn(),
    planAction: vi.fn(),
    newChat: vi.fn(),
    stopStream: vi.fn(),
    loadHistorySession: vi.fn(),
    refreshContextMeter: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({
  apiAgentConfig: vi.fn().mockResolvedValue({ llm_configured: true }),
  apiAgentSkillsList: vi.fn().mockResolvedValue({ skills: [] }),
  apiAgentSessionsList: vi.fn().mockResolvedValue({ sessions: [] }),
  apiAgentCreateSession: vi.fn(),
  apiAgentSessionDelete: vi.fn(),
  apiAgentSessionCancel: vi.fn(),
  apiAgentSessionContextMeter: vi.fn(),
  apiAgentMemoryIndexGet: vi.fn(),
  apiAgentMemoryIndexPut: vi.fn(),
  apiAgentMemoryTopicList: vi.fn(),
  apiAgentMemoryTopicGet: vi.fn(),
  apiAgentMemoryTopicPut: vi.fn(),
  apiAgentChatStream: vi.fn(),
  apiPostFormData: vi.fn(),
}));

vi.mock("../../contexts/AgentContext", () => ({
  useAgentContext: () => ({
    pageContext: null,
    sidebarOpen: true,
    prefillRequest: null,
    notifyAgentBackground: vi.fn(),
  }),
}));

vi.mock("../agent-chat", async () => {
  const actual = await vi.importActual<typeof import("../agent-chat")>("../agent-chat");
  return {
    ...actual,
    useAgentChatStream: () => streamValue,
    AgentMessageItem: () => {
      messageRowRender();
      return null;
    },
  };
});

describe("AgentChatPanel typing render boundary", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    messageRowRender.mockClear();
  });

  it("does not re-render the conversation history subtree for each composer keystroke", async () => {
    const user = userEvent.setup();
    render(
      <TestI18nProvider>
        <AgentChatPanel />
      </TestI18nProvider>,
    );

    const input = await screen.findByRole("textbox");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(messageRowRender).toHaveBeenCalled();
    messageRowRender.mockClear();

    await user.type(input, "一段较长的聊天草稿");

    expect(input).toHaveValue("一段较长的聊天草稿");
    expect(messageRowRender).not.toHaveBeenCalled();
  });
});
