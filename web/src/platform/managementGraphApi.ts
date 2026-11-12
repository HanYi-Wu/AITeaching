import { buildQuery, platformRequest } from "./platformRequest";
import type { ManagementScope, PermissionDescriptor } from "./managementApi";

export type PermissionGraphUser = {
  id: string;
  username: string;
  display_name: string;
  status: string;
  mode: "full" | "custom";
  role_ids: string[];
  effective_permissions: string[];
};

export type PermissionGraphRole = {
  id: string;
  name: string;
  status: string;
  builtin: boolean;
  kind: "base" | "full" | "custom";
  permissions: string[];
  effective_permissions: string[];
  user_count: number;
};

export type PermissionGraphMenu = {
  id: string;
  label: string;
  section: string;
  permission: string;
  group: string;
};

export type PermissionGraphPermission = PermissionDescriptor & {
  routes: Array<{ method: string; path: string }>;
};

export type ManagementPermissionGraph = {
  school: { id: string; name: string };
  self_only: boolean;
  users: PermissionGraphUser[];
  roles: PermissionGraphRole[];
  menus: PermissionGraphMenu[];
  catalog: PermissionGraphPermission[];
  assignments: Array<{ user_id: string; role_id: string; active: boolean; source: "builtin" | "assigned" }>;
  implications: Array<{ source: string; target: string }>;
  summary: {
    user_count: number;
    role_count: number;
    menu_count: number;
    unused_roles: number;
    unassigned_users: number;
    unreachable_menus: number;
  };
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  coverage: { returned_users: number; total_users: number; roles_truncated: boolean };
};

export function getManagementPermissionGraph(
  scope: ManagementScope,
  params: { schoolId?: string; q?: string; page?: number; pageSize?: number } = {},
): Promise<ManagementPermissionGraph> {
  if (scope === "admin" && !params.schoolId) return Promise.reject(new Error("请先选择学校"));
  const base = scope === "admin"
    ? `/api/admin/schools/${encodeURIComponent(params.schoolId!)}/management`
    : "/api/school/management";
  return platformRequest(`${base}/permission-graph${buildQuery({ q: params.q, page: params.page, page_size: params.pageSize })}`);
}
