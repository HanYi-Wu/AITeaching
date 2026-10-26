import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProjectionView } from "./taskTrackingApi";
import { parseFiniteProgress, useTaskProgress } from "./useTaskProgress";

const mockGet = vi.hoisted(() => vi.fn());
vi.mock("./taskTrackingApi", async (original) => ({
  ...(await original<typeof import("./taskTrackingApi")>()),
  getTaskProjectionApi: mockGet,
}));

const mockProjection = (
  overrides?: Partial<TaskProjectionView>
): TaskProjectionView => ({
  task_id: "task-100",
  owner: "teacher:t1",
  project_scope: "scope-a",
  task_type: "export",
  attempt: 1,
  status: "running",
  event_version: 1,
  progress: 0.5,
  stage: "导出处理中",
  title: "试卷导出",
  is_retryable: true,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:01Z",
  ...overrides,
});

describe("useTaskProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockGet.mockResolvedValue(mockProjection());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("parseFiniteProgress", () => {
    it("normalizes finite numbers to [0, 1] range", () => {
      expect(parseFiniteProgress(0.45)).toBe(0.45);
      expect(parseFiniteProgress(0)).toBe(0);
      expect(parseFiniteProgress(1)).toBe(1);
      expect(parseFiniteProgress(50)).toBe(0.5); // handles 0-100 percentage input
      expect(parseFiniteProgress(-0.1)).toBe(0);
      expect(parseFiniteProgress(105)).toBe(1);
    });

    it("returns null for non-finite or non-numeric values without fabricating percentages", () => {
      expect(parseFiniteProgress(null)).toBeNull();
      expect(parseFiniteProgress(undefined)).toBeNull();
      expect(parseFiniteProgress(NaN)).toBeNull();
      expect(parseFiniteProgress(Infinity)).toBeNull();
      expect(parseFiniteProgress("0.5")).toBeNull();
      expect(parseFiniteProgress(true)).toBeNull();
    });
  });

  it("fetches projection and tracks progress, stage, and retryability", async () => {
    mockGet.mockResolvedValue(
      mockProjection({
        progress: 0.75,
        stage: "正在排版试题",
        is_retryable: false,
      })
    );

    const { result } = renderHook(() =>
      useTaskProgress({
        taskId: "task-100",
        scopeKey: "teacher_1::proj_1",
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledWith("task-100");
    expect(result.current.progress).toBe(0.75);
    expect(result.current.progressPercent).toBe(75);
    expect(result.current.stage).toBe("正在排版试题");
    expect(result.current.isRetryable).toBe(false);
    expect(result.current.status).toBe("running");
  });

  it("discards late responses and clears state immediately when account or project scope changes", async () => {
    let resolveLate!: (value: TaskProjectionView) => void;
    const latePromise = new Promise<TaskProjectionView>((r) => {
      resolveLate = r;
    });
    mockGet.mockReturnValueOnce(latePromise);

    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useTaskProgress({
          taskId: "task-100",
          scopeKey,
        }),
      { initialProps: { scopeKey: "teacher_1::proj_1" } }
    );

    // Switch scope before late promise resolves
    rerender({ scopeKey: "teacher_2::proj_2" });
    expect(result.current.projection).toBeNull();
    expect(result.current.progress).toBeNull();

    // Late promise from previous scope arrives
    await act(async () => {
      resolveLate(mockProjection({ task_id: "stale-task" }));
      await Promise.resolve();
    });

    // Old task must NOT flash back
    expect(result.current.projection?.task_id).not.toBe("stale-task");
  });

  it("re-queries task status when network reconnects (window online event)", async () => {
    renderHook(() =>
      useTaskProgress({
        taskId: "task-100",
        scopeKey: "teacher_1::proj_1",
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Dispatch online event
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("handles poll errors gracefully without crashing the UI", async () => {
    mockGet.mockRejectedValue(new Error("网络连接失败"));

    const { result } = renderHook(() =>
      useTaskProgress({
        taskId: "task-err",
        scopeKey: "teacher_1::proj_1",
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.projection).toBeNull();
    expect(result.current.pollError).toBe("网络连接失败");
  });
});
