import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { ClassroomToolsWorkspace } from "./ClassroomToolsWorkspace";
import { ROLL_CALL_ANIMATION_FRAMES, ROLL_CALL_FRAME_MS } from "./rollCallEngine";

const mocks = vi.hoisted(() => ({
  setPageContext: vi.fn(),
  playTimerCue: vi.fn(() => () => undefined),
  playRollCallCue: vi.fn(),
  clearPendingAudioCues: vi.fn(),
}));

vi.mock("../../contexts/AgentContext", () => ({
  useAgentActions: () => ({
    setPageContext: mocks.setPageContext,
    setSidebarOpen: vi.fn(),
    toggleSidebar: vi.fn(),
    requestAgentPrefill: vi.fn(),
    notifyAgentBackground: vi.fn(),
  }),
}));

vi.mock("./classroomAudio", () => ({
  playTimerCue: mocks.playTimerCue,
  playRollCallCue: mocks.playRollCallCue,
  clearPendingAudioCues: mocks.clearPendingAudioCues,
}));

function renderWorkspace(props: { active?: boolean; initialTool?: "rollCall" | "timer" } = {}) {
  return render(
    <TestI18nProvider>
      <ClassroomToolsWorkspace {...props} />
    </TestI18nProvider>,
  );
}

describe("ClassroomToolsWorkspace", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    mocks.setPageContext.mockClear();
    mocks.playTimerCue.mockClear();
    mocks.playRollCallCue.mockClear();
    mocks.clearPendingAudioCues.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports range roll call, pool exhaustion, and pool reset without class roster tab or hint clutter", async () => {
    vi.useFakeTimers();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    try {
      renderWorkspace({ initialTool: "rollCall" });

      expect(screen.getByText("剩余 40 / 40")).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "班级名单" })).not.toBeInTheDocument();
      expect(screen.queryByText(/公平随机抽取/)).not.toBeInTheDocument();
      expect(screen.queryByText(/快捷键/)).not.toBeInTheDocument();

      const fromInput = screen.getByLabelText("从") as HTMLInputElement;
      const toInput = screen.getByLabelText("至") as HTMLInputElement;
      fireEvent.change(fromInput, { target: { value: "1" } });
      fireEvent.blur(fromInput);
      fireEvent.change(toInput, { target: { value: "2" } });
      fireEvent.blur(toInput);

      expect(screen.getByText("剩余 2 / 2")).toBeInTheDocument();

      const drawBtn = screen.getByRole("button", { name: "开始抽取" });
      fireEvent.click(drawBtn);
      act(() => {
        vi.advanceTimersByTime(ROLL_CALL_ANIMATION_FRAMES * ROLL_CALL_FRAME_MS + 50);
      });

      expect(screen.getByText("剩余 1 / 2")).toBeInTheDocument();
      expect(mocks.playRollCallCue).toHaveBeenCalledWith("finish", false);

      fireEvent.click(screen.getByRole("button", { name: "再抽一次" }));
      act(() => {
        vi.advanceTimersByTime(ROLL_CALL_ANIMATION_FRAMES * ROLL_CALL_FRAME_MS + 50);
      });

      expect(screen.getByText("剩余 0 / 2")).toBeInTheDocument();
      expect(
        screen.getByText("所有候选人已抽取完毕，请点击“重置状态”开始新一轮，或关闭“不重复抽取”。"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "再抽一次" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "重置状态" }));
      expect(screen.getByText("剩余 2 / 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "开始抽取" })).toBeEnabled();
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("supports custom candidate lists with live entry counting", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialTool: "rollCall" });

    await user.click(screen.getByRole("tab", { name: "自定义名单" }));
    const textarea = screen.getByLabelText("输入名单或学号（换行、逗号或空格分隔）");
    await user.type(textarea, "赵三\n钱四\n孙五");
    expect(screen.getByText("共识别 3 项")).toBeInTheDocument();
    expect(screen.getByText("剩余 3 / 3")).toBeInTheDocument();
  });

  it("runs countdown timer with spinner wrap, 30s/3-2-1s/finish audio cues, focus mode, and background persistence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T10:00:00.000Z"));

    renderWorkspace({ initialTool: "timer" });

    // Default 00:05:00 without subtitle/status pill/shortcut hint clutter
    expect(screen.getByText("00:05:00")).toBeInTheDocument();
    expect(screen.queryByText(/高精度时钟同步/)).not.toBeInTheDocument();
    expect(screen.queryByText(/剩 30 秒/)).not.toBeInTheDocument();
    expect(screen.queryByText(/快捷键/)).not.toBeInTheDocument();
    expect(screen.queryByText("就绪")).not.toBeInTheDocument();

    // Zero-duration inline alert without window.alert
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    const minInput = screen.getByLabelText("分钟") as HTMLInputElement;
    fireEvent.change(minInput, { target: { value: "0" } });
    fireEvent.blur(minInput);
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始计时" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请设置大于 0 秒的倒计时时长。");

    // Verify spinner wrap-around: decrementing 00 seconds wraps to 59
    fireEvent.click(screen.getByRole("button", { name: "减少秒钟" }));
    expect(screen.getByText("00:00:59")).toBeInTheDocument();

    // Select 1-minute preset -> 00:01:00
    fireEvent.click(screen.getByRole("button", { name: "1 分钟" }));
    expect(screen.getByText("00:01:00")).toBeInTheDocument();

    // Start countdown -> locks spinners & triggers audio cues
    fireEvent.click(screen.getByRole("button", { name: "开始计时" }));
    expect(screen.getByLabelText("分钟")).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停计时" })).toBeInTheDocument();

    // Switch sub-tab to Roll Call while timer runs in background
    const rollCallTab = screen.getByRole("tab", { name: "抽学号" });
    fireEvent.mouseDown(rollCallTab, { button: 0 });
    fireEvent.click(rollCallTab);
    expect(screen.getByText(/计时中 00:01:00|计时中 00:00:59/)).toBeInTheDocument();

    // Advance 30s -> triggers 30s warning cue while still on Roll Call tab!
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mocks.playTimerCue).toHaveBeenCalledWith("warning30", false);

    // Switch back to Timer tab -> displays elapsed countdown & finish sequence
    const timerTab = screen.getByRole("tab", { name: "计时器" });
    fireEvent.mouseDown(timerTab, { button: 0 });
    fireEvent.click(timerTab);
    expect(screen.getByText("00:00:30")).toBeInTheDocument();

    // Advance second by second through 3, 2, 1, 0
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(mocks.playTimerCue).toHaveBeenCalledWith("countdown3", false);
    expect(mocks.playTimerCue).toHaveBeenCalledWith("countdown2", false);
    expect(mocks.playTimerCue).toHaveBeenCalledWith("countdown1", false);
    expect(mocks.playTimerCue).toHaveBeenCalledWith("finish", false);
    expect(screen.getByText("倒计时结束！")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新计时" })).toBeInTheDocument();

    // Focus mode opens dialog and Escape exits it
    fireEvent.click(screen.getByRole("button", { name: "专注大屏" }));
    expect(screen.getByRole("dialog", { name: "课堂倒计时" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "课堂倒计时" })).not.toBeInTheDocument();
  });

  it("publishes agent context only when active and clears it when inactive", () => {
    const view = renderWorkspace({ active: false });
    expect(mocks.setPageContext).not.toHaveBeenCalled();

    view.rerender(
      <TestI18nProvider>
        <ClassroomToolsWorkspace active />
      </TestI18nProvider>,
    );
    expect(mocks.setPageContext).toHaveBeenCalledWith({
      current_page: "tools",
      summary: "课堂工具 · 抽学号",
    });

    view.rerender(
      <TestI18nProvider>
        <ClassroomToolsWorkspace active={false} />
      </TestI18nProvider>,
    );
    expect(mocks.setPageContext).toHaveBeenLastCalledWith(null);
  });
});
