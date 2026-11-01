import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposePublishing } from "./useComposePublishing";

const mocks = vi.hoisted(() => ({ save: vi.fn(), sync: vi.fn(), publish: vi.fn(), profile: vi.fn(), setOpen: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("../../platform/auth", async (original) => ({ ...await original<typeof import("../../platform/auth")>(),
  getAccountProfile: mocks.profile,
  listTeacherAssignedClasses: async () => ({ classes: [{ id: "class-1", name: "Class" }] }),
  listContentFolders: async () => ({ folders: [{ id: "folder-1", kind: "category", name: "Folder" }] }),
  listClassPracticeHistory: async () => ({ publications: [] }),
  syncPlatformPaperFromExam: mocks.sync, publishPlatformPaper: mocks.publish,
}));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const mount = (composeSubject = "math") => renderHook(({ ownerKey, composeSubject }) => useComposePublishing({ ownerKey, open: true, setOpen: mocks.setOpen, exportLabel: "Quiz", countsOk: true, composeSubject, persistDraftForPublish: mocks.save, onError: mocks.error, setMsg: mocks.message }), { initialProps: { ownerKey: "teacher-a/project", composeSubject } });
beforeEach(() => { vi.resetAllMocks(); mocks.profile.mockResolvedValue({ profile: { id: "teacher-a", subjects: ["数学", "物理"] } }); mocks.save.mockResolvedValue({ exam_id: "Quiz/Math" }); mocks.sync.mockResolvedValue({ paper: { paper_id: "paper-1", title: "Quiz", subject: "math" } }); mocks.publish.mockResolvedValue({}); });
async function configured(composeSubject = "math") {
  const view = mount(composeSubject);
  await act(async () => { await view.result.current.openPublishDialog(); });
  await act(async () => { view.result.current.dialogProps.onToggleClass("class-1"); view.result.current.dialogProps.onFolderIdChange("folder-1"); });
  return view;
}

it("uses the teacher's selected subject instead of the question-bank namespace when publishing", async () => {
  const { result } = await configured();
  expect(result.current.dialogProps.teacherSubjects).toEqual(["数学", "物理"]);
  expect(result.current.dialogProps.selectedSubject).toBe("");
  act(() => result.current.dialogProps.onSubjectChange("数学"));
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.sync).toHaveBeenCalledWith("Quiz/Math");
  expect(mocks.publish).toHaveBeenCalledWith("paper-1", expect.objectContaining({ class_ids: ["class-1"], folder_id: "folder-1", subject: "数学" }));
  expect(mocks.message).toHaveBeenCalledWith("已发布为线上答题试卷");
});

it("automatically selects the only subject in the teacher profile", async () => {
  mocks.profile.mockResolvedValue({ profile: { id: "teacher-a", subjects: ["数学"] } });
  const { result } = await configured();
  expect(result.current.dialogProps.selectedSubject).toBe("数学");
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.publish).toHaveBeenCalledWith("paper-1", expect.objectContaining({ subject: "数学" }));
});

it("preselects the current compose subject when it matches the teacher profile", async () => {
  const { result } = await configured("数学");
  expect(result.current.dialogProps.selectedSubject).toBe("数学");
});

it("does not publish a multi-subject paper until a subject is selected", async () => {
  const { result } = await configured();
  expect(result.current.dialogProps.selectedSubject).toBe("");
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.error).toHaveBeenCalledWith("请先选择发布学科");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("falls back to the saved paper subject when the teacher has no configured subjects", async () => {
  mocks.profile.mockResolvedValue({ profile: { id: "teacher-a", subjects: [] } });
  const { result } = await configured();
  expect(result.current.dialogProps.teacherSubjects).toEqual([]);
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.publish).toHaveBeenCalledWith("paper-1", expect.objectContaining({ subject: "math" }));
});

it("does not publish an older exam when saving the current draft fails", async () => {
  mocks.save.mockResolvedValue(null);
  const { result } = await configured();
  act(() => result.current.dialogProps.onSubjectChange("数学"));
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("stops before synchronization when the account changes during saving", async () => {
  const saving = deferred<{ exam_id: string }>(); mocks.save.mockReturnValue(saving.promise);
  const { result, rerender } = await configured();
  act(() => result.current.dialogProps.onSubjectChange("数学"));
  act(() => result.current.dialogProps.onConfirm());
  expect(mocks.save).toHaveBeenCalledTimes(1);
  rerender({ ownerKey: "teacher-b/project", composeSubject: "math" });
  await act(async () => { saving.resolve({ exam_id: "Quiz/Math" }); });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(result.current.dialogProps.selectedClassIds).toEqual([]);
});

it("stops before publishing when the project changes during synchronization", async () => {
  const syncing = deferred<{ paper: { paper_id: string } }>(); mocks.sync.mockReturnValue(syncing.promise);
  const { result, rerender } = await configured();
  act(() => result.current.dialogProps.onSubjectChange("数学"));
  await act(async () => { result.current.dialogProps.onConfirm(); });
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  rerender({ ownerKey: "teacher-a/other-project", composeSubject: "math" });
  await act(async () => { syncing.resolve({ paper: { paper_id: "paper-1" } }); });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.message).not.toHaveBeenCalled();
});

it("ignores profile subjects that resolve after the owner changes", async () => {
  const profile = deferred<{ profile: { id: string; subjects: string[] } }>();
  mocks.profile.mockReturnValue(profile.promise);
  const { result, rerender } = mount();
  act(() => { void result.current.openPublishDialog(); });
  rerender({ ownerKey: "teacher-b/project", composeSubject: "biology" });
  await act(async () => {
    profile.resolve({ profile: { id: "teacher-a", subjects: ["数学", "物理"] } });
    await profile.promise;
    await Promise.resolve();
  });
  expect(result.current.dialogProps.teacherSubjects).toEqual([]);
  expect(result.current.dialogProps.selectedSubject).toBe("");
  expect(mocks.setOpen).not.toHaveBeenCalledWith(true);
});
