import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTemplateRequestScope } from "./useTemplateRequestScope";

describe("useTemplateRequestScope", () => {
  it("invalidates inflight response validity checks when switching templates", () => {
    const { result, rerender, unmount } = renderHook(
      ({ path }) => useTemplateRequestScope(path),
      { initialProps: { path: "templates/math.yaml" } },
    );

    const isMathValid = result.current.createScopeCheck();
    expect(isMathValid()).toBe(true);
    expect(result.current.isCurrentPath("templates/math.yaml")).toBe(true);

    // Switch to English template
    rerender({ path: "templates/english.yaml" });
    expect(isMathValid()).toBe(false);
    expect(result.current.isCurrentPath("templates/math.yaml")).toBe(false);
    expect(result.current.isCurrentPath("templates/english.yaml")).toBe(true);

    const isEnglishValid = result.current.createScopeCheck();
    expect(isEnglishValid()).toBe(true);

    // Switch back to Math template: old check for Math still invalid because revision incremented
    rerender({ path: "templates/math.yaml" });
    expect(isMathValid()).toBe(false);
    expect(isEnglishValid()).toBe(false);

    const isNewMathValid = result.current.createScopeCheck();
    expect(isNewMathValid()).toBe(true);

    // Unmount invalidates all checks
    unmount();
    expect(isNewMathValid()).toBe(false);
    expect(result.current.isCurrentPath("templates/math.yaml")).toBe(false);
  });
});
