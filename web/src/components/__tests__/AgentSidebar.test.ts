import { describe, expect, it } from "vitest";

import { getAssistantOverlayWidth } from "../AgentSidebar";

describe("AgentSidebar width", () => {
  it("stays usable at desktop widths without overflowing small hosts", () => {
    expect(getAssistantOverlayWidth(1260)).toBe(420);
    expect(getAssistantOverlayWidth(900)).toBe(320);
    expect(getAssistantOverlayWidth(280)).toBe(280);
  });
});
