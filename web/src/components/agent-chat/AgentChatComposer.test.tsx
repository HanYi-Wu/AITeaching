import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentChatComposer } from "./AgentChatComposer";

function renderComposer(onSend = vi.fn(() => true), hasAttachments = false) {
  const result = render(
    <AgentChatComposer
      busy={false}
      disabled={false}
      hasAttachments={hasAttachments}
      inputPlaceholder="输入消息"
      sendLabel="发送消息"
      stopLabel="停止"
      draftPreset={null}
      onSend={onSend}
      onStop={vi.fn()}
    />,
  );
  return { ...result, onSend };
}

describe("AgentChatComposer", () => {
  it("sends with Enter, clears accepted text, and keeps Shift+Enter as a newline action", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer();
    const input = screen.getByRole("textbox");

    await user.type(input, "整理考点");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("整理考点");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("整理考点");
    expect(input).toHaveValue("");
  });

  it("does not send an IME composition Enter and preserves the composed draft", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer();
    const input = screen.getByRole("textbox");

    await user.type(input, "中文");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("中文");
  });

  it("keeps the draft when a send is rejected and accepts attachment-only sends", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => false);
    const { rerender } = render(
      <AgentChatComposer
        busy={false}
        disabled={false}
        hasAttachments={false}
        inputPlaceholder="输入消息"
        sendLabel="发送消息"
        stopLabel="停止"
        draftPreset={null}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "保留这条");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(input).toHaveValue("保留这条");

    rerender(
      <AgentChatComposer
        busy={false}
        disabled={false}
        hasAttachments
        inputPlaceholder="输入消息"
        sendLabel="发送消息"
        stopLabel="停止"
        draftPreset={null}
        onSend={() => true}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(input).toHaveValue("");
  });

  it("replaces the draft when a new programmatic preset arrives", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);
    const { rerender } = render(
      <AgentChatComposer
        busy={false}
        disabled={false}
        hasAttachments={false}
        inputPlaceholder="输入消息"
        sendLabel="发送消息"
        stopLabel="停止"
        draftPreset={{ id: 1, text: "技能建议" }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("技能建议");
    await user.clear(input);
    await user.type(input, "手动草稿");

    rerender(
      <AgentChatComposer
        busy={false}
        disabled={false}
        hasAttachments={false}
        inputPlaceholder="输入消息"
        sendLabel="发送消息"
        stopLabel="停止"
        draftPreset={{ id: 2, text: "外部预填内容" }}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    expect(input).toHaveValue("外部预填内容");
  });
});
