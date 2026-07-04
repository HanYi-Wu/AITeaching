export type PlatformRole = "admin" | "school" | "teacher" | "student";

export function roleLabel(role: PlatformRole): string {
  switch (role) {
    case "admin":
      return "管理员";
    case "school":
      return "学校端";
    case "teacher":
      return "教师端";
    case "student":
      return "学生端";
  }
}

export function roleHomePage(role: PlatformRole): "admin" | "school" | "compose" | "student" {
  switch (role) {
    case "admin":
      return "admin";
    case "school":
      return "school";
    case "teacher":
      return "compose";
    case "student":
      return "student";
  }
}

export function canUseTeacherWorkspace(role: PlatformRole): boolean {
  return role === "teacher" || role === "admin";
}
