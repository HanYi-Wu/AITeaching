import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { ComposeExportTaskBanner } from "./ComposeExportTaskBanner";

beforeAll(async () => { await setupTestI18n("zh"); });
it("offers status recovery for a running export whose connection was interrupted", () => {
  const resume = vi.fn(), retry = vi.fn();
  render(<TestI18nProvider><ComposeExportTaskBanner task={{ id: "t", status: "running", format: "pdf", attempt: 1, created_at: "now", updated_at: "now", result: null, error: null }} pendingSubmissionFailure={null} busy={false} pollError="Offline" onResume={resume} onRetry={retry} onDismiss={vi.fn()} /></TestI18nProvider>);
  expect(screen.getByRole("alert")).toHaveTextContent("导出可能仍在进行");
  fireEvent.click(screen.getByRole("button", { name: "继续查询" }));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
});
