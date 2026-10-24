import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { ComposeExportTaskView } from "../../types/compose";
import { createEmptyPaperState } from "./composeModel";
import { useComposeExportTasks } from "./useComposeExportTasks";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), get: vi.fn(), list: vi.fn(), retry: vi.fn(), sync: vi.fn(), success: vi.fn(), failure: vi.fn(), error: vi.fn() }));
vi.mock("./composeExportTasks", async (original) => ({ ...await original<typeof import("./composeExportTasks")>(), submitExportTaskApi: mocks.submit, getExportTaskApi: mocks.get, listExportTasksApi: mocks.list, retryExportTaskApi: mocks.retry }));
vi.mock("../../api/client", async (original) => ({ ...await original<typeof import("../../api/client")>(), apiPost: mocks.sync }));
const task = (status: ComposeExportTaskView["status"], attempt = 1): ComposeExportTaskView => ({ id: "task-1", format: "pdf", status, attempt, created_at: "now", updated_at: "now", result: status === "succeeded" ? { exam_dir: "exams/Quiz/Math", student_pdf: "student.pdf", teacher_pdf: "teacher.pdf" } : null, error: status === "failed" ? { status: 500, detail: { message: "Compiler failed", exam_saved: { exam_id: "Recovery/Math", name: "Recovery" } } } : null });
const input = () => ({ format: "pdf" as const, body: { export_label: "Quiz", subject: "Math", template_ref: "math", template_path: "templates/math.yaml", selected_items: [{ section_id: "s", question_ids: ["q1"] }] }, idsToDelete: [], submitted: createEmptyPaperState({ bySection: { s: ["q1"] } }) });
const mount = () => renderHook(({ scope }) => useComposeExportTasks({ ownerKey: scope, pollIntervalMs: 100, onTaskSucceeded: mocks.success, onTaskFailed: mocks.failure, onError: mocks.error }), { initialProps: { scope: "a/project/paper" } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); mocks.list.mockResolvedValue([]); mocks.submit.mockResolvedValue(task("running")); mocks.get.mockResolvedValue(task("running")); mocks.retry.mockResolvedValue(task("running", 2)); });
afterEach(() => vi.useRealTimers());

describe("export task transport and recovery", () => {
  it("reuses the original immutable request and key after an uncertain submission", async () => {
    mocks.submit.mockRejectedValueOnce(new TypeError("Network timeout"));
    const { result } = mount(); const request = input();
    await act(async () => { await result.current.startExportTask(request); });
    const original = mocks.submit.mock.calls[0]![0];
    expect(result.current.pendingSubmissionFailure?.requestPayload.request_key).toBe(original.request_key);
    request.body.selected_items[0]!.question_ids.push("later-edit");
    await act(async () => { await result.current.retryExportTask(); });
    expect(mocks.submit.mock.calls[1]![0]).toEqual(original);
    expect(original.selected_items[0].question_ids).toEqual(["q1"]);
    expect(result.current.pendingSubmissionFailure).toBeNull();
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("pauses a failed status lookup and resumes with GET without re-exporting", async () => {
    mocks.get.mockRejectedValueOnce(new TypeError("Offline"));
    const { result } = mount();
    await act(async () => { await result.current.startExportTask(input()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(110); });
    expect(result.current.activeTask?.status).toBe("running");
    expect(result.current.pollError).toBe("Offline");
    mocks.get.mockResolvedValue(task("succeeded"));
    await act(async () => { await result.current.resumePolling(); });
    expect(result.current.activeTask?.status).toBe("succeeded");
    expect(result.current.pollError).toBeNull();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it("restores pending tasks after remount without replaying their submission", async () => {
    mocks.list.mockResolvedValue([task("queued")]); mocks.get.mockResolvedValue(task("succeeded"));
    const { result } = mount();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.activeTask?.status).toBe("queued");
    await act(async () => { await vi.advanceTimersByTimeAsync(110); });
    expect(mocks.success).toHaveBeenCalledWith(expect.objectContaining({ sourceAction: "recent_resume", result: task("succeeded").result }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("reports a saved failure draft and retries that same server task", async () => {
    mocks.submit.mockResolvedValue(task("failed"));
    const { result } = mount();
    await act(async () => { await result.current.startExportTask(input()); });
    expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({ message: "Compiler failed", examSaved: { exam_id: "Recovery/Math", name: "Recovery" } }));
    mocks.retry.mockResolvedValue(task("succeeded", 2));
    await act(async () => { await result.current.retryExportTask(); });
    expect(mocks.retry).toHaveBeenCalledWith("task-1");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith(expect.objectContaining({ submitted: input().submitted, sourceAction: "retry" }));
  });

  it.each(["b/project/paper", "a/other-project/paper", "a/project/other-paper"])("discards a late response after switching to %s", async (scope) => {
    const late = deferred<ComposeExportTaskView>(); mocks.get.mockReturnValue(late.promise);
    const { result, rerender } = mount();
    await act(async () => { await result.current.startExportTask(input()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(110); });
    rerender({ scope });
    await act(async () => { late.resolve(task("succeeded")); await Promise.resolve(); });
    expect(result.current.activeTask).toBeNull();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("ignores a submission response arriving after unmount", async () => {
    const late = deferred<ComposeExportTaskView>(); mocks.submit.mockReturnValue(late.promise);
    const { result, unmount } = mount();
    let completion!: Promise<void>;
    act(() => { completion = result.current.startExportTask(input()); });
    unmount();
    await act(async () => { late.resolve(task("succeeded")); await completion; });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it.each([404, 401, 403])("falls back to synchronous export only for 404, received %s", async (status) => {
    mocks.submit.mockRejectedValue(new ApiError("Unavailable", status));
    mocks.sync.mockResolvedValue(task("succeeded").result);
    const { result } = mount();
    await act(async () => { await result.current.startExportTask(input()); });
    expect(mocks.sync).toHaveBeenCalledTimes(status === 404 ? 1 : 0);
    if (status !== 404) expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({ status }));
    else expect(mocks.success).toHaveBeenCalledTimes(1);
  });
});
