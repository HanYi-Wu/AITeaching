import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiGraphQuestionBindingsIndex } from "../../api/client";
import { useBankList } from "./useBankList";
import type { BankListItem } from "./bankModel";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiGraphQuestionBindingsIndex: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../lib/contentEvents", () => ({
  useContentLibraryChanged: vi.fn(),
}));

describe("useBankList hook", () => {
  const mockOnError = vi.fn();

  const sampleItems: BankListItem[] = [
    {
      id: "q1",
      qualified_id: "数学/default/q1",
      collection: "数学/default",
      subject: "数学",
      type: "single_choice",
      content_preview: "求导数",
      metadata: { difficulty: "easy", category: "微积分" },
      storage_path: "resource/数学/default/q1.yaml",
      storage_kind: "single",
    },
    {
      id: "q2",
      qualified_id: "物理/default/q2",
      collection: "物理/default",
      subject: "物理",
      type: "fill",
      content_preview: "求牛顿第二定律加速度",
      metadata: { difficulty: "hard", category: "力学" },
      storage_path: "resource/物理/default/q2.yaml",
      storage_kind: "single",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("solaire.platform.session");
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/bank/collections") {
        return {
          collections: [
            { id: "数学/default", label: "数学/default", subject: "数学", collection: "default" },
            { id: "物理/default", label: "物理/default", subject: "物理", collection: "default" },
          ],
        };
      }
      if (path === "/api/bank/items") {
        return { items: sampleItems };
      }
      if (path === "/api/bank/subjects") {
        return { subjects: ["数学", "物理"] };
      }
      if (path === "/api/bank/folders") {
        return { folders: ["高等数学"], assignments: { "数学/default/q1": "高等数学" } };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    vi.mocked(apiGraphQuestionBindingsIndex).mockResolvedValue({
      index: { "数学/default/q1": [{ id: "n1", canonical_name: "导数", node_kind: "concept" }] },
    });
  });

  afterEach(() => {
    localStorage.removeItem("solaire.platform.session");
    vi.restoreAllMocks();
  });

  it("loads bank collections, items, subjects, folders, and graph bindings on mount", async () => {
    const { result } = renderHook(() => useBankList({ onError: mockOnError }));

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    expect(result.current.subjects).toEqual(["数学", "物理"]);
    expect(result.current.folders.folders).toEqual(["高等数学"]);
    expect(result.current.graphLinkIndex["数学/default/q1"]).toBeDefined();
    expect(result.current.filtered).toHaveLength(2);
  });

  it("filters items by subject, type, and keyword search", async () => {
    const { result } = renderHook(() => useBankList({ onError: mockOnError }));

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    // Filter by subject
    act(() => {
      result.current.setFilterSubject("数学");
    });
    expect(result.current.filtered.map((x) => x.id)).toEqual(["q1"]);

    // Filter by type mismatch
    act(() => {
      result.current.setFilterType("fill");
    });
    expect(result.current.filtered).toHaveLength(0);

    // Reset filters and search keyword
    act(() => {
      result.current.setFilterSubject("__all__");
      result.current.setFilterType("__all__");
      result.current.commitSearch("加速度");
    });

    await waitFor(() => {
      expect(result.current.filtered.map((x) => x.id)).toEqual(["q2"]);
    });
  });

  it("ignores stale response when a newer request finishes first", async () => {
    let resolveFirstReq: (val: unknown) => void;
    const firstReqPromise = new Promise((res) => {
      resolveFirstReq = res;
    });

    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/bank/items") {
        return firstReqPromise;
      }
      return { collections: [], subjects: [], folders: [] };
    });

    const { result } = renderHook(() => useBankList({ onError: mockOnError }));

    // Trigger second loadList immediately with different items
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/bank/items") {
        return { items: [sampleItems[0]] };
      }
      return { collections: [], subjects: [], folders: [] };
    });

    await act(async () => {
      await result.current.loadList();
    });

    expect(result.current.items).toEqual([sampleItems[0]]);

    // Now first (stale) request resolves with different items
    await act(async () => {
      resolveFirstReq!({ items: sampleItems });
    });

    // Stale response must not overwrite
    expect(result.current.items).toEqual([sampleItems[0]]);
  });

  it("does not apply a slow list response after the account session changes", async () => {
    localStorage.setItem("solaire.platform.session", "account-a");
    let resolveOldItems: (value: unknown) => void;
    const oldItemsPromise = new Promise((resolve) => {
      resolveOldItems = resolve;
    });
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === "/api/bank/items") return oldItemsPromise;
      if (path === "/api/bank/collections") return Promise.resolve({ collections: [] });
      if (path === "/api/bank/subjects") return Promise.resolve({ subjects: [] });
      if (path === "/api/bank/folders") return Promise.resolve({ folders: [], assignments: {} });
      throw new Error(`Unexpected GET ${path}`);
    });

    const { result } = renderHook(() => useBankList({ onError: mockOnError }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/bank/items"));

    localStorage.setItem("solaire.platform.session", "account-b");
    await act(async () => {
      resolveOldItems!({ items: [sampleItems[1]] });
      await oldItemsPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.collections).toEqual([]);
    expect(apiGraphQuestionBindingsIndex).not.toHaveBeenCalled();
  });
});
