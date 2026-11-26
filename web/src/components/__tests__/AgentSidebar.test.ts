import { describe, expect, it } from "vitest";

import { clampAssistantPosition, getAssistantDragTuck, getAssistantOverlayWidth, getAssistantSnapEdge } from "../AgentSidebar";

describe("AgentSidebar width", () => {
  it("stays usable at desktop widths without overflowing small hosts", () => {
    expect(getAssistantOverlayWidth(1260)).toBe(420);
    expect(getAssistantOverlayWidth(900)).toBe(320);
    expect(getAssistantOverlayWidth(280)).toBe(280);
  });
  it("keeps moved panels inside the viewport during drag or resize", () => {
    expect(clampAssistantPosition({ x: 1000, y: -80 }, 420, 580, 1100, 740)).toEqual({ x: 680, y: 0 });
    expect(clampAssistantPosition({ x: 680, y: 480 }, 420, 580, 360, 520)).toEqual({ x: 0, y: 0 });
  });
  it("snaps to the nearest edge only within the edge threshold", () => {
    const edge = (x: number, y: number) => getAssistantSnapEdge({ x, y }, 400, 500, 1200, 900);
    expect(edge(15, 100)).toBe("left");
    expect(edge(780, 100)).toBe("right");
    expect(edge(350, 20)).toBe("top");
    expect(edge(350, 385)).toBe("bottom");
    expect(edge(380, 180)).toBeNull();
    expect(edge(15, 10)).toBe("top");
  });
  it("uses the pointer at the left, right and top, and the panel midpoint at the bottom", () => {
    const tuck = (x: number, y: number, top = 100) => getAssistantDragTuck({ x, y }, top, 500, 1200, 900);
    expect(tuck(-4, 155)).toEqual({ edge: "left", along: 155 });
    expect(tuck(1201, 179)).toEqual({ edge: "right", along: 179 });
    expect(tuck(430, -3)).toEqual({ edge: "top", along: 430 });
    expect(tuck(430, 670, 649)).toBeNull();
    expect(tuck(430, 672, 651)).toEqual({ edge: "bottom", along: 430 });
    expect(tuck(1199, 179)).toBeNull();
  });
});
