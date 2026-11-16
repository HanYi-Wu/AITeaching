import type { Node } from "@xyflow/react";
import type { GraphNodeRow, GraphRelationRow } from "../useGraphStore";

type NodeGeometry = readonly [string, number, number, number | null | undefined, number | null | undefined];
type EdgeGeometry = readonly [string, string, string, string];
export type CanvasGeometry = {
  scope: string;
  nodes: NodeGeometry[];
  edges: EdgeGeometry[];
  focus: boolean;
  nonce: number;
};

export function canvasGeometry(
  nodes: GraphNodeRow[], edges: GraphRelationRow[],
  sizes: Map<string, { w: number; h: number }>, focus: boolean, nonce: number, scope: string,
): CanvasGeometry {
  return {
    scope, focus, nonce,
    nodes: nodes.map((node) => {
      const size = sizes.get(node.id)!;
      return [node.id, size.w, size.h, node.layout_x, node.layout_y];
    }),
    edges: edges.map((edge) => [edge.id, edge.from_node_id, edge.to_node_id, edge.relation_type]),
  };
}

/** Compare live rows to the saved signature without allocating a second signature. */
export function sameCanvasGeometry(
  before: CanvasGeometry | null,
  nodes: GraphNodeRow[],
  edges: GraphRelationRow[],
  sizes: Map<string, { w: number; h: number }>,
  focus: boolean,
  nonce: number,
  scope: string,
): boolean {
  if (!before || before.scope !== scope || before.focus !== focus || before.nonce !== nonce ||
      before.nodes.length !== nodes.length || before.edges.length !== edges.length) return false;
  for (let index = 0; index < nodes.length; index++) {
    const left = before.nodes[index];
    const node = nodes[index];
    const size = sizes.get(node.id)!;
    if (left[0] !== node.id || left[1] !== size.w || left[2] !== size.h ||
        !Object.is(left[3], node.layout_x) || !Object.is(left[4], node.layout_y)) return false;
  }
  for (let index = 0; index < edges.length; index++) {
    const left = before.edges[index];
    const edge = edges[index];
    if (left[0] !== edge.id || left[1] !== edge.from_node_id || left[2] !== edge.to_node_id ||
        left[3] !== edge.relation_type) return false;
  }
  return true;
}

export function updateCanvasLabels(current: Node[], rows: GraphNodeRow[]): Node[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let changed = false;
  const next = current.map((node) => {
    const row = byId.get(node.id);
    if (!row || (node.data.label === row.canonical_name && node.data.nodeKind === (row.node_kind ?? "concept"))) return node;
    changed = true;
    return { ...node, data: { ...node.data, label: row.canonical_name, nodeKind: row.node_kind ?? "concept" } };
  });
  return changed ? next : current;
}
