/* ============================================================
   权限星图 3 层场景布局引擎（清晰可读 · 全部可点 · 归属明确）：
   Layer 1 (hub)    —— 全景星图：中心球 + 三大表盘 + 外围可点击真实卫星胶囊
   Layer 2 (module) —— 分类列表：左侧表盘切换 + 右侧完整胶囊列表
   Layer 3 (entity) —— 授权链路：「用户 → 角色 → 可访问页面」三列溯源
   ============================================================ */
import type {
  ManagementPermissionGraph,
  PermissionGraphMenu,
  PermissionGraphPermission,
  PermissionGraphRole,
  PermissionGraphUser,
} from "../../../../platform/managementGraphApi";
import {
  effectiveRoleAssignments,
  implicationSources,
  isActivePermissionRecord,
  permissionForMenu,
  permissionGrantState,
  permissionSourcesForUser,
  roleMenuGrantState,
  rolesForMenu,
  usersForMenu,
  usersForRole,
} from "../permissionGraphModel";

export type Cat = "user" | "role" | "menu" | "permission";
export type StageLayer = "hub" | "module" | "entity";
export type NodeKind = "core" | "hub" | "item";

export type StageNode = {
  id: string;
  cat?: Cat;
  rawId?: string;
  label: string;
  sub?: string;
  badge?: string;
  count?: number;
  ratio?: number;
  x: number;
  y: number;
  size: number;
  kind: NodeKind;
  align?: "center" | "left" | "right";
  tone?: "ok" | "off" | "danger";
  active?: boolean;
  clickable?: boolean;
  ariaLabel?: string;
  from?: string;
  delay?: number;
  expandModule?: "user" | "role" | "menu";
};

export type StageLink = {
  a: string;
  b: string;
  cat?: Cat;
  toCat?: Cat;
  active?: boolean;
  dashed?: boolean;
  shape?: "bezier" | "h";
};

const DEG = Math.PI / 180;

export function roleKindLabel(role: PermissionGraphRole) {
  if (role.kind === "full") return "完整管理权限";
  if (role.kind === "base") return "系统默认权限";
  return role.builtin ? "系统内置角色" : "校内自定义角色";
}

export function grantStateLabel(state: ReturnType<typeof permissionGrantState>) {
  switch (state) {
    case "explicit":
      return "直接授予";
    case "implied":
      return "隐含包含";
    case "builtin":
      return "内置包含";
    case "inactive":
      return "已停用";
    default:
      return "未授予";
  }
}

/** 查找某个页面对应的增删改管理权限 Key（用于区分「可管理」与「仅查看」）。 */
export function managePermissionForMenu(
  graph: ManagementPermissionGraph,
  menu: PermissionGraphMenu,
): string | null {
  const readKey = permissionForMenu(menu);
  if (readKey.endsWith(".manage")) return readKey;
  if (readKey.endsWith(".read")) {
    const candidate = `${readKey.slice(0, -5)}.manage`;
    if (graph.catalog.some((item) => item.key === candidate)) {
      return candidate;
    }
  }
  if (
    menu.section === "access" &&
    graph.catalog.some((item) => item.key === "school.roles.manage")
  ) {
    return "school.roles.manage";
  }
  return null;
}

export function roleCanManageMenu(
  graph: ManagementPermissionGraph,
  role: PermissionGraphRole,
  menu: PermissionGraphMenu,
): boolean {
  if (role.kind === "full") return true;
  const manageKey = managePermissionForMenu(graph, menu);
  if (!manageKey) return false;
  const st = permissionGrantState(role, manageKey);
  return st !== "none" && st !== "inactive";
}

export function userCanManageMenu(
  graph: ManagementPermissionGraph,
  user: PermissionGraphUser,
  menu: PermissionGraphMenu,
): boolean {
  if (!isActivePermissionRecord(user)) return false;
  if (user.mode === "full") return true;
  const manageKey = managePermissionForMenu(graph, menu);
  if (!manageKey) return false;
  return user.effective_permissions.includes(manageKey);
}

export function computeCoverageStats(graph: ManagementPermissionGraph) {
  const activeUsers = graph.users.filter((user) => isActivePermissionRecord(user));
  const usersWithRoles = activeUsers.filter(
    (user) => effectiveRoleAssignments(graph, user).length > 0,
  );
  const activeRoles = graph.roles.filter((role) => isActivePermissionRecord(role));
  const rolesWithHolders = activeRoles.filter(
    (role) => usersForRole(graph, role.id).length > 0,
  );
  const coveredMenus = graph.menus.filter((menu) => rolesForMenu(graph, menu).length > 0);

  return {
    userTotal: graph.summary.user_count,
    roleTotal: graph.summary.role_count,
    menuTotal: graph.summary.menu_count,
    unusedRoles: graph.summary.unused_roles,
    unreachableMenus: graph.summary.unreachable_menus,
    unassignedUsers: graph.summary.unassigned_users,
    userRatio: graph.users.length ? usersWithRoles.length / graph.users.length : 1,
    roleRatio: graph.roles.length ? rolesWithHolders.length / graph.roles.length : 1,
    menuRatio: graph.menus.length ? coveredMenus.length / graph.menus.length : 1,
  };
}

/** 纵向等距排布工具。 */
function stackY(count: number, index: number, top: number, bottom: number, maxStep = 60) {
  if (count <= 1) return (top + bottom) / 2;
  const step = Math.min(maxStep, (bottom - top) / (count - 1));
  const totalHeight = step * (count - 1);
  const start = (top + bottom - totalHeight) / 2;
  return start + index * step;
}

export type SceneState = {
  layer: StageLayer;
  moduleCat: "user" | "role" | "menu" | null;
  selected: { cat: Cat; id: string } | null;
  modulePage?: number;
};

export type BuiltScene = {
  nodes: StageNode[];
  links: StageLink[];
  modulePagination?: {
    page: number;
    totalPages: number;
    totalItems: number;
  };
};

/**
 * 构建前景交互场景。
 */
export function buildScene(
  graph: ManagementPermissionGraph,
  state: SceneState,
  width: number,
  height: number,
): BuiltScene {
  const stats = computeCoverageStats(graph);
  const hasEntityPanel = state.layer === "entity" && width > 860;
  const stageW = hasEntityPanel ? width - 368 : width;
  const stageH = height;

  const hubSpecs: Array<{
    cat: "role" | "user" | "menu";
    label: string;
    count: number;
    ratio: number;
    ariaLabel: string;
  }> = [
    {
      cat: "role",
      label: "角色",
      count: stats.roleTotal,
      ratio: stats.roleRatio,
      ariaLabel: `角色，${stats.roleTotal} 个来源`,
    },
    {
      cat: "user",
      label: "用户",
      count: stats.userTotal,
      ratio: stats.userRatio,
      ariaLabel: `用户，${stats.userTotal} 个账号`,
    },
    {
      cat: "menu",
      label: "页面 / 操作",
      count: stats.menuTotal,
      ratio: stats.menuRatio,
      ariaLabel: `页面 / 操作，${stats.menuTotal} 项`,
    },
  ];

  /* ── 第 1 层：全景星图（中心球 + 三大表盘 + 外围可点击真实卫星胶囊） ── */
  if (state.layer === "hub") {
    const cx = stageW * 0.5;
    const cy = stageH * 0.53;
    const orbitR = Math.min(stageW * 0.2, stageH * 0.25, 148);
    const angles = [-90, 156, 24].map((deg) => deg * DEG);

    const nodes: StageNode[] = [
      {
        id: "core",
        label: "权限全景",
        x: cx,
        y: cy,
        size: 92,
        kind: "core",
        clickable: false,
      },
    ];
    const links: StageLink[] = [];

    const hubCoords: Record<"role" | "user" | "menu", { x: number; y: number }> = {
      role: { x: cx, y: cy - orbitR },
      user: { x: cx + Math.cos(angles[1]) * orbitR * 1.08, y: cy + Math.sin(angles[1]) * orbitR * 1.06 },
      menu: { x: cx + Math.cos(angles[2]) * orbitR * 1.08, y: cy + Math.sin(angles[2]) * orbitR * 1.06 },
    };

    hubSpecs.forEach((hub, index) => {
      const id = `hub:${hub.cat}`;
      const pos = hubCoords[hub.cat];
      nodes.push({
        id,
        cat: hub.cat,
        rawId: hub.cat,
        label: hub.label,
        count: hub.count,
        ratio: hub.ratio,
        x: pos.x,
        y: pos.y,
        size: 96,
        kind: "hub",
        clickable: true,
        ariaLabel: hub.ariaLabel,
        from: "core",
        delay: index * 0.03,
      });
      links.push({
        a: "core",
        b: id,
        cat: hub.cat,
        toCat: hub.cat,
        active: true,
      });
    });

    // 在宽屏下于三枚表盘外侧直接渲染可点击的真实卫星胶囊（一眼看懂谁管什么，且每个都能直接点）
    if (stageW >= 1120) {
      // 1. 顶部「角色」表盘左右两侧展开角色胶囊
      const roleHub = hubCoords.role;
      const previewRoles = graph.roles.slice(0, 4);
      const leftRoles = previewRoles.filter((_, i) => i % 2 === 0);
      const rightRoles = previewRoles.filter((_, i) => i % 2 === 1);

      const placeRoleSatellite = (
        role: PermissionGraphRole,
        side: "left" | "right",
        idx: number,
        total: number,
      ) => {
        const holderCount = usersForRole(graph, role.id).length;
        const active = isActivePermissionRecord(role);
        const offsetX = side === "left" ? -128 : 128;
        const y = stackY(
          total,
          idx,
          Math.max(66, roleHub.y - 34),
          Math.min(cy - 62, roleHub.y + 34),
          48,
        );
        const nodeId = `role:${role.id}`;
        nodes.push({
          id: nodeId,
          cat: "role",
          rawId: role.id,
          label: role.name,
          badge: !active ? "已停用" : `${holderCount} 人`,
          x: roleHub.x + offsetX,
          y,
          size: 14,
          kind: "item",
          align: side === "left" ? "right" : "left",
          tone: !active ? "off" : holderCount === 0 ? "danger" : "ok",
          clickable: true,
          ariaLabel: `角色：${role.name}`,
          from: "hub:role",
          delay: 0.06 + idx * 0.02,
        });
        links.push({
          a: "hub:role",
          b: nodeId,
          cat: "role",
          toCat: "role",
          active: true,
          shape: "h",
        });
      };

      leftRoles.forEach((role, i) => placeRoleSatellite(role, "left", i, leftRoles.length));
      rightRoles.forEach((role, i) => placeRoleSatellite(role, "right", i, rightRoles.length));

      // 2. 左下「用户」表盘左侧展开管理员账号胶囊
      const userHub = hubCoords.user;
      const previewUsers = graph.users.slice(0, 4);
      const hasMoreUsers = graph.users.length > previewUsers.length;
      const totalUserSlots = previewUsers.length + (hasMoreUsers ? 1 : 0);
      const userX = Math.max(155, userHub.x - 118);
      const userTop = Math.max(155, userHub.y - 88);
      const userBottom = Math.min(stageH - 76, userHub.y + 92);

      previewUsers.forEach((user, idx) => {
        const assigned = effectiveRoleAssignments(graph, user);
        const customAssigned = assigned.filter((item) => item.role.kind === "custom");
        const active = isActivePermissionRecord(user);
        const roleBadge = !active
          ? "已停用"
          : user.mode === "full"
            ? "完整管理"
            : customAssigned.length > 1
              ? `${customAssigned[0].role.name} 等${customAssigned.length}项`
              : customAssigned[0]?.role.name ?? assigned[0]?.role.name ?? "未分配";
        const nodeId = `user:${user.id}`;
        nodes.push({
          id: nodeId,
          cat: "user",
          rawId: user.id,
          label: user.display_name || user.username,
          badge: roleBadge,
          x: userX,
          y: stackY(totalUserSlots, idx, userTop, userBottom, 48),
          size: 14,
          kind: "item",
          align: "right",
          tone: !active ? "off" : assigned.length === 0 ? "danger" : "ok",
          clickable: true,
          ariaLabel: `用户：${user.display_name || user.username}`,
          from: "hub:user",
          delay: 0.07 + idx * 0.02,
        });
        links.push({
          a: "hub:user",
          b: nodeId,
          cat: "user",
          toCat: "user",
          active: true,
          shape: "h",
        });
      });

      if (hasMoreUsers) {
        const moreId = "more:user";
        nodes.push({
          id: moreId,
          cat: "user",
          label: `全部 ${graph.users.length} 个账号 →`,
          x: userX,
          y: stackY(totalUserSlots, previewUsers.length, userTop, userBottom, 48),
          size: 14,
          kind: "item",
          align: "right",
          tone: "ok",
          clickable: true,
          ariaLabel: `展开全部 ${graph.users.length} 个账号`,
          from: "hub:user",
          delay: 0.15,
          expandModule: "user",
        });
        links.push({
          a: "hub:user",
          b: moreId,
          cat: "user",
          toCat: "user",
          active: true,
          dashed: true,
          shape: "h",
        });
      }

      // 3. 右下「页面 / 操作」表盘右侧展开核心页面胶囊
      const menuHub = hubCoords.menu;
      const previewMenus = graph.menus.slice(0, 5);
      const hasMoreMenus = graph.menus.length > previewMenus.length;
      const totalMenuSlots = previewMenus.length + (hasMoreMenus ? 1 : 0);
      const menuX = Math.min(stageW - 155, menuHub.x + 118);
      const menuTop = Math.max(135, menuHub.y - 108);
      const menuBottom = Math.min(stageH - 64, menuHub.y + 108);

      previewMenus.forEach((menu, idx) => {
        const users = usersForMenu(graph, menu);
        const roles = rolesForMenu(graph, menu);
        const nodeId = `menu:${menu.id}`;
        nodes.push({
          id: nodeId,
          cat: "menu",
          rawId: menu.id,
          label: menu.label,
          badge: roles.length ? `${users.length} 人可管辖` : "无人可访问",
          x: menuX,
          y: stackY(totalMenuSlots, idx, menuTop, menuBottom, 46),
          size: 14,
          kind: "item",
          align: "left",
          tone: roles.length === 0 ? "danger" : "ok",
          clickable: true,
          ariaLabel: `页面 / 操作：${menu.label}`,
          from: "hub:menu",
          delay: 0.08 + idx * 0.02,
        });
        links.push({
          a: "hub:menu",
          b: nodeId,
          cat: "menu",
          toCat: "menu",
          active: true,
          shape: "h",
        });
      });

      if (hasMoreMenus) {
        const moreId = "more:menu";
        nodes.push({
          id: moreId,
          cat: "menu",
          label: `全部 ${graph.menus.length} 项页面 →`,
          x: menuX,
          y: stackY(totalMenuSlots, previewMenus.length, menuTop, menuBottom, 46),
          size: 14,
          kind: "item",
          align: "left",
          tone: "ok",
          clickable: true,
          ariaLabel: `展开全部 ${graph.menus.length} 项页面`,
          from: "hub:menu",
          delay: 0.18,
          expandModule: "menu",
        });
        links.push({
          a: "hub:menu",
          b: moreId,
          cat: "menu",
          toCat: "menu",
          active: true,
          dashed: true,
          shape: "h",
        });
      }
    }

    return { nodes, links };
  }

  /* ── 第 2 层：分类完整展开 ── */
  if (state.layer === "module" && state.moduleCat) {
    const cat = state.moduleCat;
    // Below tablet width, the breadcrumb and category switcher already provide
    // navigation. Give the actual entity cards the full stage width.
    const compactModule = stageW <= 760;
    const coreX = Math.max(88, stageW * 0.1);
    const cy = stageH * 0.5;
    const colX = coreX + Math.min(180, stageW * 0.17);

    const nodes: StageNode[] = compactModule ? [] : [
      {
        id: "core",
        label: "返回全景",
        x: coreX,
        y: cy,
        size: 62,
        kind: "core",
        clickable: true,
        ariaLabel: "返回权限全景",
      },
    ];
    const links: StageLink[] = [];

    const orderedHubs = [
      hubSpecs.find((item) => item.cat === cat)!,
      ...hubSpecs.filter((item) => item.cat !== cat),
    ];
    const hubYs = [cy, cy - 148, cy + 148];

    orderedHubs.forEach((hub, index) => {
      if (compactModule) return;
      const id = `hub:${hub.cat}`;
      const isCurrent = index === 0;
      nodes.push({
        id,
        cat: hub.cat,
        rawId: hub.cat,
        label: hub.label,
        count: hub.count,
        ratio: hub.ratio,
        x: colX,
        y: hubYs[index],
        size: isCurrent ? 104 : 68,
        kind: "hub",
        active: isCurrent,
        clickable: true,
        ariaLabel: hub.ariaLabel,
      });
      links.push({
        a: "core",
        b: id,
        cat: hub.cat,
        toCat: hub.cat,
        active: isCurrent,
        shape: "h",
      });
    });

    type RawItem = {
      id: string;
      label: string;
      sub?: string;
      badge: string;
      tone: "ok" | "off" | "danger";
      ariaLabel: string;
    };

    let allItems: RawItem[] = [];
    if (cat === "role") {
      allItems = graph.roles.map((role) => {
        const holderCount = usersForRole(graph, role.id).length;
        const pageCount = graph.menus.filter((menu) => {
          const st = roleMenuGrantState(role, menu);
          return st !== "none" && st !== "inactive";
        }).length;
        const active = isActivePermissionRecord(role);
        return {
          id: role.id,
          label: role.name,
          sub: !active ? "已停用" : holderCount ? `${holderCount} 个账号使用` : "暂无人使用",
          badge: `${pageCount} 项页面`,
          tone: !active ? "off" : holderCount === 0 ? "danger" : "ok",
          ariaLabel: `角色：${role.name}`,
        };
      });
    } else if (cat === "user") {
      allItems = graph.users.map((user) => {
        const roles = effectiveRoleAssignments(graph, user);
        const active = isActivePermissionRecord(user);
        return {
          id: user.id,
          label: user.display_name || user.username,
          sub: !active
            ? "已停用"
            : roles.length
              ? roles.map((item) => item.role.name).join("、")
              : "未分配角色",
          badge: user.username,
          tone: !active ? "off" : roles.length === 0 ? "danger" : "ok",
          ariaLabel: `用户：${user.display_name || user.username}`,
        };
      });
    } else {
      allItems = graph.menus.map((menu) => {
        const roles = rolesForMenu(graph, menu);
        const users = usersForMenu(graph, menu);
        const managers = users.filter((u) => userCanManageMenu(graph, u, menu));
        return {
          id: menu.id,
          label: menu.label,
          sub: roles.length
            ? managers.length
              ? `${managers.length} 人可管理 · 共 ${users.length} 人可访问`
              : `${users.length} 人可查看`
            : "暂无人可访问",
          badge: roles.map((r) => r.name).slice(0, 2).join(" / ") || "未授权",
          tone: roles.length === 0 ? "danger" : "ok",
          ariaLabel: `页面 / 操作：${menu.label}`,
        };
      });
    }

    const pageSize = 7;
    const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize));
    const currentPage = Math.max(1, Math.min(totalPages, state.modulePage ?? 1));
    const items = allItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const itemX = compactModule ? stageW / 2 : Math.max(colX + 210, stageW * 0.49);
    const top = compactModule ? 126 : 86;
    const bottom = stageH - (compactModule ? 108 : 80);

    items.forEach((item, index) => {
      const id = `${cat}:${item.id}`;
      nodes.push({
        id,
        cat,
        rawId: item.id,
        label: item.label,
        sub: item.sub,
        badge: item.badge,
        x: itemX,
        y: stackY(items.length, index, top, bottom, 64),
        size: 16,
        kind: "item",
        align: compactModule ? "center" : "left",
        tone: item.tone,
        clickable: true,
        ariaLabel: item.ariaLabel,
        from: `hub:${cat}`,
        delay: index * 0.02,
      });
      if (!compactModule) {
        links.push({
          a: `hub:${cat}`,
          b: id,
          cat,
          toCat: cat,
          active: true,
          shape: "h",
        });
      }
    });

    return {
      nodes,
      links,
      modulePagination: {
        page: currentPage,
        totalPages,
        totalItems: allItems.length,
      },
    };
  }

  /* ── 第 3 层：实体授权链路（左：用户 → 中：角色 → 右：可访问页面） ── */
  const sel = state.selected;
  if (!sel) {
    return buildScene(graph, { ...state, layer: "hub" }, width, height);
  }

  const selectedExists =
    (sel.cat === "user" && graph.users.some((item) => item.id === sel.id)) ||
    (sel.cat === "role" && graph.roles.some((item) => item.id === sel.id)) ||
    (sel.cat === "menu" && graph.menus.some((item) => item.id === sel.id)) ||
    (sel.cat === "permission" && graph.catalog.some((item) => item.key === sel.id));
  if (!selectedExists) {
    // A stale deep link or a deleted record must never show another record's
    // authorization chain as if it belonged to the selection.
    return { nodes: [], links: [] };
  }

  const nodes: StageNode[] = [];
  const links: StageLink[] = [];
  const compactEntity = width <= 900;
  const top = compactEntity ? 80 : 98;
  const bottom = compactEntity ? Math.min(stageH - 76, stageH * 0.44) : stageH - 76;
  const leftX = compactEntity ? stageW / 6 : Math.max(195, stageW * 0.21);
  const midX = stageW / 2;
  const rightX = compactEntity
    ? (stageW * 5) / 6
    : Math.min(stageW - 195, stageW * 0.79);
  const centerId = `${sel.cat}:${sel.id}`;

  const placeColumn = <T,>(
    list: T[],
    delayBase: number,
    make: (item: T, y: number, index: number) => StageNode,
  ) => {
    const capped = list.slice(0, 8);
    capped.forEach((item, index) => {
      const node = make(
        item,
        stackY(capped.length, index, top, bottom, compactEntity ? 34 : 62),
        index,
      );
      if (!node.active) {
        node.from = centerId;
        node.delay = delayBase + index * 0.02;
      }
      nodes.push(node);
    });
  };

  let users: PermissionGraphUser[] = [];
  let roles: PermissionGraphRole[] = [];
  let menus: PermissionGraphMenu[] = [];
  let focalPermission: PermissionGraphPermission | null = null;

  if (sel.cat === "user") {
    const user = graph.users.find((item) => item.id === sel.id);
    if (user) {
      users = [user];
      roles = effectiveRoleAssignments(graph, user).map((item) => item.role);
      menus = graph.menus.filter((menu) =>
        roles.some((role) => {
          const st = roleMenuGrantState(role, menu);
          return st !== "none" && st !== "inactive";
        }),
      );
    }
  } else if (sel.cat === "role") {
    const role = graph.roles.find((item) => item.id === sel.id);
    if (role) {
      roles = [role];
      users = usersForRole(graph, role.id);
      menus = graph.menus.filter((menu) => {
        const st = roleMenuGrantState(role, menu);
        return st !== "none" && st !== "inactive";
      });
    }
  } else if (sel.cat === "menu") {
    const menu = graph.menus.find((item) => item.id === sel.id);
    if (menu) {
      menus = [menu];
      roles = rolesForMenu(graph, menu);
      users = usersForMenu(graph, menu);
    }
  } else if (sel.cat === "permission") {
    focalPermission = graph.catalog.find((item) => item.key === sel.id) ?? null;
    const permKey = sel.id;
    roles = graph.roles.filter(
      (role) =>
        permissionGrantState(role, permKey) !== "none" &&
        permissionGrantState(role, permKey) !== "inactive",
    );
    users = graph.users.filter((user) => permissionSourcesForUser(graph, user, permKey).length > 0);
    menus = graph.menus.filter((menu) => permissionForMenu(menu) === permKey);
  }

  const activeRoleForImplication = sel.cat === "role" ? roles[0] : null;
  const activeUserForBadge = sel.cat === "user" ? users[0] : null;
  const activeMenuForBadge = sel.cat === "menu" ? menus[0] : null;

  placeColumn(users, 0.015, (user, y) => {
    const active = isActivePermissionRecord(user);
    const badge = activeMenuForBadge
      ? userCanManageMenu(graph, user, activeMenuForBadge)
        ? "可管理"
        : "仅查看"
      : undefined;
    return {
      id: `user:${user.id}`,
      cat: "user",
      rawId: user.id,
      label: user.display_name || user.username,
      sub: active ? undefined : "已停用",
      badge,
      x: leftX,
      y,
      size: sel.cat === "user" && user.id === sel.id ? 22 : 16,
      kind: "item",
      align: compactEntity ? "center" : "right",
      tone: active ? "ok" : "off",
      active: sel.cat === "user" && user.id === sel.id,
      clickable: true,
      ariaLabel: `用户：${user.display_name || user.username}`,
    };
  });

  placeColumn(roles, 0.03, (role, y) => {
    const active = isActivePermissionRecord(role);
    const holderCount = usersForRole(graph, role.id).length;
    const badge = activeMenuForBadge
      ? roleCanManageMenu(graph, role, activeMenuForBadge)
        ? "可管理"
        : "仅查看"
      : `${holderCount} 人`;
    return {
      id: `role:${role.id}`,
      cat: "role",
      rawId: role.id,
      label: role.name,
      badge,
      x: midX,
      y,
      size: sel.cat === "role" && role.id === sel.id ? 22 : 18,
      kind: "item",
      align: "center",
      tone: !active ? "off" : holderCount === 0 ? "danger" : "ok",
      active: sel.cat === "role" && role.id === sel.id,
      clickable: true,
      ariaLabel: `角色：${role.name}`,
    };
  });

  if (sel.cat === "permission" && focalPermission && menus.length === 0) {
    placeColumn([focalPermission], 0.05, (perm, y) => ({
      id: `permission:${perm.key}`,
      cat: "permission",
      rawId: perm.key,
      label: perm.label,
      x: rightX,
      y,
      size: 22,
      kind: "item",
      align: compactEntity ? "center" : "left",
      tone: "ok",
      active: true,
      clickable: true,
      ariaLabel: `权限：${perm.label}`,
    }));
  } else {
    placeColumn(menus, 0.05, (menu, y) => {
      let sub: string | undefined;
      if (activeRoleForImplication) {
        const state = roleMenuGrantState(activeRoleForImplication, menu);
        if (state === "implied") {
          const sources = implicationSources(
            graph,
            activeRoleForImplication,
            permissionForMenu(menu),
          );
          const sourceLabels = sources.map(
            (key) => graph.catalog.find((item) => item.key === key)?.label ?? key,
          );
          sub = sourceLabels.length ? `由「${sourceLabels.join("、")}」包含` : "自动包含";
        }
      }
      const canManage = activeRoleForImplication
        ? roleCanManageMenu(graph, activeRoleForImplication, menu)
        : activeUserForBadge
          ? userCanManageMenu(graph, activeUserForBadge, menu)
          : roles.some((r) => roleCanManageMenu(graph, r, menu));

      return {
        id: `menu:${menu.id}`,
        cat: "menu",
        rawId: menu.id,
        label: menu.label,
        sub,
        badge: canManage ? "可管理" : "仅查看",
        x: rightX,
        y,
        size: sel.cat === "menu" && menu.id === sel.id ? 22 : 16,
        kind: "item",
        align: compactEntity ? "center" : "left",
        tone: "ok",
        active: sel.cat === "menu" && menu.id === sel.id,
        clickable: true,
        ariaLabel: `页面 / 操作：${menu.label}`,
      };
    });
  }

  const placedIds = new Set(nodes.map((node) => node.id));
  users.forEach((user) => {
    const userNodeId = `user:${user.id}`;
    if (!placedIds.has(userNodeId)) return;
    const assignedIds = new Set(effectiveRoleAssignments(graph, user).map((item) => item.role.id));
    roles.forEach((role) => {
      const roleNodeId = `role:${role.id}`;
      if (placedIds.has(roleNodeId) && assignedIds.has(role.id)) {
        links.push({
          a: userNodeId,
          b: roleNodeId,
          cat: "user",
          toCat: "role",
          active: true,
          shape: "h",
        });
      }
    });
  });

  roles.forEach((role) => {
    const roleNodeId = `role:${role.id}`;
    if (!placedIds.has(roleNodeId)) return;
    if (sel.cat === "permission" && focalPermission && menus.length === 0) {
      const permNodeId = `permission:${focalPermission.key}`;
      if (placedIds.has(permNodeId)) {
        links.push({
          a: roleNodeId,
          b: permNodeId,
          cat: "role",
          toCat: "permission",
          active: true,
          shape: "h",
        });
      }
      return;
    }
    menus.forEach((menu) => {
      const menuNodeId = `menu:${menu.id}`;
      if (!placedIds.has(menuNodeId)) return;
      const state = roleMenuGrantState(role, menu);
      if (state !== "none" && state !== "inactive") {
        links.push({
          a: roleNodeId,
          b: menuNodeId,
          cat: "role",
          toCat: "menu",
          active: true,
          dashed: state === "implied",
          shape: "h",
        });
      }
    });
  });

  return { nodes, links };
}
