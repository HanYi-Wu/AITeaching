import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { projectCanvasNodes } from "./canvasProjection";

const node = (id: string, extra: Partial<Node> = {}): Node => ({
  id,
  type: "knowledge",
  position: { x: 0, y: 0 },
  width: 140,
  height: 140,
  zIndex: 1,
  style: { width: 140, height: 140, zIndex: 1 },
  data: { label: id },
  ...extra,
});

describe("projectCanvasNodes", () => {
  it("reuses the input array and node records when focus styling is unchanged", () => {
    const nodes = [node("a"), node("b")];
    expect(projectCanvasNodes(nodes, null)).toBe(nodes);
    expect(projectCanvasNodes(nodes, new Set(["a", "b"]))).toBe(nodes);
  });

  it("copies only nodes whose dimming or canvas z-index must change", () => {
    const nodes = [node("a"), node("b"), node("c", { zIndex: 0 })];
    const projected = projectCanvasNodes(nodes, new Set(["a", "b"]));

    expect(projected).not.toBe(nodes);
    expect(projected[0]).toBe(nodes[0]);
    expect(projected[1]).toBe(nodes[1]);
    expect(projected[2]).not.toBe(nodes[2]);
    expect(projected[2]).toMatchObject({ zIndex: 1, style: { zIndex: 1 }, data: { focusDimmed: true } });
  });

  it("clears dimming on nodes that reenter focus and keeps other fields", () => {
    const previouslyDimmed = node("a", { data: { label: "A", focusDimmed: true } });
    const projected = projectCanvasNodes([previouslyDimmed], new Set(["a"]));

    expect(projected[0]).not.toBe(previouslyDimmed);
    expect(projected[0].data).toEqual({ label: "A", focusDimmed: false });
  });
});
