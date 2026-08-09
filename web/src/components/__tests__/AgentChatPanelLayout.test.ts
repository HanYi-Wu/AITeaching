import { describe, expect, it } from "vitest";

import { ASSISTANT_PROSE_CLASS } from "../AgentChatPanel";

describe("AgentChatPanel assistant layout", () => {
  it("constrains long assistant content without widening the chat panel", () => {
    expect(ASSISTANT_PROSE_CLASS).toContain("min-w-0");
    expect(ASSISTANT_PROSE_CLASS).toContain("max-w-full");
    expect(ASSISTANT_PROSE_CLASS).toContain("break-words");
    expect(ASSISTANT_PROSE_CLASS).toContain("prose-pre:overflow-x-auto");
    expect(ASSISTANT_PROSE_CLASS).toContain("prose-table:overflow-x-auto");
    expect(ASSISTANT_PROSE_CLASS).not.toContain("max-w-none");
  });
});
