/**
 * Command pattern: undo / redo stacks for graph operations (mind map shortcuts).
 */
import { create } from "zustand";

export type UndoRedoFrame = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

type GraphUndoState = {
  undoStack: UndoRedoFrame[];
  redoStack: UndoRedoFrame[];
  generation: number;
  pushFrame: (f: UndoRedoFrame) => void;
  clear: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

// Undo and redo callbacks can cross an async persistence boundary. Serialize the
// history operations so parallel keyboard events always consume the latest
// frame, while edits can still append frames during an operation.
let operationQueue: Promise<void> = Promise.resolve();
let framePushVersion = 0;

function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation);
  // A failed callback must reject its caller without poisoning later actions.
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export const useGraphUndoStore = create<GraphUndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  generation: 0,
  pushFrame: (f) => {
    framePushVersion += 1;
    set((state) => ({
      undoStack: [...state.undoStack, f],
      redoStack: [],
    }));
  },
  clear: () => {
    // Let the new graph use its own queue even if an old graph callback is
    // still awaiting I/O. Old operations carry the previous generation and
    // therefore cannot update the new graph's stacks when they finish.
    operationQueue = Promise.resolve();
    set((state) => ({
      undoStack: [],
      redoStack: [],
      generation: state.generation + 1,
    }));
  },
  undo: () => {
    const generation = get().generation;
    return enqueueOperation(async () => {
      if (get().generation !== generation) return;
      const undoStack = get().undoStack;
      const frameIndex = undoStack.length - 1;
      if (frameIndex < 0) return;
      const frame = undoStack[frameIndex];
      const initialPushVersion = framePushVersion;

      await frame.undo();
      if (get().generation !== generation) return;
      set((current) => {
        // pushFrame may have appended a completed edit while undo was waiting.
        // Remove the original frame at its captured position and preserve those
        // newer frames and any current redo history.
        if (
          current.generation !== generation ||
          current.undoStack[frameIndex] !== frame
        ) {
          return current;
        }
        const nextUndoStack = current.undoStack.slice();
        nextUndoStack.splice(frameIndex, 1);
        const branchedDuringUndo = framePushVersion !== initialPushVersion;
        return {
          undoStack: nextUndoStack,
          redoStack: branchedDuringUndo ? [] : [frame, ...current.redoStack],
        };
      });
    });
  },
  redo: () => {
    const generation = get().generation;
    return enqueueOperation(async () => {
      if (get().generation !== generation) return;
      const initialUndoStack = get().undoStack;
      const initialRedoStack = get().redoStack;
      const frame = initialRedoStack[0];
      if (!frame) return;

      await frame.redo();
      if (get().generation !== generation) return;
      set((current) => {
        if (current.generation !== generation) return current;
        // New edits append while redo is waiting. Keep their order after the
        // redone frame so the next undo still reverses the newest edit first.
        for (let index = 0; index < initialUndoStack.length; index += 1) {
          if (current.undoStack[index] !== initialUndoStack[index]) return current;
        }
        const nextUndoStack = current.undoStack.slice();
        nextUndoStack.splice(initialUndoStack.length, 0, frame);
        const nextRedoStack = current.redoStack[0] === frame
          ? current.redoStack.slice(1)
          : current.redoStack;
        return { undoStack: nextUndoStack, redoStack: nextRedoStack };
      });
    });
  },
}));
