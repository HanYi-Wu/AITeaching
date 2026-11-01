import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBankImportSession, type UseBankImportSessionOptions } from "../../sessionCore/useBankImportSession";

const sessionMocks = vi.hoisted(() => ({ token: vi.fn(() => "token-1") }));

vi.mock("../../../../platform/session", () => ({
  loadSessionToken: () => sessionMocks.token(),
}));

function createOptions(
  overrides: Partial<UseBankImportSessionOptions> = {}
): UseBankImportSessionOptions {
  return {
    onError: vi.fn(),
    postImportApi: vi.fn().mockResolvedValue({ written: 1, namespace: "数学/default" }),
    postBundleApi: vi.fn().mockResolvedValue({ written: 1, namespace: "数学/default" }),
    refreshListApi: vi.fn().mockResolvedValue(undefined),
    defaultSubject: "数学",
    defaultTarget: "default",
    ...overrides,
  };
}

describe("useBankImportSession request lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.token.mockReturnValue("token-1");
  });

  it("gates synchronous duplicate submissions before React rerenders", async () => {
    let resolvePost!: (value: { written: number; namespace: string }) => void;
    const postImportApi = vi.fn(
      () => new Promise<{ written: number; namespace: string }>((resolve) => { resolvePost = resolve; })
    );
    const refreshListApi = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useBankImportSession(createOptions({ postImportApi, refreshListApi }))
    );
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;

    act(() => {
      result.current.setImportYaml("id: q1\ntype: fill");
      first = result.current.importYamlText();
      second = result.current.importYamlText();
    });

    expect(postImportApi).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(false);

    await act(async () => {
      resolvePost({ written: 1, namespace: "数学/default" });
      await first;
    });
    expect(refreshListApi).toHaveBeenCalledTimes(1);
  });

  it("clears only the submitted draft at commit and preserves text entered during refresh", async () => {
    let resolveRefresh!: () => void;
    const refreshListApi = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; })
    );
    const { result } = renderHook(() =>
      useBankImportSession(createOptions({ refreshListApi }))
    );
    let submitted!: Promise<boolean>;

    act(() => {
      result.current.setImportYaml("id: submitted\ntype: fill");
      submitted = result.current.importYamlText();
    });

    await waitFor(() => expect(result.current.transaction.stage).toBe("refreshing_list"));
    expect(result.current.importYaml).toBe("");
    act(() => result.current.setImportYaml("id: newer-draft\ntype: fill"));

    await act(async () => {
      resolveRefresh();
      await submitted;
    });

    expect(result.current.importYaml).toBe("id: newer-draft\ntype: fill");
    expect(result.current.transaction.stage).toBe("idle");
  });

  it("ignores a late import result after the session token changes", async () => {
    let resolvePost!: (value: { written: number; namespace: string }) => void;
    const postImportApi = vi.fn(
      () => new Promise<{ written: number; namespace: string }>((resolve) => { resolvePost = resolve; })
    );
    const refreshListApi = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { result, rerender } = renderHook(() =>
      useBankImportSession(createOptions({ postImportApi, refreshListApi, onError }))
    );
    let submitted!: Promise<boolean>;

    act(() => {
      result.current.setImportYaml("id: q1\ntype: fill");
      submitted = result.current.importYamlText();
    });
    sessionMocks.token.mockReturnValue("token-2");
    rerender();

    await act(async () => {
      resolvePost({ written: 1, namespace: "数学/default" });
      await submitted;
    });

    expect(refreshListApi).not.toHaveBeenCalled();
    expect(result.current.transaction.stage).toBe("idle");
    expect(result.current.importYaml).toBe("id: q1\ntype: fill");
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("登录状态已更改"));
  });

  it("does not publish or refresh after unmount while an import is pending", async () => {
    let resolvePost!: (value: { written: number; namespace: string }) => void;
    const postImportApi = vi.fn(
      () => new Promise<{ written: number; namespace: string }>((resolve) => { resolvePost = resolve; })
    );
    const refreshListApi = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useBankImportSession(createOptions({ postImportApi, refreshListApi, onError }))
    );
    let submitted!: Promise<boolean>;

    act(() => {
      result.current.setImportYaml("id: q1\ntype: fill");
      submitted = result.current.importYamlText();
    });
    unmount();

    await act(async () => {
      resolvePost({ written: 1, namespace: "数学/default" });
      await submitted;
    });

    expect(refreshListApi).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("登录状态已更改"));
  });
});
