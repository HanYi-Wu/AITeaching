import { useCallback, useRef, useSyncExternalStore } from "react";
import { BankSelectionStore } from "./BankSelectionStore";

/**
 * Hook to subscribe to an individual question's selection status.
 * Guarantees zero re-renders unless this specific item's boolean state toggles.
 */
export function useRowSelection(store: BankSelectionStore, qid: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => store.subscribeId(qid, callback),
    [store, qid],
  );
  const getSnapshot = useCallback(() => store.isSelected(qid), [store, qid]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to read the full ordered selected IDs array.
 * Subscribes to global list mutations.
 */
export function useSelectedBankIds(store: BankSelectionStore): readonly string[] {
  const subscribe = useCallback(
    (callback: () => void) => store.subscribeAll(callback),
    [store],
  );
  const getSnapshot = useCallback(() => store.getOrderedIds(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to instantiate and manage a stable BankSelectionStore instance.
 */
export function useBankSelectionStore(initialIds?: string[]): BankSelectionStore {
  const storeRef = useRef<BankSelectionStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new BankSelectionStore(initialIds);
  }
  return storeRef.current;
}
