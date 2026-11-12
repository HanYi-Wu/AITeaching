import type { QuestionRow } from "../../../../types/compose";

/**
 * High-performance ID-level delta subscription store for Compose Bank Search selection.
 * Replaces monolithic set/array prop fanout with scoped per-qualified_id subscriptions.
 */
export class BankSelectionStore {
  private _selectedSet: Set<string>;
  private _orderedIds: readonly string[];
  private _anchorId: string | null;
  private _subscribers: Map<string, Set<() => void>>;
  private _globalSubscribers: Set<() => void>;

  constructor(initialIds: string[] = [], initialAnchorId: string | null = null) {
    const orderedIds = [...new Set(initialIds)];
    this._selectedSet = new Set(orderedIds);
    this._orderedIds = Object.freeze(orderedIds);
    this._anchorId = initialAnchorId && this._selectedSet.has(initialAnchorId) ? initialAnchorId : null;
    this._subscribers = new Map();
    this._globalSubscribers = new Set();
  }

  /**
   * Fast boolean check for whether a given question is currently selected.
   * Primitive boolean return guarantees strict reference equality in useSyncExternalStore.
   */
  public isSelected(qid: string): boolean {
    return this._selectedSet.has(qid);
  }

  /**
   * Read-only snapshot of the ordered list of selected qualified_ids.
   * Preserves exact selection order for Compose paper integration and drag & drop.
   */
  public getOrderedIds(): readonly string[] {
    return this._orderedIds;
  }

  /**
   * Current anchor ID for Shift-range selections.
   */
  public getAnchorId(): string | null {
    return this._anchorId;
  }

  /**
   * Total number of currently selected questions.
   */
  public getSelectedCount(): number {
    return this._orderedIds.length;
  }

  /**
   * Subscribe to selection state changes for a specific qualified_id.
   * Listener will ONLY be called when this specific item's selected status toggles.
   */
  public subscribeId(qid: string, listener: () => void): () => void {
    let set = this._subscribers.get(qid);
    if (!set) {
      set = new Set();
      this._subscribers.set(qid, set);
    }
    set.add(listener);

    return () => {
      const current = this._subscribers.get(qid);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this._subscribers.delete(qid);
        }
      }
    };
  }

  /**
   * Subscribe to global list changes (for parent actions, button badges, etc.).
   */
  public subscribeAll(listener: () => void): () => void {
    this._globalSubscribers.add(listener);
    return () => {
      this._globalSubscribers.delete(listener);
    };
  }

  /**
   * Core atomic delta notification mechanism.
   * Computes symmetric difference between previous and next selection,
   * updates state, and notifies ONLY the affected listeners.
   */
  private _applyDiff(nextOrdered: string[], nextAnchorId: string | null): void {
    // Keep array, set, and count snapshots in the same unique order even when
    // a caller supplies duplicate IDs (for example, imported paper slots).
    const orderedIds = [...new Set(nextOrdered)];
    const canonicalSet = new Set(orderedIds);
    const anchorId = nextAnchorId && canonicalSet.has(nextAnchorId) ? nextAnchorId : null;
    const changedQids = new Set<string>();

    for (const id of canonicalSet) {
      if (!this._selectedSet.has(id)) {
        changedQids.add(id);
      }
    }
    for (const id of this._selectedSet) {
      if (!canonicalSet.has(id)) {
        changedQids.add(id);
      }
    }

    const anchorChanged = this._anchorId !== anchorId;
    const orderChanged =
      orderedIds.length !== this._orderedIds.length ||
      orderedIds.some((id, i) => id !== this._orderedIds[i]);

    if (changedQids.size === 0 && !anchorChanged && !orderChanged) {
      return;
    }

    this._selectedSet = canonicalSet;
    this._orderedIds = Object.freeze(orderedIds);
    this._anchorId = anchorId;
    let firstSubscriberError: unknown;
    let didSubscriberError = false;

    // 1. Notify individual changed ID subscribers
    for (const qid of changedQids) {
      const listeners = this._subscribers.get(qid);
      if (listeners && listeners.size > 0) {
        // Copy listener set before iterating to protect against mutation during notification
        const snapshot = Array.from(listeners);
        for (let i = 0; i < snapshot.length; i++) {
          try {
            snapshot[i]();
          } catch (error) {
            if (!didSubscriberError) {
              firstSubscriberError = error;
              didSubscriberError = true;
            }
          }
        }
      }
    }

    // 2. Notify global subscribers if selection, order, or anchor changed
    if (this._globalSubscribers.size > 0 && (changedQids.size > 0 || orderChanged || anchorChanged)) {
      const globalSnapshot = Array.from(this._globalSubscribers);
      for (let i = 0; i < globalSnapshot.length; i++) {
        try {
          globalSnapshot[i]();
        } catch (error) {
          if (!didSubscriberError) {
            firstSubscriberError = error;
            didSubscriberError = true;
          }
        }
      }
    }

    // Preserve error visibility while ensuring one faulty subscriber does not
    // prevent the remaining row and action subscribers from seeing the update.
    if (didSubscriberError) {
      throw firstSubscriberError;
    }
  }

  /**
   * Single selection: replace-one semantics.
   * Selects only qid, clearing previously selected items.
   * Only the previous selection and the new selection are notified.
   */
  public selectSingle(qid: string): void {
    if (this._selectedSet.size === 1 && this._selectedSet.has(qid) && this._anchorId === qid) {
      return;
    }
    const nextOrdered = [qid];
    this._applyDiff(nextOrdered, qid);
  }

  /**
   * Ctrl/Meta multi-selection: toggle-one semantics.
   * If already selected: unselect and remove from ordered list.
   * If unselected: select and append to ordered list.
   * Updates anchor to clicked qid.
   */
  public toggle(qid: string): void {
    const nextSet = new Set<string>(this._selectedSet);
    let nextOrdered: string[];

    if (nextSet.has(qid)) {
      nextSet.delete(qid);
      nextOrdered = this._orderedIds.filter((id) => id !== qid);
    } else {
      nextSet.add(qid);
      nextOrdered = [...this._orderedIds, qid];
    }

    this._applyDiff(nextOrdered, qid);
  }

  /**
   * Shift range selection: replace-range semantics.
   * Computes contiguous range from anchor to clicked item in filteredQuestions.
   * Applies range atomically, notifying only items whose boolean status actually changes.
   */
  public selectRange(
    targetQid: string,
    targetIndex: number,
    filteredQuestions: QuestionRow[],
  ): void {
    const currentAnchorIndex = filteredQuestions.findIndex(
      (row) => row.qualified_id === this._anchorId,
    );
    const anchor = currentAnchorIndex >= 0 ? currentAnchorIndex : targetIndex;
    const start = Math.min(anchor, targetIndex);
    const end = Math.max(anchor, targetIndex);

    const range = filteredQuestions.slice(start, end + 1).map((x) => x.qualified_id);
    this._applyDiff(range, targetQid);
  }

  /**
   * Prune filtered: removes any selected IDs that are no longer in validQids.
   * Preserves anchor if still valid.
   */
  public pruneFiltered(validQids: Set<string>): void {
    let hasInvalid = false;
    for (const id of this._selectedSet) {
      if (!validQids.has(id)) {
        hasInvalid = true;
        break;
      }
    }
    if (!hasInvalid) {
      return;
    }

    const nextOrdered: string[] = [];
    for (const id of this._orderedIds) {
      if (validQids.has(id)) {
        nextOrdered.push(id);
      }
    }

    const nextAnchor = this._anchorId && validQids.has(this._anchorId) ? this._anchorId : null;
    this._applyDiff(nextOrdered, nextAnchor);
  }

  /**
   * External batch set: replaces selection with provided IDs (e.g. from right paper slot click).
   */
  public setSelectedIds(ids: string[], anchorId?: string | null): void {
    const nextOrdered = [...new Set(ids)];
    const nextAnchor = anchorId !== undefined ? anchorId : nextOrdered.length > 0 ? nextOrdered[nextOrdered.length - 1] : null;
    this._applyDiff(nextOrdered, nextAnchor);
  }

  /**
   * Clear all selections.
   */
  public clear(): void {
    if (this._selectedSet.size === 0 && this._anchorId === null) {
      return;
    }
    this._applyDiff([], null);
  }

  /**
   * Total number of active subscribers (useful for diagnostics & memory leak tests).
   */
  public getSubscriberCount(): number {
    let total = 0;
    for (const set of this._subscribers.values()) {
      total += set.size;
    }
    return total + this._globalSubscribers.size;
  }
}
