import { describe, expect, it } from "vitest";
import type { GraphNodeRow, GraphRelationRow } from "../useGraphStore";
import { canvasGeometry, sameCanvasGeometry } from "./canvasGeometry";

const nodes: GraphNodeRow[] = [
  { id: "a", canonical_name: "A", layout_x: 10, layout_y: 20 },
  { id: "b", canonical_name: "B", layout_x: null, layout_y: null },
];
const edges: GraphRelationRow[] = [
  { id: "ab", from_node_id: "a", to_node_id: "b", relation_type: "related" },
];
const sizes = new Map([ ["a", { w: 100, h: 100 }], ["b", { w: 140, h: 140 }] ]);

describe("canvas geometry signature", () => {
  it("matches unchanged geometry without depending on labels or row identity", () => {
    const before = canvasGeometry(nodes, edges, sizes, false, 0, "scope-a");
    const refreshedNodes = nodes.map((node) => ({ ...node, canonical_name: `${node.canonical_name} renamed` }));
    const refreshedEdges = edges.map((edge) => ({ ...edge }));

    expect(sameCanvasGeometry(before, refreshedNodes, refreshedEdges, sizes, false, 0, "scope-a")).toBe(true);
  });

  it("invalidates for every layout-affecting input", () => {
    const before = canvasGeometry(nodes, edges, sizes, false, 0, "scope-a");
    const check = (
      nextNodes = nodes,
      nextEdges = edges,
      nextSizes = sizes,
      focus = false,
      nonce = 0,
      scope = "scope-a",
    ) => sameCanvasGeometry(before, nextNodes, nextEdges, nextSizes, focus, nonce, scope);

    expect(check([{ ...nodes[0], layout_x: 11 }, nodes[1]])).toBe(false);
    expect(check(nodes, edges, new Map([...sizes, ["a", { w: 120, h: 120 }]]))).toBe(false);
    expect(check(nodes, [{ ...edges[0], relation_type: "causal" }])).toBe(false);
    expect(check(nodes, edges, sizes, true)).toBe(false);
    expect(check(nodes, edges, sizes, false, 1)).toBe(false);
    expect(check(nodes, edges, sizes, false, 0, "scope-b")).toBe(false);
    expect(check([nodes[1], nodes[0]])).toBe(false);
  });
});
