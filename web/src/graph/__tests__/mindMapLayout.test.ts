import { describe, expect, it } from "vitest";
import { layoutMindMapPositions } from "../mindMapLayout";

const ROOT = "__root__";

describe("layoutMindMapPositions", () => {
  it("preserves branch spacing and positions when siblings collapse", () => {
    const children = new Map([
      [ROOT, ["a", "b"]],
      ["a", ["a1", "a2"]],
      ["b", ["b1"]],
    ]);

    expect(Object.fromEntries(layoutMindMapPositions(ROOT, children, new Set()))).toEqual({
      [ROOT]: { x: 0, y: 64 },
      a: { x: 248, y: 32 },
      a1: { x: 496, y: 0 },
      a2: { x: 496, y: 64 },
      b: { x: 248, y: 128 },
      b1: { x: 496, y: 128 },
    });

    expect(Object.fromEntries(layoutMindMapPositions(ROOT, children, new Set(["a"])))).toEqual({
      [ROOT]: { x: 0, y: 32 },
      a: { x: 248, y: 0 },
      b: { x: 248, y: 64 },
      b1: { x: 496, y: 64 },
    });
  });

  it("lays out deep trees without using the JavaScript call stack", () => {
    const depth = 20_000;
    const children = new Map<string, string[]>([[ROOT, ["0"]]]);
    for (let index = 0; index < depth; index++) {
      children.set(String(index), index + 1 < depth ? [String(index + 1)] : []);
    }

    const positions = layoutMindMapPositions(ROOT, children, new Set());
    expect(positions.size).toBe(depth + 1);
    expect(positions.get(String(depth - 1))).toEqual({ x: depth * 248, y: 0 });
  });

  it("retains duplicate-ID first-position order while hiding collapsed branches", () => {
    const children = new Map([
      [ROOT, ["a", "b", "a"]],
      ["a", ["a1", "a2"]],
      ["b", ["hidden-child"]],
    ]);

    expect(Object.fromEntries(layoutMindMapPositions(ROOT, children, new Set(["b"])))).toEqual({
      [ROOT]: { x: 0, y: 128 },
      a: { x: 248, y: 224 },
      a1: { x: 496, y: 192 },
      a2: { x: 496, y: 256 },
      b: { x: 248, y: 128 },
    });
  });

  it("stops malformed ancestor cycles at the repeated node", () => {
    const children = new Map([
      [ROOT, ["a"]],
      ["a", ["b"]],
      ["b", ["a"]],
    ]);

    expect(Array.from(layoutMindMapPositions(ROOT, children, new Set()).keys())).toEqual([ROOT, "a", "b"]);
  });
});
