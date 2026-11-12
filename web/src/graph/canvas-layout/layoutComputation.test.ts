import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  assignStraightEdges,
  layoutWithDagre,
  layoutWithForceDirected,
  mergeSavedLayout,
  removeNodeOverlaps,
} from "../layoutGraph";
import { OVERLAP_DEFAULT } from "../layoutParams";
import { computeCanvasLayout, type CanvasLayoutInput } from "./layoutComputation";

function input(overrides: Partial<CanvasLayoutInput> = {}): CanvasLayoutInput {
  const nodes: Node[] = [
    { id: "a", type: "knowledge", position: { x: 0, y: 0 }, data: { label: "A" } },
    { id: "b", type: "knowledge", position: { x: 180, y: 20 }, data: { label: "B" } },
    { id: "c", type: "knowledge", position: { x: 20, y: 180 }, data: { label: "C" } },
  ];
  const edges: Edge[] = [{ id: "ab", source: "a", target: "b", data: { relationType: "related" } }];
  return {
    nodes,
    edges,
    nodeSizes: [["a", { w: 100, h: 100 }], ["b", { w: 128, h: 128 }], ["c", { w: 88, h: 88 }]],
    savedPositions: [["a", { x: 40, y: 50 }]],
    focusForceLayout: false,
    runNonFocusForce: true,
    ...overrides,
  };
}

function legacyEquivalent(task: CanvasLayoutInput) {
  const sizes = new Map(task.nodeSizes);
  const saved = new Map(task.savedPositions);
  const edges = assignStraightEdges(task.edges);
  let laid: Node[];
  if (!task.focusForceLayout) {
    laid = layoutWithDagre(task.nodes, edges, sizes);
    if (saved.size > 0) laid = mergeSavedLayout(laid, saved);
    if (task.runNonFocusForce) {
      const seed = new Map(laid.map((node) => [node.id, node.position]));
      laid = layoutWithForceDirected(laid, edges, { seed, sizes });
    }
  } else {
    let seed = layoutWithDagre(task.nodes, edges, sizes);
    if (saved.size > 0) seed = mergeSavedLayout(seed, saved);
    const seedMap = new Map(seed.map((node) => [node.id, node.position]));
    laid = layoutWithForceDirected(seed, edges, { seed: seedMap, sizes });
  }
  laid = removeNodeOverlaps(
    laid,
    undefined,
    undefined,
    OVERLAP_DEFAULT.canvasPadding,
    OVERLAP_DEFAULT.maxPasses,
    sizes,
  );
  return { nodes: laid, edges };
}

describe("computeCanvasLayout", () => {
  it.each([false, true])("matches the synchronous algorithm for focus=%s", (focusForceLayout) => {
    const task = input({ focusForceLayout });
    expect(computeCanvasLayout(task)).toEqual(legacyEquivalent(task));
  });
});
