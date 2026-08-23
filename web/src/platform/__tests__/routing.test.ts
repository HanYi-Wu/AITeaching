import { describe, expect, it } from "vitest";

import { resolvePlatformRoute } from "../routing";

describe("platform route resolution", () => {
  it("does not misroute an unavailable backend to administrator bootstrap", () => {
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: false,
        userRole: null,
        adminProjectMode: false,
        statusAvailable: false,
      } as Parameters<typeof resolvePlatformRoute>[0] & { statusAvailable: boolean }),
    ).toBe("unavailable");
  });

  it("starts on platform bootstrap or login even when no project is open", () => {
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: false,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("bootstrap");
    expect(
      resolvePlatformRoute({
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
        loading: false,
        adminExists: false,
        userRole: null,
        adminProjectMode: false,
      }),
    ).toBe("bootstrap");
    expect(
      resolvePlatformRoute({
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
        loading: false,
        adminExists: false,
        userRole: "admin",
        adminProjectMode: false,
      }),
    ).toBe("admin");
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: true,
        userRole: "admin",
        adminProjectMode: false,
      }),
    ).toBe("admin");
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: true,
        userRole: "admin",
        adminProjectMode: true,
      }),
    ).toBe("teacher");
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: true,
        userRole: "school",
        adminProjectMode: false,
      }),
    ).toBe("school");
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: true,
        userRole: "teacher",
        adminProjectMode: false,
      }),
    ).toBe("teacher");
    expect(
      resolvePlatformRoute({
        loading: false,
        adminExists: true,
        userRole: "student",
        adminProjectMode: false,
      }),
    ).toBe("student");
  });
});
