import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposePublishing } from "./useComposePublishing";

const mocks = vi.hoisted(() => ({ save: vi.fn(), sync: vi.fn(), publish: vi.fn(), setOpen: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("../../platform/auth", async (original) => ({ ...await original<typeof import("../../platform/auth")>(),
  listTeacherAssignedClasses: async () => ({ classes: [{ id: "class-1", name: "Class" }] }),
  listContentFolders: async () => ({ folders: [{ id: "folder-1", kind: "category", name: "Folder" }] }),
  listClassPracticeHistory: async () => ({ publications: [] }),
  syncPlatformPaperFromExam: mocks.sync, publishPlatformPaper: mocks.publish,
}));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const mount = () => renderHook(({ ownerKey }) => useComposePublishing({ ownerKey, open: true, setOpen: mocks.setOpen, exportLabel: "Quiz", countsOk: true, persistDraftForPublish: mocks.save, onError: mocks.error, setMsg: mocks.message }), { initialProps: { ownerKey: "teacher-a/project" } });
beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue({ exam_id: "Quiz/Math" }); mocks.sync.mockResolvedValue({ paper: { paper_id: "paper-1", title: "Quiz" } }); mocks.publish.mockResolvedValue({}); });
async function configured() {
  const view = mount();
  await act(async () => { await view.result.current.openPublishDialog(); });
  await act(async () => { view.result.current.dialogProps.onToggleClass("class-1"); view.result.current.dialogProps.onFolderIdChange("folder-1"); });
  return view;
}

it("saves, synchronizes and publishes the intended class and folder", async () => {
  const { result } = await configured();
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.sync).toHaveBeenCalledWith("Quiz/Math");
  expect(mocks.publish).toHaveBeenCalledWith("paper-1", expect.objectContaining({ class_ids: ["class-1"], folder_id: "folder-1" }));
  expect(mocks.message).toHaveBeenCalledWith("已发布为线上答题试卷");
});

it("does not publish an older exam when saving the current draft fails", async () => {
  mocks.save.mockResolvedValue(null);
  const { result } = await configured();
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("stops before synchronization when the account changes during saving", async () => {
  const saving = deferred<{ exam_id: string }>(); mocks.save.mockReturnValue(saving.promise);
  const { result, rerender } = await configured();
  act(() => result.current.dialogProps.onConfirm());
  rerender({ ownerKey: "teacher-b/project" });
  await act(async () => { saving.resolve({ exam_id: "Quiz/Math" }); });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(result.current.dialogProps.selectedClassIds).toEqual([]);
});

it("stops before publishing when the project changes during synchronization", async () => {
  const syncing = deferred<{ paper: { paper_id: string } }>(); mocks.sync.mockReturnValue(syncing.promise);
  const { result, rerender } = await configured();
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  rerender({ ownerKey: "teacher-a/other-project" });
  await act(async () => { syncing.resolve({ paper: { paper_id: "paper-1" } }); });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.message).not.toHaveBeenCalled();
});
