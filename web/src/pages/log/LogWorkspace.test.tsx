import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { LogWorkspace } from "./LogWorkspace";

const mocks = vi.hoisted(() => ({ copy: vi.fn(), setPageContext: vi.fn(), logs: [] }));
vi.mock("../../lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("../../contexts/AgentContext", () => ({ useAgentActions: () => ({ setPageContext: mocks.setPageContext }) }));
vi.mock("../../lib/appLog", () => ({ clearLogs: vi.fn(), copyLogsAsText: () => "中文运行日志", getLogSnapshot: () => mocks.logs, subscribeLogs: () => () => {} }));

beforeAll(async () => { await setupTestI18n("zh"); });

it("offers selectable log text instead of another error when automatic copying fails", async () => {
  mocks.copy.mockRejectedValue(new Error("Unavailable"));
  render(<TestI18nProvider><LogWorkspace /></TestI18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请选中下方日志后手动复制");
  expect(screen.getByRole("textbox", { name: "待复制的日志" })).toHaveValue("中文运行日志");
});
