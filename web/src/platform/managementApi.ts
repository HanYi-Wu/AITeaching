import { buildQuery, platformRequest } from "./platformRequest";
import type { PlatformUser, SchoolAccountRecord } from "./authTypes";

export type ManagementScope = "admin" | "school";
export type PermissionDescriptor = {
  key: string; label: string; group: string; description: string; assignable: boolean;
  methods: string[]; paths: string[];
};
export type ManagementRole = {
  id: string; school_id: string; name: string; description: string; status: "active" | "disabled";
  permissions: string[]; user_count?: number; created_at: string; updated_at: string;
};
export type ManagementAccess = {
  role: PlatformUser["role"]; school_id: string | null; full_access: boolean;
  effective_permissions: string[]; catalog: PermissionDescriptor[]; assigned_roles: ManagementRole[];
};
export type ManagementUserAccess = { user: SchoolAccountRecord; access: ManagementAccess };
export type ManagementRolePayload = { name: string; description?: string; status?: "active" | "disabled"; permissions: string[] };
export type ManagementUserAccessPayload = { mode: "full" | "custom"; role_ids: string[] };
export type ManagementPage = { total: number; page: number; page_size: number; total_pages: number };
export type ManagementUserQuery = { q?: string; status?: string; page?: number; pageSize?: number };

function prefix(scope: ManagementScope) { return `/api/${scope}/management`; }
function schoolPrefix(scope: ManagementScope, schoolId?: string) {
  if (scope === "school") return prefix(scope);
  if (!schoolId) throw new Error("请先选择学校");
  return `/api/admin/schools/${encodeURIComponent(schoolId)}/management`;
}
function jsonRequest<T>(path: string, method: string, payload: unknown): Promise<T> {
  return platformRequest(path, { method, body: JSON.stringify(payload) });
}

export function getManagementAccess(scope: ManagementScope): Promise<ManagementAccess> {
  return platformRequest(`${prefix(scope)}/access`);
}
export function listManagementRoles(scope: ManagementScope, schoolId?: string): Promise<{ roles: ManagementRole[] }> {
  return platformRequest(`${schoolPrefix(scope, schoolId)}/roles`);
}
export function createManagementRole(scope: ManagementScope, payload: ManagementRolePayload, schoolId?: string): Promise<{ role: ManagementRole }> {
  return jsonRequest(`${schoolPrefix(scope, schoolId)}/roles`, "POST", payload);
}
export function updateManagementRole(scope: ManagementScope, roleId: string, payload: Partial<ManagementRolePayload>, schoolId?: string): Promise<{ role: ManagementRole }> {
  return jsonRequest(`${schoolPrefix(scope, schoolId)}/roles/${encodeURIComponent(roleId)}`, "PATCH", payload);
}
export function listManagementUsers(scope: ManagementScope, params: ManagementUserQuery = {}, schoolId?: string): Promise<{ users: SchoolAccountRecord[] } & ManagementPage> {
  const query = buildQuery({ q: params.q, status: params.status, page: params.page, page_size: params.pageSize });
  if (scope === "admin") {
    if (!schoolId) return Promise.reject(new Error("请先选择学校"));
    return platformRequest(`/api/schools/${encodeURIComponent(schoolId)}/school-users${query}`);
  }
  return platformRequest(`${prefix(scope)}/users${query}`);
}
export function getManagementUserAccess(scope: ManagementScope, userId: string, schoolId?: string): Promise<ManagementUserAccess> {
  return platformRequest(`${schoolPrefix(scope, schoolId)}/users/${encodeURIComponent(userId)}/access`);
}
export function updateManagementUserAccess(scope: ManagementScope, userId: string, payload: ManagementUserAccessPayload, schoolId?: string): Promise<ManagementUserAccess> {
  return jsonRequest(`${schoolPrefix(scope, schoolId)}/users/${encodeURIComponent(userId)}/access`, "PATCH", payload);
}

export type AuditEvent = {
  id: string; occurred_at: string; actor_id: string | null; actor_role: string; actor_name: string;
  actor_school_id: string | null; school_id: string | null; school_name: string | null;
  action: string; action_label: string; resource_type: string; resource_id: string | null;
  outcome: "success" | "denied" | "failure"; affected_count: number; request_id: string;
  http_status: number; method: string; route_path: string;
};
export type AuditQuery = {
  school_id?: string; q?: string; action?: string; outcome?: string; date_from?: string; date_to?: string;
  page?: number; pageSize?: number;
};
export type ManagementAuditResponse = ManagementPage & { events: AuditEvent[]; actions: { key: string; label: string }[] };
export function listManagementAudit(scope: ManagementScope, params: AuditQuery = {}): Promise<ManagementAuditResponse> {
  return platformRequest(`${prefix(scope)}/audit-events${buildQuery({
    school_id: scope === "admin" ? params.school_id : undefined, q: params.q, action: params.action,
    outcome: params.outcome, date_from: params.date_from, date_to: params.date_to, page: params.page, page_size: params.pageSize,
  })}`);
}

export type ManagementActivity = {
  metric: "management_activity"; timezone: string; date_from: string; date_to: string;
  summary: { operation_count: number; active_accounts: number; active_schools: number };
  days: { date: string; operation_count: number; active_accounts: number }[];
  schools: { school_id: string; school_name: string; operation_count: number; active_accounts: number }[];
  heatmap: { rows: { school_id: string; school_name: string }[]; columns: string[]; matrix: number[][] };
  coverage: { started_at: string | null; description: string };
};
export function getManagementActivity(scope: ManagementScope, params: { days?: number; school_id?: string } = {}): Promise<ManagementActivity> {
  return platformRequest(`${prefix(scope)}/activity${buildQuery({ days: params.days, school_id: scope === "admin" ? params.school_id : undefined })}`);
}

export type ManagementSettings = { default_page_size: number; activity_default_days: number };
export type ManagementSettingsPatch = { default_page_size?: number | null; activity_default_days?: number | null };
export type ManagementSettingsResponse = {
  settings: ManagementSettings; overrides: { default_page_size: number | null; activity_default_days: number | null };
  inherited_settings?: ManagementSettings;
  sources: { default_page_size: "builtin" | "platform" | "school"; activity_default_days: "builtin" | "platform" | "school" };
};
export type DictionaryCategory = "subjects" | "grades";
export type ManagementDictionaryItem = {
  id: string; category: DictionaryCategory; value: string; label: string; sort_order: number;
  status: "active" | "disabled"; school_id: string | null; source: "builtin" | "platform" | "school";
  created_at?: string; updated_at?: string;
};
export type ManagementDictionaryPayload = {
  category: DictionaryCategory; value: string; label: string; sort_order?: number; status?: "active" | "disabled";
};
export type ManagementDictionaryResponse = { category: DictionaryCategory; items: ManagementDictionaryItem[]; effective_items: ManagementDictionaryItem[] };
export type ManagementOptions = { settings: ManagementSettings; subjects: ManagementDictionaryItem[]; grades: ManagementDictionaryItem[] };

export function getManagementSettings(scope: ManagementScope): Promise<ManagementSettingsResponse> {
  return platformRequest(`${prefix(scope)}/settings`);
}
export function updateManagementSettings(scope: ManagementScope, payload: ManagementSettingsPatch): Promise<ManagementSettingsResponse> {
  return jsonRequest(`${prefix(scope)}/settings`, "PATCH", payload);
}
export function listManagementDictionary(scope: ManagementScope, category: DictionaryCategory): Promise<ManagementDictionaryResponse> {
  return platformRequest(`${prefix(scope)}/dictionaries${buildQuery({ category })}`);
}
export function createManagementDictionaryItem(scope: ManagementScope, payload: ManagementDictionaryPayload): Promise<{ item: ManagementDictionaryItem }> {
  return jsonRequest(`${prefix(scope)}/dictionaries`, "POST", payload);
}
export function updateManagementDictionaryItem(scope: ManagementScope, itemId: string, payload: Partial<ManagementDictionaryPayload>): Promise<{ item: ManagementDictionaryItem }> {
  return jsonRequest(`${prefix(scope)}/dictionaries/${encodeURIComponent(itemId)}`, "PATCH", payload);
}
export function getManagementOptions(scope: ManagementScope): Promise<ManagementOptions> {
  return platformRequest(`${prefix(scope)}/options`);
}
