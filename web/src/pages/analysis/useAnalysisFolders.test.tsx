import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { useAnalysisFolders, type AnalysisFolderState } from "./useAnalysisFolders";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const state = (name: string): AnalysisFolderState => ({
  version: 1,
  folders: name ? [{ id: name.toLowerCase().replaceAll(" ", "-"), name }] : [],
  items: {},
});

describe("useAnalysisFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue(state(""));
    mocks.apiPost.mockResolvedValue(state(""));
  });

  it("gates data by the current scope during render and while disabled", async () => {
    const nextScopeRequest = deferred<AnalysisFolderState>();
    mocks.apiGet
      .mockResolvedValueOnce(state("Old project"))
      .mockReturnValueOnce(nextScopeRequest.promise);
    const renderScopes: string[][] = [];
    const { result, rerender } = renderHook(({ scopeKey, enabled }) => {
      const folders = useAnalysisFolders(scopeKey, enabled);
      useLayoutEffect(() => {
        renderScopes.push(folders.folders.map((folder) => folder.name));
      }, [scopeKey, enabled]);
      return folders;
    }, { initialProps: { scopeKey: "teacher-a/project-a", enabled: true } });

    await waitFor(() => expect(result.current.folders.map((folder) => folder.name)).toEqual(["Old project"]));
    rerender({ scopeKey: "teacher-b/project-b", enabled: true });
    expect(renderScopes.at(-1)).toEqual([]);
    expect(result.current.folders).toEqual([]);
    expect(result.current.items).toEqual({});
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));

    await act(async () => nextScopeRequest.resolve(state("New project")));
    await waitFor(() => expect(result.current.folders.map((folder) => folder.name)).toEqual(["New project"]));
    rerender({ scopeKey: "teacher-b/project-b", enabled: false });
    expect(result.current.folders).toEqual([]);
    expect(result.current.items).toEqual({});
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("allows one mutation at a time and prevents refresh from replacing its result", async () => {
    const staleRefresh = deferred<AnalysisFolderState>();
    const mutation = deferred<AnalysisFolderState>();
    mocks.apiGet.mockResolvedValueOnce(state(""));
    mocks.apiGet.mockReturnValueOnce(staleRefresh.promise);
    mocks.apiPost.mockReturnValueOnce(mutation.promise);
    const { result } = renderHook(() => useAnalysisFolders("teacher-a/project-a", true));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(1));

    let refreshPromise!: Promise<void>;
    await act(async () => { refreshPromise = result.current.refresh(); });
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
    let firstMutation!: Promise<boolean>;
    let duplicateMutation!: Promise<boolean>;
    await act(async () => {
      firstMutation = result.current.createFolder("Saved folder");
      duplicateMutation = result.current.createFolder("Duplicate request");
    });
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(await duplicateMutation).toBe(false);

    await act(async () => { await result.current.refresh(); });
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);

    await act(async () => mutation.resolve(state("Saved folder")));
    expect(await firstMutation).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Saved folder"]);

    await act(async () => {
      staleRefresh.resolve(state("Stale snapshot"));
      await refreshPromise;
    });
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["Saved folder"]);
  });

  it("resets the mutation gate on scope changes without letting an old finally clear new work", async () => {
    const oldMutation = deferred<AnalysisFolderState>();
    const newMutation = deferred<AnalysisFolderState>();
    mocks.apiPost
      .mockReturnValueOnce(oldMutation.promise)
      .mockReturnValueOnce(newMutation.promise);
    const { result, rerender } = renderHook(({ scopeKey }) => useAnalysisFolders(scopeKey, true), {
      initialProps: { scopeKey: "teacher-a/project-a" },
    });
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(1));

    let oldRequest!: Promise<boolean>;
    await act(async () => { oldRequest = result.current.createFolder("Old scope"); });
    rerender({ scopeKey: "teacher-b/project-b" });
    let newRequest!: Promise<boolean>;
    await act(async () => { newRequest = result.current.createFolder("New scope"); });
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBe(true);

    await act(async () => oldMutation.resolve(state("Old scope")));
    expect(await oldRequest).toBe(false);
    expect(result.current.busy).toBe(true);
    expect(result.current.folders).toEqual([]);

    await act(async () => newMutation.resolve(state("New scope")));
    expect(await newRequest).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.folders.map((folder) => folder.name)).toEqual(["New scope"]);
  });
});
