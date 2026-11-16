import { describe, expect, it } from "vitest";
import { computeKHopNodes } from "./focusNeighborhood";

describe("computeKHopNodes", () => {
  const edges = [
    { from_node_id: "a", to_node_id: "b" },
    { from_node_id: "a", to_node_id: "c" },
    { from_node_id: "b", to_node_id: "d" },
    { from_node_id: "c", to_node_id: "d" },
    { from_node_id: "d", to_node_id: "d" },
    { from_node_id: "a", to_node_id: "b" },
  ];

  it("returns the undirected neighborhood through one or two hops", () => {
    expect(Array.from(computeKHopNodes("a", 1, edges) ?? [])).toEqual(["a", "b", "c"]);
    expect(Array.from(computeKHopNodes("a", 2, edges) ?? [])).toEqual(["a", "b", "c", "d"]);
  });

  it("retains disabled and unknown-center behavior", () => {
    expect(computeKHopNodes("a", 0, edges)).toBeNull();
    expect(computeKHopNodes(null, 2, edges)).toBeNull();
    expect(Array.from(computeKHopNodes("missing", 2, edges) ?? [])).toEqual(["missing"]);
  });

  it("visits a high-degree neighborhood with a cursor-backed queue", () => {
    const count = 20_000;
    const star = Array.from({ length: count }, (_, index) => ({
      from_node_id: "center",
      to_node_id: String(index),
    }));
    const focused = computeKHopNodes("center", 1, star);
    expect(focused?.size).toBe(count + 1);
    expect(Array.from(focused ?? []).slice(0, 4)).toEqual(["center", "0", "1", "2"]);
  });
});
