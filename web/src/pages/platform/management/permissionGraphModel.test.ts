import { describe, expect, it } from "vitest";
import type { ManagementPermissionGraph } from "../../../platform/managementGraphApi";
import {
  effectiveRoleAssignments,
  implicationSources,
  navigationGroupsForMenus,
  permissionGrantState,
  permissionSourcesForUser,
  roleMenuGrantState,
  usersForRole,
} from "./permissionGraphModel";

function graphFixture(): ManagementPermissionGraph {
  return {
    school: { id: "school-a", name: "示范学校" },
    self_only: false,
    users: [
      { id: "u-custom", username: "teacher-a", display_name: "林老师", status: "active", mode: "custom", role_ids: ["r-custom"], effective_permissions: ["report:view", "report:export"] },
      { id: "u-full", username: "admin-a", display_name: "校管理员", status: "active", mode: "full", role_ids: ["r-custom"], effective_permissions: ["report:view", "report:export"] },
      { id: "u-disabled", username: "teacher-b", display_name: "停用账号", status: "disabled", mode: "custom", role_ids: ["r-custom"], effective_permissions: ["report:view"] },
      { id: "u-inactive-role", username: "teacher-c", display_name: "无有效角色", status: "active", mode: "custom", role_ids: ["r-disabled"], effective_permissions: [] },
      { id: "u-base", username: "teacher-d", display_name: "基础账号", status: "active", mode: "custom", role_ids: ["r-base"], effective_permissions: ["account:read"] },
    ],
    roles: [
      { id: "r-custom", name: "报表角色", status: "active", builtin: false, kind: "custom", permissions: ["report:view"], effective_permissions: ["report:view", "report:export"], user_count: 1 },
      { id: "r-disabled", name: "停用角色", status: "disabled", builtin: false, kind: "custom", permissions: ["report:view"], effective_permissions: ["report:view"], user_count: 1 },
      { id: "r-base", name: "系统基础", status: "active", builtin: true, kind: "base", permissions: [], effective_permissions: ["account:read"], user_count: 1 },
      { id: "r-full", name: "系统全权", status: "active", builtin: true, kind: "full", permissions: [], effective_permissions: ["report:view", "report:export"], user_count: 1 },
    ],
    menus: [
      { id: "m-report", label: "报表页面", section: "nav-reports", permission: "report:view", group: "报表导航" },
      { id: "m-export", label: "导出操作", section: "nav-reports", permission: "report:export", group: "报表导航" },
    ],
    catalog: [
      { key: "report:view", label: "查看报表", group: "报表", description: "", assignable: true, methods: ["GET"], paths: ["/reports"], routes: [{ method: "GET", path: "/reports" }] },
      { key: "report:export", label: "导出报表", group: "报表", description: "", assignable: true, methods: ["POST"], paths: ["/reports/export"], routes: [{ method: "POST", path: "/reports/export" }] },
      { key: "account:read", label: "查看账号", group: "账号", description: "", assignable: true, methods: ["GET"], paths: ["/accounts"], routes: [{ method: "GET", path: "/accounts" }] },
    ],
    assignments: [
      { user_id: "u-custom", role_id: "r-custom", active: true, source: "assigned" },
      { user_id: "u-full", role_id: "r-custom", active: true, source: "assigned" },
      { user_id: "u-disabled", role_id: "r-custom", active: true, source: "assigned" },
      { user_id: "u-inactive-role", role_id: "r-disabled", active: true, source: "assigned" },
      { user_id: "u-base", role_id: "r-base", active: true, source: "builtin" },
    ],
    implications: [{ source: "report:view", target: "report:export" }],
    summary: { user_count: 5, role_count: 4, menu_count: 2, unused_roles: 0, unassigned_users: 2, unreachable_menus: 0 },
    page: 1,
    page_size: 50,
    total: 5,
    total_pages: 1,
    coverage: { returned_users: 5, total_users: 5, roles_truncated: false },
  };
}

describe("permission graph resolution", () => {
  it("distinguishes explicit, implied, builtin and disabled grants", () => {
    const graph = graphFixture();
    const custom = graph.roles.find((role) => role.id === "r-custom")!;
    const disabled = graph.roles.find((role) => role.id === "r-disabled")!;
    const base = graph.roles.find((role) => role.id === "r-base")!;

    expect(permissionGrantState(custom, "report:view")).toBe("explicit");
    expect(permissionGrantState(custom, "report:export")).toBe("implied");
    expect(permissionGrantState(base, "account:read")).toBe("builtin");
    expect(permissionGrantState(disabled, "report:view")).toBe("inactive");
    expect(roleMenuGrantState(custom, graph.menus[1])).toBe("implied");
    expect(implicationSources(graph, custom, "report:export")).toEqual(["report:view"]);
  });

  it("uses virtual full/base sources and excludes disabled users or roles", () => {
    const graph = graphFixture();
    const fullUser = graph.users.find((user) => user.id === "u-full")!;
    const disabledUser = graph.users.find((user) => user.id === "u-disabled")!;
    const customRole = graph.roles.find((role) => role.id === "r-custom")!;
    const fullAssignments = effectiveRoleAssignments(graph, fullUser);

    expect(fullAssignments.map(({ role, source }) => [role.id, source])).toEqual([["r-full", "builtin"]]);
    expect(permissionSourcesForUser(graph, fullUser, "report:view").map(({ role }) => role.id)).toEqual(["r-full"]);
    expect(effectiveRoleAssignments(graph, disabledUser)).toEqual([]);
    expect(usersForRole(graph, "r-custom").map((user) => user.id)).toEqual(["u-custom"]);
    expect(permissionSourcesForUser(graph, graph.users.find((user) => user.id === "u-inactive-role")!, "report:view")).toEqual([]);
    expect(effectiveRoleAssignments(graph, graph.users.find((user) => user.id === "u-base")!)[0].role.kind).toBe("base");
    expect(permissionGrantState(customRole, "missing:permission")).toBe("none");
  });

  it("groups navigation by the real section id and retains each linked menu", () => {
    const groups = navigationGroupsForMenus(graphFixture().menus);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "nav-reports", label: "报表导航" });
    expect(groups[0].menus.map((menu) => menu.id)).toEqual(["m-report", "m-export"]);
  });
});
