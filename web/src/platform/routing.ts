import type { PlatformRole } from "./roles";

export type PlatformRoute =
  | "loading"
  | "unavailable"
  | "bootstrap"
  | "login"
  | "admin"
  | "school"
  | "teacher"
  | "student";

export type PlatformRouteInput = {
  loading: boolean;
  adminExists: boolean;
  userRole: PlatformRole | null;
  adminProjectMode: boolean;
  statusAvailable?: boolean;
};

export function resolvePlatformRoute(input: PlatformRouteInput): PlatformRoute {
  if (input.loading) return "loading";
  if (input.statusAvailable === false) return "unavailable";
  if (input.userRole === null) return input.adminExists ? "login" : "bootstrap";
  if (input.userRole === "admin") return input.adminProjectMode ? "teacher" : "admin";
  return input.userRole;
}
