import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportTeachers, listSchoolUsers, resetSchoolUserPassword, updateSchoolUser } from "../schoolApi";

vi.mock("../../api/address", () => ({ resolveApiUrl: async (path: string) => path }));
vi.mock("../../lib/appLog", () => ({ logApiCall: vi.fn() }));

describe("school management API contracts", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("solaire.platform.session", "management-test-session");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("exports the full filtered roster with authentication, without pagination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("xlsx-data", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await exportTeachers({ q: "数学 & 科学", status: "active", page: 3, pageSize: 10 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const query = new URL(url, "http://localhost").searchParams;
    expect(query.get("q")).toBe("数学 & 科学");
    expect(query.get("status")).toBe("active");
    expect(query.has("page")).toBe(false);
    expect(query.has("page_size")).toBe(false);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer management-test-session");
    expect(await blob.text()).toBe("xlsx-data");
  });

  it("surfaces export errors instead of downloading an error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "当前账号不能导出教师" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    })));

    await expect(exportTeachers()).rejects.toMatchObject({ status: 403, message: "当前账号不能导出教师" });
  });

  it("scopes school-account requests and keeps reset passwords in the request body", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await listSchoolUsers("school/one", { q: "校管", status: "disabled", page: 2, pageSize: 20 });
    await updateSchoolUser("school/one", "user/two", { display_name: "新校管", status: "active" });
    await resetSchoolUserPassword("school/one", "user/two", "temporary-test-password");

    expect(fetchMock.mock.calls[0][0]).toContain("/api/schools/school%2Fone/school-users?");
    const query = new URL(fetchMock.mock.calls[0][0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({ q: "校管", status: "disabled", page: "2", page_size: "20" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/schools/school%2Fone/school-users/user%2Ftwo");
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/schools/school%2Fone/school-users/user%2Ftwo/reset-password");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ password: "temporary-test-password" });
  });
});
