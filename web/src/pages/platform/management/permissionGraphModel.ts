import type {
  ManagementPermissionGraph,
  PermissionGraphMenu,
  PermissionGraphRole,
  PermissionGraphUser,
} from "../../../platform/managementGraphApi";

export type PermissionExplorerTarget = {
  kind: "user" | "role" | "menu" | "permission";
  id: string;
};

export type PermissionGrantState = "explicit" | "implied" | "builtin" | "inactive" | "none";

export type EffectiveRoleAssignment = {
  role: PermissionGraphRole;
  source: "builtin" | "assigned";
};

export type PermissionNavigationGroup = {
  id: string;
  label: string;
  menus: PermissionGraphMenu[];
};

const isActive = (status: string) => status.toLowerCase() === "active";

export function permissionForMenu(menu: PermissionGraphMenu) {
  return menu.permission.trim();
}

export function navigationIdForMenu(menu: PermissionGraphMenu) {
  return menu.section.trim() || menu.group.trim() || "unassigned";
}

export function navigationGroupsForMenus(menus: PermissionGraphMenu[]): PermissionNavigationGroup[] {
  const groups = new Map<string, PermissionNavigationGroup>();
  menus.forEach((menu) => {
    const id = navigationIdForMenu(menu);
    const group = groups.get(id) ?? {
      id,
      label: menu.group.trim() || (id === "unassigned" ? "未分类导航" : "导航分组"),
      menus: [],
    };
    group.menus.push(menu);
    groups.set(id, group);
  });
  return [...groups.values()];
}

/**
 * Resolve only live sources. A full access account is represented by the
 * virtual full role; old custom role bindings are intentionally ignored.
 */
export function effectiveRoleAssignments(
  graph: ManagementPermissionGraph,
  user: PermissionGraphUser,
): EffectiveRoleAssignment[] {
  if (!isActive(user.status)) return [];

  if (user.mode === "full") {
    const role = graph.roles.find((item) => item.kind === "full" && isActive(item.status));
    return role ? [{ role, source: "builtin" }] : [];
  }

  const roles = new Map(graph.roles.map((role) => [role.id, role]));
  const seen = new Set<string>();
  const result: EffectiveRoleAssignment[] = [];
  for (const assignment of graph.assignments) {
    if (assignment.user_id !== user.id || !assignment.active || seen.has(assignment.role_id)) continue;
    const role = roles.get(assignment.role_id);
    if (!role || !isActive(role.status) || role.kind === "full") continue;
    if (role.kind === "base" && assignment.source !== "builtin") continue;
    if (role.kind === "custom" && assignment.source !== "assigned") continue;
    seen.add(role.id);
    result.push({ role, source: role.kind === "base" ? "builtin" : "assigned" });
  }
  return result;
}

export function permissionGrantState(
  role: PermissionGraphRole,
  permissionKey: string,
): PermissionGrantState {
  if (!isActive(role.status)) return "inactive";
  if (!permissionKey || !role.effective_permissions.includes(permissionKey)) return "none";
  if (role.kind === "base" || role.kind === "full") return "builtin";
  return role.permissions.includes(permissionKey) ? "explicit" : "implied";
}

export function roleMenuGrantState(
  role: PermissionGraphRole,
  menu: PermissionGraphMenu,
): PermissionGrantState {
  return permissionGrantState(role, permissionForMenu(menu));
}

export function permissionSourcesForUser(
  graph: ManagementPermissionGraph,
  user: PermissionGraphUser,
  permissionKey: string,
): EffectiveRoleAssignment[] {
  if (!isActive(user.status) || !user.effective_permissions.includes(permissionKey)) return [];
  return effectiveRoleAssignments(graph, user).filter(
    ({ role }) => permissionGrantState(role, permissionKey) !== "none",
  );
}

export function usersForRole(
  graph: ManagementPermissionGraph,
  roleId: string,
): PermissionGraphUser[] {
  const role = graph.roles.find((item) => item.id === roleId);
  if (!role || !isActive(role.status)) return [];
  return graph.users.filter((user) =>
    effectiveRoleAssignments(graph, user).some((item) => item.role.id === roleId),
  );
}

export function rolesForMenu(
  graph: ManagementPermissionGraph,
  menu: PermissionGraphMenu,
): PermissionGraphRole[] {
  return graph.roles.filter((role) => {
    const state = roleMenuGrantState(role, menu);
    return state !== "none" && state !== "inactive";
  });
}

export function usersForMenu(
  graph: ManagementPermissionGraph,
  menu: PermissionGraphMenu,
): PermissionGraphUser[] {
  const permissionKey = permissionForMenu(menu);
  if (!permissionKey) return [];
  return graph.users.filter((user) =>
    permissionSourcesForUser(graph, user, permissionKey).length > 0,
  );
}

export function implicationPath(
  graph: ManagementPermissionGraph,
  sources: string[],
  target: string,
): string[] | null {
  const nextBySource = new Map<string, string[]>();
  graph.implications.forEach(({ source, target: next }) => {
    const list = nextBySource.get(source) ?? [];
    list.push(next);
    nextBySource.set(source, list);
  });

  for (const source of sources) {
    const queue: Array<{ key: string; path: string[] }> = [{ key: source, path: [source] }];
    const visited = new Set<string>([source]);
    while (queue.length) {
      const item = queue.shift()!;
      for (const key of nextBySource.get(item.key) ?? []) {
        if (key === target) return [...item.path, key];
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ key, path: [...item.path, key] });
        }
      }
    }
  }
  return null;
}

export function implicationSources(
  graph: ManagementPermissionGraph,
  role: PermissionGraphRole,
  permissionKey: string,
): string[] {
  const path = implicationPath(graph, role.permissions, permissionKey);
  return path?.slice(0, -1) ?? [];
}

export function activePermissionKeysForUser(user: PermissionGraphUser) {
  return isActive(user.status) ? new Set(user.effective_permissions) : new Set<string>();
}

export function isActivePermissionRecord(user: PermissionGraphUser | PermissionGraphRole) {
  return isActive(user.status);
}

