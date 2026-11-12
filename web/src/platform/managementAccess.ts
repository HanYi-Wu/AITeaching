import type { PlatformUser } from "./authTypes";

const BASE_SCHOOL_PERMISSIONS = new Set(["school.overview.read", "school.access.read", "school.options.read"]);

export function canManage(user: PlatformUser, permission: string): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "school") return false;
  if (Array.isArray(user.management_permissions)) return user.management_permissions.includes(permission);
  if (user.school_access_mode === "custom") return BASE_SCHOOL_PERMISSIONS.has(permission);
  // Older clients and the existing full-access school accounts remain compatible.
  return true;
}
