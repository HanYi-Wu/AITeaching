import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { layoutWithForceDirected } from "../layoutGraph";

describe("layoutWithForceDirected", () => {
  it("preserves duplicate, reversed, self, and missing-endpoint edge behavior", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 15, y: -12 }, data: {} },
      { id: "b", position: { x: 181, y: 24 }, data: {} },
      { id: "c", position: { x: 52, y: 225 }, data: {} },
      { id: "d", position: { x: -104, y: 139 }, data: {} },
    ];
    const edges: Edge[] = [
      { id: "ab-1", source: "a", target: "b" },
      { id: "ab-2", source: "a", target: "b" },
      { id: "ba", source: "b", target: "a" },
      { id: "aa", source: "a", target: "a" },
      { id: "missing-source", source: "missing", target: "c" },
      { id: "cd", source: "c", target: "d" },
      { id: "missing-target", source: "a", target: "missing" },
    ];
    const sizes = new Map([
      ["a", { w: 100, h: 88 }],
      ["b", { w: 144, h: 130 }],
      ["c", { w: 172, h: 144 }],
      ["d", { w: 116, h: 102 }],
    ]);
    const seed = new Map([
      ["a", { x: 12, y: -10 }],
      ["b", { x: 174, y: 31 }],
      ["c", { x: 60, y: 215 }],
      ["d", { x: -95, y: 145 }],
    ]);

    const result = layoutWithForceDirected(nodes, edges, {
      iterations: 24,
      sizes,
      seed,
      preScaleCenters: 0.73,
    });

    const expected = [
      { id: "a", position: { x: 27.373174143376673, y: -48.67472298589102 } },
      { id: "b", position: { x: 199.33064626135632, y: -15.99208536663189 } },
      { id: "c", position: { x: 41.82807568364049, y: 272.5537267813181 } },
      { id: "d", position: { x: -117.53189608837357, y: 173.1130815712048 } },
    ];
    expect(result.map((node) => node.id)).toEqual(expected.map((node) => node.id));
    result.forEach((node, index) => {
      expect(node.position.x).toBeCloseTo(expected[index].position.x, 10);
      expect(node.position.y).toBeCloseTo(expected[index].position.y, 10);
    });
  });
});
