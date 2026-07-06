import { describe, expect, it } from "vitest";

import { estimateDataUrlBytes, MAX_STUDENT_IMAGE_BYTES } from "../imageCompression";

describe("imageCompression", () => {
  it("estimates data url payload bytes for the 2MB student upload guard", () => {
    expect(estimateDataUrlBytes("data:image/png;base64,ZmFrZQ==")).toBe(4);
    expect(MAX_STUDENT_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });
});
