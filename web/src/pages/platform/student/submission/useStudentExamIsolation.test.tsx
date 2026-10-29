import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudentExam } from "../useStudentExam";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), submit: vi.fn(), restoreImages: vi.fn(),
  persistImages: vi.fn(), acknowledgeImages: vi.fn(), retainImages: vi.fn(), retainLate: vi.fn(), compress: vi.fn(),
}));
vi.mock("../../../../platform/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../platform/auth")>(),
  saveStudentAnswers: mocks.save, submitStudentAttempt: mocks.submit,
  recordStudentProctorEvent: vi.fn().mockResolvedValue({}), loadSessionToken: () => null,
}));
vi.mock("../studentImageDraft", async (importOriginal) => ({
  ...await importOriginal<typeof import("../studentImageDraft")>(),
  restoreStudentImageDraft: mocks.restoreImages, persistStudentImageDraft: mocks.persistImages,
  acknowledgeStudentImageDraft: mocks.acknowledgeImages, retainUnconfirmedStudentImageDraft: mocks.retainImages,
  retainLateStudentImage: mocks.retainLate,
}));
vi.mock("../../../../lib/imageCompression", () => ({ compressImageFileToDataUrl: mocks.compress }));

type Start = Parameters<ReturnType<typeof useStudentExam>["open"]>[0];
const user = { id: "student", username: "student", display_name: "Student", role: "student", status: "active" } as const;
const start = (id: string): Start => ({
  attempt: { id, publication_id: `pub-${id}`, title: id, status: "in_progress", project_scope: "project", snapshot_version: "v1", submission_mode: "online" },
  questions: ["q1", "q2"].map((question_id) => ({ question_id, type: "short_answer", content: question_id, header: question_id, section_id: "s", score_per_item: 1 })),
  saved_answers: [{ question_id: "q1", answer: "A" }, { question_id: "q2", answer: "B" }],
}) as Start;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("student save and submission isolation", () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    mocks.restoreImages.mockImplementation(async (_scope, images) => ({ images, conflicts: {}, restored: false, issue: null }));
    mocks.persistImages.mockResolvedValue(null);
    mocks.acknowledgeImages.mockResolvedValue(null);
    mocks.retainImages.mockResolvedValue(null);
    mocks.retainLate.mockResolvedValue(null);
    mocks.save.mockResolvedValue({ answer_count: 1 });
    mocks.submit.mockResolvedValue({ attempt: { submitted_answers_accepted: true } });
  });

  it("saves only changed questions, keeps later edits, and sends explicit clears", async () => {
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted }));
    await act(async () => { await result.current.open(start("a")); });
    act(() => result.current.setAnswer("q1", "first"));
    const pending = deferred<{ answer_count: number }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    let save!: Promise<void>;
    act(() => { save = result.current.saveActiveDraft(); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("a", [{ question_id: "q1", answer: "first", images: [] }]));
    act(() => result.current.setAnswer("q1", "second"));
    await act(async () => { pending.resolve({ answer_count: 1 }); await save; });
    expect(result.current.saveStatus).toBe("dirty");
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("a", [{ question_id: "q1", answer: "second", images: [] }]);
    act(() => result.current.setAnswer("q2", ""));
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("a", [{ question_id: "q2", answer: "", images: [] }]);
  });

  it("retains the full current answer when an older save and submit overlap", async () => {
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(start("a")); });
    act(() => result.current.setAnswer("q1", "old pending"));
    const pending = deferred<{ answer_count: number }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    let save!: Promise<void>;
    act(() => { save = result.current.saveActiveDraft(); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    act(() => result.current.setAnswer("q1", "A"));
    await act(async () => { await result.current.submitActiveAttempt(); });
    expect(mocks.submit).toHaveBeenCalledWith("a", expect.objectContaining({ answers: [
      { question_id: "q1", answer: "A", images: [] }, { question_id: "q2", answer: "B", images: [] },
    ] }));
    await act(async () => { pending.resolve({ answer_count: 1 }); await save; });
    expect(result.current.activeAttempt).toBeNull();
  });

  it("ignores a slower open and a late submission after switching attempts", async () => {
    const slowOpen = deferred<{ images: Record<string, never[]>; conflicts: Record<string, never[]>; restored: boolean; issue: null }>();
    mocks.restoreImages.mockReturnValueOnce(slowOpen.promise);
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted }));
    let oldOpen!: Promise<boolean>;
    act(() => { oldOpen = result.current.open(start("old")); });
    await act(async () => { await result.current.open(start("new")); });
    await act(async () => { slowOpen.resolve({ images: {}, conflicts: {}, restored: false, issue: null }); expect(await oldOpen).toBe(false); });
    expect(result.current.activeAttempt?.id).toBe("new");
    const pending = deferred<{ attempt: { submitted_answers_accepted: boolean } }>();
    mocks.submit.mockReturnValueOnce(pending.promise);
    let submitting!: Promise<void>;
    act(() => { submitting = result.current.submitActiveAttempt(); });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.open(start("third")); });
    await act(async () => { pending.resolve({ attempt: { submitted_answers_accepted: true } }); await submitting; });
    expect(result.current.activeAttempt?.id).toBe("third");
    expect(result.current.answers.q1).toBe("A");
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("forces a fresh save when an earlier request completes after reopening the same attempt", async () => {
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(start("a")); });
    act(() => result.current.setAnswer("q1", "old"));
    const pending = deferred<{ answer_count: number }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    let save!: Promise<void>;
    act(() => { save = result.current.saveActiveDraft(); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.open(start("a")); });
    await act(async () => { pending.resolve({ answer_count: 1 }); await save; });
    expect(result.current.saveStatus).toBe("dirty");
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("a", expect.arrayContaining([
      expect.objectContaining({ question_id: "q1" }), expect.objectContaining({ question_id: "q2" }),
    ]));
  });

  it("retains a late image in the old scope without changing the newly opened paper", async () => {
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(start("a")); });
    const pending = deferred<{ name: string; mime_type: string; data_url: string }>();
    mocks.compress.mockReturnValueOnce(pending.promise);
    const file = new File(["x"], "late.png", { type: "image/png" });
    let imageWork!: Promise<void>;
    act(() => { imageWork = result.current.setQuestionImages("q1", [file] as unknown as FileList); });
    await act(async () => { await result.current.open(start("b")); });
    const image = { name: "late.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" };
    await act(async () => { pending.resolve(image); await imageWork; });
    expect(result.current.activeAttempt?.id).toBe("b");
    expect(result.current.imageAnswers).toEqual({});
    expect(mocks.retainLate).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "a", accountId: "student" }), "q1", [image], [], undefined);
    expect(Object.values(result.current.unconfirmedImages)[0].images.q1).toEqual([image]);
  });

  it("does not expose a prior account's late image after account switching", async () => {
    const { result, rerender } = renderHook(({ account }) => useStudentExam({ user: account, onMessage: vi.fn(), onSubmitted: vi.fn() }), {
      initialProps: { account: { ...user, id: "student" } },
    });
    await act(async () => { await result.current.open(start("a")); });
    const pending = deferred<{ name: string; mime_type: string; data_url: string }>();
    mocks.compress.mockReturnValueOnce(pending.promise);
    let imageWork!: Promise<void>;
    act(() => { imageWork = result.current.setQuestionImages("q1", [new File(["x"], "a.png")] as unknown as FileList); });
    rerender({ account: { ...user, id: "other" } });
    await act(async () => { await result.current.open(start("b")); });
    await act(async () => { pending.resolve({ name: "a.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" }); await imageWork; });
    expect(result.current.activeAttempt?.id).toBe("b");
    expect(result.current.unconfirmedImages).toEqual({});
    expect(mocks.retainLate).toHaveBeenCalledWith(expect.objectContaining({ accountId: "student" }), "q1", expect.any(Array), [], undefined);
    rerender({ account: { ...user, id: "student" } });
    await waitFor(() => expect(Object.values(result.current.unconfirmedImages)[0]?.images.q1).toEqual([
      { name: "a.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" },
    ]));
  });

  it("asks before leaving when text drafts are only in volatile memory", async () => {
    const unavailable = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("storage blocked"); });
    const volatileUser = { ...user, id: "volatile-student" };
    const { result, unmount } = renderHook(() => useStudentExam({ user: volatileUser, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    try {
      await act(async () => { await result.current.open(start("volatile")); });
      act(() => result.current.setAnswer("q1", "keep this"));
      expect(result.current.textDraftIssue).toBe("unavailable");
      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      act(() => { window.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    } finally {
      unmount();
      unavailable.mockRestore();
    }
  });


  it("retries failed saves and includes a first empty paper", async () => {
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    const blank = { ...start("blank"), saved_answers: [] };
    await act(async () => { await result.current.open(blank); });
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("blank", [
      { question_id: "q1", answer: "", images: [] }, { question_id: "q2", answer: "", images: [] },
    ]);
    act(() => result.current.setAnswer("q1", "retry me"));
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(result.current.saveStatus).toBe("error");
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("blank", [{ question_id: "q1", answer: "retry me", images: [] }]);
  });

  it("sends an explicit empty image list when a previously saved image is cleared", async () => {
    const image = { name: "saved.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" };
    const data = { ...start("a"), saved_answers: [{ question_id: "q1", answer: "A", images: [image] }, { question_id: "q2", answer: "B" }] };
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(data); });
    await act(async () => { await result.current.setQuestionImages("q1", null); });
    await act(async () => { await result.current.saveActiveDraft(); });
    expect(mocks.save).toHaveBeenLastCalledWith("a", [{ question_id: "q1", answer: "A", images: [] }]);
  });


  it("retains an image removal made while submission is awaiting confirmation", async () => {
    const image = { name: "saved.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" };
    const data = { ...start("a"), saved_answers: [{ question_id: "q1", answer: "A", images: [image] }, { question_id: "q2", answer: "B" }] };
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(data); });
    const pending = deferred<{ attempt: { submitted_answers_accepted: boolean } }>();
    mocks.submit.mockReturnValueOnce(pending.promise);
    let submitting!: Promise<void>;
    act(() => { submitting = result.current.submitActiveAttempt(); });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.setQuestionImages("q1", null); });
    await act(async () => { pending.resolve({ attempt: { submitted_answers_accepted: true } }); await submitting; });
    expect(Object.values(result.current.unconfirmedImages)[0].images.q1).toEqual([]);
  });

  it("waits for an earlier image operation before restoring the same attempt", async () => {
    const { result } = renderHook(() => useStudentExam({ user, onMessage: vi.fn(), onSubmitted: vi.fn() }));
    await act(async () => { await result.current.open(start("a")); });
    const pending = deferred<{ name: string; mime_type: string; data_url: string }>();
    mocks.compress.mockReturnValueOnce(pending.promise);
    let imageWork!: Promise<void>;
    act(() => { imageWork = result.current.setQuestionImages("q1", [new File(["x"], "a.png")] as unknown as FileList); });
    let reopening!: Promise<boolean>;
    act(() => { reopening = result.current.open(start("a")); });
    expect(mocks.restoreImages).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ name: "a.png", mime_type: "image/png", data_url: "data:image/png;base64,eA==" });
      await imageWork;
      expect(await reopening).toBe(true);
    });
    expect(mocks.restoreImages).toHaveBeenCalledTimes(2);
    expect(mocks.retainLate).toHaveBeenCalledTimes(1);
  });

});
