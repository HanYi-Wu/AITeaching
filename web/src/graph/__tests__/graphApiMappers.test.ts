import { describe, expect, it } from "vitest";
import { apiNodeToGraphRow, graphNodeRowToCreateBody } from "../graphApiMappers";

describe("node recovery payload", () => {
  it("retains source and notes when restoring a deleted node", () => {
    const original = { id: "node", canonical_name: "Node", source: "lesson.md", node_kind: "skill",
      notes: [{ id: "note", body: "important", created_at: "2026-10-28" }],
      aliases: ["alias"], tags: ["tag"], primary_parent_id: "parent", layout_x: 10, layout_y: 20 };
    const row = apiNodeToGraphRow(original, "fallback");
    const restored = graphNodeRowToCreateBody(row);
    expect(restored).toMatchObject(original);
    expect(restored.notes).not.toBe(row.notes);
  });
});
