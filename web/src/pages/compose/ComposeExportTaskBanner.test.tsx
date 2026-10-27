import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";
import { ComposeExportTaskBanner } from "./ComposeExportTaskBanner";

beforeAll(async () => {
  await setupTestI18n("zh");
});

describe("ComposeExportTaskBanner", () => {
  it("offers status recovery for a running export whose connection was interrupted", () => {
    const resume = vi.fn(), retry = vi.fn();
    render(
      <TestI18nProvider>
        <ComposeExportTaskBanner
          task={{
            id: "t",
            status: "running",
            format: "pdf",
            attempt: 1,
            created_at: "now",
            updated_at: "now",
            result: null,
            error: null,
          }}
          pendingSubmissionFailure={null}
          busy={false}
          pollError="Offline"
          onResume={resume}
          onRetry={retry}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("导出可能仍在进行");
    fireEvent.click(screen.getByRole("button", { name: "继续查询" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("displays progress percentage and stage when progress is finite", () => {
    render(
      <TestI18nProvider>
        <ComposeExportTaskBanner
          task={{
            id: "task-prog",
            status: "running",
            format: "pdf",
            attempt: 1,
            created_at: "now",
            updated_at: "now",
            result: null,
            error: null,
          }}
          pendingSubmissionFailure={null}
          busy={false}
          pollError={null}
          progress={0.65}
          stage="渲染PDF页面"
          onResume={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>
    );

    expect(screen.getByTestId("task-progress-value")).toHaveTextContent("65%");
    expect(screen.getByTestId("task-stage-label")).toHaveTextContent("渲染PDF页面");
    expect(screen.queryByTestId("task-progress-indeterminate")).toBeNull();
  });

  it("displays indeterminate processing label and never fabricates percentage when progress is null", () => {
    render(
      <TestI18nProvider>
        <ComposeExportTaskBanner
          task={{
            id: "task-indet",
            status: "running",
            format: "pdf",
            attempt: 1,
            created_at: "now",
            updated_at: "now",
            result: null,
            error: null,
          }}
          pendingSubmissionFailure={null}
          busy={false}
          pollError={null}
          progress={null}
          onResume={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>
    );

    expect(screen.queryByTestId("task-progress-value")).toBeNull();
    expect(screen.getByTestId("task-progress-indeterminate")).toBeInTheDocument();
  });

  it("suppresses retry button when failed task has isRetryable=false", () => {
    const retry = vi.fn();
    render(
      <TestI18nProvider>
        <ComposeExportTaskBanner
          task={{
            id: "task-non-retry",
            status: "failed",
            format: "docx",
            attempt: 1,
            created_at: "now",
            updated_at: "now",
            result: null,
            error: { status: 400, detail: "不可恢复的排版错误" },
          }}
          pendingSubmissionFailure={null}
          busy={false}
          pollError={null}
          isRetryable={false}
          onResume={vi.fn()}
          onRetry={retry}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>
    );

    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
  });

  it("shows retry button when failed task is retryable", () => {
    const retry = vi.fn();
    render(
      <TestI18nProvider>
        <ComposeExportTaskBanner
          task={{
            id: "task-retryable",
            status: "failed",
            format: "docx",
            attempt: 1,
            created_at: "now",
            updated_at: "now",
            result: null,
            error: { status: 500, detail: "临时网络错误" },
          }}
          pendingSubmissionFailure={null}
          busy={false}
          pollError={null}
          isRetryable={true}
          onResume={vi.fn()}
          onRetry={retry}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>
    );

    const retryBtn = screen.getByRole("button", { name: /重试/ });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
