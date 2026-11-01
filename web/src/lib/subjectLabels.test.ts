import { describe, expect, it } from "vitest";

import { formatSubjectLabel } from "./subjectLabels";

describe("formatSubjectLabel", () => {
  it("translates known subject codes and preserves unknown values", () => {
    expect(formatSubjectLabel("math")).toBe("数学");
    expect(formatSubjectLabel("社会实践")).toBe("社会实践");
    expect(formatSubjectLabel(" ", "未分科")).toBe("未分科");
  });

  it("returns prototype property names as plain labels", () => {
    expect(formatSubjectLabel("__proto__")).toBe("__proto__");
    expect(formatSubjectLabel("constructor")).toBe("constructor");
  });
});
