import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore, type GraphNodeRow } from "../../useGraphStore";
import { reconcileNodeRows, reconcileRelationRows } from "../../snapshotCommands/reconcile";

const node = (id: string): GraphNodeRow => ({ id, canonical_name: id, notes: [{ id: "note", body: "草稿" }] });

describe("authoritative graph snapshots", () => {
  beforeEach(() => useGraphStore.setState({ graphNodes: [], relations: [] }));

  it("retains unchanged row identities while respecting incoming order and removals", () => {
    const first = node("graph/a");
    const second = node("graph/b");
    const current = [first, second];
    expect(reconcileNodeRows(current, JSON.parse(JSON.stringify(current)))).toBe(current);
    const reordered = reconcileNodeRows(current, [{ ...second }, { ...first }]);
    expect(reordered).not.toBe(current);
    expect(reordered[0]).toBe(second);
    expect(reordered[1]).toBe(first);
    expect(reconcileNodeRows(current, [{ ...second }])).toEqual([second]);
    expect(reconcileNodeRows(current, [])).toEqual([]);
  });

  it("applies new response fields, cleared values, and changed note metadata", () => {
    const original = { ...node("graph/a"), description: null, future: { revision: 1 } };
    const incoming = { ...original, description: undefined, future: { revision: 2 } };
    expect(reconcileNodeRows([original], [incoming])[0]).toBe(incoming);
    const changedNote = { ...original, notes: [{ id: "note", body: "草稿", created_at: "2026-10-29" }] };
    expect(reconcileNodeRows([original], [changedNote])[0]).toBe(changedNote);
    const withoutFuture = node("graph/a");
    expect(reconcileNodeRows([original], [withoutFuture])[0]).toBe(withoutFuture);
  });

  it("does not notify subscribers for identical snapshots or no-op patches", () => {
    const first = node("graph/a");
    const second = node("graph/b");
    useGraphStore.getState().setGraphNodes([first, second]);
    let notifications = 0;
    const unsubscribe = useGraphStore.subscribe(() => notifications++);
    useGraphStore.getState().setGraphNodes(JSON.parse(JSON.stringify([first, second])));
    useGraphStore.getState().patchGraphNode(first.id, { canonical_name: first.canonical_name });
    useGraphStore.getState().patchGraphNode("missing", { canonical_name: "ignored" });
    expect(notifications).toBe(0);
    useGraphStore.getState().patchGraphNode(first.id, { canonical_name: "已更新" });
    expect(notifications).toBe(1);
    expect(useGraphStore.getState().graphNodes[1]).toBe(second);
    unsubscribe();
  });

  it("retains relation references and accepts changed extension fields", () => {
    const relation = { id: "edge", from_node_id: "graph/a", to_node_id: "graph/b", relation_type: "part_of", extra: 1 };
    const current = [relation];
    expect(reconcileRelationRows(current, [{ ...relation }])).toBe(current);
    const changed = { ...relation, extra: 2 };
    expect(reconcileRelationRows(current, [changed])[0]).toBe(changed);
  });
});
