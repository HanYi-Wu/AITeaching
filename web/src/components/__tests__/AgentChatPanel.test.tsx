import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { AgentChatPanel } from "../AgentChatPanel";
import * as clientApi from "../../api/client";

// Mock API client
vi.mock("../../api/client", () => ({
  apiAgentConfig: vi.fn(),
  apiAgentSkillsList: vi.fn(),
  apiAgentSessionsList: vi.fn(),
  apiAgentCreateSession: vi.fn(),
  apiAgentSessionGet: vi.fn(),
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

// Mock AgentContext
vi.mock("../../contexts/AgentContext", () => ({
  useAgentContext: () => ({
    pageContext: { current_page: "graph", summary: "图谱编辑中" },
    sidebarOpen: true,
    prefillRequest: null,
    notifyAgentBackground: vi.fn(),
  }),
}));

describe("AgentChatPanel", () => {
  beforeEach(async () => {
    await setupTestI18n("zh");
    vi.clearAllMocks();

    vi.mocked(clientApi.apiAgentConfig).mockResolvedValue({
      llm_configured: true,
      model: "test-model",
    } as any);
    vi.mocked(clientApi.apiAgentSkillsList).mockResolvedValue({
      skills: [
        {
          id: "skill-1",
          label: "整理考点",
          description: "梳理知识点",
          suggested_user_input: "请帮我梳理考点",
        },
      ] as any,
    });
    vi.mocked(clientApi.apiAgentSessionsList).mockResolvedValue({
      sessions: [
        { session_id: "sess-1", title: "第一轮对话" },
      ] as any,
    });
    vi.mocked(clientApi.apiAgentCreateSession).mockResolvedValue({
      session_id: "sess-new",
    } as any);
  });

  it("renders header, quick starts, and user input field", async () => {
    render(
      <TestI18nProvider>
        <AgentChatPanel />
      </TestI18nProvider>,
    );

    expect(await screen.findByText("整理考点")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("adds and removes file attachments properly", async () => {
    render(
      <TestI18nProvider>
        <AgentChatPanel />
      </TestI18nProvider>,
    );

    const surface = screen.getByTestId("agent-file-drop-surface");
    const testFile = new File(["dummy content"], "syllabus.pdf", { type: "application/pdf" });

    // Simulate drag and drop
    fireEvent.drop(surface, {
      dataTransfer: {
        types: ["Files"],
        files: [testFile],
      },
    });

    const fileLabel = await screen.findByText("syllabus.pdf");
    expect(fileLabel).toBeInTheDocument();

    // Click remove button inside the chip
    const chipContainer = fileLabel.closest("div");
    expect(chipContainer).not.toBeNull();
    const removeBtn = within(chipContainer!).getByRole("button");
    await userEvent.click(removeBtn);
    expect(screen.queryByText("syllabus.pdf")).not.toBeInTheDocument();
  });

  it("deduplicates redundant confirm_needed and plan_ready events during stream", async () => {
    let streamCallback: ((ev: string, data: any) => void) | null = null;
    vi.mocked(clientApi.apiAgentChatStream).mockImplementation((_payload, onEvent) => {
      streamCallback = onEvent;
      return Promise.resolve() as any;
    });

    render(
      <TestI18nProvider>
        <AgentChatPanel />
      </TestI18nProvider>,
    );

    const inputArea = screen.getByRole("textbox");
    fireEvent.change(inputArea, { target: { value: "生成考点试卷" } });
    fireEvent.keyDown(inputArea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(clientApi.apiAgentCreateSession).toHaveBeenCalled();
      expect(clientApi.apiAgentChatStream).toHaveBeenCalled();
    });

    expect(streamCallback).not.toBeNull();

    // Send streaming text
    streamCallback!("text_delta", { text: "正在为您规划…" });
    expect(await screen.findByText("正在为您规划…")).toBeInTheDocument();

    // Send confirm_needed event twice with same action_id
    streamCallback!("confirm_needed", {
      action_id: "act-42",
      tool_name: "exam.create",
      description: "是否确认生成试卷？",
    });
    streamCallback!("confirm_needed", {
      action_id: "act-42",
      tool_name: "exam.create",
      description: "是否确认生成试卷？",
    });

    expect(await screen.findByText("是否确认生成试卷？")).toBeInTheDocument();
    // Should only have 1 confirm card with "是否确认生成试卷？"
    const confirmCards = screen.getAllByText("是否确认生成试卷？");
    expect(confirmCards).toHaveLength(1);

    // Send plan_ready event twice with same plan_file_path
    streamCallback!("plan_ready", {
      plan_file_path: "plans/plan-1.md",
      content: "# 阶段计划草案",
    });
    streamCallback!("plan_ready", {
      plan_file_path: "plans/plan-1.md",
      content: "# 阶段计划草案",
    });

    expect(await screen.findByText("# 阶段计划草案")).toBeInTheDocument();
    // Should only have 1 plan card content
    const planCards = screen.getAllByText("# 阶段计划草案");
    expect(planCards).toHaveLength(1);
  });

  it("handles duplicate tool_result without duplicate insertion", async () => {
    let streamCallback: ((ev: string, data: any) => void) | null = null;
    vi.mocked(clientApi.apiAgentChatStream).mockImplementation((_payload, onEvent) => {
      streamCallback = onEvent;
      return Promise.resolve() as any;
    });

    render(
      <TestI18nProvider>
        <AgentChatPanel />
      </TestI18nProvider>,
    );

    const inputArea = screen.getByRole("textbox");
    fireEvent.change(inputArea, { target: { value: "查询知识库" } });
    fireEvent.keyDown(inputArea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(clientApi.apiAgentChatStream).toHaveBeenCalled();
    });

    // Emit tool_start
    streamCallback!("tool_start", { tool_name: "bank.search", tool_call_id: "call-one", label: "检索题库" });
    expect(await screen.findByText("检索题库")).toBeInTheDocument();

    // Emit tool_result
    streamCallback!("tool_result", {
      tool_name: "bank.search", tool_call_id: "call-one",
      summary: "找到 3 道匹配题目",
    });
    expect(await screen.findByText("找到 3 道匹配题目")).toBeInTheDocument();

    // Emit duplicate tool_result for same tool
    streamCallback!("tool_result", {
      tool_name: "bank.search", tool_call_id: "call-one",
      summary: "找到 3 道匹配题目",
    });

    const toolCards = screen.getAllByText("找到 3 道匹配题目");
    expect(toolCards).toHaveLength(1);
    streamCallback!("tool_start", { tool_name: "bank.search", tool_call_id: "call-two", label: "检索题库" });
    streamCallback!("tool_result", { tool_name: "bank.search", tool_call_id: "call-two", summary: "找到 3 道匹配题目" });
    await waitFor(() => expect(screen.getAllByText("找到 3 道匹配题目")).toHaveLength(2));
  });
});
