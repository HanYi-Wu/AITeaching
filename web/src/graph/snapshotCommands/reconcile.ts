import type { GraphNodeNoteRow, GraphNodeRow, GraphRelationRow } from "../useGraphStore";

// Rows originate in JSON responses. Compare every field so new response fields
// and note metadata cannot silently retain an older value.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => sameValue(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

export function areNotesEqual(a: GraphNodeNoteRow[] | undefined, b: GraphNodeNoteRow[] | undefined): boolean {
  return sameValue(a, b);
}

export function areStringArraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return sameValue(a, b);
}

export function areNodesEqual(a: GraphNodeRow, b: GraphNodeRow): boolean {
  return sameValue(a, b);
}

export function areRelationsEqual(a: GraphRelationRow, b: GraphRelationRow): boolean {
  return sameValue(a, b);
}

function reconcileRows<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (current === incoming || current.length === 0) return incoming;
  const byId = new Map(current.map((row) => [row.id, row]));
  let changed = current.length !== incoming.length;
  const rows = incoming.map((row, index) => {
    const previous = byId.get(row.id);
    const next = previous && sameValue(previous, row) ? previous : row;
    if (next !== current[index]) changed = true;
    return next;
  });
  return changed ? rows : current;
}

export function reconcileNodeRows(current: GraphNodeRow[], incoming: GraphNodeRow[]): GraphNodeRow[] {
  return reconcileRows(current, incoming);
}

export function reconcileRelationRows(current: GraphRelationRow[], incoming: GraphRelationRow[]): GraphRelationRow[] {
  return reconcileRows(current, incoming);
}
