import { describe, expect, it } from "vitest";
import type { ManagementPermissionGraph } from "../../../../platform/managementGraphApi";
import { buildScene } from "./stageScene";

const graphFixture = (): ManagementPermissionGraph => {
  const permissionKeys = Array.from({ length: 8 }, (_, index) => "school.route-" + index + ".read");
  const roles = Array.from({ length: 10 }, (_, index) => ({
    id: "role-" + index,
    name: "角色 " + index,
    status: "active",
    builtin: false,
    kind: "custom" as const,
    permissions: index === 0 ? permissionKeys : [],
    effective_permissions: index === 0 ? permissionKeys : [],
    user_count: index === 0 ? 8 : 0,
  }));
  const users = Array.from({ length: 8 }, (_, index) => ({
    id: "user-" + index,
    username: "reader-" + index,
    display_name: "查看员 " + index,
    status: "active",
    mode: "custom" as const,
    role_ids: ["role-0"],
    effective_permissions: permissionKeys,
  }));
  const menus = permissionKeys.map((permission, index) => ({
    id: "menu-" + index,
    label: "页面 " + index,
    section: "page-" + index,
    permission,
    group: "教务",
  }));

  return {
    school: { id: "school-1", name: "演示学校" },
    self_only: false,
    users,
    roles,
    menus,
    catalog: permissionKeys.map((key, index) => ({
      key,
      label: "查看页面 " + index,
      group: "教务",
      description: "只读权限",
      assignable: true,
      methods: ["GET"],
      paths: ["/api/page-" + index],
      routes: [{ method: "GET", path: "/api/page-" + index }],
    })),
    assignments: users.map((user) => ({
      user_id: user.id,
      role_id: "role-0",
      active: true,
      source: "assigned" as const,
    })),
    implications: [],
    summary: {
      user_count: users.length,
      role_count: roles.length,
      menu_count: menus.length,
      unused_roles: roles.length - 1,
      unassigned_users: 0,
      unreachable_menus: 0,
    },
    page: 1,
    page_size: 50,
    total: users.length,
    total_pages: 1,
    coverage: { returned_users: users.length, total_users: users.length, roles_truncated: false },
  };
};

describe("buildScene responsive geometry", () => {
  it("centers compact module cards within a phone-sized stage", () => {
    const width = 341;
    const height = 680;
    const scene = buildScene(
      graphFixture(),
      { layer: "module", moduleCat: "role", selected: null },
      width,
      height,
    );
    const items = scene.nodes.filter((node) => node.kind === "item");

    expect(items).toHaveLength(7);
    expect(items.every((node) => node.x === width / 2 && node.align === "center")).toBe(true);
    expect(items.every((node) => node.y >= 126 && node.y <= height - 108)).toBe(true);
    expect(scene.nodes.some((node) => node.id === "core" || node.kind === "hub")).toBe(false);
    expect(scene.modulePagination).toMatchObject({ page: 1, totalPages: 2, totalItems: 10 });
  });

  it("keeps the desktop module layout unchanged", () => {
    const scene = buildScene(
      graphFixture(),
      { layer: "module", moduleCat: "role", selected: null },
      1200,
      680,
    );

    expect(scene.nodes.some((node) => node.id === "core")).toBe(true);
    expect(scene.nodes.filter((node) => node.kind === "hub")).toHaveLength(3);
    expect(scene.nodes.find((node) => node.kind === "item")).toMatchObject({
      x: 588,
      align: "left",
    });
  });

  it("keeps the panorama hub previews within the stage width", () => {
    const compact = buildScene(graphFixture(), { layer: "hub", moduleCat: null, selected: null }, 720, 680);
    const desktop = buildScene(graphFixture(), { layer: "hub", moduleCat: null, selected: null }, 1360, 680);

    expect(compact.nodes.filter((node) => node.kind === "hub")).toHaveLength(3);
    expect(compact.nodes.filter((node) => node.kind === "item")).toHaveLength(0);
    const desktopPreviews = desktop.nodes.filter((node) => node.kind === "item");
    expect(desktopPreviews.length).toBeGreaterThan(0);
    expect(desktopPreviews.every((node) => node.x >= 0 && node.x <= 1360)).toBe(true);
  });

  it("keeps entity columns inside the mobile stage and above its detail drawer", () => {
    const width = 341;
    const height = 680;
    const scene = buildScene(
      graphFixture(),
      { layer: "entity", moduleCat: "role", selected: { cat: "role", id: "role-0" } },
      width,
      height,
    );
    const items = scene.nodes.filter((node) => node.kind === "item");

    expect(items.filter((node) => node.cat === "user")).toHaveLength(8);
    expect(items.filter((node) => node.cat === "role")).toHaveLength(1);
    expect(items.filter((node) => node.cat === "menu")).toHaveLength(8);
    expect(items.every((node) => node.x > 0 && node.x < width && node.align === "center")).toBe(true);
    expect(items.every((node) => node.y >= 80 && node.y <= height * 0.44)).toBe(true);
    expect(items.filter((node) => node.cat === "user").every((node) => node.x === width / 6)).toBe(true);
    expect(items.filter((node) => node.cat === "role").every((node) => node.x === width / 2)).toBe(true);
    expect(items.filter((node) => node.cat === "menu").every((node) => node.x === (width * 5) / 6)).toBe(true);
  });

  it("preserves the desktop entity column coordinates and alignments", () => {
    const stageWidth = 1200 - 368;
    const scene = buildScene(
      graphFixture(),
      { layer: "entity", moduleCat: "role", selected: { cat: "role", id: "role-0" } },
      1200,
      680,
    );
    const user = scene.nodes.find((node) => node.cat === "user");
    const role = scene.nodes.find((node) => node.cat === "role");
    const menu = scene.nodes.find((node) => node.cat === "menu");

    expect(user?.x).toBeCloseTo(Math.max(195, stageWidth * 0.21));
    expect(user?.align).toBe("right");
    expect(role?.x).toBe(stageWidth / 2);
    expect(role?.align).toBe("center");
    expect(menu?.x).toBeCloseTo(Math.min(stageWidth - 195, stageWidth * 0.79));
    expect(menu?.align).toBe("left");
  });

  it.each(["user", "role", "menu"] as const)(
    "returns an empty scene for a missing %s selection instead of showing the first record",
    (cat) => {
      const scene = buildScene(
        graphFixture(),
        { layer: "entity", moduleCat: cat, selected: { cat, id: "deleted-record" } },
        341,
        680,
      );

      expect(scene.nodes).toEqual([]);
      expect(scene.links).toEqual([]);
    },
  );
});
