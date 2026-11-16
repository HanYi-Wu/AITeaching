import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphUndoStore, type UndoRedoFrame } from "../useUndoStack";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function frame(
  undo: () => Promise<void> = async () => undefined,
  redo: () => Promise<void> = async () => undefined,
): UndoRedoFrame {
  return { undo, redo };
}

describe("graph undo history", () => {
  beforeEach(() => {
    useGraphUndoStore.getState().clear();
  });

  it("serializes parallel undo and redo calls against the latest frame", async () => {
    const firstUndo = deferred<void>();
    const events: string[] = [];
    const older = frame(
      async () => { events.push("undo older"); },
      async () => { events.push("redo older"); },
    );
    const newer = frame(
      () => { events.push("undo newer"); return firstUndo.promise; },
      async () => { events.push("redo newer"); },
    );
    useGraphUndoStore.getState().pushFrame(older);
    useGraphUndoStore.getState().pushFrame(newer);

    const undoNewest = useGraphUndoStore.getState().undo();
    const undoNext = useGraphUndoStore.getState().undo();
    await Promise.resolve();
    expect(events).toEqual(["undo newer"]);

    firstUndo.resolve();
    await Promise.all([undoNewest, undoNext]);
    expect(events).toEqual(["undo newer", "undo older"]);
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([older, newer]);

    await Promise.all([
      useGraphUndoStore.getState().redo(),
      useGraphUndoStore.getState().redo(),
    ]);
    expect(events).toEqual([
      "undo newer",
      "undo older",
      "redo older",
      "redo newer",
    ]);
    expect(useGraphUndoStore.getState().undoStack).toEqual([older, newer]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([]);
  });

  it("preserves an edit pushed while undo is waiting", async () => {
    const undoCall = deferred<void>();
    const oldEdit = frame(() => undoCall.promise);
    const newEditUndo = vi.fn(async () => undefined);
    const newEdit = frame(newEditUndo);
    useGraphUndoStore.getState().pushFrame(oldEdit);

    const pendingUndo = useGraphUndoStore.getState().undo();
    await Promise.resolve();
    useGraphUndoStore.getState().pushFrame(newEdit);
    undoCall.resolve();
    await pendingUndo;

    expect(useGraphUndoStore.getState().undoStack).toEqual([newEdit]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([]);

    await useGraphUndoStore.getState().undo();
    expect(newEditUndo).toHaveBeenCalledOnce();
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([newEdit]);
  });

  it("inserts a redone frame before edits pushed while redo is waiting", async () => {
    const redoCall = deferred<void>();
    const redone = frame(async () => undefined, () => redoCall.promise);
    const newerEdit = frame();
    useGraphUndoStore.getState().pushFrame(redone);
    await useGraphUndoStore.getState().undo();

    const pendingRedo = useGraphUndoStore.getState().redo();
    await Promise.resolve();
    useGraphUndoStore.getState().pushFrame(newerEdit);
    redoCall.resolve();
    await pendingRedo;

    expect(useGraphUndoStore.getState().undoStack).toEqual([redone, newerEdit]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([]);
  });

  it("isolates a cleared graph and lets the next graph use undo immediately", async () => {
    const oldUndoCall = deferred<void>();
    const staleQueuedUndo = vi.fn(async () => undefined);
    const oldFrame = frame(() => oldUndoCall.promise);
    const staleFrame = frame(staleQueuedUndo);
    useGraphUndoStore.getState().pushFrame(staleFrame);
    useGraphUndoStore.getState().pushFrame(oldFrame);

    const pendingOldUndo = useGraphUndoStore.getState().undo();
    const queuedOldUndo = useGraphUndoStore.getState().undo();
    await Promise.resolve();
    expect(staleQueuedUndo).not.toHaveBeenCalled();

    useGraphUndoStore.getState().clear();
    const newGraphUndo = vi.fn(async () => undefined);
    const newGraphFrame = frame(newGraphUndo);
    useGraphUndoStore.getState().pushFrame(newGraphFrame);
    await useGraphUndoStore.getState().undo();
    expect(newGraphUndo).toHaveBeenCalledOnce();
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([newGraphFrame]);

    oldUndoCall.resolve();
    await Promise.all([pendingOldUndo, queuedOldUndo]);
    expect(staleQueuedUndo).not.toHaveBeenCalled();
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([newGraphFrame]);
  });

  it("propagates callback failures and keeps the queue usable", async () => {
    const failure = new Error("undo failed");
    const failed = frame(async () => { throw failure; });
    const recoveredUndo = vi.fn(async () => undefined);
    const recovered = frame(recoveredUndo);
    useGraphUndoStore.getState().pushFrame(failed);

    await expect(useGraphUndoStore.getState().undo()).rejects.toBe(failure);
    expect(useGraphUndoStore.getState().undoStack).toEqual([failed]);

    useGraphUndoStore.getState().pushFrame(recovered);
    await useGraphUndoStore.getState().undo();
    expect(recoveredUndo).toHaveBeenCalledOnce();
    expect(useGraphUndoStore.getState().undoStack).toEqual([failed]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([recovered]);
  });

  it("propagates redo failures without consuming the redo frame", async () => {
    const failure = new Error("redo failed");
    const failedRedo = frame(async () => undefined, async () => { throw failure; });
    useGraphUndoStore.getState().pushFrame(failedRedo);
    await useGraphUndoStore.getState().undo();

    await expect(useGraphUndoStore.getState().redo()).rejects.toBe(failure);
    expect(useGraphUndoStore.getState().undoStack).toEqual([]);
    expect(useGraphUndoStore.getState().redoStack).toEqual([failedRedo]);
  });
});
