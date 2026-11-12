import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformUser } from "../../../platform/authTypes";
import { saveSessionToken } from "../../../platform/session";
import { PlatformRequestError } from "../../../platform/platformRequest";
import type { ManagementHelpAnswer, ManagementHelpIndex } from "../../../platform/managementHelpApi";
import { buildManagementHelpHistory, ManagementHelp } from "./ManagementHelp";

const mocks = vi.hoisted(() => ({ get: vi.fn(), ask: vi.fn() }));

vi.mock("../../../platform/managementHelpApi", () => ({
  getManagementHelp: mocks.get,
  askManagementHelp: mocks.ask,
}));

const admin: PlatformUser = { id: "admin-a", role: "admin", username: "root", display_name: "管理员", status: "active" };
const school: PlatformUser = { id: "school-a", role: "school", school_id: "school-one", username: "manager", display_name: "学校管理员", status: "active" };
const index: ManagementHelpIndex = {
  sections: [],
  suggestions: ["怎么导入教师？"],
};
const teacherAnswer: ManagementHelpAnswer = {
  answer: "打开教师页面即可管理教师账号。",
  links: [{ label: "打开教师", section: "teachers", view: "list" }],
  source: "local",
};

beforeEach(() => {
  localStorage.clear();
  saveSessionToken("session-a");
  mocks.get.mockReset().mockResolvedValue(index);
  mocks.ask.mockReset().mockResolvedValue(teacherAnswer);
});

describe("ManagementHelp", () => {
  it("bounds recent conversation history by item count and total characters", () => {
    const history = buildManagementHelpHistory(Array.from({ length: 8 }, (_, indexValue) => ({
      id: indexValue,
      role: indexValue % 2 ? "assistant" as const : "user" as const,
      content: String(indexValue).repeat(500),
    })));

    expect(history.length).toBeLessThanOrEqual(8);
    expect(history.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(2400);
    expect(history.every((item) => item.content.length <= 500)).toBe(true);
    expect(history.at(-1)?.content).toBe("7".repeat(500));
  });

  it("opens from the visible button and Ctrl/Cmd+K, while leaving IME composition alone", async () => {
    render(<><input aria-label="页面搜索框" /><ManagementHelp user={school} /></>);

    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭帮助" }));

    fireEvent.keyDown(screen.getByLabelText("页面搜索框"), { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, isComposing: true, keyCode: 229 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("询问管理助手")).toHaveFocus());
  });

  it("answers a suggested question and navigates only through the returned link", async () => {
    const onNavigate = vi.fn();
    render(<ManagementHelp user={school} context={{ section: "teachers", school_id: "school-one" }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    fireEvent.click(await screen.findByRole("button", { name: "怎么导入教师？" }));

    expect(await screen.findByText("打开教师页面即可管理教师账号。")).toBeInTheDocument();
    expect(mocks.ask).toHaveBeenCalledWith("school", expect.objectContaining({
      question: "怎么导入教师？", school_id: "school-one", section: "teachers",
    }), expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "打开教师" }));
    expect(onNavigate).toHaveBeenCalledWith({ label: "打开教师", section: "teachers", view: "list" });
  });

  it("drops an in-flight answer after the account identity changes", async () => {
    let resolveAnswer!: (answer: ManagementHelpAnswer) => void;
    mocks.ask.mockReturnValue(new Promise<ManagementHelpAnswer>((resolve) => { resolveAnswer = resolve; }));
    const { rerender } = render(<ManagementHelp user={school} />);
    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    fireEvent.change(await screen.findByLabelText("询问管理助手"), { target: { value: "怎么导入教师？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalled());

    const nextUser = { ...school, id: "school-b", school_id: "school-two" };
    rerender(<ManagementHelp user={nextUser} />);
    await act(async () => { resolveAnswer({ ...teacherAnswer, answer: "旧账号的延迟回答" }); });

    expect(screen.queryByText("旧账号的延迟回答")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears old conversation and drops an answer when the session token changes", async () => {
    let resolveAnswer!: (answer: ManagementHelpAnswer) => void;
    mocks.ask.mockReturnValue(new Promise<ManagementHelpAnswer>((resolve) => { resolveAnswer = resolve; }));
    const { rerender } = render(<ManagementHelp user={school} />);
    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    fireEvent.change(await screen.findByLabelText("询问管理助手"), { target: { value: "怎么导入教师？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalled());

    saveSessionToken("session-b");
    rerender(<ManagementHelp user={school} />);
    await act(async () => { resolveAnswer({ ...teacherAnswer, answer: "旧会话的延迟回答" }); });

    expect(screen.queryByText("旧会话的延迟回答")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears submitted conversation when the server reports an expired session", async () => {
    mocks.ask.mockRejectedValue(new PlatformRequestError("internal server message", 401));
    const { container } = render(<ManagementHelp user={school} />);
    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    fireEvent.change(await screen.findByLabelText("询问管理助手"), { target: { value: "怎么导入教师？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("登录状态已过期");
    expect(container.querySelector(".management-help__turn--user")).not.toBeInTheDocument();
  });

  it("isolates a permission answer when the selected school context changes", async () => {
    let resolveAnswer!: (answer: ManagementHelpAnswer) => void;
    mocks.ask.mockReturnValue(new Promise<ManagementHelpAnswer>((resolve) => { resolveAnswer = resolve; }));
    const { rerender } = render(<ManagementHelp user={admin} context={{ school_id: "school-one", section: "access" }} />);
    fireEvent.click(screen.getByRole("button", { name: "不会用？问助手" }));
    fireEvent.change(await screen.findByLabelText("询问管理助手"), { target: { value: "谁能管理教师账号？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalled());

    rerender(<ManagementHelp user={admin} context={{ school_id: "school-two", section: "access" }} />);
    await act(async () => { resolveAnswer({ ...teacherAnswer, answer: "旧学校的权限回答" }); });

    expect(screen.queryByText("旧学校的权限回答")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
