/**
 * Merge the inclusive range between an anchor and a target in the current
 * visible order, preserving existing selections and their order.
 */
export function rangeSelection(
  currentSelection: readonly string[],
  visibleIds: readonly string[],
  anchorId: string | null | undefined,
  targetId: string,
): string[] {
  if (!targetId) return [...currentSelection];
  const from = anchorId ? visibleIds.indexOf(anchorId) : -1;
  const to = visibleIds.indexOf(targetId);
  if (from < 0 || to < 0) return [targetId];

  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const result: string[] = [];
  const selected = new Set<string>();
  for (const id of currentSelection) {
    if (id && !selected.has(id)) {
      selected.add(id);
      result.push(id);
    }
  }
  for (const id of visibleIds.slice(start, end + 1)) {
    if (id && !selected.has(id)) {
      selected.add(id);
      result.push(id);
    }
  }
  return result;
}

export function isShiftSpace(event: { key: string; shiftKey: boolean; repeat?: boolean }): boolean {
  return event.shiftKey && !event.repeat && (event.key === " " || event.key === "Spacebar" || event.key === "Space");
}

/** Apply a desired selection through a toggle-only callback. */
export function applySelectionDelta(
  currentSelection: readonly string[],
  nextSelection: readonly string[],
  toggleItem: (id: string) => void,
) {
  const current = new Set(currentSelection);
  const next = new Set(nextSelection);
  for (const id of currentSelection) {
    if (!next.has(id)) toggleItem(id);
  }
  for (const id of nextSelection) {
    if (!current.has(id)) toggleItem(id);
  }
}
