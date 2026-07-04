import { describe, expect, it } from "vitest";

import { canUseTeacherWorkspace, roleHomePage } from "../roles";

describe("platform role policy", () => {
  it("maps roles to stable home pages", () => {
    expect(roleHomePage("admin")).toBe("admin");
    expect(roleHomePage("school")).toBe("school");
    expect(roleHomePage("teacher")).toBe("compose");
    expect(roleHomePage("student")).toBe("student");
  });

  it("only teachers and admins can use teacher workspace in phase 1", () => {
    expect(canUseTeacherWorkspace("teacher")).toBe(true);
    expect(canUseTeacherWorkspace("admin")).toBe(true);
    expect(canUseTeacherWorkspace("school")).toBe(false);
    expect(canUseTeacherWorkspace("student")).toBe(false);
  });
});
