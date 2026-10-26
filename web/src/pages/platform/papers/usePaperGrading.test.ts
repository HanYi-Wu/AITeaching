import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePaperGrading } from "./usePaperGrading";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("usePaperGrading", () => {
  it("accepts only the newest same-question save when responses arrive out of order", async () => {
    const { result } = renderHook(() => usePaperGrading("teacher-a/project-a/paper-a"));
    const firstResponse = deferred<number>();
    const secondResponse = deferred<number>();
    const first = result.current.beginSave("attempt-1:question-1");
    const second = result.current.beginSave("attempt-1:question-1");
    const acceptWhenResolved = async (request: typeof first, response: ReturnType<typeof deferred<number>>) => {
      await response.promise;
      return result.current.acceptSave(request);
    };
    const firstCompletion = acceptWhenResolved(first, firstResponse);
    const secondCompletion = acceptWhenResolved(second, secondResponse);

    await act(async () => {
      secondResponse.resolve(2);
      expect(await secondCompletion).toEqual({ current: true, fields: { score: true, feedback: true } });
      firstResponse.resolve(1);
      expect(await firstCompletion).toEqual({ current: false, fields: { score: false, feedback: false } });
    });
  });

  it("keeps an AI response from replacing fields edited or saved after the request began", () => {
    const { result } = renderHook(() => usePaperGrading("teacher-a/project-a/paper-a"));
    const key = "attempt-1:question-1";
    const ai = result.current.beginAiRequest([key]);

    act(() => result.current.beginEdit(key, "score"));
    expect(result.current.acceptAiFields(ai, key, ["score", "feedback"])).toEqual(["feedback"]);

    const laterAi = result.current.beginAiRequest([key]);
    const save = result.current.beginSave(key);
    expect(result.current.acceptAiFields(laterAi, key, ["score", "feedback"])).toEqual([]);
    expect(result.current.acceptSave(save)).toEqual({ current: true, fields: { score: true, feedback: true } });
  });

  it("does not refresh over manual edits until a save has accepted that edit version", () => {
    const { result } = renderHook(() => usePaperGrading("teacher-a/project-a/paper-a"));
    const key = "attempt-1:question-1";
    const beforeEdit = result.current.beginRefresh();
    act(() => result.current.beginEdit(key, "score"));
    expect(result.current.acceptRefreshField(beforeEdit, key, "score")).toBe(false);

    const afterEdit = result.current.beginRefresh();
    expect(result.current.acceptRefreshField(afterEdit, key, "score")).toBe(false);

    const save = result.current.beginSave(key);
    expect(result.current.acceptSave(save).fields.score).toBe(true);
    const afterSave = result.current.beginRefresh();
    expect(result.current.acceptRefreshField(afterSave, key, "score")).toBe(true);
  });

  it("invalidates outstanding requests when the account, project, or paper scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scope }) => usePaperGrading(scope),
      { initialProps: { scope: "teacher-a/project-a/paper-a" } },
    );
    const save = result.current.beginSave("attempt-1:question-1");
    const ai = result.current.beginAiRequest(["attempt-1:question-1"]);
    const refresh = result.current.beginRefresh();

    rerender({ scope: "teacher-b/project-b/paper-b" });

    expect(result.current.isCurrentSave(save)).toBe(false);
    expect(result.current.isCurrentScope(save.scopeVersion)).toBe(false);
    expect(result.current.isCurrentAiRequest(ai, "attempt-1:question-1")).toBe(false);
    expect(result.current.isCurrentRefresh(refresh)).toBe(false);
  });

  it("invalidates outstanding requests when the grading workspace unmounts", () => {
    const { result, unmount } = renderHook(() => usePaperGrading("teacher-a/project-a/paper-a"));
    const ai = result.current.beginAiRequest(["attempt-1:question-1"]);

    unmount();

    expect(result.current.isCurrentAiRequest(ai, "attempt-1:question-1")).toBe(false);
  });
});
