import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeDraftScope, TemplateRow } from "../../types/compose";
import { buildComposeDraftStorageKey, readScopedComposeDraft, writeScopedComposeDraft } from "./composeDraftStorage";
import { createEmptyPaperState } from "./composeModel";
import { useComposePaperHistory } from "./useComposePaperHistory";

const templates: TemplateRow[] = [{ id: "math", path: "templates/math.yaml", layout: "single_column", sections: [{ section_id: "choice", type: "single_choice", required_count: 2, score_per_item: 5 }] }];
const scope: ComposeDraftScope = { accountId: "a", projectRoot: "C:/project", paperKey: "exam:Quiz/Math" };
const props = (nextScope = scope) => ({ scope: nextScope, storageKey: buildComposeDraftStorageKey(nextScope), ownerKey: `${nextScope.accountId}::${nextScope.projectRoot}` });
const options = { initialExportLabel: "Quiz", initialSubject: "Math", templates, shortcutsEnabled: true };
const mount = () => renderHook((input) => useComposePaperHistory({ ...options, ...input }), { initialProps: props() });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("paper history and recovery integration", () => {
  it("undoes and redoes one atomic edit and writes a recoverable snapshot", () => {
    const { result } = mount();
    act(() => result.current.commitEdit((previous) => ({ ...previous, bySection: { choice: ["q1"] }, scoreOverrides: { choice: { q1: 3 } } })));
    expect(result.current.canUndo).toBe(true);
    act(() => vi.advanceTimersByTime(350));
    expect(readScopedComposeDraft(scope).record?.paper.bySection.choice).toEqual(["q1"]);
    act(() => result.current.undo());
    expect(result.current.paperState.bySection.choice).toEqual([]);
    act(() => result.current.redo());
    expect(result.current.paperState.scoreOverrides).toEqual({ choice: { q1: 3 } });
  });

  it("offers explicit restore and retains an undo step back to the saved paper", () => {
    writeScopedComposeDraft(scope, createEmptyPaperState({ templatePath: templates[0]!.path, templateRef: "math", bySection: { choice: ["q1"] }, exportLabel: "Recovered", subject: "Math" }));
    const { result } = mount();
    expect(result.current.paperState.bySection.choice).toEqual([]);
    expect(result.current.recoverableDraft).not.toBeNull();
    act(() => result.current.restoreLocalDraft());
    expect(result.current.paperState.bySection.choice).toEqual(["q1"]);
    act(() => result.current.undo());
    expect(result.current.paperState.bySection.choice).toEqual([]);
  });

  it.each([{ ...scope, accountId: "b" }, { ...scope, projectRoot: "C:/other" }])("resets history and prevents draft writes across identity scopes", (other) => {
    const { result, rerender } = mount();
    act(() => result.current.commitEdit((previous) => ({ ...previous, exportLabel: "Private", bySection: { choice: ["q1"] } })));
    act(() => vi.advanceTimersByTime(350));
    rerender(props(other));
    expect(result.current.paperState.exportLabel).toBe("Quiz");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.recoverableDraft).toBeNull();
    act(() => vi.advanceTimersByTime(350));
    expect(readScopedComposeDraft(other).record).toBeNull();
    expect(readScopedComposeDraft(scope).record?.paper.exportLabel).toBe("Private");
  });

  it("preserves edits made during a server save, including their recovery record", () => {
    const { result } = mount();
    const submitted = result.current.paperState;
    act(() => result.current.commitEdit((previous) => ({ ...previous, bySection: { choice: ["q1"] } })));
    act(() => result.current.acceptSavedState(submitted, submitted));
    expect(result.current.paperState.bySection.choice).toEqual(["q1"]);
    expect(result.current.isDirty).toBe(true);
    expect(readScopedComposeDraft(scope).record?.paper.bySection.choice).toEqual(["q1"]);
  });

  it("moves unsaved edits to the server-assigned paper scope after first save", () => {
    const { result, rerender } = mount();
    const submitted = result.current.paperState;
    const target = { ...scope, paperKey: "exam:Renamed/Math" };
    act(() => result.current.commitEdit((previous) => ({ ...previous, bySection: { choice: ["q1"] } })));
    act(() => result.current.acceptSavedState(submitted, submitted, target));
    rerender(props(target));
    expect(result.current.paperState.bySection.choice).toEqual(["q1"]);
    expect(readScopedComposeDraft(target).record?.paper.bySection.choice).toEqual(["q1"]);
    expect(readScopedComposeDraft(scope).record).toBeNull();
  });

  it("does not overwrite a pending recovery choice when editing or leaving", () => {
    const old = createEmptyPaperState({ exportLabel: "Recovery first" });
    writeScopedComposeDraft(scope, old);
    const { result, unmount } = mount();
    act(() => result.current.commitEdit((previous) => ({ ...previous, exportLabel: "New edits" })));
    act(() => vi.advanceTimersByTime(350));
    unmount();
    expect(readScopedComposeDraft(scope).record?.paper.exportLabel).toBe("Recovery first");
  });

  it("ignores undo in inputs and during IME, and handles it on the workspace", () => {
    const { result } = mount();
    act(() => result.current.commitEdit((previous) => ({ ...previous, exportLabel: "Changed" })));
    const input = document.createElement("input"); document.body.append(input); input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    expect(result.current.paperState.exportLabel).toBe("Changed");
    input.remove();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, isComposing: true })));
    expect(result.current.paperState.exportLabel).toBe("Changed");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true })));
    expect(result.current.paperState.exportLabel).toBe("Quiz");
  });
});
