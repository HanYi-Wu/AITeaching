/** Pure tree layout helpers for the editable mind-map canvas. */

export type MindMapPosition = { x: number; y: number };

interface TreeNode {
  id: string;
  children: TreeNode[];
  y: number;
  x: number;
  subtreeHeight: number;
}

export const MIND_MAP_NODE_W = 168;
export const MIND_MAP_NODE_H = 48;
const H_GAP = 80;
const V_GAP = 16;

type BuildFrame = {
  tree: TreeNode;
  childIds: string[];
  nextChild: number;
};

/**
 * Build the visible tree iteratively. A very deep imported hierarchy should
 * not consume the JavaScript call stack. Ancestor cycles are ignored so a
 * malformed parent chain cannot hang the canvas; ordinary child order and
 * duplicate sibling behavior stay the same as the recursive walk.
 */
function buildTree(
  rootId: string,
  childrenByParent: Map<string, string[]>,
  collapsed: Set<string>,
): TreeNode {
  const root: TreeNode = { id: rootId, children: [], y: 0, x: 0, subtreeHeight: MIND_MAP_NODE_H };
  const activePath = new Set([rootId]);
  const childIdsFor = (id: string) => collapsed.has(id) ? [] : (childrenByParent.get(id) ?? []);
  const stack: BuildFrame[] = [{ tree: root, childIds: childIdsFor(rootId), nextChild: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.nextChild < frame.childIds.length) {
      const childId = frame.childIds[frame.nextChild++];
      if (activePath.has(childId)) continue;

      const child: TreeNode = { id: childId, children: [], y: 0, x: 0, subtreeHeight: MIND_MAP_NODE_H };
      frame.tree.children.push(child);
      activePath.add(childId);
      stack.push({ tree: child, childIds: childIdsFor(childId), nextChild: 0 });
      continue;
    }

    if (frame.tree.children.length > 0) {
      frame.tree.subtreeHeight = frame.tree.children.reduce(
        (height, child) => height + child.subtreeHeight + V_GAP,
        -V_GAP,
      );
    }
    activePath.delete(frame.tree.id);
    stack.pop();
  }

  return root;
}

function assignPositions(root: TreeNode, x: number, y: number): void {
  const stack: Array<{ node: TreeNode; x: number; y: number }> = [{ node: root, x, y }];
  while (stack.length > 0) {
    const placement = stack.pop()!;
    const { node } = placement;
    node.x = placement.x;
    node.y = placement.y + node.subtreeHeight / 2 - MIND_MAP_NODE_H / 2;

    let childY = placement.y;
    const childPlacements = new Array<{ node: TreeNode; x: number; y: number }>(node.children.length);
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      childPlacements[index] = { node: child, x: placement.x + MIND_MAP_NODE_W + H_GAP, y: childY };
      childY += child.subtreeHeight + V_GAP;
    }
    for (let index = childPlacements.length - 1; index >= 0; index--) stack.push(childPlacements[index]);
  }
}

/**
 * Match the old flatten order (parent, then children in reverse insertion
 * order) when retaining the first position for an ID. This keeps duplicate ID
 * behavior stable while avoiding the temporary flat array of every position.
 */
function indexFirstPositionById(root: TreeNode): Map<string, MindMapPosition> {
  const byId = new Map<string, MindMapPosition>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!byId.has(node.id)) byId.set(node.id, { x: node.x, y: node.y });
    for (const child of node.children) stack.push(child);
  }
  return byId;
}

/** Return positions for the visible nodes, including the virtual root. */
export function layoutMindMapPositions(
  rootId: string,
  childrenByParent: Map<string, string[]>,
  collapsed: Set<string>,
): Map<string, MindMapPosition> {
  const root = buildTree(rootId, childrenByParent, collapsed);
  assignPositions(root, 0, 0);
  return indexFirstPositionById(root);
}
