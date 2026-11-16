import type { Node } from "@xyflow/react";

/**
 * Apply focus dimming without recreating unchanged React Flow nodes.
 *
 * Node position changes arrive continuously while a node is dragged. Returning
 * the original node records in that path lets React Flow's memoized node views
 * skip renders for every node whose visual data did not change.
 */
export function projectCanvasNodes(nodes: Node[], focusSet: Set<string> | null): Node[] {
  let projected: Node[] | null = null;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const focusDimmed = focusSet !== null && !focusSet.has(node.id);
    const hasCanvasZIndex = node.zIndex === 1 && node.style?.zIndex === 1;
    const alreadyDimmed = Boolean((node.data as { focusDimmed?: boolean }).focusDimmed);
    if (hasCanvasZIndex && alreadyDimmed === focusDimmed) continue;

    projected ??= nodes.slice();
    projected[index] = {
      ...node,
      zIndex: 1,
      style: { ...node.style, zIndex: 1 },
      data: { ...node.data, focusDimmed },
    };
  }

  return projected ?? nodes;
}
