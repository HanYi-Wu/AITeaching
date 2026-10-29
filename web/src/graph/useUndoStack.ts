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

export const useGraphUndoStore = create<GraphUndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  generation: 0,
  pushFrame: (f) =>
    set(() => ({
      undoStack: [...get().undoStack, f],
      redoStack: [],
    })),
  clear: () => set((state) => ({
    undoStack: [],
    redoStack: [],
    generation: state.generation + 1,
  })),
  undo: async () => {
    const { undoStack, redoStack, generation } = get();
    if (undoStack.length === 0) return;
    const f = undoStack[undoStack.length - 1];
    await f.undo();
    if (get().generation !== generation) return;
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [f, ...redoStack],
    });
  },
  redo: async () => {
    const { undoStack, redoStack, generation } = get();
    if (redoStack.length === 0) return;
    const f = redoStack[0];
    await f.redo();
    if (get().generation !== generation) return;
    set({
      redoStack: redoStack.slice(1),
      undoStack: [...undoStack, f],
    });
  },
}));
