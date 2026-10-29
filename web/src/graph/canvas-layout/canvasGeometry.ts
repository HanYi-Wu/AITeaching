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

export function sameCanvasGeometry(before: CanvasGeometry | null, after: CanvasGeometry): boolean {
  if (!before || before.scope !== after.scope || before.focus !== after.focus || before.nonce !== after.nonce ||
      before.nodes.length !== after.nodes.length || before.edges.length !== after.edges.length) return false;
  for (let index = 0; index < after.nodes.length; index++) {
    const left = before.nodes[index];
    const right = after.nodes[index];
    for (let field = 0; field < right.length; field++) if (!Object.is(left[field], right[field])) return false;
  }
  for (let index = 0; index < after.edges.length; index++) {
    const left = before.edges[index];
    const right = after.edges[index];
    for (let field = 0; field < right.length; field++) if (left[field] !== right[field]) return false;
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
