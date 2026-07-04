import { describe, expect, it } from "vitest";

import { resolvePlatformRoute } from "../routing";

describe("platform route resolution", () => {
  it("starts on platform bootstrap or login even when no project is open", () => {
    expect(
      resolvePlatformRoute({
        projectBound: false,
        loading: false,
        adminExists: false,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("bootstrap");
    expect(
      resolvePlatformRoute({
        projectBound: false,
        loading: false,
        adminExists: true,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("login");
  });

  it("routes bootstrap and anonymous login explicitly", () => {
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: false,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("bootstrap");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("login");
  });

  it("routes authenticated roles without relying on nested JSX order", () => {
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: false,
        userRole: "admin",
        adminProjectMode: false,
      }),
    ).toBe("admin");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: "admin",
        adminProjectMode: false,
      }),
    ).toBe("admin");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: "admin",
        adminProjectMode: true,
      }),
    ).toBe("teacher");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: "school",
        adminProjectMode: false,
      }),
    ).toBe("school");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: "teacher",
        adminProjectMode: false,
      }),
    ).toBe("teacher");
    expect(
      resolvePlatformRoute({
        projectBound: true,
        loading: false,
        adminExists: true,
        userRole: "student",
        adminProjectMode: false,
      }),
    ).toBe("student");
  });
});
