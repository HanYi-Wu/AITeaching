import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposeDraftScope } from "./useComposeDraftScope";

const mocks = vi.hoisted(() => ({ get: vi.fn(), me: vi.fn() }));
vi.mock("../../api/client", () => ({ apiGet: mocks.get }));
vi.mock("../../platform/auth", () => ({ getCurrentUser: mocks.me }));
beforeEach(() => { vi.resetAllMocks(); mocks.me.mockResolvedValue({ user: { id: "teacher" } }); });

it("uses a redacted public project's opaque identity and isolates a second project", async () => {
  mocks.get.mockResolvedValue({ bound: true, root: "", project_id: "project:one" });
  const { result } = renderHook(() => useComposeDraftScope({ currentExamId: "Quiz/Math" }));
  await waitFor(() => expect(result.current.scopeReady).toBe(true));
  const first = result.current.storageKey;
  expect(result.current.scope?.projectRoot).toBe("project:one");
  mocks.get.mockResolvedValue({ bound: true, root: "", project_id: "project:two" });
  await act(async () => { await result.current.refreshScope(); });
  expect(result.current.storageKey).not.toBe(first);
});

it("keeps persistence disabled if an older public server supplies no reliable identity", async () => {
  mocks.get.mockResolvedValue({ bound: true, root: "" });
  const { result } = renderHook(() => useComposeDraftScope({ currentExamId: "Quiz/Math" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/api/project/info"));
  expect(result.current.scopeReady).toBe(false);
  expect(result.current.storageKey).toBeNull();
});
