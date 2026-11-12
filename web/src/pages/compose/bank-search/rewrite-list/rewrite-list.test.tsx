import { act, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestI18n, TestI18nProvider } from "../../../../test/i18nTestUtils";
import type { QuestionRow } from "../../../../types/compose";
import { ComposeBankActionBar } from "../../ComposeBankSearchPanel";
import { BankSelectionStore } from "./BankSelectionStore";
import { BankQuestionList } from "./BankQuestionList";

function createSyntheticQuestions(count: number): QuestionRow[] {
  return Array.from({ length: count }, (_, i) => {
    const qid = `math/algebra/q_${String(i + 1).padStart(4, "0")}`;
    return {
      id: `q_${i + 1}`,
      qualified_id: qid,
      namespace: "algebra",
      collection: "algebra",
      subject: "数学",
      type: i % 4 === 0 ? "single_choice" : i % 4 === 1 ? "multiple_choice" : i % 4 === 2 ? "group" : "fill_in_the_blank",
      answer: "A",
      content_preview: `题目 ${i + 1}：已知 $f(x) = x^${(i % 5) + 1} + ${(i % 3) + 1}$，求导数。`,
      content: `题目 ${i + 1}：已知 $f(x) = x^${(i % 5) + 1} + ${(i % 3) + 1}$，求导数。`,
      analysis: `解析：根据基本求导法则。`,
      metadata: i % 2 === 0 ? { difficulty: "medium", year: "2024" } : { difficulty: "hard" },
    };
  });
}

describe("BankSelectionStore pure model", () => {
  it("initializes empty and supports single selection with scoped notifications", () => {
    const store = new BankSelectionStore();
    expect(store.getOrderedIds()).toEqual([]);
    expect(store.getAnchorId()).toBeNull();
    expect(store.getSelectedCount()).toBe(0);

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const globalListener = vi.fn();

    const unsubA = store.subscribeId("math/q1", listenerA);
    const unsubB = store.subscribeId("math/q2", listenerB);
    const unsubGlobal = store.subscribeAll(globalListener);

    // Select q1
    store.selectSingle("math/q1");
    expect(store.isSelected("math/q1")).toBe(true);
    expect(store.isSelected("math/q2")).toBe(false);
    expect(store.getOrderedIds()).toEqual(["math/q1"]);
    expect(store.getAnchorId()).toBe("math/q1");
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(0);
    expect(globalListener).toHaveBeenCalledTimes(1);

    // Select q2 (should notify q1: true->false and q2: false->true)
    store.selectSingle("math/q2");
    expect(store.isSelected("math/q1")).toBe(false);
    expect(store.isSelected("math/q2")).toBe(true);
    expect(store.getOrderedIds()).toEqual(["math/q2"]);
    expect(store.getAnchorId()).toBe("math/q2");
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(globalListener).toHaveBeenCalledTimes(2);

    // Re-select q2 (no-op: 0 notifications)
    store.selectSingle("math/q2");
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(globalListener).toHaveBeenCalledTimes(2);

    unsubA();
    unsubB();
    unsubGlobal();
  });

  it("deduplicates imported IDs and keeps the ordered list, set, and count aligned", () => {
    const store = new BankSelectionStore(["math/q1", "math/q1", "math/q2"], "math/q1");
    expect(store.getOrderedIds()).toEqual(["math/q1", "math/q2"]);
    expect(store.getSelectedCount()).toBe(2);
    expect(store.isSelected("math/q1")).toBe(true);
    expect(store.isSelected("math/q2")).toBe(true);

    store.setSelectedIds(["math/q2", "math/q2", "math/q3", "math/q2"], "missing/qid");
    expect(store.getOrderedIds()).toEqual(["math/q2", "math/q3"]);
    expect(store.getSelectedCount()).toBe(2);
    expect(store.getAnchorId()).toBeNull();
    expect(store.isSelected("math/q1")).toBe(false);
    expect(store.isSelected("math/q3")).toBe(true);
  });

  it("notifies remaining row and action subscribers if a subscriber throws", () => {
    const store = new BankSelectionStore();
    const secondRowListener = vi.fn();
    const globalListener = vi.fn();
    store.subscribeId("math/q1", () => { throw new Error("subscriber failure"); });
    store.subscribeId("math/q1", secondRowListener);
    store.subscribeAll(globalListener);

    expect(() => store.selectSingle("math/q1")).toThrow("subscriber failure");
    expect(secondRowListener).toHaveBeenCalledTimes(1);
    expect(globalListener).toHaveBeenCalledTimes(1);
    expect(store.getOrderedIds()).toEqual(["math/q1"]);
  });

  it("handles Ctrl/Meta toggle selection and preserves insertion order", () => {
    const store = new BankSelectionStore();
    const l1 = vi.fn();
    const l2 = vi.fn();
    const l3 = vi.fn();

    store.subscribeId("math/q1", l1);
    store.subscribeId("math/q2", l2);
    store.subscribeId("math/q3", l3);

    store.toggle("math/q2");
    expect(store.getOrderedIds()).toEqual(["math/q2"]);
    expect(store.getAnchorId()).toBe("math/q2");
    expect(l2).toHaveBeenCalledTimes(1);
    expect(l1).toHaveBeenCalledTimes(0);

    store.toggle("math/q1");
    expect(store.getOrderedIds()).toEqual(["math/q2", "math/q1"]);
    expect(store.getAnchorId()).toBe("math/q1");
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);

    // Toggle off q2
    store.toggle("math/q2");
    expect(store.getOrderedIds()).toEqual(["math/q1"]);
    expect(l2).toHaveBeenCalledTimes(2);
    expect(l1).toHaveBeenCalledTimes(1);

    // Re-select q2 (appended after q1)
    store.toggle("math/q2");
    expect(store.getOrderedIds()).toEqual(["math/q1", "math/q2"]);
    expect(l2).toHaveBeenCalledTimes(3);
  });

  it("handles Shift range forward and backward with batch notification", () => {
    const questions = createSyntheticQuestions(10);
    const store = new BankSelectionStore();
    const listeners = questions.map((q) => {
      const fn = vi.fn();
      store.subscribeId(q.qualified_id, fn);
      return fn;
    });

    // Anchor at index 2 (q_0003)
    store.selectSingle(questions[2].qualified_id);
    expect(listeners[2]).toHaveBeenCalledTimes(1);
    expect(store.getAnchorId()).toBe(questions[2].qualified_id);

    // Shift click index 5 (q_0006) -> selects indices 2, 3, 4, 5
    store.selectRange(questions[5].qualified_id, 5, questions);
    expect(store.getOrderedIds()).toEqual([
      questions[2].qualified_id,
      questions[3].qualified_id,
      questions[4].qualified_id,
      questions[5].qualified_id,
    ]);
    expect(store.getAnchorId()).toBe(questions[5].qualified_id);

    // Index 2 was already selected! So index 2 boolean did not change!
    // Only indices 3, 4, 5 changed from false -> true.
    expect(listeners[2]).toHaveBeenCalledTimes(1);
    expect(listeners[3]).toHaveBeenCalledTimes(1);
    expect(listeners[4]).toHaveBeenCalledTimes(1);
    expect(listeners[5]).toHaveBeenCalledTimes(1);
    expect(listeners[0]).toHaveBeenCalledTimes(0);
    expect(listeners[6]).toHaveBeenCalledTimes(0);

    // Consecutive Shift click from new anchor (index 5) backwards to index 3
    // Selects range index 3 to index 5
    // Previously selected: 2, 3, 4, 5. New: 3, 4, 5.
    // Index 2 toggles: true -> false. Indices 3, 4, 5: unchanged!
    store.selectRange(questions[3].qualified_id, 3, questions);
    expect(store.getOrderedIds()).toEqual([
      questions[3].qualified_id,
      questions[4].qualified_id,
      questions[5].qualified_id,
    ]);
    expect(listeners[2]).toHaveBeenCalledTimes(2); // was true, now false
    expect(listeners[3]).toHaveBeenCalledTimes(1); // stayed true
    expect(listeners[4]).toHaveBeenCalledTimes(1); // stayed true
    expect(listeners[5]).toHaveBeenCalledTimes(1); // stayed true
  });

  it("notifies global listeners when external reordering occurs without spurious row updates", () => {
    const store = new BankSelectionStore(["q1", "q2"]);
    const l1 = vi.fn();
    const l2 = vi.fn();
    const globalListener = vi.fn();

    store.subscribeId("q1", l1);
    store.subscribeId("q2", l2);
    store.subscribeAll(globalListener);

    // Reorder: ["q2", "q1"]
    store.setSelectedIds(["q2", "q1"]);
    expect(store.getOrderedIds()).toEqual(["q2", "q1"]);
    // Global listener notified of new ordered snapshot
    expect(globalListener).toHaveBeenCalledTimes(1);
    // Row selection booleans did NOT change (both remain true), so 0 row notifications!
    expect(l1).toHaveBeenCalledTimes(0);
    expect(l2).toHaveBeenCalledTimes(0);
  });

  it("prunes invalid selections when filtering without resurrecting old selections", () => {
    const store = new BankSelectionStore(["q1", "q2", "q3"], "q2");
    const l1 = vi.fn();
    const l2 = vi.fn();
    const l3 = vi.fn();
    store.subscribeId("q1", l1);
    store.subscribeId("q2", l2);
    store.subscribeId("q3", l3);

    // Filter allows only q2 and q4
    store.pruneFiltered(new Set(["q2", "q4"]));
    expect(store.getOrderedIds()).toEqual(["q2"]);
    expect(store.getAnchorId()).toBe("q2");
    expect(l1).toHaveBeenCalledTimes(1); // pruned
    expect(l2).toHaveBeenCalledTimes(0); // kept
    expect(l3).toHaveBeenCalledTimes(1); // pruned

    // Filter restored to allow q1, q2, q3 -> old selections must NOT resurrect!
    store.pruneFiltered(new Set(["q1", "q2", "q3"]));
    expect(store.getOrderedIds()).toEqual(["q2"]);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l3).toHaveBeenCalledTimes(1);
  });

  it("handles anchor filtered out by falling back to current clicked item", () => {
    const questions = createSyntheticQuestions(5);
    const store = new BankSelectionStore(["math/algebra/q_0001"], "math/algebra/q_0001");
    // Filter questions so anchor q_0001 is missing:
    const filtered = questions.slice(2); // q_0003, q_0004, q_0005
    // Shift click on q_0004 (index 1 of filtered)
    store.selectRange(filtered[1].qualified_id, 1, filtered);
    // Anchor was not found in filtered, so start = 1, end = 1 -> only q_0004 selected
    expect(store.getOrderedIds()).toEqual([filtered[1].qualified_id]);
    expect(store.getAnchorId()).toBe(filtered[1].qualified_id);
  });
});

describe("BankQuestionList and BankQuestionRow Component Integration", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  it("renders 100 complete DOM rows with accessibility buttons, KaTeX previews, and metadata", () => {
    const questions = createSyntheticQuestions(100);
    const store = new BankSelectionStore();
    const onRowClick = vi.fn();

    const { container } = render(
      <TestI18nProvider>
        <BankQuestionList
          contentSyncing={false}
          totalQuestionCount={100}
          filteredQuestions={questions}
          store={store}
          onLeftBankClick={onRowClick}
        />
      </TestI18nProvider>,
    );

    const buttons = container.querySelectorAll('button[draggable="true"]');
    expect(buttons).toHaveLength(100);

    const spans = container.querySelectorAll('button[draggable="true"] span[data-question-id]');
    expect(spans).toHaveLength(100);

    // Verify first row contents
    expect(buttons[0]).toHaveTextContent("math/algebra/q_0001");
    expect(buttons[0]).toHaveTextContent("题目 1：");
    expect(buttons[0]).toHaveTextContent("difficulty:medium");
    expect(buttons[0]).toHaveTextContent("year:2024");
  });

  it("updates the bank action count without rerendering its owner", () => {
    const store = new BankSelectionStore();
    let ownerRenderCount = 0;

    function Owner() {
      ownerRenderCount += 1;
      return (
        <ComposeBankActionBar
          store={store}
          disabled={false}
          onAdd={vi.fn()}
          onFill={vi.fn()}
          onEditPaper={vi.fn()}
        />
      );
    }

    const { container } = render(
      <TestI18nProvider>
        <Owner />
      </TestI18nProvider>,
    );
    expect(ownerRenderCount).toBe(1);
    expect(container.querySelector(".or-g49-bank-actions")!).toHaveTextContent("（0）");

    act(() => store.selectSingle("math/q1"));
    expect(container.querySelector(".or-g49-bank-actions")!).toHaveTextContent("（1）");
    expect(ownerRenderCount).toBe(1);
  });

  it("verifies scoped re-renders: only clicked rows re-render during single selection", async () => {
    const questions = createSyntheticQuestions(20);
    const store = new BankSelectionStore();
    const renderCounts = new Map<string, number>();

    const onRowClick = (q: QuestionRow, index: number, e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (e.shiftKey) {
        store.selectRange(q.qualified_id, index, questions);
      } else if (e.ctrlKey || e.metaKey) {
        store.toggle(q.qualified_id);
      } else {
        store.selectSingle(q.qualified_id);
      }
    };

    const { container } = render(
      <TestI18nProvider>
        <BankQuestionList
          contentSyncing={false}
          totalQuestionCount={20}
          filteredQuestions={questions}
          store={store}
          onLeftBankClick={onRowClick}
          onRender={(qid) => renderCounts.set(qid, (renderCounts.get(qid) ?? 0) + 1)}
        />
      </TestI18nProvider>,
    );

    // Initial mount: every row rendered once
    expect(renderCounts.size).toBe(20);
    for (const count of renderCounts.values()) {
      expect(count).toBe(1);
    }

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[draggable="true"]');

    // 1. Single click on Row 2 (index 1)
    renderCounts.clear();
    await userEvent.click(buttons[1]);

    // Row 2 should have selected class
    expect(buttons[1]).toHaveClass("border-[var(--or-primary)]");
    // Only Row 2 re-rendered!
    expect(renderCounts.get(questions[1].qualified_id)).toBe(1);
    expect(renderCounts.size).toBe(1);

    // 2. Single click on Row 5 (index 4)
    renderCounts.clear();
    await userEvent.click(buttons[4]);

    expect(buttons[4]).toHaveClass("border-[var(--or-primary)]");
    expect(buttons[1]).not.toHaveClass("border-[var(--or-primary)]");

    // Only Row 2 (true->false) and Row 5 (false->true) re-rendered!
    expect(renderCounts.size).toBe(2);
    expect(renderCounts.get(questions[1].qualified_id)).toBe(1);
    expect(renderCounts.get(questions[4].qualified_id)).toBe(1);

    // 3. Ctrl+Click on Row 7 (index 6)
    renderCounts.clear();
    fireEvent.click(buttons[6], { ctrlKey: true });

    expect(buttons[4]).toHaveClass("border-[var(--or-primary)]");
    expect(buttons[6]).toHaveClass("border-[var(--or-primary)]");
    // Only Row 7 re-rendered!
    expect(renderCounts.size).toBe(1);
    expect(renderCounts.get(questions[6].qualified_id)).toBe(1);

    // 4. Shift+Click from Row 7 to Row 10 (index 9)
    renderCounts.clear();
    fireEvent.click(buttons[9], { shiftKey: true });

    // Range indices 6..9 should be selected
    for (let i = 6; i <= 9; i++) {
      expect(buttons[i]).toHaveClass("border-[var(--or-primary)]");
    }
    // Row 4 was previously selected outside the range, so it is unselected!
    expect(buttons[4]).not.toHaveClass("border-[var(--or-primary)]");

    // Unaffected rows (e.g. index 0, 1, 2, 3, 5, 11..19) did NOT re-render!
    expect(renderCounts.has(questions[0].qualified_id)).toBe(false);
    expect(renderCounts.has(questions[2].qualified_id)).toBe(false);
    expect(renderCounts.has(questions[15].qualified_id)).toBe(false);
  });

  it("produces correct MIME drag payload for single, multi, and unselected rows", () => {
    const questions = createSyntheticQuestions(5);
    const store = new BankSelectionStore();
    const onRowClick = vi.fn();

    const { container } = render(
      <TestI18nProvider>
        <BankQuestionList
          contentSyncing={false}
          totalQuestionCount={5}
          filteredQuestions={questions}
          store={store}
          onLeftBankClick={onRowClick}
        />
      </TestI18nProvider>,
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[draggable="true"]');

    // Drag unselected Row 1: payload contains ONLY Row 1
    const setData1 = vi.fn();
    fireEvent.dragStart(buttons[0], {
      dataTransfer: { setData: setData1 },
    });
    expect(setData1).toHaveBeenCalledWith(
      "application/x-originreach-bank-qids",
      JSON.stringify([questions[0].qualified_id]),
    );

    // Select Row 2 and Row 4
    act(() => {
      store.setSelectedIds([questions[1].qualified_id, questions[3].qualified_id]);
    });

    // Drag selected Row 2: payload contains ALL selected items in order
    const setData2 = vi.fn();
    fireEvent.dragStart(buttons[1], {
      dataTransfer: { setData: setData2 },
    });
    expect(setData2).toHaveBeenCalledWith(
      "application/x-originreach-bank-qids",
      JSON.stringify([questions[1].qualified_id, questions[3].qualified_id]),
    );

    // Drag unselected Row 3: payload contains ONLY Row 3
    const setData3 = vi.fn();
    fireEvent.dragStart(buttons[2], {
      dataTransfer: { setData: setData3 },
    });
    expect(setData3).toHaveBeenCalledWith(
      "application/x-originreach-bank-qids",
      JSON.stringify([questions[2].qualified_id]),
    );
  });

  it("supports keyboard Tab and Enter navigation on row buttons", async () => {
    const questions = createSyntheticQuestions(3);
    const store = new BankSelectionStore();
    const onRowClick = vi.fn();

    const { container } = render(
      <TestI18nProvider>
        <BankQuestionList
          contentSyncing={false}
          totalQuestionCount={3}
          filteredQuestions={questions}
          store={store}
          onLeftBankClick={onRowClick}
        />
      </TestI18nProvider>,
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[draggable="true"]');
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(questions[0], 0, expect.anything());

    // Tab through child hover details to next button
    await userEvent.tab();
    await userEvent.tab();
    expect(buttons[1]).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(questions[1], 1, expect.anything());
  });

  it("releases subscriptions on unmount without memory leaks or stale listeners", () => {
    const questions = createSyntheticQuestions(5);
    const store = new BankSelectionStore();
    expect(store.getSubscriberCount()).toBe(0);

    const { unmount } = render(
      <TestI18nProvider>
        <BankQuestionList
          contentSyncing={false}
          totalQuestionCount={5}
          filteredQuestions={questions}
          store={store}
          onLeftBankClick={vi.fn()}
        />
      </TestI18nProvider>,
    );

    // 5 rows subscribed
    expect(store.getSubscriberCount()).toBe(5);

    unmount();
    // After unmount, all subscriptions must be cleaned up!
    expect(store.getSubscriberCount()).toBe(0);
  });
});
