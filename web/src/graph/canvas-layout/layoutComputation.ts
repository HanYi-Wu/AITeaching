import type { Edge, Node } from "@xyflow/react";
import {
  assignStraightEdges,
  layoutWithDagre,
  layoutWithForceDirected,
  mergeSavedLayout,
  removeNodeOverlaps,
} from "../layoutGraph";
import { OVERLAP_DEFAULT } from "../layoutParams";

export type LayoutSizeEntry = readonly [string, { w: number; h: number }];
export type LayoutPositionEntry = readonly [string, { x: number; y: number }];

/**
 * Structured-cloneable input for the canvas layout calculation.
 *
 * Keep this payload limited to plain ReactFlow data.  In particular, do not
 * pass callbacks or store objects to the worker: layout must remain a pure
 * calculation with the same inputs as the synchronous path.
 */
export type CanvasLayoutInput = {
  nodes: Node[];
  edges: Edge[];
  nodeSizes: LayoutSizeEntry[];
  savedPositions: LayoutPositionEntry[];
  focusForceLayout: boolean;
  runNonFocusForce: boolean;
};

export type CanvasLayoutResult = {
  nodes: Node[];
  edges: Edge[];
};

function seedFromNodes(nodes: Node[]): Map<string, { x: number; y: number }> {
  const seed = new Map<string, { x: number; y: number }>();
  for (const node of nodes) seed.set(node.id, node.position);
  return seed;
}

/**
 * Run the exact dagre → force → overlap pipeline used by GraphCanvas.
 *
 * This function is intentionally free of React, browser globals, and state
 * writes so it can run unchanged in a module Worker or on the main thread.
 */
export function computeCanvasLayout(input: CanvasLayoutInput): CanvasLayoutResult {
  const nodeSizes = new Map(input.nodeSizes);
  const savedPositions = new Map(input.savedPositions);
  const rfEdges = assignStraightEdges(input.edges);
  let laid: Node[];

  if (!input.focusForceLayout) {
    laid = layoutWithDagre(input.nodes, rfEdges, nodeSizes);
    if (savedPositions.size > 0) laid = mergeSavedLayout(laid, savedPositions);
    if (input.runNonFocusForce) {
      laid = layoutWithForceDirected(laid, rfEdges, {
        seed: seedFromNodes(laid),
        sizes: nodeSizes,
      });
      laid = removeNodeOverlaps(
        laid,
        undefined,
        undefined,
        OVERLAP_DEFAULT.canvasPadding,
        OVERLAP_DEFAULT.maxPasses,
        nodeSizes,
      );
    } else {
      laid = removeNodeOverlaps(
        laid,
        undefined,
        undefined,
        OVERLAP_DEFAULT.canvasPadding,
        OVERLAP_DEFAULT.maxPasses,
        nodeSizes,
      );
    }
  } else {
    let seed = layoutWithDagre(input.nodes, rfEdges, nodeSizes);
    if (savedPositions.size > 0) seed = mergeSavedLayout(seed, savedPositions);
    laid = layoutWithForceDirected(seed, rfEdges, {
      seed: seedFromNodes(seed),
      sizes: nodeSizes,
    });
    laid = removeNodeOverlaps(
      laid,
      undefined,
      undefined,
      OVERLAP_DEFAULT.canvasPadding,
      OVERLAP_DEFAULT.maxPasses,
      nodeSizes,
    );
  }

  return { nodes: laid, edges: rfEdges };
}
